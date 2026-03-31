import type { EntityId } from "./entities";

export type FrameTone = "management" | "service" | "signal" | "automation";
export type NodeTone =
  | "edge"
  | "network"
  | "platform"
  | "runtime"
  | "device"
  | "client";
export type ChipTone =
  | "service"
  | "controller"
  | "monitoring"
  | "agent"
  | "utility";

export type MapFrame = {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  tone: FrameTone;
  entityId?: EntityId;
  members?: EntityId[];
};

export type MapChip = {
  id: EntityId;
  label: string;
  tone: ChipTone;
};

export type MapNode = {
  id: EntityId;
  x: number;
  y: number;
  w: number;
  h: number;
  tone: NodeTone;
  eyebrow?: string;
  label?: string;
  caption?: string;
  chips?: MapChip[];
};

export type MapEdge = {
  id: string;
  from: EntityId;
  to: EntityId;
  kind: "physical" | "runtime" | "policy";
  path: string;
  label?: string;
  dashed?: boolean;
};

export const layout = {
  viewBox: "0 0 2400 2800",

  frames: [
    {
      id: "management-frame",
      label: "Management",
      x: 120,
      y: 850,
      w: 480,
      h: 440,
      tone: "management",
      entityId: "management-lane",
      members: ["unifi-vm", "unifi-controller"],
    },
    {
      id: "service-frame",
      label: "Services",
      x: 680,
      y: 850,
      w: 680,
      h: 640,
      tone: "service",
      entityId: "service-lane",
      members: ["shared-vm", "caddy", "ingress", "homepage", "vaultwarden"],
    },
    {
      id: "signal-frame",
      label: "Monitoring",
      x: 1440,
      y: 850,
      w: 420,
      h: 440,
      tone: "signal",
      entityId: "signal-lane",
      members: ["kuma-lxc", "uptime-kuma"],
    },
    {
      id: "automation-frame",
      label: "Automation",
      x: 1940,
      y: 850,
      w: 360,
      h: 440,
      tone: "automation",
      entityId: "automation-lane",
      members: ["hermes-vm", "hermes"],
    },
  ],

  nodes: [
    {
      id: "isp",
      x: 1100,
      y: 80,
      w: 200,
      h: 100,
      tone: "edge",
      eyebrow: "WAN",
      label: "ISP",
      caption: "Upstream handoff",
    },
    {
      id: "opnsense",
      x: 480,
      y: 400,
      w: 280,
      h: 140,
      tone: "edge",
      eyebrow: "Firewall",
      label: "OPNsense",
      caption: "Routing, DNS, policy",
    },
    {
      id: "switch",
      x: 960,
      y: 400,
      w: 240,
      h: 140,
      tone: "network",
      eyebrow: "Core Fabric",
      label: "Switch",
      caption: "Port map hub",
    },
    {
      id: "proxmox",
      x: 1400,
      y: 400,
      w: 280,
      h: 140,
      tone: "platform",
      eyebrow: "Hypervisor",
      label: "Proxmox",
      caption: "VM & LXC host",
    },
    {
      id: "unifi-vm",
      x: 160,
      y: 940,
      w: 400,
      h: 160,
      tone: "runtime",
      eyebrow: "VM1",
      label: "UniFi VM",
      caption: "Controller lane",
      chips: [
        {
          id: "unifi-controller",
          label: "UniFi Controller",
          tone: "controller",
        },
      ],
    },
    {
      id: "shared-vm",
      x: 720,
      y: 940,
      w: 600,
      h: 460,
      tone: "runtime",
      eyebrow: "VM2",
      label: "Shared VM",
      caption: "Ubuntu + Docker Compose",
      chips: [
        {
          id: "caddy",
          label: "Caddy",
          tone: "service",
        },
        {
          id: "ingress",
          label: "Ingress",
          tone: "utility",
        },
        {
          id: "homepage",
          label: "Homepage",
          tone: "utility",
        },
        {
          id: "vaultwarden",
          label: "Vaultwarden",
          tone: "service",
        },
      ],
    },
    {
      id: "kuma-lxc",
      x: 1480,
      y: 940,
      w: 340,
      h: 260,
      tone: "runtime",
      eyebrow: "LXC",
      label: "Kuma",
      caption: "Independent checks",
      chips: [
        {
          id: "uptime-kuma",
          label: "Uptime Kuma",
          tone: "monitoring",
        },
      ],
    },
    {
      id: "hermes-vm",
      x: 1980,
      y: 940,
      w: 280,
      h: 260,
      tone: "runtime",
      eyebrow: "VM3",
      label: "Hermes VM",
      caption: "Agent lane",
      chips: [
        {
          id: "hermes",
          label: "Hermes",
          tone: "agent",
        },
      ],
    },
    {
      id: "unifi-ap",
      x: 280,
      y: 2300,
      w: 200,
      h: 120,
      tone: "device",
      eyebrow: "Wireless",
      label: "AP",
      caption: "Managed by UniFi",
    },
    {
      id: "bazzite-pc",
      x: 700,
      y: 2300,
      w: 200,
      h: 120,
      tone: "client",
      eyebrow: "Client",
      label: "PC",
      caption: "Operator workstation",
    },
    {
      id: "jetkvm",
      x: 1300,
      y: 2300,
      w: 200,
      h: 120,
      tone: "device",
      eyebrow: "Recovery",
      label: "KVM",
      caption: "Out-of-band console",
    },
    {
      id: "nas",
      x: 1720,
      y: 2300,
      w: 200,
      h: 120,
      tone: "device",
      eyebrow: "Storage",
      label: "NAS",
      caption: "Future storage lane",
    },
  ],

  edges: [
    {
      id: "wan-to-edge",
      from: "isp",
      to: "opnsense",
      kind: "physical",
      path: "M1200,180 L1200,280 L620,280 L620,400",
      label: "WAN uplink",
      dashed: true,
    },
    {
      id: "edge-to-switch",
      from: "opnsense",
      to: "switch",
      kind: "physical",
      path: "M760,470 L960,470",
    },
    {
      id: "switch-to-proxmox",
      from: "switch",
      to: "proxmox",
      kind: "physical",
      path: "M1200,470 L1400,470",
    },
    {
      id: "switch-to-ap",
      from: "switch",
      to: "unifi-ap",
      kind: "physical",
      path: "M1020,540 L1020,2120 L380,2120 L380,2300",
    },
    {
      id: "switch-to-pc",
      from: "switch",
      to: "bazzite-pc",
      kind: "physical",
      path: "M1080,540 L1080,2160 L800,2160 L800,2300",
    },
    {
      id: "switch-to-kvm",
      from: "switch",
      to: "jetkvm",
      kind: "physical",
      path: "M1140,540 L1140,2200 L1400,2200 L1400,2300",
    },
    {
      id: "switch-to-nas",
      from: "switch",
      to: "nas",
      kind: "physical",
      path: "M1160,540 L1160,2240 L1820,2240 L1820,2300",
    },
    {
      id: "proxmox-to-unifi-vm",
      from: "proxmox",
      to: "unifi-vm",
      kind: "runtime",
      path: "M1440,540 L1440,720 L360,720 L360,940",
      label: "VM placement",
    },
    {
      id: "proxmox-to-shared-vm",
      from: "proxmox",
      to: "shared-vm",
      kind: "runtime",
      path: "M1500,540 L1500,760 L1020,760 L1020,940",
      label: "VM placement",
    },
    {
      id: "proxmox-to-kuma-lxc",
      from: "proxmox",
      to: "kuma-lxc",
      kind: "runtime",
      path: "M1580,540 L1580,800 L1650,800 L1650,940",
    },
    {
      id: "proxmox-to-hermes-vm",
      from: "proxmox",
      to: "hermes-vm",
      kind: "runtime",
      path: "M1640,540 L1640,760 L2120,760 L2120,940",
    },
    {
      id: "policy-to-management",
      from: "opnsense",
      to: "management-lane",
      kind: "policy",
      path: "M520,540 L520,680 L360,680 L360,850",
      label: "Admin reach",
      dashed: true,
    },
    {
      id: "policy-to-services",
      from: "opnsense",
      to: "service-lane",
      kind: "policy",
      path: "M580,540 L580,640 L1020,640 L1020,850",
      label: "Publish + trust",
      dashed: true,
    },
    {
      id: "policy-to-signals",
      from: "opnsense",
      to: "signal-lane",
      kind: "policy",
      path: "M640,540 L640,600 L1650,600 L1650,850",
      label: "Checks + alerts",
      dashed: true,
    },
    {
      id: "policy-to-automation",
      from: "opnsense",
      to: "automation-lane",
      kind: "policy",
      path: "M700,540 L700,560 L2120,560 L2120,850",
      label: "Utility access",
      dashed: true,
    },
  ],
} satisfies {
  viewBox: string;
  frames: MapFrame[];
  nodes: MapNode[];
  edges: MapEdge[];
};
