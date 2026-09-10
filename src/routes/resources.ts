import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../lib/prisma.js';

export const resourceRoutes: FastifyPluginAsync = async (app) => {
  app.get('/resources', async () => {
    return prisma.resource.findMany({ orderBy: { name: 'asc' } });
  });
};
