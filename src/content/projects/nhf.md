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

The band needed a home base on the web. Show dates were scattered across socials and info was more word-of-mouth. I helped to build them something more centralized.

## What I learned

An interesting piece was the Google Calendar integration. I wanted a way for the band to add upcoming show dates without me having to go into the code or manage a separate database. The site pulls from their Google Calendar behind the scenes, so when they add a gig it shows up on the website automatically. The 3D album card navigation was something new I played around with too. Getting CSS 3D transforms and Motion.js to work together across devices took multiple iterations.

<div class="screenshot-strip">

![Album card flipped](/screenshots/nohard/backcard.png)

![Band member popup](/screenshots/nohard/popout.png)

![Google Calendar integration](/screenshots/nohard/gcal-integration.png)

</div>
