export type EntityKind =
  | "zone"
  | "edge"
  | "network"
  | "platform"
  | "runtime"
  | "service"
  | "device"
  | "client";

export type DetailSection = {
  title: string;
  items: string[];
};

export type Entity = {
  id: string;
  title: string;
  kind: EntityKind;
  summary: string;
  badges: string[];
  related: string[];
  sections: DetailSection[];
};

export const entities = {
  vlans: {
    id: "vlans",
    title: "VLANs",
    kind: "network",
    summary:
      "The network is split into separate lanes so different types of traffic stay isolated from each other.",
    badges: ["segmentation"],
    related: [
      "opnsense",
      "switch",
      "management-lane",
      "service-lane",
      "signal-lane",
    ],
    sections: [
      {
        title: "Lanes",
        items: [
          "VLAN10 Trusted: everyday devices like my PC",
          "VLAN20 Service: apps and monitoring tools",
          "VLAN30 Management: admin-only access",
          "VLAN40 Guest: visitor Wi-Fi, fully isolated",
          "VLAN50 IoT: smart devices, locked down",
        ],
      },
    ],
  },
  "management-lane": {
    id: "management-lane",
    title: "Management",
    kind: "zone",
    summary:
      "A restricted zone for admin tools. Only I can access what's in here.",
    badges: ["VLAN30", "admin"],
    related: [
      "opnsense",
      "proxmox",
      "unifi-vm",
      "unifi-controller",
      "unifi-ap",
    ],
    sections: [
      {
        title: "What's here",
        items: [
          "Wi-Fi controller and network management tools.",
          "Separated from the rest so a problem with an app can't affect network admin access.",
        ],
      },
    ],
  },
  "service-lane": {
    id: "service-lane",
    title: "Service Lane",
    kind: "zone",
    summary:
      "Where the apps live. Services I use day-to-day are hosted here behind a single entry point.",
    badges: ["VLAN20", "apps"],
    related: [
      "opnsense",
      "shared-vm",
      "caddy",
      "ingress",
      "homepage",
      "vaultwarden",
    ],
    sections: [
      {
        title: "What's here",
        items: [
          "Password manager, dashboard, and reverse proxy.",
          "All services are accessed through one front door instead of separate ports.",
        ],
      },
    ],
  },
  "signal-lane": {
    id: "signal-lane",
    title: "Signal Lane",
    kind: "zone",
    summary:
      "Monitoring runs separately so it can still tell me when something else breaks.",
    badges: ["VLAN20", "monitoring"],
    related: ["opnsense", "proxmox", "kuma-lxc", "uptime-kuma"],
    sections: [
      {
        title: "What's here",
        items: [
          "Uptime Kuma watches all other services and sends alerts if something goes down.",
          "Runs on its own container so it stays up even if the app server has issues.",
        ],
      },
    ],
  },
  "automation-lane": {
    id: "automation-lane",
    title: "Agent Lane",
    kind: "zone",
    summary:
      "A dedicated space for automation and background tasks, kept separate from the main apps.",
    badges: ["VLAN20", "automation"],
    related: ["opnsense", "proxmox", "hermes-vm", "hermes"],
    sections: [
      {
        title: "What's here",
        items: [
          "Hermes agent handles automated tasks like browser automation.",
          "Has its own VM so experiments don't interfere with the services people actually use.",
        ],
      },
    ],
  },
  isp: {
    id: "isp",
    title: "ISP",
    kind: "edge",
    summary: "The internet connection. Everything starts here.",
    badges: ["wan"],
    related: ["opnsense"],
    sections: [
      {
        title: "Role",
        items: ["Feeds into the firewall, which decides what gets through."],
      },
    ],
  },
  opnsense: {
    id: "opnsense",
    title: "OPNsense",
    kind: "edge",
    summary:
      "The firewall. Controls what can talk to what and enforces the VLAN boundaries.",
    badges: ["firewall", "routing"],
    related: [
      "isp",
      "switch",
      "management-lane",
      "service-lane",
      "signal-lane",
      "automation-lane",
    ],
    sections: [
      {
        title: "What it does",
        items: [
          "Routes traffic between the internet and internal networks.",
          "Enforces rules about which VLANs can reach each other.",
        ],
      },
    ],
  },
  switch: {
    id: "switch",
    title: "Switch",
    kind: "network",
    summary:
      "The central hub that connects everything physically. All devices and the server plug into it.",
    badges: ["switching"],
    related: ["opnsense", "proxmox", "unifi-ap", "bazzite-pc", "jetkvm", "nas"],
    sections: [
      {
        title: "What it does",
        items: [
          "Connects the firewall, server, and all client devices together.",
          "Handles VLAN tagging so traffic stays in its lane across the wire.",
        ],
      },
    ],
  },
  proxmox: {
    id: "proxmox",
    title: "Proxmox",
    kind: "platform",
    summary:
      "The server itself. Runs virtual machines and containers that host everything else on this map.",
    badges: ["hypervisor"],
    related: [
      "switch",
      "management-lane",
      "service-lane",
      "signal-lane",
      "automation-lane",
      "unifi-vm",
      "shared-vm",
      "kuma-lxc",
      "hermes-vm",
    ],
    sections: [
      {
        title: "What it does",
        items: [
          "One physical machine split into multiple virtual ones, each with its own job.",
          "Makes it easy to add, remove, or restart services without affecting the rest.",
        ],
      },
    ],
  },
  "unifi-ap": {
    id: "unifi-ap",
    title: "AP",
    kind: "device",
    summary: "The Wi-Fi access point. Provides wireless for all VLANs.",
    badges: ["wireless"],
    related: ["switch", "management-lane", "unifi-controller"],
    sections: [
      {
        title: "What it does",
        items: [
          "Broadcasts separate Wi-Fi networks for trusted, guest, and IoT devices.",
          "Managed remotely through the UniFi Controller.",
        ],
      },
    ],
  },
  "bazzite-pc": {
    id: "bazzite-pc",
    title: "PC",
    kind: "client",
    summary:
      "My main workstation. Used for development and managing the server.",
    badges: ["VLAN10", "client"],
    related: ["switch", "management-lane", "service-lane"],
    sections: [
      {
        title: "What it does",
        items: [
          "Runs Bazzite Linux. Primary device for coding, admin access, and testing services.",
        ],
      },
    ],
  },
  jetkvm: {
    id: "jetkvm",
    title: "KVM",
    kind: "device",
    summary:
      "Emergency access to the server. If everything else is down, this still works.",
    badges: ["VLAN30", "recovery"],
    related: ["switch", "proxmox"],
    sections: [
      {
        title: "What it does",
        items: [
          "Provides keyboard/video/mouse access to the server over the network.",
          "A backup plan when normal remote management isn't reachable.",
        ],
      },
    ],
  },
  nas: {
    id: "nas",
    title: "NAS",
    kind: "device",
    summary:
      "Network storage for backups and media. Planned expansion with TrueNAS.",
    badges: ["VLAN10", "storage"],
    related: ["switch"],
    sections: [
      {
        title: "What it does",
        items: [
          "Will handle backups, media serving (Jellyfin), and file storage.",
          "Kept separate from the compute server so storage and apps don't compete for resources.",
        ],
      },
    ],
  },
  "unifi-vm": {
    id: "unifi-vm",
    title: "UniFi VM",
    kind: "runtime",
    summary: "A virtual machine just for managing the Wi-Fi network.",
    badges: ["VLAN30", "VM"],
    related: ["management-lane", "proxmox", "unifi-controller", "unifi-ap"],
    sections: [
      {
        title: "What it does",
        items: [
          "Runs the UniFi Controller in its own isolated environment.",
          "Kept in the management zone so it's only accessible by admin devices.",
        ],
      },
    ],
  },
  "unifi-controller": {
    id: "unifi-controller",
    title: "UniFi Controller",
    kind: "service",
    summary:
      "Software that manages the Wi-Fi access point. Handles SSIDs, clients, and network settings.",
    badges: ["VLAN30", "controller"],
    related: ["unifi-vm", "management-lane", "unifi-ap"],
    sections: [
      {
        title: "What it does",
        items: [
          "Configures and monitors the access point remotely.",
          "Lives in the management zone, not the app zone, for security.",
        ],
      },
    ],
  },
  "shared-vm": {
    id: "shared-vm",
    title: "Shared VM",
    kind: "runtime",
    summary:
      "The main app server. Runs Docker containers for the services I use every day.",
    badges: ["VLAN20", "docker"],
    related: [
      "proxmox",
      "service-lane",
      "caddy",
      "ingress",
      "homepage",
      "vaultwarden",
    ],
    sections: [
      {
        title: "What it does",
        items: [
          "Hosts multiple services in Docker containers on one VM.",
          "All services share a reverse proxy so they're accessible through clean URLs.",
        ],
      },
    ],
  },
  caddy: {
    id: "caddy",
    title: "Caddy",
    kind: "service",
    summary:
      "The reverse proxy. Gives each service its own URL and handles HTTPS certificates automatically.",
    badges: ["VLAN20", "proxy"],
    related: [
      "shared-vm",
      "ingress",
      "homepage",
      "vaultwarden",
      "service-lane",
      "opnsense",
    ],
    sections: [
      {
        title: "What it does",
        items: [
          "Routes incoming requests to the right service based on the URL.",
          "Automatically sets up and renews HTTPS certificates.",
        ],
      },
    ],
  },
  ingress: {
    id: "ingress",
    title: "Ingress",
    kind: "service",
    summary:
      "The single entry point for all services. Instead of remembering ports, everything goes through one door.",
    badges: ["VLAN20", "entrypoint"],
    related: ["shared-vm", "caddy", "service-lane", "homepage", "vaultwarden"],
    sections: [
      {
        title: "What it does",
        items: [
          "Keeps things simple by funneling all access through the reverse proxy.",
        ],
      },
    ],
  },
  homepage: {
    id: "homepage",
    title: "Homepage",
    kind: "service",
    summary:
      "A dashboard that shows all running services in one place. The first thing I see when I open the lab.",
    badges: ["VLAN20", "dashboard"],
    related: ["shared-vm", "service-lane", "caddy", "ingress"],
    sections: [
      {
        title: "What it does",
        items: [
          "Links to every service with status indicators.",
          "Makes the lab feel like a real product instead of a pile of containers.",
        ],
      },
    ],
  },
  vaultwarden: {
    id: "vaultwarden",
    title: "Vaultwarden",
    kind: "service",
    summary:
      "Self-hosted password manager. Works like Bitwarden but runs on my own server.",
    badges: ["VLAN20", "secrets"],
    related: ["shared-vm", "service-lane", "caddy", "ingress", "opnsense"],
    sections: [
      {
        title: "What it does",
        items: [
          "Stores and syncs passwords across all my devices.",
          "Accessible through HTTPS with automatic certificate management.",
        ],
      },
    ],
  },
  "kuma-lxc": {
    id: "kuma-lxc",
    title: "Kuma LXC",
    kind: "runtime",
    summary:
      "A lightweight container dedicated to monitoring. Runs separately from everything it watches.",
    badges: ["VLAN20", "LXC"],
    related: ["proxmox", "signal-lane", "uptime-kuma", "opnsense"],
    sections: [
      {
        title: "What it does",
        items: [
          "Hosts Uptime Kuma on its own so monitoring stays up even when the app VM is down.",
        ],
      },
    ],
  },
  "uptime-kuma": {
    id: "uptime-kuma",
    title: "Uptime Kuma",
    kind: "service",
    summary:
      "Watches all services and sends Telegram alerts if something goes down.",
    badges: ["VLAN20", "alerts"],
    related: [
      "kuma-lxc",
      "signal-lane",
      "opnsense",
      "shared-vm",
      "homepage",
      "vaultwarden",
    ],
    sections: [
      {
        title: "What it does",
        items: [
          "Pings every service on a schedule and tracks uptime history.",
          "Sends a notification if anything stops responding.",
        ],
      },
    ],
  },
  "hermes-vm": {
    id: "hermes-vm",
    title: "Hermes VM",
    kind: "runtime",
    summary:
      "A separate VM for automation tasks. Kept isolated so experiments don't affect anything else.",
    badges: ["VLAN20", "VM"],
    related: ["proxmox", "automation-lane", "hermes"],
    sections: [
      {
        title: "What it does",
        items: [
          "Runs the Hermes agent for browser automation and background jobs.",
          "Connected via Tailscale for remote access.",
        ],
      },
    ],
  },
  hermes: {
    id: "hermes",
    title: "Hermes",
    kind: "service",
    summary:
      "An automation agent that handles background tasks like browser automation and scheduled jobs.",
    badges: ["VLAN20", "agent"],
    related: ["hermes-vm", "automation-lane"],
    sections: [
      {
        title: "What it does",
        items: [
          "Runs automated workflows in its own isolated environment.",
          "Future home for more orchestration and helper services.",
        ],
      },
    ],
  },
} as const satisfies Record<string, Entity>;

export type EntityId = keyof typeof entities;

export const entityList = Object.values(entities);
