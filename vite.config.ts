import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Tier badges, shuttlecock, and shop product art are static,
      // rarely change, and need to render even on a flaky connection
      // — precache them so the service worker serves from cache
      // instead of hitting the network.
      includeAssets: [
        'favicon.svg',
        'app-icon.svg',
        'shuttlecock.png',
        'bronze-tier.png',
        'silver-tier.png',
        'gold-tier.png',
        'diamond-tier.png',
        'predator-tier.png',
        'Titanium-shield.png',
        'Vibranium-shield.png',
        'Platinum-shuttlecock.png',
        'dragon-egg.png',
        'space-window-deep-space.jpg',
        'dinoCharactersVersion1.1/gifs/DinoSprites_doux.gif',
        'dinoCharactersVersion1.1/gifs/DinoSprites_mort.gif',
        'dinoCharactersVersion1.1/gifs/DinoSprites_tard.gif',
        'dinoCharactersVersion1.1/gifs/DinoSprites_vita.gif',
        'dinoCharactersVersion1.1/sheets/DinoSprites - doux.png',
        'dinoCharactersVersion1.1/sheets/DinoSprites - mort.png',
        'dinoCharactersVersion1.1/sheets/DinoSprites - tard.png',
        'dinoCharactersVersion1.1/sheets/DinoSprites - vita.png',
      ],
      workbox: {
        // Runtime caching for Supabase reads + avatar images so users
        // see their last-known data on weak / no signal. Mutations
        // (POST/PATCH/DELETE) and Realtime subscriptions still need
        // the network; only GETs to the REST endpoint are cached.
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/v1\/.*/i,
            handler: 'StaleWhileRevalidate',
            method: 'GET',
            options: {
              cacheName: 'supabase-rest',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 7, // 1 week
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern:
              /^https:\/\/.*\.supabase\.co\/storage\/v1\/object\/public\/avatars\/.*/i,
            handler: 'CacheFirst',
            method: 'GET',
            options: {
              cacheName: 'supabase-avatars',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
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
