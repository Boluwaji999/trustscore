// Hero animation: coins flow into the shield. Risky ones are stopped with a red flag,
// the rest pass through green. Drawn on a canvas; pauses whenever it can't be seen.

import { $, reduceMotion } from './util.js';

const SHIELD = new Path2D('M16 4l9 3.4v6.8c0 5.6-3.8 9.7-9 12.4-5.2-2.7-9-6.8-9-12.4V7.4L16 4z');
const TICK = new Path2D('M12.2 15.6l2.8 2.8 5-5.6');

const FLAGS = ['Honeypot', 'Hidden owner', 'Unlocked liquidity', 'Unlimited minting', 'Whale wallets', 'Huge fees'];
const LEFT_LINES = 5;
const RIGHT_LINES = 3;
const BAD_SHARE = 0.4;
const SPAWN_MS = 620;
const TRAIL = 7;

let canvas, ctx, colors;
let W = 0, H = 0, cx = 0, cy = 0, size = 0;
let inPaths = [], outPaths = [];
let coins = [], rings = [];
let label = null;
let flash = { color: null, alpha: 0 };
let lastSpawn = 0, lastFrame = 0, flagIndex = 0;
let visible = false, running = false;

function curve(x0, y0, x1, y1) {
  const bend = (x1 - x0) * 0.55;
  return { x0, y0, c1x: x0 + bend, c1y: y0, c2x: x1 - bend, c2y: y1, x1, y1 };
}

function pointOn(p, t) {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return {
    x: a * p.x0 + b * p.c1x + c * p.c2x + d * p.x1,
    y: a * p.y0 + b * p.c1y + c * p.c2y + d * p.y1,
  };
}

function layout() {
  const box = canvas.getBoundingClientRect();
  const dpr = Math.min(devicePixelRatio || 1, 2);
  W = box.width;
  H = box.height;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  cx = W / 2;
  cy = H / 2 + 12;
  size = Math.min(H * 0.46, 92);

  const spread = H * 0.74;
  const lineY = (i, n) => cy + (n === 1 ? 0 : (i / (n - 1) - 0.5) * spread);
  const edge = size * 0.36;
  inPaths = Array.from({ length: LEFT_LINES }, (_, i) => curve(0, lineY(i, LEFT_LINES), cx - edge, cy));
  outPaths = Array.from({ length: RIGHT_LINES }, (_, i) => curve(cx + edge, cy, W, lineY(i, RIGHT_LINES)));
}

function spawn() {
  coins.push({
    path: inPaths[Math.floor(Math.random() * LEFT_LINES)],
    t: 0,
    speed: 0.00042 + Math.random() * 0.00016,
    bad: Math.random() < BAD_SHARE,
    leaving: false,
  });
}

function hitShield(coin) {
  const color = coin.bad ? colors.red : colors.green;
  flash = { color, alpha: 1 };
  rings.push({ r: size * 0.42, alpha: 0.7, color });
  if (coin.bad) {
    label = { text: FLAGS[flagIndex++ % FLAGS.length], alpha: 1, life: 1 };
    coin.dead = true;
  } else {
    coin.leaving = true;
    coin.t = 0;
    coin.path = outPaths[Math.floor(Math.random() * RIGHT_LINES)];
  }
}

function update(dt, now) {
  if (now - lastSpawn > SPAWN_MS) {
    lastSpawn = now;
    spawn();
  }
  for (const coin of coins) {
    coin.t += coin.speed * dt;
    if (coin.t < 1) continue;
    if (coin.leaving) coin.dead = true;
    else hitShield(coin);
  }
  coins = coins.filter((c) => !c.dead);

  for (const ring of rings) {
    ring.r += dt * 0.05;
    ring.alpha -= dt * 0.0013;
  }
  rings = rings.filter((r) => r.alpha > 0);
  flash.alpha = Math.max(0, flash.alpha - dt * 0.0022);

  if (label) {
    label.life -= dt * 0.00065;
    label.alpha = Math.min(1, label.life * 3);
    if (label.life <= 0) label = null;
  }
}

function drawPaths(paths) {
  ctx.strokeStyle = colors.border;
  ctx.lineWidth = 1;
  for (const p of paths) {
    ctx.beginPath();
    ctx.moveTo(p.x0, p.y0);
    ctx.bezierCurveTo(p.c1x, p.c1y, p.c2x, p.c2y, p.x1, p.y1);
    ctx.stroke();
  }
}

function drawCoin(coin) {
  const color = coin.leaving ? colors.green : colors.text;
  ctx.fillStyle = color;
  for (let i = TRAIL; i >= 0; i--) {
    const t = coin.t - i * 0.012;
    if (t < 0) continue;
    const { x, y } = pointOn(coin.path, t);
    ctx.globalAlpha = i === 0 ? 1 : 0.32 * (1 - i / TRAIL);
    ctx.beginPath();
    ctx.arc(x, y, i === 0 ? 2.6 : 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawShield() {
  const scale = size / 32;
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(scale, scale);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  ctx.fillStyle = colors.bg;
  ctx.fill(SHIELD);
  if (flash.alpha > 0) {
    ctx.globalAlpha = flash.alpha * 0.16;
    ctx.fillStyle = flash.color;
    ctx.fill(SHIELD);
    ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = flash.alpha > 0.05 ? flash.color : colors.text;
  ctx.lineWidth = 1.5;
  ctx.stroke(SHIELD);
  ctx.strokeStyle = colors.green;
  ctx.lineWidth = 1.9;
  ctx.stroke(TICK);
  ctx.restore();
}

function draw() {
  ctx.clearRect(0, 0, W, H);
  drawPaths(inPaths);
  drawPaths(outPaths);
  coins.forEach(drawCoin);

  ctx.lineWidth = 1.5;
  for (const ring of rings) {
    ctx.globalAlpha = Math.max(0, ring.alpha);
    ctx.strokeStyle = ring.color;
    ctx.beginPath();
    ctx.arc(cx, cy, ring.r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  drawShield();

  if (label) {
    ctx.globalAlpha = Math.max(0, label.alpha);
    ctx.fillStyle = colors.red;
    ctx.font = `500 12px ${colors.mono}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(label.text, cx, cy - size / 2 - 10 - (1 - label.life) * 8);
    ctx.globalAlpha = 1;
  }
}

function frame(now) {
  if (!visible || document.hidden) {
    running = false;
    return;
  }
  const dt = Math.min(now - lastFrame, 50);
  lastFrame = now;
  update(dt, now);
  draw();
  requestAnimationFrame(frame);
}

function start() {
  if (running || reduceMotion) return;
  running = true;
  lastFrame = performance.now();
  requestAnimationFrame(frame);
}

// With reduced motion, show one still picture instead of the animation.
function drawStill() {
  coins = [
    { path: inPaths[0], t: 0.35 },
    { path: inPaths[2], t: 0.6 },
    { path: inPaths[4], t: 0.25 },
    { path: outPaths[1], t: 0.5, leaving: true },
  ];
  draw();
}

export function wireFlow() {
  canvas = $('flow-canvas');
  ctx = canvas.getContext('2d');

  const css = getComputedStyle(document.documentElement);
  const token = (name) => css.getPropertyValue(name).trim();
  colors = {
    bg: token('--bg'),
    border: token('--border-strong'),
    text: token('--text'),
    red: token('--red'),
    green: token('--green'),
    mono: token('--mono'),
  };

  new ResizeObserver(() => {
    layout();
    if (reduceMotion) drawStill();
  }).observe(canvas);

  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) start();
  }).observe(canvas);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && visible) start();
  });
}
