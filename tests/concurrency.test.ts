import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

const app = await buildApp();
let resourceId: string;
let accessToken: string;
let userId: string;

beforeAll(async () => {
  await app.ready();

  await prisma.resource.deleteMany({
    where: { slug: 'concorrencia-test' },
  });

  await prisma.user.deleteMany({
    where: { email: 'concurrency-user@example.com' },
  });

  const register = await app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    payload: {
      name: 'Concurrency User',
      email: 'concurrency-user@example.com',
      password: 'Concurrency-Test-Password-2026',
    },
  });

  expect(register.statusCode).toBe(201);

  const auth = register.json();
  accessToken = auth.accessToken;
  userId = auth.user.id;

  const resource = await prisma.resource.create({
    data: { name: 'Concorrência Test', slug: 'concorrencia-test' },
  });

  resourceId = resource.id;
});

afterAll(async () => {
  await prisma.resource.deleteMany({
    where: { id: resourceId },
  });

  await prisma.user.deleteMany({
    where: { id: userId },
  });

  await app.close();
  await prisma.$disconnect();
});

describe('reservation concurrency', () => {
  it('allows only one confirmed reservation for 20 overlapping requests', async () => {
    const requests = Array.from({ length: 20 }, (_, index) =>
      app.inject({
        method: 'POST',
        url: '/v1/reservations',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
          'idempotency-key': `concurrency-${Date.now()}-${index}`,
        },
        payload: {
          resourceId,
          startsAt: '2026-10-10T14:00:00.000Z',
          endsAt: '2026-10-10T15:00:00.000Z',
        },
      }),
    );

    const responses = await Promise.all(requests);
    const created = responses.filter((response) => response.statusCode === 201);
    const conflicts = responses.filter((response) => response.statusCode === 409);

    expect(created).toHaveLength(1);
    expect(conflicts).toHaveLength(19);

    const confirmedCount = await prisma.reservation.count({
      where: {
        resourceId,
        userId,
        status: 'CONFIRMED',
      },
    });

    expect(confirmedCount).toBe(1);
  });
});
