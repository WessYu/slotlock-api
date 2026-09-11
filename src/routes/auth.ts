import type { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { authenticate, getAuthUser } from '../lib/auth.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import {
  createRefreshToken,
  hashRefreshToken,
  refreshTokenTtlMs,
  signAccessToken,
} from '../lib/tokens.js';
import {
  loginSchema,
  refreshSchema,
  registerSchema,
} from '../schemas/auth.js';

function publicUser(user: {
  id: string;
  name: string | null;
  email: string;
  role: 'USER' | 'ADMIN';
  createdAt: Date;
}) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
  };
}

async function issueSession(user: {
  id: string;
  role: 'USER' | 'ADMIN';
}) {
  const access = signAccessToken(user.id, user.role);
  const refresh = createRefreshToken();
  const expiresAt = new Date(Date.now() + refreshTokenTtlMs);

  await prisma.refreshSession.create({
    data: {
      userId: user.id,
      tokenHash: refresh.tokenHash,
      expiresAt,
    },
  });

  return {
    accessToken: access.token,
    accessTokenExpiresInSeconds: access.expiresInSeconds,
    refreshToken: refresh.token,
    refreshTokenExpiresAt: expiresAt.toISOString(),
  };
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post('/auth/register', async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        issues: parsed.error.flatten(),
      });
    }

    try {
      const passwordHash = await hashPassword(parsed.data.password);

      const user = await prisma.user.create({
        data: {
          name: parsed.data.name,
          email: parsed.data.email,
          passwordHash,
        },
      });

      const tokens = await issueSession(user);

      return reply.code(201).send({
        user: publicUser(user),
        ...tokens,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError
        && error.code === 'P2002'
      ) {
        return reply.code(409).send({ error: 'EMAIL_ALREADY_REGISTERED' });
      }

      request.log.error({ err: error }, 'user registration failed');
      return reply.code(500).send({ error: 'INTERNAL_SERVER_ERROR' });
    }
  });

  app.post('/auth/login', async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        issues: parsed.error.flatten(),
      });
    }

    const user = await prisma.user.findUnique({
      where: { email: parsed.data.email },
    });

    if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
      return reply.code(401).send({ error: 'INVALID_CREDENTIALS' });
    }

    const tokens = await issueSession(user);

    return {
      user: publicUser(user),
      ...tokens,
    };
  });

  app.post('/auth/refresh', async (request, reply) => {
    const parsed = refreshSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        issues: parsed.error.flatten(),
      });
    }

    const currentHash = hashRefreshToken(parsed.data.refreshToken);
    const replacement = createRefreshToken();
    const replacementExpiresAt = new Date(Date.now() + refreshTokenTtlMs);
    const now = new Date();

    try {
      const rotated = await prisma.$transaction(async (tx) => {
        const currentSession = await tx.refreshSession.findUnique({
          where: { tokenHash: currentHash },
          include: {
            user: {
              select: {
                id: true,
                role: true,
              },
            },
          },
        });

        if (
          !currentSession
          || currentSession.revokedAt
          || currentSession.expiresAt <= now
        ) {
          return null;
        }

        const revoked = await tx.refreshSession.updateMany({
          where: {
            id: currentSession.id,
            revokedAt: null,
            expiresAt: { gt: now },
          },
          data: {
            revokedAt: now,
          },
        });

        if (revoked.count !== 1) {
          return null;
        }

        await tx.refreshSession.create({
          data: {
            userId: currentSession.user.id,
            tokenHash: replacement.tokenHash,
            expiresAt: replacementExpiresAt,
          },
        });

        return currentSession.user;
      });

      if (!rotated) {
        return reply.code(401).send({ error: 'INVALID_REFRESH_TOKEN' });
      }

      const access = signAccessToken(rotated.id, rotated.role);

      return {
        accessToken: access.token,
        accessTokenExpiresInSeconds: access.expiresInSeconds,
        refreshToken: replacement.token,
        refreshTokenExpiresAt: replacementExpiresAt.toISOString(),
      };
    } catch (error) {
      request.log.error({ err: error }, 'refresh token rotation failed');
      return reply.code(500).send({ error: 'INTERNAL_SERVER_ERROR' });
    }
  });

  app.post('/auth/logout', async (request, reply) => {
    const parsed = refreshSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        issues: parsed.error.flatten(),
      });
    }

    await prisma.refreshSession.updateMany({
      where: {
        tokenHash: hashRefreshToken(parsed.data.refreshToken),
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    return reply.code(204).send();
  });

  app.get('/auth/me', { preHandler: authenticate }, async (request) => {
    return {
      user: getAuthUser(request),
    };
  });
};
