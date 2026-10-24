// Drawing and motion copied from the user-supplied Mimo state/emote board.
// Keep the reference block unchanged; lifecycle and application aliases live outside it.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.NotchyMimoRenderer = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  function referenceEngine({now, random, dpr, schedule, Path2D}) {
    const performance = {now}, window = {devicePixelRatio:dpr};
    const Math = Object.create(globalThis.Math); Math.random = random;
    const setTimeout = schedule;
    // BEGIN EXACT REFERENCE
const NOW = () => performance.now();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const E = {
  out: t => 1 - Math.pow(1 - t, 3),
  inOut: t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  back: t => { const c1 = 1.7, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  lin: t => t
};
const hexRgb = h => { h = h.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; };
const rgba = (c, a) => 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + a + ')';
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const Snd = { play() {} };

const P = { eye: { w: .25, h: .52, sp: .31, p: .02 }, ink: '#121317' };
const STATES = {
  idle: { col: '#E6E9EE', tint: 0, eye: 'pill', badge: null },
  working: { col: '#3B9EFF', tint: .72, eye: 'pill', badge: ['dots', '#3B9EFF'] },
  finished: { col: '#34D399', tint: .35, eye: 'happy', badge: ['dot', '#34D399'] },
  error: { col: '#F4505E', tint: .78, eye: 'flat', badge: ['dot', '#F4505E'] },
  dizzy: { col: '#F472B6', tint: .7, eye: 'spiral', badge: null },
  thinking: { col: '#8B5CF6', tint: .72, eye: 'pill', badge: ['dots', '#8B5CF6'], look: [.55, .55] },
  searching: { col: '#6366F1', tint: .72, eye: 'pill', badge: ['dots', '#6366F1'], scan: 1 },
  approval: { col: '#F5A524', tint: .78, eye: 'wide', badge: ['bang', '#F5A524'], bounce: 1 },
  question: { col: '#22D3EE', tint: .75, eye: 'pill', badge: ['q', '#22D3EE'], tilt: .17 },
  ratelimit: { col: '#FB923C', tint: .72, eye: 'tired', badge: ['dot', '#FB923C'], sweat: 1 },
  sleeping: { col: '#94A3B8', tint: .32, eye: 'closed', badge: null, breathe: 1, zz: 1 },
  reading: { col: '#D6A15E', tint: .55, eye: 'pill', badge: ['book', '#D6A15E'], read: 1, glasses: 1 },
  gain: { col: '#22C55E', tint: .5, eye: 'dollar', badge: ['up', '#22C55E'], bounce: 1, coins: 1 },
  loss: { col: '#E5484D', tint: .6, eye: 'sad', badge: ['down', '#E5484D'], slump: 1, tears: 1 },
  news: { col: '#E879F9', tint: .6, eye: 'wide', badge: ['news', '#E879F9'], glance: 1, ring: 1 },
  coding: { col: '#14B8A6', tint: .6, eye: 'pill', badge: ['code', '#14B8A6'], type: 1, code: 1 }
};
const EMOTES = {
  love: { eye: 'heart' }, surprised: { eye: 'dot' }, proud: { eye: 'star' },
  wink: { eye: 'wink' }, yawn: { eye: 'tired' }, happy: { eye: 'happy' }
};

function rr(x, X, Y, W, H, R) {
  R = Math.max(0, Math.min(R, W / 2, H / 2));
  x.beginPath(); x.moveTo(X + R, Y); x.arcTo(X + W, Y, X + W, Y + H, R); x.arcTo(X + W, Y + H, X, Y + H, R); x.arcTo(X, Y + H, X, Y, R); x.arcTo(X, Y, X + W, Y, R); x.closePath();
}
function heart(x, s) {
  x.beginPath(); x.moveTo(0, s * .38); x.bezierCurveTo(-s * 1.05, -s * .15, -s * .5, -s * .95, 0, -s * .38); x.bezierCurveTo(s * .5, -s * .95, s * 1.05, -s * .15, 0, s * .38); x.closePath();
}
function star(x, ro, ri) {
  x.beginPath();
  for (let i = 0; i < 10; i++) { const r = i % 2 ? ri : ro, a = -Math.PI / 2 + i * Math.PI / 5; x.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
  x.closePath();
}

class Bot {
  constructor(canvas) {
    this.c = canvas; this.x = canvas.getContext('2d');
    this.s = { yaw: 0, pitch: 0, roll: 0, tilt: 0, open: 1, sx: 1, sy: 1, oy: 0, ox: 0, tint: 0, blush: 0, es: 1, badgeS: 0 };
    this.tg = Object.assign({}, this.s); this.tw = []; this.lock = {};
    this.col = [230, 233, 238]; this.colT = [230, 233, 238];
    this.state = 'idle'; this.cfg = STATES.idle; this.eyeOv = null; this.ovUntil = 0;
    this.badge = null; this.badgeCol = '#fff'; this._bk = 'none'; this._bt = 0;
    this.parts = []; this.nextBlink = NOW() + 1500 + Math.random() * 2000;
    this.look = { x: 0, y: 0 }; this.t0 = NOW() - Math.random() * 5000; this.lastAmb = 0; this.lastAmb2 = 0; this.last = NOW();
    const dpr = Math.min(2, window.devicePixelRatio || 1); const px = 260;
    canvas.width = px * dpr; canvas.height = px * dpr;
  }
  anim(p, keys, after) {
    this.tw = this.tw.filter(t => t.p !== p);
    this.tw.push({ p: p, keys: keys, i: 0, from: this.s[p], t0: NOW(), after: after }); this.lock[p] = 1;
  }
  setState(n, force) {
    if (!STATES[n]) return; if (this.state === n && !force) return;
    const prev = this.state; this.state = n; const c = this.cfg = STATES[n];
    this.colT = hexRgb(c.col); this.tg.tint = c.tint; this.tg.tilt = c.tilt || 0; this.setBadge(c.badge);
    if (n === 'finished') { this.roll(950, 1); setTimeout(() => this.emit('spark', 5), 500); }
    else if (n === 'error') { this.anim('ox', [[.08, 50, E.out], [-.08, 70, E.inOut], [.05, 70, E.inOut], [0, 90, E.out]]); }
    else if (n === 'approval') { this.anim('oy', [[-.2, 150, E.out], [0, 300, E.back]]); }
    else if (n === 'dizzy') { this.roll(1300, 2); }
    else if (n === 'question') { this.blink(); }
    else if (n === 'ratelimit') { this.emit('sweat', 1); }
    else if (n === 'gain') { this.anim('oy', [[-.28, 150, E.out], [0, 420, E.back]]); setTimeout(() => this.emit('coin', 6), 200); }
    else if (n === 'loss') { this.anim('sy', [[.84, 220, E.out], [.94, 420, E.inOut]]); this.anim('sx', [[1.1, 220, E.out], [1.04, 420, E.inOut]]); }
    else if (n === 'news') { this.anim('oy', [[-.18, 120, E.out], [0, 320, E.back]]); this.blink(); }
    else if (prev !== 'idle' || n !== 'idle') this.blink();
  }
  setBadge(b) {
    const key = b ? b.join() : 'none'; if (key === this._bk) return; this._bk = key; const tok = ++this._bt;
    this.anim('badgeS', [[0, 90, E.inOut]]);
    setTimeout(() => { if (tok !== this._bt) return; this.badge = b ? b[0] : null; this.badgeCol = b ? b[1] : null; if (b) this.anim('badgeS', [[1, 280, E.back]]); }, 100);
  }
  blink() { if (this.lock.open) return; this.anim('open', [[.06, 70, E.inOut], [1, 130, E.out]]); }
  roll(d, turns) { this.s.roll = 0; this.anim('roll', [[Math.PI * 2 * turns, d, E.inOut]], () => { this.s.roll = 0; this.tg.roll = 0; }); }
  emote(n, d) {
    const em = EMOTES[n]; if (!em) return; this.eyeOv = em.eye; this.ovUntil = NOW() + d;
    if (n === 'love') { this.anim('blush', [[1, 300, E.out], [1, d - 600, E.lin], [0, 300, E.inOut]]); this.emit('heart', 4); this.anim('oy', [[-.1, 160, E.out], [0, 300, E.back]]); }
    if (n === 'surprised') { this.anim('oy', [[-.3, 140, E.out], [0, 380, E.back]]); this.anim('es', [[1.25, 120, E.out], [1, 500, E.inOut]]); }
    if (n === 'proud') { this.emit('star', 5); this.anim('tilt', [[-.14, 220, E.out], [-.14, d - 500, E.lin], [0, 280, E.inOut]]); }
    if (n === 'wink') { this.anim('tilt', [[.12, 160, E.out], [.12, d - 400, E.lin], [0, 240, E.inOut]]); }
    if (n === 'yawn') {
      this.anim('sy', [[1.12, 500, E.inOut], [1, 500, E.inOut]]); this.anim('sx', [[.94, 500, E.inOut], [1, 500, E.inOut]]);
      setTimeout(() => { this.eyeOv = 'closed'; this.emit('z', 2); }, 700);
    }
  }
  emit(type, n) {
    if (type === 'coin' || type === 'tear' || type === 'code') { this.emitSpecial(type, n); return; }
    for (let i = 0; i < n; i++) this.parts.push({ type: type, x: (Math.random() - .5) * .9 + (type === 'z' ? .55 : 0), y: -.7 - Math.random() * .2, vx: (Math.random() - .5) * .35 + (type === 'z' ? .18 : 0), vy: -(.45 + Math.random() * .35), age: -i * .14, life: 1.3 + Math.random() * .5, rot: Math.random() * 6, sz: .15 + Math.random() * .08 });
  }
  emitSpecial(type, n) {
    for (let i = 0; i < n; i++) {
      if (type === 'tear') this.parts.push({ type: type, x: (Math.random() < .5 ? -.235 : .235), y: .15, vx: 0, vy: .5, age: -i * .14, life: 1.1, rot: 0, sz: .09 });
      else if (type === 'coin') this.parts.push({ type: type, x: (Math.random() - .5) * 1.1, y: -.55, vx: (Math.random() - .5) * .5, vy: -1.4 - Math.random() * .3, g: 2.4, age: -i * .12, life: 1.5, rot: Math.random() * 6, sz: .15 });
      else this.parts.push({ type: type, ch: ['{ }', '</>', '( )', '=>', '[ ]', ';'][Math.floor(Math.random() * 6)], x: (Math.random() - .5) * 1.2, y: -.75, vx: (Math.random() - .5) * .2, vy: -(.35 + Math.random() * .2), age: -i * .1, life: 1.6, rot: 0, sz: .15 });
    }
  }
  update() {
    const n = NOW(), dt = Math.min(.05, (n - this.last) / 1000); this.last = n;
    const s = this.s, tg = this.tg, c = this.cfg, t = (n - this.t0) / 1000;
    for (const tw of this.tw.slice()) {
      const k = tw.keys[tw.i]; const p = clamp((n - tw.t0) / k[1], 0, 1); s[tw.p] = tw.from + (k[0] - tw.from) * k[2](p);
      if (p >= 1) {
        tw.from = k[0]; tw.i++; tw.t0 = n;
        if (tw.i >= tw.keys.length) { this.tw.splice(this.tw.indexOf(tw), 1); delete this.lock[tw.p]; this.tg[tw.p] = tw.keys[tw.keys.length - 1][0]; if (tw.after) tw.after(); }
      }
    }
    let ty = this.look.x * .62, tp = this.look.y * .5;
    if (c.look) { ty = ty * .35 + c.look[0] * .55; tp = tp * .3 + c.look[1] * .5; }
    if (c.scan) { ty = Math.sin(t * 2.6) * .6; tp = -.06; }
    if (this.state === 'sleeping') { ty = 0; tp = -.14; }
    if (this.state === 'dizzy') { ty = Math.sin(t * 9) * .25; }
    if (c.read) { const ph = (t * .6) % 1, line = Math.floor(t * .6) % 3; ty = -.55 + 1.1 * E.inOut(clamp(ph / .85, 0, 1)); tp = -.02 - line * .07; }
    if (c.glance) { ty = Math.sin(t * 1.3) > 0 ? .6 : -.15; tp = .06; }
    if (c.type) { ty = Math.sin(t * 5.5) * .28 + Math.sin(t * 1.3) * .2; tp = -.14; }
    if (c.slump) { ty = this.look.x * .15; tp = -.14; }
    tg.yaw = ty; tg.pitch = tp; tg.tilt = c.tilt || 0; tg.oy = c.bounce ? -Math.abs(Math.sin(t * 5.2)) * .07 : (c.slump ? .06 : (c.type ? -Math.abs(Math.sin(t * 9)) * .012 : 0));
    tg.sy = c.breathe ? 1 + Math.sin(t * 1.8) * .035 : (c.slump ? .94 + Math.sin(t * 1.2) * .01 : 1); tg.sx = c.breathe ? 1 - Math.sin(t * 1.8) * .02 : (c.slump ? 1.04 : 1);
    const kLook = 1 - Math.pow(.0025, dt), kGen = 1 - Math.pow(.0008, dt);
    for (const k in tg) { if (this.lock[k]) continue; s[k] += (tg[k] - s[k]) * ((k === 'yaw' || k === 'pitch') ? kLook : kGen); }
    this.col = mix(this.col, this.colT, 1 - Math.pow(.002, dt));
    if (n > this.nextBlink) {
      if (this.state !== 'sleeping' && this.state !== 'dizzy') { this.blink(); if (Math.random() < .22) setTimeout(() => this.blink(), 230); }
      this.nextBlink = n + 2200 + Math.random() * 3200;
    }
    if (this.eyeOv && n > this.ovUntil) this.eyeOv = null;
    if (n - this.lastAmb > 1300) { this.lastAmb = n; if (c.zz) this.emit('z', 1); if (c.sweat && Math.random() < .5) this.emit('sweat', 1); }
    if (n - this.lastAmb2 > 650) { this.lastAmb2 = n; if (c.coins) this.emit('coin', 2); if (c.tears) this.emit('tear', 1); if (c.code) this.emit('code', 1); }
    for (const p of this.parts) p.age += dt; this.parts = this.parts.filter(p => p.age < p.life);
  }
  draw() {
    const x = this.x, W = this.c.width, H = this.c.height, s = this.s;
    x.clearRect(0, 0, W, H);
    const R = W * .31, rx = R, ry = R;
    const cx = W / 2 + s.ox * R, cy = H / 2 + s.oy * R;
    const col = this.col;
    x.save(); x.translate(cx, cy); x.rotate(s.tilt); x.scale(s.sx, s.sy);
    const path = new Path2D(); path.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    // corps : blanc en haut, pêche en bas
    const g = x.createLinearGradient(rx * .18, -ry * .95, -rx * .12, ry * .95);
    g.addColorStop(0, 'rgb(252,253,255)'); g.addColorStop(.42, 'rgb(250,232,218)'); g.addColorStop(1, 'rgb(236,180,140)');
    x.fillStyle = g; x.fill(path);
    if (s.tint > .01) {
      const tg2 = x.createLinearGradient(0, ry, 0, -ry * .25);
      tg2.addColorStop(0, rgba(col, .9 * s.tint * .6)); tg2.addColorStop(1, rgba(col, 0));
      x.fillStyle = tg2; x.fill(path);
    }
    const sh = x.createRadialGradient(rx * .25, -ry * .32, R * .15, 0, 0, R * 1.25);
    sh.addColorStop(0, 'rgba(255,255,255,0)'); sh.addColorStop(.6, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(120,60,20,.2)');
    x.fillStyle = sh; x.fill(path);
    const hl = x.createRadialGradient(rx * .34, -ry * .46, 0, rx * .34, -ry * .46, R * .42);
    hl.addColorStop(0, 'rgba(226,235,255,.6)'); hl.addColorStop(1, 'rgba(226,235,255,0)');
    x.fillStyle = hl; x.fill(path);
    x.lineWidth = R * .012; x.strokeStyle = 'rgba(236,180,140,.55)'; x.stroke(path);
    if (this.cfg.ring) {
      for (let q = 0; q < 2; q++) { const k = ((NOW() / 1000 * .9 + q * .5) % 1); x.beginPath(); x.arc(0, 0, R * (1.04 + .5 * k), 0, Math.PI * 2); x.lineWidth = R * .035; x.strokeStyle = rgba(col, .55 * (1 - k)); x.stroke(); }
      x.strokeStyle = 'rgba(236,180,140,.55)';
    }
    // joues
    const bl = s.blush;
    if (bl > .01) {
      x.save(); x.clip(path); const yo = Math.sin(s.yaw) * rx * .8; x.fillStyle = 'rgba(255,120,150,' + (.5 * bl) + ')';
      for (const sd of [-1, 1]) { x.beginPath(); x.ellipse(sd * rx * .55 + yo, ry * .2, R * .17, R * .1, 0, 0, Math.PI * 2); x.fill(); }
      x.restore();
    }
    // yeux
    x.save(); x.clip(path); x.fillStyle = P.ink; x.strokeStyle = P.ink;
    const shape = this.eyeOv || this.cfg.eye; const eyePos = [];
    for (const sd of [-1, 1]) {
      const yaw = sd * P.eye.sp + s.yaw; let pitch = P.eye.p + s.pitch + s.roll;
      pitch = ((pitch + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
      const cp = Math.cos(pitch); if (Math.cos(yaw) * cp < .04) continue;
      const px = Math.sin(yaw) * cp * rx, py = -Math.sin(pitch) * ry;
      const fx = Math.max(.18, Math.cos(yaw)), fy = Math.max(.18, cp);
      x.save(); x.translate(px, py); x.scale(fx, fy); this.eye(shape, R * P.eye.w * s.es, R * P.eye.h * s.es, s.open, sd);
      if (this.cfg.glasses) { x.lineWidth = R * .03; x.strokeStyle = P.ink; x.beginPath(); x.arc(0, 0, R * .27, 0, Math.PI * 2); x.stroke(); }
      x.restore();
      eyePos.push({ px: px, py: py, fx: fx });
      if (this.cfg.glasses && eyePos.length === 2) { x.lineWidth = R * .03; x.strokeStyle = P.ink; x.beginPath(); x.moveTo(eyePos[0].px + R * .27 * eyePos[0].fx, eyePos[0].py); x.lineTo(eyePos[1].px - R * .27 * eyePos[1].fx, eyePos[1].py); x.stroke(); }
    }
    x.restore();
    x.restore();
    // badge
    if (this.badge && s.badgeS > .01) {
      const bs = s.badgeS; const bx = cx - rx * .76 * s.sx, by = cy - ry * .72 * s.sy; x.save(); x.translate(bx, by); x.scale(bs, bs);
      const bcol = this.badgeCol;
      if (this.badge === 'dots') {
        const w = R * .74, h = R * .42; x.fillStyle = '#000'; rr(x, -w / 2 - R * .07, -h / 2 - R * .07, w + R * .14, h + R * .14, (h + R * .14) / 2); x.fill();
        x.fillStyle = bcol; rr(x, -w / 2, -h / 2, w, h, h / 2); x.fill();
        const tt = NOW() / 1000;
        for (let i = 0; i < 3; i++) { const ph = ((tt * 2.4 - i * .22) % 1 + 1) % 1; const r = R * .06 * (1 + .4 * Math.max(0, Math.sin(ph * Math.PI * 2))); x.fillStyle = 'rgba(255,255,255,.95)'; x.beginPath(); x.arc((i - 1) * R * .19, 0, r, 0, Math.PI * 2); x.fill(); }
      } else if (this.badge === 'code') {
        const w = R * .9, h = R * .42; x.fillStyle = '#000'; rr(x, -w / 2 - R * .07, -h / 2 - R * .07, w + R * .14, h + R * .14, (h + R * .14) / 2); x.fill();
        x.fillStyle = bcol; rr(x, -w / 2, -h / 2, w, h, h / 2); x.fill();
        x.fillStyle = '#fff'; x.font = '800 ' + (R * .24) + 'px ui-monospace,Menlo,monospace'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('</>', 0, R * .015);
      } else if (this.badge === 'book' || this.badge === 'up' || this.badge === 'down' || this.badge === 'news') {
        x.fillStyle = '#000'; x.beginPath(); x.arc(0, 0, R * .3, 0, Math.PI * 2); x.fill();
        x.fillStyle = bcol; x.beginPath(); x.arc(0, 0, R * .23, 0, Math.PI * 2); x.fill();
        x.strokeStyle = '#fff'; x.lineWidth = R * .045; x.lineCap = 'round'; x.lineJoin = 'round'; x.beginPath();
        if (this.badge === 'up' || this.badge === 'down') {
          const d = this.badge === 'up' ? 1 : -1;
          x.moveTo(0, R * .1 * d); x.lineTo(0, -R * .11 * d); x.moveTo(-R * .09, -R * .02 * d); x.lineTo(0, -R * .11 * d); x.lineTo(R * .09, -R * .02 * d);
        } else if (this.badge === 'book') {
          x.moveTo(0, -R * .07); x.lineTo(0, R * .09);
          x.moveTo(0, -R * .07); x.quadraticCurveTo(-R * .07, -R * .1, -R * .13, -R * .07); x.lineTo(-R * .13, R * .07); x.quadraticCurveTo(-R * .07, R * .04, 0, R * .09);
          x.moveTo(0, -R * .07); x.quadraticCurveTo(R * .07, -R * .1, R * .13, -R * .07); x.lineTo(R * .13, R * .07); x.quadraticCurveTo(R * .07, R * .04, 0, R * .09);
        } else {
          x.moveTo(-R * .11, -R * .1); x.lineTo(R * .11, -R * .1); x.lineTo(R * .11, R * .1); x.lineTo(-R * .11, R * .1); x.closePath();
          x.moveTo(-R * .06, -R * .03); x.lineTo(R * .06, -R * .03); x.moveTo(-R * .06, R * .035); x.lineTo(R * .06, R * .035);
        }
        x.stroke();
      } else if (this.badge === 'bang' || this.badge === 'q') {
        x.fillStyle = '#000'; x.beginPath(); x.arc(0, 0, R * .3, 0, Math.PI * 2); x.fill();
        x.fillStyle = bcol; x.beginPath(); x.arc(0, 0, R * .23, 0, Math.PI * 2); x.fill();
        x.fillStyle = '#fff'; x.font = '800 ' + (R * .32) + 'px -apple-system,system-ui,sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(this.badge === 'bang' ? '!' : '?', 0, R * .02);
      } else {
        x.fillStyle = '#000'; x.beginPath(); x.arc(0, 0, R * .2, 0, Math.PI * 2); x.fill();
        x.fillStyle = bcol; x.beginPath(); x.arc(0, 0, R * .135, 0, Math.PI * 2); x.fill();
      }
      x.restore();
    }
    // particules
    for (const p of this.parts) {
      if (p.age < 0) continue;
      const k = p.age / p.life, a = k < .2 ? k / .2 : 1 - (k - .2) / .8;
      const px = cx + (p.x + p.vx * p.age) * R * 1.3, py = cy + (p.y + p.vy * p.age + (p.g || 0) * .5 * p.age * p.age) * R * 1.3; const sz = R * p.sz * (1 + k * .4);
      x.save(); x.translate(px, py); x.globalAlpha = clamp(a, 0, 1);
      if (p.type === 'heart') { x.fillStyle = '#FF4D6D'; x.rotate(Math.sin(p.age * 6) * .3); heart(x, sz); x.fill(); }
      else if (p.type === 'star') { x.fillStyle = '#F7B32B'; x.rotate(p.rot + p.age * 2); star(x, sz, sz * .45); x.fill(); }
      else if (p.type === 'spark') { x.fillStyle = '#fff'; x.rotate(p.rot); star(x, sz * .8, sz * .18); x.fill(); }
      else if (p.type === 'coin') { x.scale(Math.max(.15, Math.abs(Math.cos(p.age * 8 + p.rot))), 1); x.fillStyle = '#F7B32B'; x.beginPath(); x.arc(0, 0, sz, 0, Math.PI * 2); x.fill(); x.strokeStyle = '#C98A12'; x.lineWidth = sz * .22; x.beginPath(); x.arc(0, 0, sz * .62, 0, Math.PI * 2); x.stroke(); }
      else if (p.type === 'code') { x.fillStyle = '#5EEAD4'; x.font = '700 ' + (sz * 1.7) + 'px ui-monospace,Menlo,monospace'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(p.ch, 0, 0); }
      else if (p.type === 'sweat' || p.type === 'tear') { x.fillStyle = '#7CC7FF'; x.beginPath(); x.moveTo(0, -sz); x.quadraticCurveTo(sz * .8, sz * .2, 0, sz * .6); x.quadraticCurveTo(-sz * .8, sz * .2, 0, -sz); x.fill(); }
      else if (p.type === 'z') { x.fillStyle = 'rgba(210,220,235,1)'; x.font = '700 ' + (sz * 1.9) + 'px -apple-system,system-ui,sans-serif'; x.textAlign = 'start'; x.textBaseline = 'alphabetic'; x.fillText('z', 0, 0); }
      x.restore();
    }
  }
  eye(shape, w, h, open, sd) {
    const x = this.x, t = NOW() / 1000;
    switch (shape) {
      case 'wide': w *= 1.16; h *= 1.12; /* fallthrough */
      case 'pill': { const hh = Math.max(h * open, w * .3); rr(x, -w / 2, -hh / 2, w, hh, Math.min(w / 2, hh / 2)); x.fill(); break; }
      case 'dot': x.beginPath(); x.arc(0, 0, w * .45, 0, Math.PI * 2); x.fill(); break;
      case 'line': x.rotate(-sd * .2); rr(x, -w * .78, -w * .21, w * 1.56, w * .42, w * .21); x.fill(); break;
      case 'flat': rr(x, -w * .72, -w * .2, w * 1.44, w * .4, w * .2); x.fill(); break;
      case 'happy': x.lineWidth = w * .5; x.lineCap = 'round'; x.beginPath(); x.arc(0, h * .18, w * .82, Math.PI * 1.12, Math.PI * 1.88); x.stroke(); break;
      case 'closed': x.lineWidth = w * .36; x.lineCap = 'round'; x.beginPath(); x.arc(0, -h * .08, w * .78, Math.PI * .15, Math.PI * .85); x.stroke(); break;
      case 'spiral': { x.lineWidth = w * .22; x.lineCap = 'round'; x.beginPath(); for (let a = 0; a < 4.4 * Math.PI; a += .2) { const r = w * .06 + a * w * .058, aa = a + t * 9 * sd; const px = Math.cos(aa) * r, py = Math.sin(aa) * r; if (a) x.lineTo(px, py); else x.moveTo(px, py); } x.stroke(); break; }
      case 'heart': x.fillStyle = '#FF4D6D'; heart(x, w * 1.2); x.fill(); x.fillStyle = P.ink; break;
      case 'star': x.fillStyle = '#F7B32B'; x.rotate(t * 1.5 * sd); star(x, w * 1.05, w * .46); x.fill(); x.fillStyle = P.ink; break;
      case 'tired': rr(x, -w / 2, -h * .02, w, h * .38, w / 2); x.fill(); rr(x, -w * .62, -h * .1, w * 1.24, w * .22, w * .11); x.fill(); break;
      case 'wink': if (sd < 0) { rr(x, -w / 2, -h / 2, w, h, w / 2); x.fill(); } else { x.lineWidth = w * .5; x.lineCap = 'round'; x.beginPath(); x.arc(0, h * .18, w * .82, Math.PI * 1.12, Math.PI * 1.88); x.stroke(); } break;
      case 'dollar': x.fillStyle = '#1FA463'; x.font = '800 ' + (h * 1.05) + 'px -apple-system,system-ui,sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('$', 0, h * .04); x.fillStyle = P.ink; break;
      case 'sad': { x.rotate(sd * -.42); const hh = Math.max(h * .85 * open, w * .3); rr(x, -w / 2, -hh / 2, w, hh, Math.min(w / 2, hh / 2)); x.fill(); break; }
      default: rr(x, -w / 2, -h / 2, w, h, w / 2); x.fill();
    }
  }
}
    // END EXACT REFERENCE
    return {Bot, STATES, EMOTES};
  }
  const canonical = referenceEngine({now:()=>0, random:()=>.5, dpr:1, schedule:()=>0});
  for (const entry of Object.values(canonical.STATES)) {
    if (entry.badge) Object.freeze(entry.badge);
    if (entry.look) Object.freeze(entry.look);
    Object.freeze(entry);
  }
  for (const entry of Object.values(canonical.EMOTES)) Object.freeze(entry);
  const STATES = Object.freeze(canonical.STATES), EMOTES = Object.freeze(canonical.EMOTES);
  function create(canvas, options = {}) {
    if (!canvas || typeof canvas.getContext !== 'function' || !canvas.getContext('2d')) throw new TypeError('Mimo requires a 2D canvas.');
    const view = canvas.ownerDocument?.defaultView || globalThis;
    const now = options.now || (()=>view.performance.now());
    const defer = options.schedule || ((callback, delay)=>view.setTimeout(callback, delay));
    const cancel = options.cancel || (token=>view.clearTimeout(token));
    const random = options.random || globalThis.Math.random;
    const dpr = options.dpr ?? view.devicePixelRatio ?? 1;
    if (typeof now !== 'function' || typeof defer !== 'function' || typeof cancel !== 'function' || typeof random !== 'function' || !Number.isFinite(dpr) || dpr <= 0) throw new TypeError('Invalid Mimo renderer options.');
    const pending = new Set(); let paused = false, disposed = false;
    function arm(job) {
      job.due = now() + job.remaining;
      job.token = defer(()=>{job.token=null;pending.delete(job);if(!disposed&&!paused)job.callback();}, job.remaining);
    }
    function schedule(callback, delay = 0) {
      if (disposed) return null;
      const job = {callback, remaining:globalThis.Math.max(0, delay), due:0, token:null};
      pending.add(job); if (!paused) arm(job); return job;
    }
    const {Bot} = referenceEngine({now, random, dpr, schedule, Path2D:options.Path2D || view.Path2D});
    const bot = new Bot(canvas);
    bot.pauseScheduled = () => {
      if (paused || disposed) return;
      paused=true;
      for(const job of pending){job.remaining=globalThis.Math.max(0,job.due-now());if(job.token!==null)cancel(job.token);job.token=null;}
    };
    bot.resumeScheduled = () => {
      if (!paused || disposed) return;
      paused=false;for(const job of pending)arm(job);
    };
    bot.cancelPending = () => {for(const job of pending)if(job.token!==null)cancel(job.token);pending.clear();};
    bot.pendingCount = () => pending.size;
    bot.dispose = () => {if(disposed)return;disposed=true;bot.cancelPending();bot.tw=[];bot.parts=[];bot.lock={};};
    return bot;
  }
  return Object.freeze({create, STATES, EMOTES});
});
