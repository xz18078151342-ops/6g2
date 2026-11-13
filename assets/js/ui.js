/* =========================================================
   ui.js —— 通用工具、图表基元、滚动与入场动画
   ========================================================= */
(function () {
  'use strict';

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const TAU = Math.PI * 2;

  /* 确定性随机数（mulberry32），保证每次加载场景一致 */
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(r) {
    let u = 0, v = 0;
    while (u === 0) u = r();
    while (v === 0) v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
  }
  function fmt(v, d) {
    if (v === null || v === undefined || Number.isNaN(v)) return '—';
    return Number(v).toFixed(d === undefined ? 1 : d);
  }

  /* canvas 尺寸适配（考虑 devicePixelRatio） */
  function fitCanvas(canvas, hCss) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(canvas.clientWidth, 10);
    const h = hCss || canvas.clientHeight || 180;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, W: w, H: h };
  }

  /* ---------- 极简图表：坐标轴 + 网格 ---------- */
  function axis(canvas, o) {
    const { ctx, W, H } = fitCanvas(canvas, o.h);
    const pad = Object.assign({ l: 44, r: 14, t: 14, b: 30 }, o.pad || {});
    const x0 = pad.l, x1 = W - pad.r, y0 = H - pad.b, y1 = pad.t;
    const xmin = o.xmin, xmax = o.xmax, ymin = o.ymin, ymax = o.ymax;
    const X = v => x0 + (v - xmin) / (xmax - xmin) * (x1 - x0);
    const Y = v => y0 - (v - ymin) / (ymax - ymin) * (y0 - y1);

    ctx.clearRect(0, 0, W, H);
    ctx.font = '10px "JetBrains Mono", Consolas, monospace';
    ctx.textBaseline = 'middle';

    /* 网格 */
    const nx = o.xTicks || 5, ny = o.yTicks || 4;
    const xv = o.xTickVals || Array.from({ length: nx + 1 }, (_, i) => xmin + (xmax - xmin) * i / nx);
    const yv = o.yTickVals || Array.from({ length: ny + 1 }, (_, i) => ymin + (ymax - ymin) * i / ny);
    ctx.strokeStyle = 'rgba(122,168,255,.09)';
    ctx.lineWidth = 1;
    for (const v of yv) {
      const y = Math.round(Y(v)) + .5;
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
      ctx.fillStyle = '#6b7c9a'; ctx.textAlign = 'right';
      ctx.fillText(o.yFmt ? o.yFmt(v) : fmt(v, 0), x0 - 8, y);
    }
    for (const v of xv) {
      const x = Math.round(X(v)) + .5;
      ctx.strokeStyle = Math.abs(v - xmin) < 1e-9 ? 'rgba(122,168,255,.2)' : 'rgba(122,168,255,.06)';
      ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x, y0); ctx.stroke();
      ctx.fillStyle = '#6b7c9a'; ctx.textAlign = 'center';
      ctx.fillText(o.xFmt ? o.xFmt(v) : fmt(v, 0), x, y0 + 13);
    }
    /* 轴标签 */
    if (o.xLabel) {
      ctx.fillStyle = '#5c6b88'; ctx.textAlign = 'right';
      ctx.fillText(o.xLabel, x1, H - 4);
    }
    if (o.yLabel) {
      ctx.save(); ctx.translate(11, y1 + 2); ctx.fillStyle = '#5c6b88'; ctx.textAlign = 'left';
      ctx.fillText(o.yLabel, 0, 0); ctx.restore();
    }
    return { ctx, W, H, x0, x1, y0, y1, X, Y, plot: { x0, x1, y0, y1 } };
  }

  function polyline(g, pts, color, width, dash) {
    if (!pts.length) return;
    const c = g.ctx;
    c.save();
    c.beginPath();
    c.strokeStyle = color; c.lineWidth = width || 1.6; c.lineJoin = 'round'; c.lineCap = 'round';
    if (dash) c.setLineDash(dash); else c.setLineDash([]);
    pts.forEach((p, i) => { const x = g.X(p[0]), y = g.Y(p[1]); i ? c.lineTo(x, y) : c.moveTo(x, y); });
    c.stroke();
    c.restore();
  }
  function dots(g, pts, color, r) {
    const c = g.ctx;
    c.save(); c.fillStyle = color;
    pts.forEach(p => { c.beginPath(); c.arc(g.X(p[0]), g.Y(p[1]), r || 2.4, 0, TAU); c.fill(); });
    c.restore();
  }
  function vline(g, x, color, dash) {
    const c = g.ctx;
    c.save(); c.beginPath(); c.strokeStyle = color; c.lineWidth = 1;
    if (dash) c.setLineDash(dash); else c.setLineDash([]);
    c.moveTo(g.X(x), g.y1); c.lineTo(g.X(x), g.y0); c.stroke(); c.restore();
  }
  function hline(g, y, color, dash) {
    const c = g.ctx;
    c.save(); c.beginPath(); c.strokeStyle = color; c.lineWidth = 1;
    if (dash) c.setLineDash(dash); else c.setLineDash([]);
    c.moveTo(g.x0, g.Y(y)); c.lineTo(g.x1, g.Y(y)); c.stroke(); c.restore();
  }
  function band(g, x0v, x1v, color) {
    const c = g.ctx;
    c.save(); c.fillStyle = color;
    c.fillRect(g.X(x0v), g.y1, g.X(x1v) - g.X(x0v), g.y0 - g.y1);
    c.restore();
  }
  function note(g, str, x, y, color, align, size) {
    const c = g.ctx;
    c.save();
    c.font = (size || 10.5) + 'px "JetBrains Mono", Consolas, monospace';
    c.fillStyle = color || '#8b9cbd';
    c.textAlign = align || 'left';
    c.textBaseline = 'middle';
    c.fillText(str, x, y);
    c.restore();
  }

  /* ---------- 滚动 / 导航 ---------- */
  function initScrollSpy() {
    const header = $('#siteHeader');
    const links = $$('#mainNav a');
    const secs = links.map(a => ({ a, el: $(a.getAttribute('href')) })).filter(o => o.el);
    const onScroll = () => {
      header.classList.toggle('solid', window.scrollY > 24);
      let cur = null;
      const y = window.scrollY + 120;
      secs.forEach(o => { if (o.el.offsetTop <= y) cur = o; });
      links.forEach(a => a.classList.remove('active'));
      if (cur) cur.a.classList.add('active');
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  function initReveal() {
    const els = $$('.card, .pain, .pipe-step, .road, .rep, .section-head, .dparam, .layer, .boundary-item, .gallery, .table-wrap');
    els.forEach(el => el.classList.add('reveal'));
    if (!('IntersectionObserver' in window)) { els.forEach(e => e.classList.add('in')); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          const el = e.target;
          const sibs = Array.from(el.parentElement.children).filter(c => c.classList.contains('reveal'));
          const idx = Math.min(sibs.indexOf(el), 6);
          el.style.transitionDelay = (idx * 55) + 'ms';
          el.classList.add('in');
          io.unobserve(el);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: .08 });
    els.forEach(e => io.observe(e));
  }

  function initCounters() {
    /* 数值直接落在终值上：避免脚本未执行完时显示中间值 */
    $$('[data-count]').forEach(el => {
      const to = parseFloat(el.dataset.count), dec = parseInt(el.dataset.dec || '0', 10);
      el.textContent = to.toFixed(dec) + (el.dataset.suffix || '');
    });
  }

  window.UI = { $, $$, clamp, lerp, rng, gauss, fmt, fitCanvas, axis, polyline, dots, vline, hline, band, note, TAU, initScrollSpy, initReveal, initCounters };
})();
