import { z } from 'zod';

const explicitOffsetPattern = /(?:Z|[+-]\d{2}:\d{2})$/i;
const maxWindowMs = 7 * 24 * 60 * 60 * 1000;

const offsetDateTimeSchema = z.string().trim().refine(
  (value) => explicitOffsetPattern.test(value) && Number.isFinite(Date.parse(value)),
  {
    message: 'must be a valid ISO-8601 datetime with an explicit UTC offset or Z',
  },
);

export const availabilityParamsSchema = z.object({
  id: z.string().uuid(),
});

export const availabilityQuerySchema = z.object({
  from: offsetDateTimeSchema,
  to: offsetDateTimeSchema,
  slotMinutes: z.coerce.number().int().min(15).max(240).default(60),
}).superRefine((value, ctx) => {
  const fromMs = Date.parse(value.from);
  const toMs = Date.parse(value.to);

  if (toMs <= fromMs) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['to'],
      message: 'to must be after from',
    });
    return;
  }

  const windowMs = toMs - fromMs;

  if (windowMs > maxWindowMs) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['to'],
      message: 'availability window cannot exceed 7 days',
    });
  }

  const slotMs = value.slotMinutes * 60 * 1000;

  if (windowMs % slotMs !== 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['slotMinutes'],
      message: 'the requested window must be evenly divisible by slotMinutes',
    });
  }
});
