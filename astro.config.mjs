// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import react from '@astrojs/react';

// https://astro.build/config
export default defineConfig({
  server: {
    port: Number(process.env.PORT) || 4321,
  },

  vite: {
    plugins: [tailwindcss()]
  },

  integrations: [react()]
});