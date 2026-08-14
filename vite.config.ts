import { createReadStream, existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));
const ortDistDir = resolve(projectRoot, 'node_modules/onnxruntime-web/dist');
const ortRuntimePattern = /^ort-wasm.*\.(?:wasm|mjs)$/;

function ortRuntimeAssets(): Plugin {
  return {
    name: 'ort-runtime-assets',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = (request.url ?? '').split('?')[0];
        const prefix = pathname.startsWith('/photo/ort/') ? '/photo/ort/' : pathname.startsWith('/ort/') ? '/ort/' : null;
        if (!prefix) return next();
        const filename = decodeURIComponent(pathname.slice(prefix.length));
        if (!ortRuntimePattern.test(filename)) return next();
        const source = resolve(ortDistDir, filename);
        if (!existsSync(source)) return next();
        response.statusCode = 200;
        response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        response.setHeader('Content-Type', filename.endsWith('.wasm') ? 'application/wasm' : 'text/javascript; charset=utf-8');
        createReadStream(source).pipe(response);
      });
    },
    generateBundle() {
      for (const filename of readdirSync(ortDistDir)) {
        if (!ortRuntimePattern.test(filename)) continue;
        this.emitFile({
          type: 'asset',
          fileName: `ort/${filename}`,
          source: readFileSync(resolve(ortDistDir, filename)),
        });
      }
    },
  };
}

export default defineConfig({
  base: '/photo/',
  resolve: {
    conditions: ['onnxruntime-web-use-extern-wasm'],
  },
  plugins: [
    react(),
    ortRuntimeAssets(),
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
