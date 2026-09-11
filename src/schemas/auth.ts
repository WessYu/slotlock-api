import { z } from 'zod';

const emailSchema = z.string()
  .trim()
  .email()
  .transform((value) => value.toLowerCase());

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  email: emailSchema,
  password: z.string().min(12).max(128),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

export const refreshSchema = z.object({
  refreshToken: z.string().trim().min(20).max(256),
});
