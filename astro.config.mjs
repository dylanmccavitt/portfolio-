// @ts-check
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';
import react from '@astrojs/react';

// https://astro.build/config
export default defineConfig({
  adapter: vercel(),
  integrations: [react()],
  // Canonical origin — drives `Astro.site`, the `<link rel="canonical">` in the
  // layouts, and the absolute URLs in `src/pages/sitemap.xml.ts` (#25).
  site: 'https://dylanmccavitt.xyz',
  // Suppress the dev-only toolbar pill — it overlaps the bottom player bar in
  // mobile dev screenshots/audits. Dev-only; `astro build` never ships it.
  devToolbar: { enabled: false },
  // Astro's global form-origin guard (CSRF protection for form-encoded POSTs).
  // This was previously disabled so the Slack control-plane webhook could post
  // cross-origin; that endpoint is gone (#316), and no remaining route accepts
  // cross-origin form posts, so the guard stays on.
  security: { checkOrigin: true },
});
