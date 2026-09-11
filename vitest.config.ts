import { defineConfig } from 'vitest/config';

process.env.JWT_SECRET ??= `test-only-${'x'.repeat(40)}`;

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
