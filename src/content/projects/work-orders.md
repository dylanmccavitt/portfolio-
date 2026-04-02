---
title: "Work Orders"
subtitle: "Work order management system, school project"
order: 4
repoUrl: "https://github.com/apolydore/Work-Order-Management-System"
---

![Work order landing page](/screenshots/work-order/work-order-landing.png)

## What it is

A web app for managing construction and maintenance work orders across NYC. External users submit job requests, admins review and convert them into work orders, assign contractors, track progress through a status lifecycle, and generate invoices on completion. Built as a group project for CS 546.

The stack is Express 5 with MongoDB (raw driver, no ORM), Handlebars for templating, and session-based auth with bcrypt. Company seed data comes from a real NYC open-data CSV of awarded construction contracts.

## How it works

Two roles drive the workflow. Admins get full control: they review incoming job requests (pending, approved, rejected), create and assign work orders with priority levels and geolocation, track status from open through completion, add comments, manage a daily schedule, and issue invoices with line items, charge codes, and tax computation. Contractors see their assigned work orders and a personal dashboard.

The public-facing side lets anyone submit a job request or contact form without logging in. Once approved, the request flows into the work order pipeline.

## What I learned

Working with a team of four on a shared codebase meant making real decisions about code organization and responsibility boundaries. The invoicing system ended up being the most involved piece: validating charge codes against a collection, computing line totals and tax rates, and managing draft/issued/paid/cancelled states. We also wrote extensive input validation by hand since we weren't using an ORM, which made us think harder about what actually needed to be checked at each boundary.

<div class="screenshot-strip">

![Job request form](/screenshots/work-order/jobreqform.png)

![Admin dashboard](/screenshots/work-order/woadmin.png)

![Invoice](/screenshots/work-order/invoice.png)

</div>
