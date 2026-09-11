import { z } from 'zod';

const slugSchema = z.string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const createResourceSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: slugSchema,
});

export const updateResourceSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  slug: slugSchema.optional(),
}).refine(
  (value) => value.name !== undefined || value.slug !== undefined,
  { message: 'At least one field is required.' },
);

export const resourceIdParamsSchema = z.object({
  id: z.string().uuid(),
});
