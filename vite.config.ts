import { defineConfig } from 'vite';
export default defineConfig({
  build: { chunkSizeWarningLimit: 1500 },
  // The suites are CPU-heavy physics simulations; running files one at a time is faster overall on small machines.
  test: { environment: 'node', include: ['tests/**/*.test.ts'], fileParallelism: false },
});
