import type { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@prisma/client';
import { authenticate, getAuthUser } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
import { createReservationSchema } from '../schemas/reservation.js';

function sameReservationPayload(
  reservation: {
    userId: string | null;
    resourceId: string;
    startsAt: Date;
    endsAt: Date;
  },
  userId: string,
  payload: {
    resourceId: string;
    startsAt: Date;
    endsAt: Date;
  },
) {
  return (
    reservation.userId === userId
    && reservation.resourceId === payload.resourceId
    && reservation.startsAt.getTime() === payload.startsAt.getTime()
    && reservation.endsAt.getTime() === payload.endsAt.getTime()
  );
}

export const reservationRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authenticate);

  app.get('/reservations', async (request) => {
    const user = getAuthUser(request);

    return prisma.reservation.findMany({
      where: user.role === 'ADMIN'
        ? undefined
        : { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
  });

  app.post('/reservations', async (request, reply) => {
    const user = getAuthUser(request);
    const idempotencyKey = request.headers['idempotency-key'];

    if (typeof idempotencyKey !== 'string' || idempotencyKey.trim().length < 8) {
      return reply.code(400).send({
        error: 'INVALID_IDEMPOTENCY_KEY',
        message: 'Send an Idempotency-Key header with at least 8 characters.',
      });
    }

    const parsed = createReservationSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        issues: parsed.error.flatten(),
      });
    }

    const existing = await prisma.reservation.findUnique({
      where: { idempotencyKey },
    });

    if (existing) {
      if (!sameReservationPayload(existing, user.id, parsed.data)) {
        return reply.code(409).send({ error: 'IDEMPOTENCY_KEY_REUSED' });
      }

      return reply.code(200).send(existing);
    }

    try {
      const reservation = await prisma.$transaction(async (tx) => {
        const resource = await tx.resource.findUnique({
          where: { id: parsed.data.resourceId },
          select: { id: true },
        });

        if (!resource) {
          throw new Error('RESOURCE_NOT_FOUND');
        }

        return tx.reservation.create({
          data: {
            resourceId: parsed.data.resourceId,
            userId: user.id,
            customerEmail: user.email,
            startsAt: parsed.data.startsAt,
            endsAt: parsed.data.endsAt,
            idempotencyKey,
          },
        });
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });

      return reply.code(201).send(reservation);
    } catch (error) {
      if (error instanceof Error && error.message === 'RESOURCE_NOT_FOUND') {
        return reply.code(404).send({ error: 'RESOURCE_NOT_FOUND' });
      }

      if (
        error instanceof Prisma.PrismaClientKnownRequestError
        && error.code === 'P2002'
      ) {
        const duplicate = await prisma.reservation.findUnique({
          where: { idempotencyKey },
        });

        if (duplicate) {
          if (!sameReservationPayload(duplicate, user.id, parsed.data)) {
            return reply.code(409).send({ error: 'IDEMPOTENCY_KEY_REUSED' });
          }

          return reply.code(200).send(duplicate);
        }
      }

      const message = String((error as { message?: unknown })?.message ?? '');

      if (
        message.includes('reservations_no_overlap')
        || message.includes('exclusion constraint')
      ) {
        return reply.code(409).send({
          error: 'RESERVATION_CONFLICT',
          message: 'This resource is already reserved for part of the requested interval.',
        });
      }

      request.log.error({ err: error }, 'reservation creation failed');
      return reply.code(500).send({ error: 'INTERNAL_SERVER_ERROR' });
    }
  });

  app.get('/reservations/:id', async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };

    const reservation = await prisma.reservation.findUnique({
      where: { id },
    });

    if (
      !reservation
      || (user.role !== 'ADMIN' && reservation.userId !== user.id)
    ) {
      return reply.code(404).send({ error: 'RESERVATION_NOT_FOUND' });
    }

    return reservation;
  });

  app.delete('/reservations/:id', async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };

    const reservation = await prisma.reservation.findUnique({
      where: { id },
    });

    if (
      !reservation
      || (user.role !== 'ADMIN' && reservation.userId !== user.id)
    ) {
      return reply.code(404).send({ error: 'RESERVATION_NOT_FOUND' });
    }

    if (reservation.status === 'CANCELLED') {
      return reply.code(200).send(reservation);
    }

    const cancelled = await prisma.reservation.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });

    return reply.code(200).send(cancelled);
  });
};
