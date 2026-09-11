import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

const app = await buildApp();
const testPassword = `Test-${'x'.repeat(40)}`;
const emails = {
  user: 'rbac-user@example.test',
  other: 'rbac-other@example.test',
  admin: 'rbac-admin@example.test',
};

let user: any;
let other: any;
let admin: any;
let resourceId = '';
let reservationId = '';

async function register(email: string, name: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    payload: { name, email, password: testPassword },
  });
  expect(response.statusCode).toBe(201);
  return response.json();
}

beforeAll(async () => {
  await app.ready();
  await prisma.resource.deleteMany({ where: { slug: { startsWith: 'rbac-' } } });
  await prisma.user.deleteMany({ where: { email: { in: Object.values(emails) } } });

  user = await register(emails.user, 'RBAC User');
  other = await register(emails.other, 'RBAC Other');
  admin = await register(emails.admin, 'RBAC Admin');

  await prisma.user.update({
    where: { id: admin.user.id },
    data: { role: 'ADMIN' },
  });

  const login = await app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    payload: { email: emails.admin, password: testPassword },
  });
  expect(login.statusCode).toBe(200);
  admin.accessToken = login.json().accessToken;
});

afterAll(async () => {
  await prisma.resource.deleteMany({ where: { slug: { startsWith: 'rbac-' } } });
  await prisma.user.deleteMany({ where: { email: { in: Object.values(emails) } } });
  await app.close();
  await prisma.$disconnect();
});

describe('authentication and RBAC', () => {
  it('rejects unauthenticated access and USER resource creation', async () => {
    const anonymous = await app.inject({ method: 'GET', url: '/v1/reservations' });
    expect(anonymous.statusCode).toBe(401);

    const forbidden = await app.inject({
      method: 'POST',
      url: '/v1/resources',
      headers: { authorization: `Bearer ${user.accessToken}` },
      payload: { name: 'Forbidden', slug: 'rbac-forbidden' },
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it('lets ADMIN create resources and enforces reservation ownership', async () => {
    const createdResource = await app.inject({
      method: 'POST',
      url: '/v1/resources',
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { name: 'RBAC Resource', slug: 'rbac-resource' },
    });
    expect(createdResource.statusCode).toBe(201);
    resourceId = createdResource.json().id;

    const createdReservation = await app.inject({
      method: 'POST',
      url: '/v1/reservations',
      headers: {
        authorization: `Bearer ${user.accessToken}`,
        'idempotency-key': 'rbac-reservation-001',
      },
      payload: {
        resourceId,
        startsAt: '2026-11-01T14:00:00.000Z',
        endsAt: '2026-11-01T15:00:00.000Z',
      },
    });
    expect(createdReservation.statusCode).toBe(201);
    reservationId = createdReservation.json().id;
    expect(createdReservation.json().userId).toBe(user.user.id);

    const hidden = await app.inject({
      method: 'GET',
      url: `/v1/reservations/${reservationId}`,
      headers: { authorization: `Bearer ${other.accessToken}` },
    });
    expect(hidden.statusCode).toBe(404);

    const visible = await app.inject({
      method: 'GET',
      url: `/v1/reservations/${reservationId}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });
    expect(visible.statusCode).toBe(200);
  });

  it('rotates refresh tokens and rejects replay', async () => {
    const rotated = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: user.refreshToken },
    });
    expect(rotated.statusCode).toBe(200);

    const replay = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: user.refreshToken },
    });
    expect(replay.statusCode).toBe(401);
  });

  it('rejects cross-user idempotency-key reuse', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/reservations',
      headers: {
        authorization: `Bearer ${other.accessToken}`,
        'idempotency-key': 'rbac-reservation-001',
      },
      payload: {
        resourceId,
        startsAt: '2026-11-01T14:00:00.000Z',
        endsAt: '2026-11-01T15:00:00.000Z',
      },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe('IDEMPOTENCY_KEY_REUSED');
  });
});
