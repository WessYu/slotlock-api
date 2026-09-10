import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

const app = await buildApp();
let resourceId: string;

beforeAll(async () => {
  await app.ready();

  await prisma.resource.deleteMany({
    where: { slug: 'availability-test' },
  });

  const resource = await prisma.resource.create({
    data: {
      name: 'Availability Test',
      slug: 'availability-test',
    },
  });

  resourceId = resource.id;

  await prisma.reservation.create({
    data: {
      resourceId,
      customerEmail: 'confirmed@example.com',
      startsAt: new Date('2026-10-20T13:00:00.000Z'),
      endsAt: new Date('2026-10-20T14:00:00.000Z'),
      idempotencyKey: 'availability-confirmed-test',
    },
  });

  await prisma.reservation.create({
    data: {
      resourceId,
      customerEmail: 'cancelled@example.com',
      startsAt: new Date('2026-10-20T15:00:00.000Z'),
      endsAt: new Date('2026-10-20T16:00:00.000Z'),
      status: 'CANCELLED',
      idempotencyKey: 'availability-cancelled-test',
    },
  });
});

afterAll(async () => {
  await prisma.resource.deleteMany({
    where: { id: resourceId },
  });
  await app.close();
  await prisma.$disconnect();
});

describe('resource availability', () => {
  it('returns fixed slots and respects half-open interval boundaries', async () => {
    const from = encodeURIComponent('2026-10-20T09:00:00-03:00');
    const to = encodeURIComponent('2026-10-20T12:00:00-03:00');

    const response = await app.inject({
      method: 'GET',
      url: `/v1/resources/${resourceId}/availability?from=${from}&to=${to}&slotMinutes=60`,
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();

    expect(body.window).toMatchObject({
      from: '2026-10-20T12:00:00.000Z',
      to: '2026-10-20T15:00:00.000Z',
      slotMinutes: 60,
      normalizedTo: 'UTC',
      intervalSemantics: '[start,end)',
    });

    expect(body.summary).toEqual({
      totalSlots: 3,
      availableSlots: 2,
      unavailableSlots: 1,
    });

    expect(body.slots).toEqual([
      {
        startsAt: '2026-10-20T12:00:00.000Z',
        endsAt: '2026-10-20T13:00:00.000Z',
        available: true,
      },
      {
        startsAt: '2026-10-20T13:00:00.000Z',
        endsAt: '2026-10-20T14:00:00.000Z',
        available: false,
      },
      {
        startsAt: '2026-10-20T14:00:00.000Z',
        endsAt: '2026-10-20T15:00:00.000Z',
        available: true,
      },
    ]);
  });

  it('ignores cancelled reservations', async () => {
    const from = encodeURIComponent('2026-10-20T12:00:00-03:00');
    const to = encodeURIComponent('2026-10-20T13:00:00-03:00');

    const response = await app.inject({
      method: 'GET',
      url: `/v1/resources/${resourceId}/availability?from=${from}&to=${to}&slotMinutes=60`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().slots).toEqual([
      {
        startsAt: '2026-10-20T15:00:00.000Z',
        endsAt: '2026-10-20T16:00:00.000Z',
        available: true,
      },
    ]);
  });

  it('rejects datetimes without an explicit timezone offset', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/resources/${resourceId}/availability?from=2026-10-20T09:00:00&to=2026-10-20T10:00:00&slotMinutes=60`,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('VALIDATION_ERROR');
  });

  it('returns 404 for an unknown resource', async () => {
    const from = encodeURIComponent('2026-10-20T09:00:00Z');
    const to = encodeURIComponent('2026-10-20T10:00:00Z');

    const response = await app.inject({
      method: 'GET',
      url: `/v1/resources/00000000-0000-4000-8000-000000000000/availability?from=${from}&to=${to}`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'RESOURCE_NOT_FOUND' });
  });
});
