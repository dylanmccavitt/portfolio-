---
title: "Homeserver"
subtitle: "Self-hosted infrastructure and automation"
order: 1
topologyUrl: "/homelab/topology/"
---

![Homepage dashboard](/screenshots/homelab/homepage.png)

## What it is

I run a small server setup at home that handles things most people use cloud services for: password management, network monitoring, service dashboards, and automated tasks. Everything runs on a single physical server using virtual machines and containers, managed through a firewall that controls what can talk to what.

The system is split into separate zones: one for network management, one for applications people actually use, one for monitoring, and one for automation. This separation means a problem in one area doesn't cascade into others.

This is a continuous project. The core infrastructure is live and running, but I'm still building it out. TrueNAS for dedicated storage, Jellyfin for media, Grafana for observability, and a Tailscale subnet router for remote management access are all planned next.

[View the interactive topology map →](/homelab/topology/)

## Why I built it

I wanted hands-on experience with the kind of infrastructure decisions that come up in professional environments: network segmentation, reverse proxies, monitoring, and service isolation, but at a scale where I could understand every piece end to end. Cloud services abstract away the parts I wanted to learn.

## What I learned

Designing for failure is more important than designing for features. The most valuable decisions were about separation: keeping monitoring independent from the services it watches, isolating management access from public-facing apps, and giving each workload its own space to fail without taking everything else down.

<div class="screenshot-strip">

![Proxmox dashboard](/screenshots/homelab/proxmox.png)

![OPNsense firewall](/screenshots/homelab/opnsense.png)

![Uptime Kuma monitoring](/screenshots/homelab/kuma.png)

</div>
