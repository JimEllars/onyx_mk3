import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'rust/crates/onyx/static',
    emptyOutDir: true,
  },
  test: {
    environment: 'node',
    globals: true,
    // This workspace builds on two cores; spawning a fork per file costs more
    // than the tests do.
    fileParallelism: false,
    testTimeout: 15000,
    include: ['src/**/__tests__/**/*.test.{js,jsx}'],
    setupFiles: ['./src/test/setup.js'],
    restoreMocks: true,
    clearMocks: true,
  },
});
