// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import react from '@astrojs/react';

// https://astro.build/config
export default defineConfig({
  // Canonical origin — drives `Astro.site`, the `<link rel="canonical">` in the
  // layouts, and the absolute URLs in `src/pages/sitemap.xml.ts` (#25).
  site: 'https://dylanmccavitt.xyz',

  vite: {
    plugins: [tailwindcss()]
  },

  integrations: [react()]
});