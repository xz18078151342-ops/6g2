/* =========================================================
   scene.js —— 城市低空航路态势动态演示
   12 个通感节点 / 6 架无人机 / 视距判定 / 融合定位误差 / 时空双门限告警
   所有几何与误差均为按方案参数生成的实时可视化（非外场数据）
   ========================================================= */
(function () {
  'use strict';
  const { clamp, lerp, rng, gauss, fmt, TAU } = window.UI;
  const D = window.DATA;
  const M = D.meta;

  /* ---------- 世界坐标（横向范围随画布比例自适应，保证圆是圆） ---------- */
  const CORRIDOR = 2000;          // m
  const COVER = M.coverageRadius; // 502 m
  const GATE_H = 30, GATE_V = 10;
  const WATCH_H = 60, WATCH_V = 15;
  const PAD = { l: 46, r: 18, t: 20, b: 26 };

  let HALFX = 360;
  const X = y => PAD.l + (y / CORRIDOR) * (W - PAD.l - PAD.r);
  const Y = x => H - PAD.b - ((x + HALFX) / (2 * HALFX)) * (H - PAD.t - PAD.b);
  const scaleOf = () => (W - PAD.l - PAD.r) / CORRIDOR;   // px per metre

  /* ---------- 静态：楼块 ---------- */
  function buildBuildings() {
    const r = rng(20261113);
    const out = [];
    for (let y = 10; y < 1990; y += 118 + r() * 46) {
      for (const side of [-1, 1]) {
        let x = 104 + r() * 30;
        while (x < 372) {
          const w = 42 + r() * 56;
          const d = 46 + r() * 60;
          const h = 26 + r() * 84;
          out.push({ x0: side * x - d / 2, x1: side * x + d / 2, y0: y, y1: y + w, h, tone: 0.09 + r() * 0.07 });
          x += d + 14 + r() * 26;
        }
      }
    }
    return out;
  }

  function buildStations() {
    const out = [];
    for (let i = 0; i < M.nStations; i++) {
      out.push({ id: i + 1, y: 62.5 + i * M.stationSpacing, x: (i % 2 === 0 ? -1 : 1) * M.stationLateral, z: M.stationHeight });
    }
    return out;
  }

  /* ---------- 航迹：三角波往返 + 侧向正弦，全部为 t 的解析函数 ---------- */
  const TRAJ = [
    { lane: -118, amp: 22, lam: 900, psi: 0.7, period: 220, phase: 0.10, z0: 101 },
    { lane: -74, amp: 30, lam: 760, psi: 2.1, period: 196, phase: 0.55, z0: 99 },
    { lane: 84, amp: 26, lam: 980, psi: 4.0, period: 246, phase: 0.33, z0: 103 },
    { lane: 132, amp: 16, lam: 700, psi: 1.1, period: 800, phase: 0.72, z0: 97 },   // 慢速巡检
    { lane: -30, amp: 26, lam: 820, psi: 0.0, period: 267, phase: 0.175, z0: 100 },  // 冲突对 A：起点 y=700
    { lane: 30, amp: 26, lam: 820, psi: Math.PI, period: 267, phase: 0.675, z0: 103 } // 冲突对 B：起点 y=1300
  ];

  const S = {
    t: 0, running: true, speed: 1, mode: 'C', sel: 0,
    coverage: true, gnss: true, predict: true, avoid: false,
    events: [], separation: [], lastMetric: 0, lastLog: 0, level: 'clear', pair: null,
    _nLos: undefined, _nNlos: undefined, _lastNlos: 0, _links: null
  };

  let canvas, ctx, W = 600, H = 300, dpr = 1, staticLayer = null;
  const buildings = buildBuildings();
  const stations = buildStations();
  const SIGMA = {
    A: D.positioning[0].cep95 / 2.4477,
    B: D.positioning[1].cep95 / 2.4477,
    C: D.positioning[2].cep95 / 2.4477
  };
  const CEPK = 2.4477;

  /* 相关噪声（AR(1)），使径向误差的 95 分位与表 9 一致 */
  const NOISE = (function () {
    const r = rng(7717), arr = [];
    for (let u = 0; u < 6; u++) {
      const ax = [gauss(r)], ay = [gauss(r)];
      for (let k = 1; k < 1300; k++) {
        ax[k] = 0.93 * ax[k - 1] + Math.sqrt(1 - 0.93 * 0.93) * gauss(r);
        ay[k] = 0.90 * ay[k - 1] + Math.sqrt(1 - 0.90 * 0.90) * gauss(r);
      }
      const sd = a => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
      const sx = sd(ax), sy = sd(ay);
      arr.push({ x: ax.map(v => v / sx), y: ay.map(v => v / sy) });
    }
    return arr;
  })();

  function noiseAt(u, t) {
    const n = NOISE[u];
    const f = clamp(t * 10, 0, 1298);
    const i = Math.floor(f), a = f - i;
    return { x: lerp(n.x[i], n.x[i + 1] || n.x[i], a), y: lerp(n.y[i], n.y[i + 1] || n.y[i], a) };
  }

  function tri(p) { p = ((p % 1) + 1) % 1; return p < 0.5 ? p * 2 : 2 - p * 2; }
  function baseState(i, t) {
    const u = TRAJ[i];
    const phase = t / u.period + u.phase;
    const s = tri(phase);
    const dir = (((phase % 1) + 1) % 1) < 0.5 ? 1 : -1;
    const y = CORRIDOR * s;
    const x = u.lane + u.amp * Math.sin(TAU * y / u.lam + u.psi);
    const z = u.z0 + 3.2 * Math.sin(t / 6.4 + i * 1.7);
    const speed = 4000 / u.period * dir;
    const dxdy = u.amp * Math.cos(TAU * y / u.lam + u.psi) * TAU / u.lam;
    return { x, y, z, vx: dxdy * speed, vy: speed };
  }

  /* 避让：无状态平滑函数，随拖拽 / 回放保持一致 */
  function avoidOffset(t) {
    if (!S.avoid) return 0;
    const a = baseState(4, t), b = baseState(5, t);
    const gap = Math.hypot(a.x - b.x, a.y - b.y);
    const k = clamp((72 - gap) / 52, 0, 1);
    return 58 * k * k * (3 - 2 * k);
  }
  function uavState(i, t) {
    const st = baseState(i, t);
    if (i === 5) { const o = avoidOffset(t); if (o) st.x += o; }
    return st;
  }

  /* ---------- 视距判定（Liang–Barsky + 高度判据） ---------- */
  function blocked(sx, sy, sz, tx, ty, tz) {
    const dx = tx - sx, dy = ty - sy;
    const minx = Math.min(sx, tx) - 2, maxx = Math.max(sx, tx) + 2;
    const miny = Math.min(sy, ty) - 2, maxy = Math.max(sy, ty) + 2;
    for (let k = 0; k < buildings.length; k++) {
      const b = buildings[k];
      if (b.x1 < minx || b.x0 > maxx || b.y1 < miny || b.y0 > maxy) continue;
      let tmin = 0, tmax = 1;
      /* x 轴 */
      if (Math.abs(dx) < 1e-9) {
        if (sx < b.x0 || sx > b.x1) continue;
      } else {
        let t1 = (b.x0 - sx) / dx, t2 = (b.x1 - sx) / dx;
        if (t1 > t2) { const q = t1; t1 = t2; t2 = q; }
        tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
        if (tmin > tmax) continue;
      }
      /* y 轴 */
      if (Math.abs(dy) < 1e-9) {
        if (sy < b.y0 || sy > b.y1) continue;
      } else {
        let t1 = (b.y0 - sy) / dy, t2 = (b.y1 - sy) / dy;
        if (t1 > t2) { const q = t1; t1 = t2; t2 = q; }
        tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
        if (tmin > tmax) continue;
      }
      if (tmax < 0 || tmin > 1) continue;
      const tt = clamp(tmin, 0, 1);
      if (b.h > sz + (tz - sz) * tt) return true;
    }
    return false;
  }

  function linkFor(uav) {
    const res = [];
    for (let i = 0; i < stations.length; i++) {
      const s = stations[i];
      const d = Math.hypot(s.y - uav.y, s.x - uav.x);
      if (d > 640) continue;
      const los = !blocked(s.x, s.y, s.z, uav.x, uav.y, uav.z);
      const usable = los ? d < COVER : d < 212;
      if (!usable) continue;
      res.push({ s, d, los, idx: i });
    }
    return res;
  }

  /* ---------- 静态层 ---------- */
  function buildStatic() {
    const off = document.createElement('canvas');
    off.width = canvas.width; off.height = canvas.height;
    const c = off.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#060c16'); g.addColorStop(1, '#04070e');
    c.fillStyle = g; c.fillRect(0, 0, W, H);

    c.strokeStyle = 'rgba(122,168,255,.05)'; c.lineWidth = 1;
    for (let y = 0; y <= CORRIDOR; y += 200) {
      const x = Math.round(X(y)) + .5;
      c.beginPath(); c.moveTo(x, PAD.t); c.lineTo(x, H - PAD.b); c.stroke();
    }
    for (let x = -400; x <= 400; x += 200) {
      const yy = Math.round(Y(x)) + .5;
      c.beginPath(); c.moveTo(PAD.l, yy); c.lineTo(W - PAD.r, yy); c.stroke();
    }

    /* 航路走廊 */
    c.save();
    c.fillStyle = 'rgba(53,224,208,.03)';
    c.fillRect(X(0), Y(95), X(CORRIDOR) - X(0), Y(-95) - Y(95));
    c.strokeStyle = 'rgba(53,224,208,.24)'; c.setLineDash([6, 6]); c.lineWidth = 1;
    c.beginPath(); c.moveTo(X(0), Y(95)); c.lineTo(X(CORRIDOR), Y(95)); c.stroke();
    c.beginPath(); c.moveTo(X(0), Y(-95)); c.lineTo(X(CORRIDOR), Y(-95)); c.stroke();
    c.restore();

    /* 楼块 */
    for (const b of buildings) {
      const x = X(b.y0), y = Y(b.x1), w = X(b.y1) - X(b.y0), h = Y(b.x0) - Y(b.x1);
      c.fillStyle = 'rgba(126,164,224,' + (b.tone * 0.9).toFixed(3) + ')';
      c.fillRect(x, y, w, h);
      c.strokeStyle = 'rgba(126,164,224,.12)'; c.lineWidth = .8;
      c.strokeRect(x + .4, y + .4, Math.max(w - .8, 1), Math.max(h - .8, 1));
    }

    /* 覆盖圈 */
    if (S.coverage) {
      const r = COVER * scaleOf();
      for (const s of stations) {
        const cx = X(s.y), cy = Y(s.x);
        const rg = c.createRadialGradient(cx, cy, 0, cx, cy, r);
        rg.addColorStop(0, 'rgba(53,224,208,.08)');
        rg.addColorStop(.6, 'rgba(53,224,208,.03)');
        rg.addColorStop(1, 'rgba(53,224,208,0)');
        c.fillStyle = rg;
        c.beginPath(); c.arc(cx, cy, r, 0, TAU); c.fill();
        c.strokeStyle = 'rgba(53,224,208,.15)'; c.lineWidth = .8; c.setLineDash([3, 5]);
        c.beginPath(); c.arc(cx, cy, r, 0, TAU); c.stroke(); c.setLineDash([]);
      }
    }

    /* 轴 */
    c.font = '10px "JetBrains Mono", Consolas, monospace';
    c.fillStyle = '#5d6d8b';
    c.textAlign = 'center'; c.textBaseline = 'top';
    for (let y = 0; y <= CORRIDOR; y += 500) c.fillText(y + ' m', X(y), H - PAD.b + 6);
    c.textAlign = 'right'; c.textBaseline = 'middle';
    for (const x of [-200, 0, 200]) c.fillText((x > 0 ? '+' : '') + x, PAD.l - 8, Y(x));
    c.textAlign = 'left'; c.textBaseline = 'top';
    c.fillStyle = '#54647f';
    c.fillText('横向 / m', 6, 4);
    return off;
  }

  /* ---------- 动态绘制 ---------- */
  function drawStation(s, link, t) {
    const cx = X(s.y), cy = Y(s.x);
    const color = !link ? null : (link.los ? '#3ee08f' : '#a78bfa');
    ctx.save();
    if (link) {
      const pr = 6 + 4 * Math.abs(Math.sin(t * 3 + s.id));
      ctx.strokeStyle = link.los ? 'rgba(62,224,143,.35)' : 'rgba(167,139,250,.35)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, pr, 0, TAU); ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(cx, cy - 7); ctx.lineTo(cx + 6.2, cy + 5); ctx.lineTo(cx - 6.2, cy + 5);
    ctx.closePath();
    ctx.fillStyle = color || 'rgba(255,182,72,.75)';
    ctx.shadowColor = color || 'rgba(255,182,72,.45)';
    ctx.shadowBlur = link ? 12 : 5;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.font = '8.5px "JetBrains Mono", Consolas, monospace';
    ctx.fillStyle = link ? 'rgba(233,238,251,.9)' : 'rgba(150,163,190,.55)';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText('ISAC-' + s.id, cx, cy - 9);
    ctx.restore();
  }

  function drawUav(u, st, isSel) {
    const cx = X(st.y), cy = Y(st.x);
    const col = isSel ? '#35e0d0' : '#6fc8f5';
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.atan2(st.vy, st.vx) + Math.PI / 2);
    ctx.fillStyle = col;
    ctx.shadowColor = col; ctx.shadowBlur = isSel ? 14 : 6;
    ctx.beginPath();
    ctx.moveTo(0, -6); ctx.lineTo(4.4, 0); ctx.lineTo(2.2, 6); ctx.lineTo(-2.2, 6); ctx.lineTo(-4.4, 0);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = .5;
    for (const p of [[-7, -5], [7, -5], [-7, 5], [7, 5]]) {
      ctx.beginPath(); ctx.arc(p[0], p[1], 1.6, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    ctx.font = '9.5px "JetBrains Mono", Consolas, monospace';
    ctx.fillStyle = isSel ? '#9df3ea' : 'rgba(176,200,238,.66)';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    let dy = -9;
    if (S.pair && S.level !== 'clear' && (u === S.pair.a || u === S.pair.b)) dy = (u === S.pair.a ? -20 : 20);
    ctx.fillText('UA-' + (u + 1), cx + 9, cy + dy);

    if (isSel) {
      ctx.strokeStyle = 'rgba(53,224,208,.45)';
      ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.arc(cx, cy, 13, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function drawTrack(u, t, color, width, n) {
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let k = n; k >= 0; k--) {
      const st = uavState(u, t - k * 0.25);
      const px = X(st.y), py = Y(st.x);
      k === n ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.restore();
  }

  function ring(cx, cy, rPx, stroke, fill) {
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, Math.max(rPx, 2), 0, TAU);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.restore();
  }

  function predPos(u, t, horizon) { return uavState(u, t + horizon); }

  function draw(t) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(staticLayer, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const sel = S.sel;
    const links = S._links || [];
    const st = uavState(sel, t);

    /* 站—目标连线 */
    for (let i = 0; i < links.length; i++) {
      const L = links[i];
      ctx.save();
      ctx.beginPath();
      ctx.strokeStyle = L.los ? 'rgba(62,224,143,.3)' : 'rgba(167,139,250,.34)';
      ctx.lineWidth = L.los ? 1 : 1.1;
      if (!L.los) ctx.setLineDash([4, 3]);
      ctx.moveTo(X(L.s.y), Y(L.s.x));
      ctx.lineTo(X(st.y), Y(st.x));
      ctx.stroke();
      const ph = ((t * 1.6 + i * 0.3) % 1);
      const px = lerp(X(L.s.y), X(st.y), ph), py = lerp(Y(L.s.x), Y(st.x), ph);
      ctx.setLineDash([]);
      ctx.fillStyle = L.los ? 'rgba(62,224,143,.85)' : 'rgba(167,139,250,.85)';
      ctx.beginPath(); ctx.arc(px, py, 1.9, 0, TAU); ctx.fill();
      ctx.restore();
    }

    /* 站点 */
    const linkById = {};
    for (const L of links) linkById[L.idx] = L;
    for (let i = 0; i < stations.length; i++) drawStation(stations[i], linkById[i], t);

    /* 选中目标的历史航迹 */
    drawTrack(sel, t, 'rgba(150,168,196,.2)', 1, 48);

    /* 融合 / GNSS */
    const nz = noiseAt(sel, t);
    const nLos = links.filter(L => L.los).length;
    const sigma = (links.length && nLos === 0) ? SIGMA.A : SIGMA[S.mode];
    const fx = st.x + nz.y * sigma, fy = st.y + nz.x * sigma;
    const cx = X(fy), cy = Y(fx);
    const scale = scaleOf();

    if (S.gnss) {
      const na = noiseAt(sel, t + 37.3);
      const gx = st.x + na.y * SIGMA.A, gy = st.y + na.x * SIGMA.A;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,93,108,.45)'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(X(gy), Y(gx)); ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(255,93,108,.9)'; ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(X(gy) - 4, Y(gx) - 4); ctx.lineTo(X(gy) + 4, Y(gx) + 4);
      ctx.moveTo(X(gy) + 4, Y(gx) - 4); ctx.lineTo(X(gy) - 4, Y(gx) + 4);
      ctx.stroke();
      ctx.restore();
      ring(X(gy), Y(gx), SIGMA.A * CEPK * scale, 'rgba(255,93,108,.22)', 'rgba(255,93,108,.05)');
    }

    /* 真值 */
    ctx.fillStyle = 'rgba(160,178,206,.7)';
    ctx.beginPath(); ctx.arc(X(st.y), Y(st.x), 2.4, 0, TAU); ctx.fill();

    /* 融合误差与位置 */
    const modeCol = S.mode === 'A' ? '#ff5d6c' : (S.mode === 'B' ? '#ffc857' : '#35e0d0');
    ring(cx, cy, sigma * CEPK * scale, modeCol + 'b0', modeCol + '12');
    ctx.save();
    ctx.fillStyle = modeCol; ctx.shadowColor = modeCol; ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.arc(cx, cy, 3.6, 0, TAU); ctx.fill();
    ctx.restore();

    /* 其它目标 */
    for (let u = 0; u < 6; u++) {
      if (u === sel) continue;
      drawUav(u, uavState(u, t), false);
    }
    drawUav(sel, st, true);

    /* 冲突对 */
    if (S.pair && S.level !== 'clear') drawPair(S.pair, t);

    /* 角标 */
    ctx.save();
    ctx.font = '9.5px "JetBrains Mono", Consolas, monospace';
    ctx.fillStyle = 'rgba(140,158,190,.42)';
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText('选中 UA-' + (sel + 1) + ' · ' + S.mode + ' 方案 · 10 Hz', PAD.l + 6, H - PAD.b - 4);
    ctx.restore();
  }

  function drawPair(pair, t) {
    const { a, b, dhNow, dv } = pair;
    const A = uavState(a, t), B = uavState(b, t);
    const level = S.level;
    const base = level === 'conflict' ? 'rgba(255,93,108,' : (level === 'watch' ? 'rgba(255,182,72,' : 'rgba(62,224,143,');
    const scale = scaleOf();

    for (const P of [A, B]) ring(X(P.y), Y(P.x), GATE_H * scale, base + '0.45)', null);
    ctx.save();
    ctx.strokeStyle = base + '0.85)';
    ctx.lineWidth = 1.2; ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(X(A.y), Y(A.x)); ctx.lineTo(X(B.y), Y(B.x)); ctx.stroke();
    ctx.restore();

    const mx = (X(A.y) + X(B.y)) / 2, my = (Y(A.x) + Y(B.x)) / 2;
    const label = (level === 'conflict' ? '冲突告警 · ' : '接近 · ') + fmt(dhNow, 1) + ' m / ' + fmt(dv, 1) + ' m';
    const col = level === 'conflict' ? '#ff5d6c' : (level === 'watch' ? '#ffb648' : '#3ee08f');
    ctx.save();
    ctx.font = '600 10px "JetBrains Mono", Consolas, monospace';
    const tw = ctx.measureText(label).width + 18, th = 19;
    const bx = mx - tw / 2, by = Math.min(Y(A.x), Y(B.x)) - 50;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, tw, th, 9); else ctx.rect(bx, by, tw, th);
    ctx.fillStyle = 'rgba(8,13,22,.9)'; ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 1;
    ctx.globalAlpha = .75; ctx.stroke(); ctx.globalAlpha = 1;
    ctx.fillStyle = col; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, mx, by + th / 2 + 0.5);
    ctx.restore();

    if (S.predict) {
      for (const u of [a, b]) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,182,72,.55)';
        ctx.lineWidth = 1; ctx.setLineDash([5, 5]);
        ctx.beginPath();
        let last = null;
        for (let k = 1; k <= 15; k++) {
          const p = predPos(u, t, k * 0.1);
          last = [X(p.y), Y(p.x)];
          k === 1 ? ctx.moveTo(last[0], last[1]) : ctx.lineTo(last[0], last[1]);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255,182,72,.85)';
        ctx.beginPath(); ctx.arc(last[0], last[1], 2.4, 0, TAU); ctx.fill();
        ctx.restore();
      }
    }
  }

  /* ---------- 判定 ---------- */
  function evaluatePair(t) {
    let best = null;
    for (let i = 0; i < 6; i++) {
      for (let j = i + 1; j < 6; j++) {
        let dhMin = 1e9;
        for (let k = 0; k <= 15; k++) {
          const A = predPos(i, t, k * 0.1), B = predPos(j, t, k * 0.1);
          const d = Math.hypot(A.y - B.y, A.x - B.x);
          if (d < dhMin) dhMin = d;
        }
        const A = uavState(i, t), B = uavState(j, t);
        const dhNow = Math.hypot(A.y - B.y, A.x - B.x);
        const dv = Math.abs(A.z - B.z);
        let level = 'clear';
        if (dhMin < GATE_H && dv < GATE_V) level = 'conflict';
        else if (dhMin < WATCH_H && dv < WATCH_V) level = 'watch';
        if (!best || dhMin < best.dhMin) best = { a: i, b: j, dhMin, dhNow, dv, level };
      }
    }
    return best;
  }
  const rank = l => (l === 'conflict' ? 2 : l === 'watch' ? 1 : 0);

  /* ---------- 事件流 ---------- */
  function push(text, cls) {
    S.events.unshift({ text, cls, t: S.t });
    if (S.events.length > 7) S.events.pop();
    renderEvents();
  }
  function renderEvents() {
    const el = document.getElementById('eventLog');
    if (!el) return;
    el.innerHTML = S.events.map(e =>
      '<li class="' + (e.cls || '') + '"><span class="t">T+' + e.t.toFixed(1) + '</span> ' + e.text + '</li>'
    ).join('');
  }

  function events(t, pair, links) {
    const now = performance.now();
    if (now - S.lastLog < 240) return;
    const prev = S.level;
    S.level = pair ? pair.level : 'clear';
    const name = pair ? 'UA-' + (pair.a + 1) + ' ⇢ UA-' + (pair.b + 1) : '';

    if (pair && rank(S.level) > rank(prev)) {
      S.lastLog = now;
      if (S.level === 'conflict') {
        push('时空双门限触发：' + name + ' 水平 ' + fmt(pair.dhNow, 1) + ' m / 垂直 ' + fmt(pair.dv, 1) + ' m', 't-alert');
        push('三级策略：告警下发运营方运控中心 + 监管平台', 't-alert');
      } else {
        push('接近预警：' + name + ' 预测最小间距 ' + fmt(pair.dhMin, 1) + ' m', 't-warn');
      }
    } else if (S.level === 'clear' && rank(prev) > 0) {
      S.lastLog = now;
      push('间距恢复 ' + fmt(pair ? pair.dhNow : 0, 1) + ' m，告警解除' + (S.avoid ? '（避让已生效）' : ''), 't-ok');
    }

    const nLos = links.filter(L => L.los).length, nNlos = links.length - nLos;
    if (nLos !== S._nLos || nNlos !== S._nNlos) {
      if (S._nLos !== undefined) {
        S.lastLog = now;
        push('多站对齐：UA-' + (S.sel + 1) + ' 参与 ' + links.length + ' 站（视距 ' + nLos + ' / 非视距 ' + nNlos + '）', 't-info');
      }
      S._nLos = nLos; S._nNlos = nNlos;
    }

    if (nNlos > 0 && now - S._lastNlos > 2600) {
      S._lastNlos = now;
      const nl = links.filter(L => !L.los);
      const one = nl[Math.floor(Math.abs(Math.sin(t * 0.7)) * nl.length) % nl.length];
      const p = 0.82 + 0.16 * Math.abs(Math.sin(t * 1.3 + one.s.id));
      push('NLOSNet：ISAC-' + one.s.id + ' NLOS p=' + fmt(p, 2) + '，附加距离 ' + fmt(4 + 14 * Math.abs(Math.sin(t + one.s.id)), 1) + ' m → 去偏', 't-info');
    }
  }

  /* ---------- 面板 ---------- */
  const cepHist = new Map();
  function metrics(t, pair, links) {
    const now = performance.now();
    if (now - S.lastMetric < 110) return;
    S.lastMetric = now;

    const nz = noiseAt(S.sel, t);
    const nLosC = links.filter(L => L.los).length;
    const sig = (links.length && nLosC === 0) ? SIGMA.A : SIGMA[S.mode];
    const err = Math.hypot(nz.x, nz.y) * sig;
    const arr = cepHist.get(S.sel) || [];
    arr.push(err);
    if (arr.length > 900) arr.shift();
    cepHist.set(S.sel, arr);
    const sorted = arr.slice().sort((a, b) => a - b);
    const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : err;

    const nLos = links.filter(L => L.los).length, nNlos = links.length - nLos;
    const conf = nNlos ? (0.86 + 0.12 * Math.abs(Math.sin(t * 0.9))) : 0;
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };

    set('mErr', fmt(err, 1) + ' m');
    set('mErrSub', 'CEP95 统计 ' + fmt(p95, 1) + ' m · 方案 ' + S.mode);
    set('mStations', links.length + ' / ' + nLos + ' / ' + nNlos);
    set('mConf', nNlos ? 'NLOSNet 置信度 ' + fmt(conf, 2) : 'NLOSNet 未触发（全视距）');
    set('mGap', pair ? fmt(pair.dhNow, 1) + ' m / ' + fmt(pair.dv, 1) + ' m' : '—');

    const lv = S.level;
    const lvEl = document.getElementById('mLevel');
    if (lvEl) {
      lvEl.textContent = lv === 'conflict' ? '冲突告警' : (lv === 'watch' ? '接近预警' : '正常');
      lvEl.style.color = lv === 'conflict' ? 'var(--red)' : (lv === 'watch' ? 'var(--amber)' : 'var(--green)');
    }
    set('mLevelSub', pair ? 'UA-' + (pair.a + 1) + ' ⇄ UA-' + (pair.b + 1) + ' · 预测最小间距 ' + fmt(pair.dhMin, 1) + ' m' : '三级策略：告警 → 减速 → 航路重规划');
    set('mPairLabel', lv === 'clear' ? '无告警' : (lv === 'conflict' ? '冲突告警' : '接近预警'));
    set('tlTime', 'T + ' + t.toFixed(1) + ' s');

    const scrub = document.getElementById('timeScrub');
    if (scrub && document.activeElement !== scrub) scrub.value = String(t.toFixed(1));

    S.separation.push(pair ? Math.min(pair.dhNow, 119) : 0);
    if (S.separation.length > 240) S.separation.shift();
    drawSeparation();
  }

  function drawSeparation() {
    const cvs = document.getElementById('conflictCanvas');
    if (!cvs) return;
    const g = window.UI.axis(cvs, {
      h: 96, xmin: -24, xmax: 0, ymin: 0, ymax: 120,
      pad: { l: 26, r: 10, t: 8, b: 15 },
      xTickVals: [-24, -16, -8, 0], yTickVals: [0, 30, 60, 90, 120],
      xFmt: v => v.toFixed(0), yFmt: v => v.toFixed(0)
    });
    window.UI.hline(g, 30, 'rgba(255,93,108,.45)', [3, 4]);
    window.UI.hline(g, 60, 'rgba(255,182,72,.28)', [2, 5]);
    window.UI.note(g, '30', g.x0 + 2, g.Y(30) - 6, 'rgba(255,93,108,.8)', 'left', 8);
    const n = S.separation.length;
    const pts = S.separation.map((v, i) => [-24 + 24 * i / Math.max(n - 1, 1), v]);
    if (n > 1) window.UI.polyline(g, pts, 'rgba(53,224,208,.9)', 1.6);
    if (n) window.UI.dots(g, [pts[n - 1]], '#35e0d0', 2.6);
  }

  /* ---------- 主循环 ---------- */
  let lastTs = 0;
  function loop(ts) {
    if (!lastTs) lastTs = ts;
    const dt = Math.min((ts - lastTs) / 1000, 0.06);
    lastTs = ts;
    if (S.running) {
      S.t += dt * S.speed;
      if (S.t >= 120) { S.t -= 120; S.separation = []; cepHist.clear(); }
    }
    S.pair = evaluatePair(S.t);
    S._links = linkFor(uavState(S.sel, S.t));
    events(S.t, S.pair, S._links);
    draw(S.t);
    metrics(S.t, S.pair, S._links);
    requestAnimationFrame(loop);
  }

  /* ---------- 交互 ---------- */
  function measure() {
    const box = canvas.parentElement;
    const hCss = Math.max(box.clientHeight, 200);
    const f = window.UI.fitCanvas(canvas, hCss);
    ctx = f.ctx; W = f.W; H = f.H;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    HALFX = Math.max(260, (H - PAD.t - PAD.b) / (2 * scaleOf()));
    staticLayer = buildStatic();
  }
  function resize() { measure(); draw(S.t); }

  function init() {
    canvas = document.getElementById('sceneCanvas');
    if (!canvas) return;
    measure();
    window.addEventListener('resize', () => { clearTimeout(S._rt); S._rt = setTimeout(resize, 150); });

    /* 深链接：?t0=32 直接跳到某一时刻（演示 / 截图用） */
    const q0 = new URLSearchParams(location.search);
    if (q0.has('t0')) S.t = Math.min(119, Math.max(0, parseFloat(q0.get('t0')) || 0));

    const btn = document.getElementById('btnPlay');
    const syncBtn = () => { if (btn) btn.innerHTML = S.running ? '<span class="ico">❚❚</span>暂停' : '<span class="ico">▶</span>播放'; };
    btn && btn.addEventListener('click', () => { S.running = !S.running; syncBtn(); });
    document.addEventListener('keydown', e => {
      if (e.code === 'Space' && !/INPUT|TEXTAREA|BUTTON/.test(document.activeElement.tagName)) {
        e.preventDefault(); S.running = !S.running; syncBtn();
      }
    });
    const reset = document.getElementById('btnReset');
    reset && reset.addEventListener('click', () => {
      S.t = 0; S.events = []; S.separation = []; cepHist.clear();
      S._nLos = undefined; S._nNlos = undefined; S.level = 'clear';
      push('演示复位：12 个通感节点在线，6 架目标进入航路', 't-ok');
    });

    document.querySelectorAll('#speedSeg button').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('#speedSeg button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      S.speed = parseFloat(b.dataset.speed);
    }));

    document.querySelectorAll('#modeSeg button').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('#modeSeg button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      S.mode = b.dataset.mode;
      cepHist.clear(); S.separation = [];
      push('定位方案切换：' + b.textContent.trim() + '（CEP95 ' + D.positioning.find(p => p.key === S.mode).cep95.toFixed(1) + ' m）', 't-ok');
    }));

    const bind = (id, key) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', () => { S[key] = el.checked; if (key === 'coverage') staticLayer = buildStatic(); });
    };
    bind('chkCoverage', 'coverage');
    bind('chkGnss', 'gnss');
    bind('chkPredict', 'predict');
    bind('chkAvoid', 'avoid');

    const scrub = document.getElementById('timeScrub');
    scrub && scrub.addEventListener('input', () => {
      S.t = parseFloat(scrub.value); S.separation = []; cepHist.clear();
    });

    canvas.addEventListener('click', ev => {
      const r = canvas.getBoundingClientRect();
      const px = (ev.clientX - r.left) * (W / r.width);
      const py = (ev.clientY - r.top) * (H / r.height);
      let best = -1, bd = 1e9;
      for (let u = 0; u < 6; u++) {
        const st = uavState(u, S.t);
        const d = Math.hypot(X(st.y) - px, Y(st.x) - py);
        if (d < bd) { bd = d; best = u; }
      }
      if (bd < 50) { S.sel = best; cepHist.clear(); S.separation = []; }
    });

    push('系统就绪：12 个通感节点在线，6 架目标进入航路', 't-ok');
    push('CPI 20 ms · 站侧处理 5.71 ms · 端到端 27.3 ms', 't-info');
    requestAnimationFrame(loop);
  }

  window.Scene = { init };
})();
