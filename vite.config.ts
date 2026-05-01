import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Tier badges + shuttlecock are static, rarely change, and need
      // to render even on a flaky connection — precache them so the
      // service worker serves from cache instead of hitting the network.
      includeAssets: [
        'favicon.svg',
        'app-icon.svg',
        'shuttlecock.png',
        'bronze-tier.png',
        'silver-tier.png',
        'gold-tier.png',
        'diamond-tier.png',
        'predator-tier.png',
      ],
      manifest: {
        name: 'Badminton ELO',
        short_name: 'Badminton ELO',
        description: 'Track singles and doubles badminton ratings for your club.',
        theme_color: '#0a0a0c',
        background_color: '#0a0a0c',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          {
            src: 'shuttlecock.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'shuttlecock.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
