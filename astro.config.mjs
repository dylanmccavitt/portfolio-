// @ts-check
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

// https://astro.build/config
export default defineConfig({
  adapter: vercel(),
  // Canonical origin — drives `Astro.site`, the `<link rel="canonical">` in the
  // layouts, and the absolute URLs in `src/pages/sitemap.xml.ts` (#25).
  site: 'https://dylanmccavitt.xyz',
  // Suppress the dev-only toolbar pill — it overlaps the bottom player bar in
  // mobile dev screenshots/audits. Dev-only; `astro build` never ships it.
  devToolbar: { enabled: false },
});
