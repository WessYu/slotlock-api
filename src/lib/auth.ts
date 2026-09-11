import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from './prisma.js';
import { verifyAccessToken, type AuthRole } from './tokens.js';

export interface AuthUser {
  id: string;
  email: string;
  role: AuthRole;
}

type RequestWithAuth = FastifyRequest & {
  authUser?: AuthUser;
};

function readBearerToken(request: FastifyRequest) {
  const authorization = request.headers.authorization;

  if (!authorization) return null;

  const [scheme, token] = authorization.split(' ');

  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return null;
  }

  return token;
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  const token = readBearerToken(request);

  if (!token) {
    return reply.code(401).send({ error: 'UNAUTHORIZED' });
  }

  try {
    const payload = verifyAccessToken(token);

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        role: true,
      },
    });

    if (!user) {
      return reply.code(401).send({ error: 'UNAUTHORIZED' });
    }

    (request as RequestWithAuth).authUser = {
      id: user.id,
      email: user.email,
      role: user.role,
    };
  } catch {
    return reply.code(401).send({ error: 'UNAUTHORIZED' });
  }
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as RequestWithAuth).authUser;

  if (!user) {
    return reply.code(401).send({ error: 'UNAUTHORIZED' });
  }

  if (user.role !== 'ADMIN') {
    return reply.code(403).send({ error: 'FORBIDDEN' });
  }
}

export function getAuthUser(request: FastifyRequest) {
  const user = (request as RequestWithAuth).authUser;

  if (!user) {
    throw new Error('AUTH_CONTEXT_MISSING');
  }

  return user;
}
