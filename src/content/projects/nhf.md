---
title: "No Hard Feelings"
subtitle: "Website for a band"
order: 3
liveUrl: "https://nohardfeelings.app"
---

![No Hard Feelings landing page](/screenshots/nohard/landing.png)

## What it is

A website for No Hard Feelings, a classic rock cover band based in NJ/NY. The site gives fans a place to find show dates, learn about the band, watch live videos, and get in touch for booking, all in one spot instead of scattered across social media.

Built with Astro, React, and Tailwind. The hero section is a 3D-flippable album cover where the front has navigation styled as album tracklist items and the back reveals band member bios with tap-to-reveal dialogs. Motion.js handles the flip and dialog animations.

## Why I built it

The band needed a home base on the web. Show dates were buried in Instagram posts, band info was word-of-mouth, and booking meant texting around. I built them something clean and centralized.

## What I learned

The most interesting piece was the Google Calendar integration. A server-side API route proxies the Google Calendar v3 API so show dates stay current without anyone manually updating the site. The 3D album card navigation was a fun design challenge too. Getting CSS 3D transforms and Motion.js to play nicely together across devices took iteration. Radix UI handled the accessible dialog primitives so the band member popups work properly on mobile.

<div class="screenshot-strip">

![Album card flipped](/screenshots/nohard/backcard.png)

![Band member popup](/screenshots/nohard/popout.png)

![Google Calendar integration](/screenshots/nohard/gcal-integration.png)

</div>
