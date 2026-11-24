import { h, reduced } from './ui.js';

const lowPower = () => (navigator.hardwareConcurrency ?? 4) <= 2 || navigator.connection?.saveData;

/** ใบไม้ปลิวเบาๆ หยุดเองเมื่อแท็บถูกซ่อน */
export function floatingLeaves(count = 14) {
  if (reduced() || lowPower()) return;
  const canvas = h('canvas', { class: 'fx-leaves', 'aria-hidden': 'true' });
  document.body.prepend(canvas);
  const ctx = canvas.getContext('2d');
  const n = innerWidth < 640 ? Math.ceil(count / 2) : count;
  let W; let H; let dpr;
  const size = () => { dpr = Math.min(devicePixelRatio, 2); W = innerWidth; H = innerHeight; canvas.width = W * dpr; canvas.height = H * dpr; };
  size();
  addEventListener('resize', size);
  const make = (y) => ({ x: Math.random() * innerWidth, y: y ?? -30, s: 6 + Math.random() * 10, v: 0.25 + Math.random() * 0.5, a: Math.random() * 6, w: 0.4 + Math.random(), hue: Math.random() < 0.3 ? 268 : 95 + Math.random() * 35 });
  const leaves = Array.from({ length: n }, () => make(Math.random() * innerHeight));
  let raf;
  const draw = () => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    for (const l of leaves) {
      l.y += l.v; l.a += 0.012 * l.w; l.x += Math.sin(l.a) * 0.6;
      if (l.y > H + 30) Object.assign(l, make());
      ctx.save();
      ctx.translate(l.x, l.y); ctx.rotate(Math.sin(l.a) * 1.4);
      ctx.fillStyle = `hsl(${l.hue} 55% ${l.hue > 200 ? 78 : 55}% / .38)`;
      ctx.beginPath(); ctx.moveTo(0, -l.s); ctx.quadraticCurveTo(l.s, -l.s * 0.2, 0, l.s); ctx.quadraticCurveTo(-l.s, -l.s * 0.2, 0, -l.s); ctx.fill();
      ctx.restore();
    }
    raf = requestAnimationFrame(draw);
  };
  draw();
  document.addEventListener('visibilitychange', () => { cancelAnimationFrame(raf); if (!document.hidden) draw(); });
}

export function celebrate() {
  if (reduced()) return;
  const c = h('canvas', { class: 'fx-celebrate', 'aria-hidden': 'true' });
  document.body.append(c);
  const W = c.width = innerWidth; const H = c.height = innerHeight;
  const ctx = c.getContext('2d');
  const colors = ['#35a66a', '#8fd14b', '#6a4fc0', '#cdbcf2', '#f5821f', '#ffc83d'];
  const ps = Array.from({ length: 150 }, (_, i) => { const left = i % 2; const ang = (left ? -60 : -120) * (Math.PI / 180) + (Math.random() - 0.5) * 0.9; const sp = 11 + Math.random() * 13;
    return { x: left ? 0 : W, y: H * 0.8, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, s: 5 + Math.random() * 9, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, c: colors[i % 6] }; });
  const t0 = performance.now();
  const tick = (t) => {
    const age = (t - t0) / 3800;
    if (age >= 1) return c.remove();
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = Math.min(1, (1 - age) * 2);
    for (const p of ps) {
      p.vy += 0.28; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.scale(1, Math.abs(Math.cos(p.r * 1.7)) + 0.15); ctx.fillStyle = p.c;
      ctx.beginPath(); ctx.moveTo(0, -p.s); ctx.quadraticCurveTo(p.s, 0, 0, p.s); ctx.quadraticCurveTo(-p.s, 0, 0, -p.s); ctx.fill(); ctx.restore();
    }
    return requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** เอียงการ์ด 3 มิติตามเมาส์ */
export function tilt(el) {
  if (reduced() || !matchMedia('(hover: hover)').matches) return;
  el.addEventListener('pointermove', (e) => {
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width; const y = (e.clientY - r.top) / r.height;
    el.style.setProperty('--rx', `${(0.5 - y) * 14}deg`); el.style.setProperty('--ry', `${(x - 0.5) * 18}deg`);
    el.style.setProperty('--gx', `${x * 100}%`); el.style.setProperty('--gy', `${y * 100}%`);
  });
  el.addEventListener('pointerleave', () => { el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg'); });
}

export function parallax(selector) {
  if (reduced() || !matchMedia('(hover: hover)').matches) return;
  const els = [...document.querySelectorAll(selector)];
  let queued = false;
  addEventListener('pointermove', (e) => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      for (const el of els) { const d = Number(el.dataset.depth || 10); el.style.translate = `${(0.5 - e.clientX / innerWidth) * d}px ${(0.5 - e.clientY / innerHeight) * d * 0.5}px`; }
    });
  }, { passive: true });
}

export function countUp(el, to, format = (n) => n.toLocaleString('th-TH')) {
  if (reduced() || !to) { el.textContent = format(to); return; }
  const t0 = performance.now();
  const step = (t) => { const p = Math.min(1, (t - t0) / 900); el.textContent = format(Math.round(to * (1 - (1 - p) ** 4))); if (p < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
