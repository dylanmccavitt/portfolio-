---
title: "Bella's Beads"
subtitle: "Ecommerce site for a jewelry maker"
order: 2
liveUrl: "https://bellasbeads.shop"
---

## What it is

A full-featured ecommerce platform for selling handmade beaded jewelry. Customers can browse the catalog, add items to a cart, create accounts, and check out — with both guest and authenticated flows. Logged-in users get order history, shipment tracking, and saved addresses. An admin dashboard handles product management and inventory.

Built as a monorepo with a React + TypeScript frontend (Vite, Tailwind, Radix UI) and a Node/Express backend. PostgreSQL via Supabase handles data and auth, Stripe processes payments, and Shippo generates shipping labels automatically through a Zapier integration.

![Bella's Beads landing page](/screenshots/bella/landing.png)

## Why I built it

This was a freelance project for a real client — a jewelry maker who needed a way to sell online. It had to handle the full lifecycle: browsing, payments, shipping, order tracking. No shortcuts, no "coming soon" pages.

## What I learned

The hardest parts were the integration seams. Getting Stripe webhooks to verify signatures correctly with raw request bodies, wiring up the Shippo label flow through Zapier (order → Zapier → Shippo → webhook callback), and keeping session-based auth in sync across guest and authenticated carts all took more thought than the features themselves. I also spent real time on security — CSRF protection, rate limiting at multiple tiers (global, auth, payment, webhook), and HMAC token hashing.

![Stripe checkout integration](/screenshots/bella/stripe.png)
