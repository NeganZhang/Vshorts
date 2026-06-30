import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// During dev the SPA talks to the existing Node worker (Express) on :3000,
// which already serves the REST API and /uploads assets with mock fallbacks.
// In production the SPA is a static bundle pointed at the deployed worker via
// VITE_API_BASE.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/uploads': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
});
