import { defineConfig } from 'vite';

// 개발 중 게임 서버 주소 (npm run dev 에서 3000번으로 고정)
const SERVER = `http://localhost:${process.env.DEV_SERVER_PORT ?? 3000}`;

export default defineConfig({
  root: 'client',
  publicDir: false,
  server: {
    host: true, // 같은 Wi-Fi의 휴대폰에서도 접속 가능
    port: 5173,
    fs: { allow: ['..'] },
    proxy: {
      '/socket.io': { target: SERVER, ws: true },
      '/api': { target: SERVER },
    },
  },
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: { manualChunks: { phaser: ['phaser'] } },
    },
  },
});
