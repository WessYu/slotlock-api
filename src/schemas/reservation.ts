import { z } from 'zod';

export const createReservationSchema = z.object({
  resourceId: z.string().uuid(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
}).superRefine((value, ctx) => {
  if (value.startsAt >= value.endsAt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endsAt'],
      message: 'endsAt must be after startsAt',
    });
  }
});
