import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',      // only pure modules (src/labels.js) are under test
    include: ['src/**/*.test.js'],
  },
});
