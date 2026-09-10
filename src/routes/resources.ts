import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../lib/prisma.js';
import {
  availabilityParamsSchema,
  availabilityQuerySchema,
} from '../schemas/availability.js';

export const resourceRoutes: FastifyPluginAsync = async (app) => {
  app.get('/resources', async () => {
    return prisma.resource.findMany({ orderBy: { name: 'asc' } });
  });

  app.get('/resources/:id/availability', async (request, reply) => {
    const parsedParams = availabilityParamsSchema.safeParse(request.params);
    const parsedQuery = availabilityQuerySchema.safeParse(request.query);

    if (!parsedParams.success || !parsedQuery.success) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        issues: {
          params: parsedParams.success ? undefined : parsedParams.error.flatten(),
          query: parsedQuery.success ? undefined : parsedQuery.error.flatten(),
        },
      });
    }

    const { id } = parsedParams.data;
    const { from: fromInput, to: toInput, slotMinutes } = parsedQuery.data;

    const resource = await prisma.resource.findUnique({
      where: { id },
      select: { id: true, name: true, slug: true },
    });

    if (!resource) {
      return reply.code(404).send({ error: 'RESOURCE_NOT_FOUND' });
    }

    const from = new Date(fromInput);
    const to = new Date(toInput);

    const reservations = await prisma.reservation.findMany({
      where: {
        resourceId: id,
        status: 'CONFIRMED',
        startsAt: { lt: to },
        endsAt: { gt: from },
      },
      select: {
        startsAt: true,
        endsAt: true,
      },
      orderBy: { startsAt: 'asc' },
    });

    const slotMs = slotMinutes * 60 * 1000;
    const slots: Array<{
      startsAt: string;
      endsAt: string;
      available: boolean;
    }> = [];

    let reservationIndex = 0;

    for (let cursor = from.getTime(); cursor < to.getTime(); cursor += slotMs) {
      const slotEnd = cursor + slotMs;

      while (
        reservationIndex < reservations.length
        && reservations[reservationIndex].endsAt.getTime() <= cursor
      ) {
        reservationIndex += 1;
      }

      const reservation = reservations[reservationIndex];
      const isBlocked = Boolean(
        reservation
        && reservation.startsAt.getTime() < slotEnd
        && reservation.endsAt.getTime() > cursor,
      );

      slots.push({
        startsAt: new Date(cursor).toISOString(),
        endsAt: new Date(slotEnd).toISOString(),
        available: !isBlocked,
      });
    }

    const availableSlots = slots.filter((slot) => slot.available).length;

    return {
      resource,
      window: {
        from: from.toISOString(),
        to: to.toISOString(),
        slotMinutes,
        normalizedTo: 'UTC',
        intervalSemantics: '[start,end)',
      },
      summary: {
        totalSlots: slots.length,
        availableSlots,
        unavailableSlots: slots.length - availableSlots,
      },
      slots,
    };
  });
};
