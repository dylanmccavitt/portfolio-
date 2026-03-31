---
title: "Bella"
subtitle: "Full-stack web application for small businesses"
order: 2
liveUrl: "https://bellasbeads.shop"
---

## What it is

Bella is a web application built for small businesses to manage their day-to-day operations. It handles the kind of work that usually lives in spreadsheets or sticky notes — tracking tasks, managing client information, and keeping a team on the same page.

The app is built with Next.js and uses Supabase for the database and authentication. Payments are handled through Stripe, and the whole thing is deployed on Vercel.

![Bella landing page](/screenshots/bella/landing.png)

## Why I built it

I wanted to build something real — not a tutorial project, but an application that solves an actual problem and has to handle the messiness of real-world use: authentication, payments, error tracking, and deployment. Small businesses were a good fit because their needs are concrete and well-understood.

## What I learned

Full-stack development is mostly about the seams between systems. The hardest parts weren't the individual features but the integration points: making Stripe webhooks reliable, keeping Supabase auth in sync with the frontend, and setting up error tracking with Sentry so problems are visible before users report them.

![Stripe checkout integration](/screenshots/bella/stripe.png)
