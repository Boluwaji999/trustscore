// Draws a 1200x630 result card on a canvas so people can post it on X / Telegram.

import { riskOf, RISK_LABEL, shortAddress } from './util.js';

const W = 1200;
const H = 630;
const C = {
  bg: '#09090b',
  surface: '#111114',
  border: '#26262b',
  text: '#ededef',
  muted: '#8e8e97',
  faint: '#5e5e67',
  high: '#f4525a',
  medium: '#f2a33a',
  low: '#3ecf8e',
  danger: '#f4525a',
  warn: '#f2a33a',
  good: '#3ecf8e',
  info: '#7aa7ff',
};

function fit(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function drawShield(ctx, x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s / 32, s / 32);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = C.text;
  ctx.lineWidth = 2.2;
  ctx.stroke(new Path2D('M16 4l9 3.4v6.8c0 5.6-3.8 9.7-9 12.4-5.2-2.7-9-6.8-9-12.4V7.4L16 4z'));
  ctx.strokeStyle = C.low;
  ctx.lineWidth = 2.6;
  ctx.stroke(new Path2D('M12.2 15.6l2.8 2.8 5-5.6'));
  ctx.restore();
}

export async function makeCard({ chain, address, result }) {
  await document.fonts.ready;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const sans = 'Geist, system-ui, sans-serif';
  const mono = '"Geist Mono", ui-monospace, monospace';
  const risk = riskOf(result.score);
  const tone = C[risk];

  // Background + soft top glow
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, -120, 0, W / 2, -120, 700);
  glow.addColorStop(0, 'rgba(255,255,255,0.07)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Brand
  drawShield(ctx, 64, 52, 36);
  ctx.fillStyle = C.text;
  ctx.font = `600 26px ${sans}`;
  ctx.textBaseline = 'middle';
  ctx.fillText('TrustScore', 112, 71);
  ctx.fillStyle = C.faint;
  ctx.font = `500 18px ${mono}`;
  ctx.textAlign = 'right';
  ctx.fillText('RISK REPORT', W - 64, 71);
  ctx.textAlign = 'left';

  // Token
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.text;
  ctx.font = `600 62px ${sans}`;
  const title = result.symbol ? `$${result.symbol}` : result.name;
  ctx.fillText(fit(ctx, title, 640), 64, 210);
  ctx.fillStyle = C.muted;
  ctx.font = `400 24px ${mono}`;
  ctx.fillText(fit(ctx, `${result.symbol ? result.name + ' · ' : ''}${chain.name} · ${shortAddress(address)}`, 640), 64, 252);

  // Score panel
  const px = 780;
  const py = 130;
  ctx.fillStyle = C.surface;
  roundRect(ctx, px, py, 356, 250, 20);
  ctx.fill();
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = C.faint;
  ctx.font = `500 16px ${mono}`;
  ctx.fillText('RISK SCORE', px + 32, py + 46);
  ctx.fillStyle = tone;
  ctx.font = `600 120px ${sans}`;
  ctx.fillText(String(result.score), px + 28, py + 168);
  const numW = ctx.measureText(String(result.score)).width;
  ctx.fillStyle = C.faint;
  ctx.font = `400 30px ${mono}`;
  ctx.fillText('/ 10', px + 40 + numW, py + 168);

  // Meter
  const segW = (356 - 64 - 9 * 6) / 10;
  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = i < result.score ? tone : '#1d1d22';
    roundRect(ctx, px + 32 + i * (segW + 6), py + 196, segW, 12, 3);
    ctx.fill();
  }

  // Risk badge
  ctx.font = `500 20px ${sans}`;
  const label = RISK_LABEL[risk];
  const bw = ctx.measureText(label).width + 52;
  ctx.fillStyle = `${tone}22`;
  roundRect(ctx, 64, 290, bw, 44, 22);
  ctx.fill();
  ctx.fillStyle = tone;
  ctx.beginPath();
  ctx.arc(88, 312, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 102, 313);
  ctx.textBaseline = 'alphabetic';

  // Top findings: the worst first.
  const shown = result.findings.filter((f) => f.level !== 'info').slice(0, 3);
  shown.forEach((f, i) => {
    const y = 402 + i * 52;
    ctx.fillStyle = C[f.level];
    ctx.beginPath();
    ctx.arc(72, y - 8, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = C.text;
    ctx.font = `500 26px ${sans}`;
    ctx.fillText(fit(ctx, f.title, 1040), 92, y);
  });

  // Footer
  ctx.strokeStyle = C.border;
  ctx.beginPath();
  ctx.moveTo(64, H - 72);
  ctx.lineTo(W - 64, H - 72);
  ctx.stroke();
  ctx.fillStyle = C.faint;
  ctx.font = `400 18px ${sans}`;
  ctx.fillText('Information, not financial advice. Always do your own research.', 64, H - 34);

  return canvas;
}

export async function shareCard(report) {
  const canvas = await makeCard(report);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  const filename = `trustscore-${(report.result.symbol || 'token').toLowerCase()}.png`;
  const file = new File([blob], filename, { type: 'image/png' });

  // Phones: open the share sheet. Desktop: download the file.
  if (navigator.canShare?.({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
    try {
      await navigator.share({ files: [file], title: 'TrustScore result' });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
