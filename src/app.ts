import { loadEnvFile } from 'node:process';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { assertAuthConfig } from './lib/tokens.js';
import { authRoutes } from './routes/auth.js';
import { healthRoutes } from './routes/health.js';
import { resourceRoutes } from './routes/resources.js';
import { reservationRoutes } from './routes/reservations.js';

function loadLocalEnv() {
  try {
    loadEnvFile();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code !== 'ENOENT') {
      throw error;
    }
  }
}

export async function buildApp() {
  loadLocalEnv();
  assertAuthConfig();

  const app = Fastify({ logger: true });

  await app.register(helmet);
  await app.register(cors, { origin: false });
  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });

  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: '/v1' });
  await app.register(resourceRoutes, { prefix: '/v1' });
  await app.register(reservationRoutes, { prefix: '/v1' });

  return app;
}
