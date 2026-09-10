import type { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { createReservationSchema } from '../schemas/reservation.js';

export const reservationRoutes: FastifyPluginAsync = async (app) => {
  app.post('/reservations', async (request, reply) => {
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
            customerEmail: parsed.data.customerEmail.toLowerCase(),
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

      // P2002 handles an idempotency race. PostgreSQL exclusion violations surface
      // through Prisma as a database-level request error depending on driver/runtime.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const duplicate = await prisma.reservation.findUnique({ where: { idempotencyKey } });
        if (duplicate) return reply.code(200).send(duplicate);
      }

      const message = String((error as { message?: unknown })?.message ?? '');
      if (message.includes('reservations_no_overlap') || message.includes('exclusion constraint')) {
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
    const { id } = request.params as { id: string };
    const reservation = await prisma.reservation.findUnique({ where: { id } });

    if (!reservation) return reply.code(404).send({ error: 'RESERVATION_NOT_FOUND' });
    return reservation;
  });

  app.delete('/reservations/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    const reservation = await prisma.reservation.findUnique({ where: { id } });
    if (!reservation) return reply.code(404).send({ error: 'RESERVATION_NOT_FOUND' });

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
