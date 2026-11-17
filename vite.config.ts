import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { swPlugin } from './build/sw-plugin';

export default defineConfig({
  base: './',
  plugins: [react(), swPlugin()],
  build: { target: 'es2020', sourcemap: false },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as never);
