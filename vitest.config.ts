import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'src/**/*.{test,spec}.{ts,tsx}',
      'api/**/*.{test,spec}.{js,ts}',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/lib/calc/**', 'src/lib/voice/**', 'src/lib/ai/**'],
      exclude: ['**/*.test.ts', '**/*.spec.ts', '**/types.ts'],
    },
  },
})
