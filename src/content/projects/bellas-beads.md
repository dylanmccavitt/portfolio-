---
title: "Bella's Beads"
subtitle: "Ecommerce site for a jewelry maker"
order: 2
liveUrl: "https://bellasbeads.shop"
---

![Bella's Beads landing page](/screenshots/bella/landing.png)

## What it is

A full-featured ecommerce platform for selling handmade jewelry. Customers can browse products, create accounts, and check out with both guest and authenticated flows. Logged-in users get order history, shipment tracking, and saved addresses. An admin dashboard handles product management and inventory.

Built as a monorepo with a React + TypeScript frontend and a Node/Express backend. PostgreSQL via Supabase handles data and auth, Stripe processes payments, and Shippo automates shipping label generation.

## Why I built it

This was a freelance project for a jewelry maker who needed a way to sell online. It had to handle the full lifecycle: browsing, payments, shipping, order tracking.

## What I learned

The challenge was building the whole thing from the ground up and getting all the third-party pieces to work in unison. Stripe for payments, Shippo for automated shipping, Supabase for data and auth, Resend for transactional emails. Each one has its own webhook patterns, auth flows, and failure modes. Making them all talk to each other reliably, took more thought than any individual feature. I also spent time on security: CSRF protection to make sure form submissions actually come from the site, rate limiting to prevent abuse, and HMAC token hashing so sensitive tokens are never stored in plain text.

<div class="screenshot-strip">

![Product page](/screenshots/bella/product-page.png)

![Cart](/screenshots/bella/cart.png)

![Stripe checkout](/screenshots/bella/stripe.png)

![Shipping](/screenshots/bella/shipping.png)

![Admin dashboard](/screenshots/bella/admin-dash.png)

</div>
