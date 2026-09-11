import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    environment: 'node',
    globals: false,
    testTimeout: 20000,
    hookTimeout: 20000,
    pool: 'forks',
  },
});
