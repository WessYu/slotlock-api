import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

const app = await buildApp();
let resourceId: string;

beforeAll(async () => {
  await app.ready();
  await prisma.reservation.deleteMany();
  await prisma.resource.deleteMany({ where: { slug: 'concorrencia-test' } });

  const resource = await prisma.resource.create({
    data: { name: 'Concorrência Test', slug: 'concorrencia-test' },
  });
  resourceId = resource.id;
});

afterAll(async () => {
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
          'content-type': 'application/json',
          'idempotency-key': `concurrency-${Date.now()}-${index}`,
        },
        payload: {
          resourceId,
          customerEmail: `candidate-${index}@example.com`,
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
      where: { resourceId, status: 'CONFIRMED' },
    });
    expect(confirmedCount).toBe(1);
  });
});
