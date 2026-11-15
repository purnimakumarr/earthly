import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const api = process.env.API_ORIGIN || 'http://localhost:3000';

// In development the API runs separately; proxying keeps everything on one
// origin so the session cookie behaves exactly as it does in production.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': api,
      '/uploads': api,
    },
  },
});
