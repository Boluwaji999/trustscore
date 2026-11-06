// Page-wide scroll effects: reading progress bar, hero fading away, sections revealing on entry.

import { reduceMotion } from './util.js';

// Groups reveal one after another; `stagger` is the delay between items in a group, in ms.
const REVEALS = [
  { selector: '.feed-head > *', stagger: 90 },
  { selector: '.feed-summary, .feed-grid, .feed-note', stagger: 90 },
  { selector: '.features > .label, .features > h2, .feature-grid', stagger: 90 },
  { selector: '.feature > *', stagger: 35 },
  { selector: '.footer > *', stagger: 80 },
];

function wireReveals() {
  document.documentElement.classList.add('reveal-ready');
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const node = entry.target;
      io.unobserve(node);
      node.classList.add('revealed');
      // Hand the element back to its normal hover transitions once it has landed.
      setTimeout(() => node.removeAttribute('data-reveal'), 1400);
    }
  }, { rootMargin: '0px 0px -10% 0px', threshold: 0.05 });

  for (const { selector, stagger } of REVEALS) {
    document.querySelectorAll(selector).forEach((node, i) => {
      node.dataset.reveal = '';
      node.style.setProperty('--reveal-delay', `${i * stagger}ms`);
      io.observe(node);
    });
  }
}

function wireProgress() {
  const root = document.documentElement;
  let queued = false;
  const update = () => {
    queued = false;
    const y = scrollY;
    const max = root.scrollHeight - innerHeight;
    root.style.setProperty('--page-progress', max > 0 ? (y / max).toFixed(4) : '0');
    root.style.setProperty('--hero-out', Math.min(1, y / (innerHeight * 0.75)).toFixed(4));
    root.classList.toggle('scrolled', y > 8);
  };
  addEventListener('scroll', () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  }, { passive: true });
  addEventListener('resize', update, { passive: true });
  update();
}

export function wireScroll() {
  wireProgress();
  if (!reduceMotion) wireReveals();
}
