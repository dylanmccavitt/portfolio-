---
title: "Work Orders"
subtitle: "Work order management system, school project"
order: 4
repoUrl: "https://github.com/apolydore/Work-Order-Management-System"
---

![Work order landing page](/screenshots/work-order/work-order-landing.webp)

## What it is

A web app for managing construction and maintenance work orders across NYC. External users submit job requests, admins review and convert them into work orders, assign contractors, track progress, and generate invoices on completion. Built as a group project for my Web Programming course during my Master's.

The stack is Express 5 with MongoDB (raw driver, no ORM), Handlebars for templating, and session-based auth with bcrypt. Company seed data comes from a real [NYC open-data dataset](https://data.cityofnewyork.us/Housing-Development/Handyman-Work-Order-HWO-Charges/sbnd-xujn/about_data) of awarded construction contracts. This project is not live or hosted. It was built as a class deliverable and runs locally.

## How it works

Two roles drive the workflow. Admins get full control: they review incoming job requests (pending, approved, rejected), create and assign work orders with priority levels and geolocation, track status through completion, add comments, manage a daily schedule, and issue invoices. Contractors see their assigned work orders and a personal dashboard.

The public-facing side lets anyone submit a job request or contact form without logging in. Once approved, the request flows into the work order pipeline.

## What I learned

Working with a team of four on a shared codebase meant making real decisions about code and task delegation. The invoicing system ended up being the most involved piece. We had to validate charge codes against a collection, compute line totals and tax rates, and managing draft/issued/paid/cancelled states. We also wrote extensive input validation by hand as part of the project requirements, which made us think harder about what actually needed to be checked at each boundary.

<div class="screenshot-strip">

![Job request form](/screenshots/work-order/jobreqform.webp)

![Admin dashboard](/screenshots/work-order/woadmin.webp)

![Invoice](/screenshots/work-order/invoice.webp)

</div>
