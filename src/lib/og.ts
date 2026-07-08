/**
 * Build-time Open Graph image generation. Renders branded 1200x630 cards using
 * the agent-first typography/tokens: dark canvas, accent rule, title, optional
 * status badge, tagline, and byline.
 */
import satori, { type SatoriOptions } from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { StatusKind } from '@/data/catalog';

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

const BG = '#121317';
const PANEL = '#1c1e24';
const LINE = '#2a2c35';
const TEXT = '#e6e8ed';
const DIM = '#969aa6';
const FAINT = '#8a8fa0';

const BADGE: Record<StatusKind, { bg: string; fg: string }> = {
  dry: { bg: 'rgba(230,180,80,0.12)', fg: '#e6b450' },
  live: { bg: 'rgba(80,200,120,0.12)', fg: '#50c878' },
  wip: { bg: 'rgba(139,124,246,0.14)', fg: '#8b7cf6' },
  done: { bg: 'rgba(150,154,166,0.10)', fg: '#969aa6' },
};

function loadFonts(): SatoriOptions['fonts'] {
  const require = createRequire(import.meta.url);
  const file = (weight: number) =>
    readFileSync(
      require.resolve(`@fontsource/inter/files/inter-latin-${weight}-normal.woff`),
    );
  return [
    { name: 'Inter', data: file(400), weight: 400, style: 'normal' },
    { name: 'Inter', data: file(600), weight: 600, style: 'normal' },
    { name: 'Inter', data: file(700), weight: 700, style: 'normal' },
    { name: 'Inter', data: file(800), weight: 800, style: 'normal' },
  ];
}

let FONTS: SatoriOptions['fonts'] | null = null;

export interface OgCard {
  title: string;
  hue: string;
  kind: string;
  tagline?: string;
  status?: [StatusKind, string];
}

type Node = {
  type: string;
  props: { style: Record<string, unknown>; children?: Node | Node[] | string };
};

function el(
  type: string,
  style: Record<string, unknown>,
  children?: Node | Node[] | string,
): Node {
  return { type, props: { style, children } };
}

const flex = { display: 'flex' } as const;

function cardTree(card: OgCard): Node {
  const badge = card.status ? BADGE[card.status[0]] : null;

  const content: Node[] = [
    el(
      'div',
      {
        ...flex,
        fontSize: 25,
        fontWeight: 700,
        letterSpacing: 3,
        textTransform: 'uppercase',
        color: card.hue,
      },
      card.kind,
    ),
    el(
      'div',
      {
        ...flex,
        maxWidth: 990,
        fontSize: 82,
        fontWeight: 800,
        letterSpacing: -3,
        color: TEXT,
        lineHeight: 1.02,
      },
      card.title,
    ),
  ];

  if (card.tagline) {
    content.push(
      el(
        'div',
        {
          ...flex,
          maxWidth: 850,
          fontSize: 31,
          fontWeight: 400,
          color: DIM,
          lineHeight: 1.32,
        },
        card.tagline,
      ),
    );
  }

  if (card.status && badge) {
    content.push(
      el(
        'div',
        {
          ...flex,
          alignSelf: 'flex-start',
          fontSize: 22,
          fontWeight: 700,
          letterSpacing: 1.5,
          textTransform: 'uppercase',
          color: badge.fg,
          background: badge.bg,
          padding: '8px 20px',
          borderRadius: 999,
        },
        card.status[1],
      ),
    );
  }

  return el(
    'div',
    {
      ...flex,
      position: 'relative',
      flexDirection: 'column',
      width: '100%',
      height: '100%',
      background: BG,
      padding: 78,
      justifyContent: 'space-between',
      fontFamily: 'Inter',
      overflow: 'hidden',
    },
    [
      el('div', {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 10,
        background: card.hue,
      }),
      el('div', {
        position: 'absolute',
        top: -300,
        right: -240,
        width: 650,
        height: 650,
        borderRadius: 9999,
        background: card.hue,
        opacity: 0.16,
      }),
      el('div', {
        position: 'absolute',
        left: 78,
        right: 78,
        bottom: 126,
        height: 1,
        background: LINE,
      }),
      el('div', { ...flex, flexDirection: 'column', gap: 20 }, content),
      el(
        'div',
        {
          ...flex,
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: 28,
          color: FAINT,
        },
        [
          el(
            'div',
            { ...flex, alignItems: 'center', gap: 14, color: TEXT, fontWeight: 700 },
            [
              el('div', {
                width: 34,
                height: 34,
                borderRadius: 8,
                border: `1px solid ${LINE}`,
                background: PANEL,
              }),
              el('div', flex, 'Dylan McCavitt'),
            ],
          ),
          el('div', flex, 'dylanmccavitt.xyz'),
        ],
      ),
    ],
  );
}

export async function renderOgImage(card: OgCard): Promise<Buffer> {
  FONTS ??= loadFonts();
  const svg = await satori(cardTree(card) as unknown as Parameters<typeof satori>[0], {
    width: OG_WIDTH,
    height: OG_HEIGHT,
    fonts: FONTS,
  });
  return Buffer.from(new Resvg(svg).render().asPng());
}
