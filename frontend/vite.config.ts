import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Load env file from parent directory
  const env = loadEnv(mode, '../', '');
  return {
    plugins: [react()],
    envDir: '../',
    server: {
      port: parseInt(env.FRONTEND_PORT || '5174'),
      host: true,
    },
  };
});
