import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/photo/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Alun Image',
        short_name: 'Alun Image',
        description: '隐私优先的本地图片处理工具箱',
        theme_color: '#f7f8f5',
        background_color: '#f7f8f5',
        display: 'standalone',
        start_url: '/photo/',
        scope: '/photo/',
        icons: [
          { src: '/photo/pwa-192.svg', sizes: '192x192', type: 'image/svg+xml' },
          { src: '/photo/pwa-512.svg', sizes: '512x512', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        navigateFallback: '/photo/index.html',
        globPatterns: ['**/*.{js,css,html,svg,webmanifest}'],
      },
    }),
  ],
});
