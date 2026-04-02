---
title: "Homeserver"
subtitle: "Self-hosted infrastructure and automation"
order: 1
topologyUrl: "/homelab/topology/"
---

![Homepage dashboard](/screenshots/homelab/homepage.png)

## What it is

I run a small server setup at home that handles most things a cloud service usually would: password management, network monitoring, service dashboards, and automated tasks. Everything runs on a single physical server using virtual machines and containers, managed through a firewall that controls what can talk to what.

The system is split into separate zones: one for network management, one for applications people actually use, one for monitoring, and one for automation. This separation means a problem in one area doesn't cascade into others.

This is a continuous project. The core infrastructure is live and running, but I'm still building it out. Some things in scope: a NAS for dedicated storage, Grafana for visibility, Jellyfin for media and a Tailscale subnet router for remote management acess.

[View the interactive topology map →](/homelab/topology/)

## Why I built it

I wanted to understand what cloud services were abstracting away, but I also just wanted more control. Open source tools allow me to build what I want. It's also just a continuous learning environment. With how fast things move today, there's always something new to try or improve.

## What I learned

To design for failure. It's tempting to rush into adding the flashy services, but getting the core infrastructure right first matters more. Solid separation, good monitoring, and clean network boundaries mean I can add new services later without backtracking and reconfiguring everything that was already working. The most valuable decisions were the boring ones: keeping monitoring independent from the things it watches, isolating admin access from user-facing apps, and giving each workload room to break without taking everything else down.

<div class="screenshot-strip">

![Proxmox dashboard](/screenshots/homelab/proxmox.png)

![OPNsense firewall](/screenshots/homelab/opnsense.png)

![Uptime Kuma monitoring](/screenshots/homelab/kuma.png)

</div>
