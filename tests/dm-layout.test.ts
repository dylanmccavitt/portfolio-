import assert from 'node:assert/strict';
import test from 'node:test';

const { chooseDmFrame } = await import('@/components/frost/dm-layout.js');

const viewport = { width: 1200, height: 800 };
const desired = { width: 360, height: 460 };

test('DM stays in the familiar bottom-right corner when it is clear', () => {
  assert.equal(chooseDmFrame({ viewport, desired }).placement, 'bottom-right');
});

test('DM moves away from visible content instead of covering it', () => {
  const frame = chooseDmFrame({
    viewport,
    desired,
    obstacles: [{ x: 800, y: 300, width: 400, height: 500, weight: 2 }],
  });
  assert.equal(frame.placement, 'bottom-left');
  assert.equal(frame.w, 360);
  assert.equal(frame.h, 460);
});

test('DM keeps its current clear corner to avoid jitter', () => {
  const frame = chooseDmFrame({
    viewport,
    desired,
    previousPlacement: 'top-left',
  });
  assert.equal(frame.placement, 'top-left');
});

test('DM shrinks only when every full-size corner collides', () => {
  const frame = chooseDmFrame({
    viewport,
    desired,
    obstacles: [{ x: 0, y: 0, width: 1200, height: 800 }],
  });
  assert.ok(frame.h < desired.height);
  assert.ok(frame.h >= 260);
  assert.ok(frame.w >= 300);
});

test('DM never escapes a small desktop viewport', () => {
  const frame = chooseDmFrame({
    viewport: { width: 920, height: 620 },
    desired: { width: 500, height: 900 },
  });
  assert.ok(frame.x >= 16);
  assert.ok(frame.y >= 72);
  assert.ok(frame.x + frame.w <= 904);
  assert.ok(frame.y + frame.h <= 604);
});

test('DM respects a user-selected larger footprint when the page has room', () => {
  const frame = chooseDmFrame({
    viewport: { width: 1440, height: 900 },
    desired: { width: 520, height: 580 },
  });
  assert.equal(frame.w, 520);
  assert.equal(frame.h, 580);
});
