/* =========================================================
   lab.js —— 交互实验区：距离-多普勒 / MTI / ρ 折中 / 时延 / 精度分位数
   ========================================================= */
(function () {
  'use strict';
  const { fmt, clamp, lerp, axis, polyline, dots, note, hline, vline, band, TAU, fitCanvas } = window.UI;
  const D = window.DATA;
  const rdState = { v: 6, mti: true };
  const rhoState = { rho: 25 };

  function interp(xs, ys, x) {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
    for (let i = 1; i < xs.length; i++) {
      if (x <= xs[i]) {
        const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
        return lerp(ys[i - 1], ys[i], t);
      }
    }
    return ys[ys.length - 1];
  }

  /* ---------- 距离-多普勒图 ---------- */
  const RD = { NR: 160, NV: 120, rMax: 620, vMax: 15 };
  let rdBg = null;

  const rdTexture = (function () {
    let a = 12345;
    const rnd = () => { a = (a * 1103515245 + 12345) & 0x7fffffff; return a / 0x7fffffff; };
    const noise = new Float32Array(RD.NR * RD.NV);
    const rangeMod = new Float32Array(RD.NR);
    for (let i = 0; i < RD.NR; i++) rangeMod[i] = 0.55 + 0.45 * rnd();
    for (let i = 0; i < noise.length; i++) noise[i] = rnd();
    return { noise: noise, rangeMod: rangeMod };
  })();

  function ramp(t) {
    const stops = [
      [0.00, [5, 9, 16]],
      [0.12, [10, 34, 54]],
      [0.28, [13, 82, 98]],
      [0.44, [26, 152, 140]],
      [0.60, [126, 206, 116]],
      [0.74, [240, 205, 76]],
      [0.88, [255, 152, 62]],
      [1.00, [255, 255, 244]]
    ];
    for (let i = 1; i < stops.length; i++) {
      if (t <= stops[i][0]) {
        const a = stops[i - 1], b = stops[i];
        const k = (t - a[0]) / (b[0] - a[0]);
        return [
          Math.round(lerp(a[1][0], b[1][0], k)),
          Math.round(lerp(a[1][1], b[1][1], k)),
          Math.round(lerp(a[1][2], b[1][2], k))
        ];
      }
    }
    return stops[stops.length - 1][1];
  }

  function rdImage() {
    const NR = RD.NR, NV = RD.NV;
    const cv = document.createElement('canvas');
    cv.width = NR; cv.height = NV;
    const c = cv.getContext('2d');
    const img = c.createImageData(NR, NV);
    const atten = rdState.mti ? 29.23 : 0;
    const vBlind = 1.171875;
    const tAtt = rdState.mti ? -22 * Math.pow(1 - clamp(Math.abs(rdState.v) / vBlind, 0, 1), 2) : 0;
    const targetV = rdState.v, targetR = 420;
    const out = img.data;
    for (let iy = 0; iy < NV; iy++) {
      const v = -RD.vMax + (RD.vMax * 2) * iy / (NV - 1);
      for (let ix = 0; ix < NR; ix++) {
        const r = RD.rMax * ix / (NR - 1);
        const clutter = 54 * Math.exp(-(v * v) / (2 * 0.9 * 0.9)) * rdTexture.rangeMod[ix] - atten;
        const noise = rdTexture.noise[iy * NR + ix] * 3.4;
        const dr = (r - targetR) / 2.0, dv = (v - targetV) / 1.4;
        const tgt = 35 + tAtt - (dr * dr + dv * dv) * 4.6;
        const db = Math.max(noise, Math.max(clutter, tgt));
        const t = clamp(db / 62, 0, 1);
        const o = (iy * NR + ix) * 4;
        const col = ramp(t);
        out[o] = col[0]; out[o + 1] = col[1]; out[o + 2] = col[2]; out[o + 3] = 255;
      }
    }
    c.putImageData(img, 0, 0);
    return cv;
  }

  function drawRD() {
    const cvs = document.getElementById('rdCanvas');
    if (!cvs) return;
    const f = fitCanvas(cvs, cvs.clientHeight || 250);
    const c = f.ctx, W = f.W, H = f.H;
    c.clearRect(0, 0, W, H);
    c.fillStyle = '#04080f'; c.fillRect(0, 0, W, H);
    const pad = { l: 40, r: 12, t: 24, b: 28 };
    const x0 = pad.l, x1 = W - pad.r, y0 = H - pad.b, y1 = pad.t;
    const X = r => x0 + (r / RD.rMax) * (x1 - x0);
    const Y = v => y0 - ((v + RD.vMax) / (RD.vMax * 2)) * (y0 - y1);

    if (!rdBg) rdBg = rdImage();
    c.save();
    c.imageSmoothingEnabled = true;
    c.setTransform(1, 0, 0, 1, 0, 0);
    const dpr = cvs.width / W;
    c.drawImage(rdBg, 0, 0, rdBg.width, rdBg.height, x0 * dpr, y1 * dpr, (x1 - x0) * dpr, (y0 - y1) * dpr);
    c.restore();

    c.save();
    c.strokeStyle = 'rgba(255,255,255,.07)'; c.lineWidth = 1; c.setLineDash([2, 5]);
    c.beginPath(); c.moveTo(x0, Y(0)); c.lineTo(x1, Y(0)); c.stroke();
    c.restore();

    const tx = X(420), ty = Y(rdState.v);
    c.save();
    c.strokeStyle = 'rgba(255,255,255,.9)'; c.lineWidth = 1;
    c.beginPath(); c.arc(tx, ty, 6.5, 0, TAU); c.stroke();
    c.beginPath(); c.moveTo(tx - 12, ty); c.lineTo(tx - 8, ty); c.moveTo(tx + 8, ty); c.lineTo(tx + 12, ty); c.stroke();
    c.beginPath(); c.moveTo(tx, ty - 12); c.lineTo(tx, ty - 8); c.moveTo(tx, ty + 8); c.lineTo(tx, ty + 12); c.stroke();
    c.font = '9.5px "JetBrains Mono", Consolas, monospace';
    c.fillStyle = 'rgba(255,255,255,.92)';
    c.textAlign = 'left'; c.textBaseline = 'bottom';
    c.fillText('UA-1 · 420 m · ' + rdState.v.toFixed(1) + ' m/s', tx + 12, ty - 6);
    c.restore();

    c.font = '9px "JetBrains Mono", Consolas, monospace';
    c.fillStyle = '#65769a'; c.textAlign = 'center'; c.textBaseline = 'top';
    for (const r of [0, 200, 400, 600]) c.fillText(String(r), X(r), y0 + 6);
    c.textAlign = 'right'; c.textBaseline = 'middle';
    for (const v of [15, 0, -15]) c.fillText((v > 0 ? '+' : '') + v, x0 - 6, Y(v));

    c.fillStyle = '#5c6b88'; c.textAlign = 'left'; c.textBaseline = 'top';
    c.fillText('距离 / m', x0, 4);
    c.textAlign = 'right'; c.textBaseline = 'bottom';
    c.fillText('多普勒速度 / (m·s⁻¹)', x1, H - 3);

    c.textAlign = 'right'; c.textBaseline = 'top';
    c.fillStyle = rdState.mti ? 'rgba(53,224,208,.95)' : 'rgba(255,93,108,.95)';
    c.font = '600 9.5px "JetBrains Mono", Consolas, monospace';
    c.fillText(rdState.mti ? 'MTI ON · 杂波 −29.2 dB' : 'MTI OFF · 杂波主导', x1, 4);

    const lw = 84, lx = x1 - lw, ly = H - 16;
    for (let i = 0; i < lw; i++) {
      const col = ramp(i / lw);
      c.fillStyle = 'rgb(' + col[0] + ',' + col[1] + ',' + col[2] + ')';
      c.fillRect(lx + i, ly, 1, 5);
    }
    c.fillStyle = '#65769a'; c.textAlign = 'left'; c.textBaseline = 'top';
    c.font = '8px "JetBrains Mono", Consolas, monospace';
    c.fillText('弱', lx - 12, ly - 1);
    c.textAlign = 'right'; c.fillText('强', x1, ly - 1);
  }

  /* ---------- Pd 随速度变化 ---------- */
  function drawPd() {
    const cvs = document.getElementById('pdCanvas');
    if (!cvs) return;
    const g = axis(cvs, {
      h: cvs.clientHeight || 186, xmin: 0, xmax: 15, ymin: 0, ymax: 1.02,
      pad: { l: 36, r: 12, t: 18, b: 26 },
      xTickVals: [0, 3, 6, 9, 12, 15], yTickVals: [0, 0.25, 0.5, 0.75, 1.0],
      xFmt: v => v.toFixed(0), yFmt: v => v.toFixed(2)
    });
    band(g, 0, 1.171875, 'rgba(255,93,108,.13)');

    polyline(g, D.mti.vSweep.map((v, i) => [v, D.mti.pdOff[i]]), 'rgba(255,93,108,.6)', 1.5, [3, 3]);
    polyline(g, D.mti.vSweep.map((v, i) => [v, D.mti.pdOn[i]]), 'rgba(53,224,208,.95)', 2);
    dots(g, D.mti.vSweep.map((v, i) => [v, D.mti.pdOn[i]]), '#35e0d0', 2.2);
    dots(g, D.mti.vSweep.map((v, i) => [v, D.mti.pdOff[i]]), 'rgba(255,93,108,.8)', 1.8);

    const pdOn = interp(D.mti.vSweep, D.mti.pdOn, rdState.v);
    vline(g, rdState.v, 'rgba(255,255,255,.5)', [3, 3]);
    note(g, 'v = ' + rdState.v.toFixed(1) + ' m/s', g.X(rdState.v) + 5, g.y1 + 24, 'rgba(233,238,251,.9)', 'left', 9);
    note(g, 'MTI 后 Pd = ' + pdOn.toFixed(2), g.x0 + 4, g.y1 + 9, 'rgba(53,224,208,.95)', 'left', 9.5);
    note(g, '无 MTI', g.x1 - 4, g.y1 + 9, 'rgba(255,93,108,.85)', 'right', 9);
  }

  /* ---------- 感知/通信折中 ---------- */
  function drawRho() {
    const cvs = document.getElementById('rhoCanvas');
    if (!cvs) return;
    const T = D.tradeoff;
    const g = axis(cvs, {
      h: cvs.clientHeight || 230, xmin: 5, xmax: 60, ymin: 150, ymax: 500,
      pad: { l: 44, r: 46, t: 22, b: 26 },
      xTickVals: [5, 15, 25, 35, 45, 55], yTickVals: [200, 300, 400, 500],
      xFmt: v => v.toFixed(0) + '%', yFmt: v => v.toFixed(0)
    });
    const pdY = p => 150 + (p - 0.6) / 0.4 * 350;

    band(g, g.X(24.2), g.X(25.8), 'rgba(53,224,208,.14)');
    vline(g, 25, 'rgba(53,224,208,.5)', [4, 4]);

    polyline(g, T.rho.map((r, i) => [r * 100, T.throughput[i]]), 'rgba(77,141,255,.95)', 2);
    polyline(g, T.rho.map((r, i) => [r * 100, pdY(T.pd[i])]), 'rgba(255,182,72,.95)', 2, [5, 4]);

    const cur = rhoState.rho;
    const th = interp(T.rho.map(r => r * 100), T.throughput, cur);
    const pd = interp(T.rho.map(r => r * 100), T.pd, cur);
    dots(g, [[cur, th]], '#4d8dff', 3.4);
    dots(g, [[cur, pdY(pd)]], '#ffb648', 3.4);

    /* 右轴 Pd 刻度 */
    g.ctx.save();
    g.ctx.font = '9px "JetBrains Mono", Consolas, monospace';
    g.ctx.fillStyle = 'rgba(255,182,72,.7)';
    g.ctx.textAlign = 'left'; g.ctx.textBaseline = 'middle';
    for (const p of [0.6, 0.7, 0.8, 0.9, 1.0]) g.ctx.fillText(p.toFixed(2), g.x1 + 6, g.Y(pdY(p)));
    g.ctx.restore();

    /* 图例（左上角） */
    const lx0 = g.x0 + 6, ly = g.y1 + 12;
    g.ctx.save();
    g.ctx.font = '9px "JetBrains Mono", Consolas, monospace';
    g.ctx.textBaseline = 'middle';
    g.ctx.strokeStyle = 'rgba(77,141,255,.95)'; g.ctx.lineWidth = 2;
    g.ctx.beginPath(); g.ctx.moveTo(lx0, ly); g.ctx.lineTo(lx0 + 14, ly); g.ctx.stroke();
    g.ctx.fillStyle = '#93a4c4'; g.ctx.textAlign = 'left';
    g.ctx.fillText('吞吐 / Mbps', lx0 + 19, ly);
    g.ctx.strokeStyle = 'rgba(255,182,72,.95)'; g.ctx.lineWidth = 1.6; g.ctx.setLineDash([4, 3]);
    g.ctx.beginPath(); g.ctx.moveTo(lx0 + 90, ly); g.ctx.lineTo(lx0 + 104, ly); g.ctx.stroke();
    g.ctx.setLineDash([]);
    g.ctx.fillStyle = '#93a4c4';
    g.ctx.fillText('Pd（右轴）', lx0 + 109, ly);
    g.ctx.restore();
  }

  /* ---------- 精度分位数 ---------- */
  function drawCdf() {
    const cvs = document.getElementById('cdfCanvas');
    if (!cvs) return;
    const f = fitCanvas(cvs, cvs.clientHeight || 186);
    const c = f.ctx, W = f.W, H = f.H;
    c.clearRect(0, 0, W, H);
    const pad = { l: 34, r: 134, t: 14, b: 22 };
    const maxV = 34;
    const x0 = pad.l, x1 = W - pad.r;
    const X = v => x0 + (v / maxV) * (x1 - x0);
    c.font = '9.5px "JetBrains Mono", Consolas, monospace';
    c.fillStyle = '#65769a'; c.textAlign = 'center'; c.textBaseline = 'top';
    for (let v = 0; v <= 30; v += 10) {
      c.fillText(v + '', X(v), H - pad.b + 5);
      c.strokeStyle = 'rgba(122,168,255,.07)';
      c.beginPath(); c.moveTo(X(v), pad.t); c.lineTo(X(v), H - pad.b); c.stroke();
    }
    const rowH = (H - pad.t - pad.b) / 3;
    D.positioning.forEach((p, i) => {
      const y = pad.t + rowH * (i + 0.5);
      const bh = 14;
      c.fillStyle = 'rgba(122,168,255,.06)';
      c.fillRect(x0, y - bh / 2, x1 - x0, bh);
      c.fillStyle = p.color + '99';
      c.fillRect(x0, y - bh / 2, X(p.cep95) - x0, bh);
      c.fillStyle = p.color;
      c.fillRect(x0, y - bh / 2, X(p.p90) - x0, bh);
      /* P50 / P90 / CEP95 刻度 */
      [p.p50, p.p90, p.cep95].forEach((v, k) => {
        c.strokeStyle = k === 2 ? 'rgba(255,255,255,.9)' : 'rgba(4,8,15,.85)';
        c.lineWidth = k === 2 ? 1.6 : 1.2;
        c.beginPath(); c.moveTo(X(v), y - bh / 2 - 2); c.lineTo(X(v), y + bh / 2 + 2); c.stroke();
      });
      c.textAlign = 'left'; c.textBaseline = 'middle';
      c.font = '600 11px "JetBrains Mono", Consolas, monospace';
      c.fillStyle = p.color;
      c.fillText(p.key, x1 + 8, y - 10);
      c.fillStyle = '#c3cfe6';
      c.fillText(p.cep95.toFixed(1) + ' m', x1 + 22, y - 10);
      c.font = '8.5px "JetBrains Mono", Consolas, monospace';
      c.fillStyle = '#6b7c9a';
      c.fillText('P50 ' + p.p50.toFixed(1) + ' / P90 ' + p.p90.toFixed(1), x1 + 8, y + 7);
    });
    c.fillStyle = '#65769a'; c.textAlign = 'left'; c.textBaseline = 'bottom';
    c.font = '9px "JetBrains Mono", Consolas, monospace';
    c.fillText('水平误差 / m', x0, H - 2);
  }

  /* ---------- 预测精度 ---------- */
  function drawPred() {
    const cvs = document.getElementById('predCanvas');
    if (!cvs) return;
    const g = axis(cvs, {
      h: cvs.clientHeight || 186, xmin: 0.1, xmax: 1.5, ymin: 0, ymax: 2.2,
      pad: { l: 38, r: 14, t: 16, b: 26 },
      xTickVals: [0.1, 0.5, 1.0, 1.5], yTickVals: [0, 0.5, 1.0, 1.5, 2.0],
      xFmt: v => v.toFixed(1) + 's', yFmt: v => v.toFixed(1)
    });
    polyline(g, D.conflict.horizon.map((h, i) => [h, D.conflict.maeCv[i]]), 'rgba(255,93,108,.65)', 1.6, [4, 3]);
    polyline(g, D.conflict.horizon.map((h, i) => [h, D.conflict.maeMlp[i]]), 'rgba(53,224,208,.95)', 2);
    dots(g, D.conflict.horizon.map((h, i) => [h, D.conflict.maeMlp[i]]), '#35e0d0', 2);
    note(g, '匀速外推 2.08 m', g.X(1.5) - 4, g.Y(2.08) - 11, 'rgba(255,93,108,.9)', 'right', 9);
    note(g, 'TrajNet 0.57 m', g.X(1.5) - 4, g.Y(0.57) - 11, 'rgba(53,224,208,.95)', 'right', 9);
  }

  /* ---------- 作用距离对比 ---------- */
  function drawRange() {
    const cvs = document.getElementById('rangeCanvas');
    if (!cvs) return;
    const f = fitCanvas(cvs, cvs.clientHeight || 186);
    const c = f.ctx, W = f.W, H = f.H;
    c.clearRect(0, 0, W, H);
    const rows = [
      { label: '仅热噪声', v: 3175, color: 'rgba(77,141,255,.85)', note: '3.2 km' },
      { label: '城市杂波（视距）', v: 502, color: 'rgba(53,224,208,.9)', note: '502 m' },
      { label: '城市杂波（非视距）', v: 212, color: 'rgba(255,182,72,.9)', note: '212 m' }
    ];
    const pad = { l: 96, r: 52, t: 18, b: 24 };
    const x0 = pad.l, x1 = W - pad.r;
    const maxV = 3500;
    const X = v => x0 + (v / maxV) * (x1 - x0);
    c.textBaseline = 'middle';
    const rowH = (H - pad.t - pad.b) / rows.length;
    rows.forEach((r, i) => {
      const y = pad.t + rowH * (i + 0.5), bh = Math.min(rowH * 0.5, 18);
      c.fillStyle = 'rgba(122,168,255,.05)';
      c.fillRect(x0, y - bh / 2, x1 - x0, bh);
      const g2 = c.createLinearGradient(x0, 0, Math.max(X(r.v), x0 + 4), 0);
      g2.addColorStop(0, 'rgba(255,255,255,.05)');
      g2.addColorStop(1, r.color);
      c.fillStyle = g2;
      c.fillRect(x0, y - bh / 2, Math.max(X(r.v) - x0, 3), bh);
      c.fillStyle = '#8b9cbd'; c.textAlign = 'right';
      c.font = '10.5px "Inter","Microsoft YaHei",sans-serif';
      c.fillText(r.label, x0 - 10, y);
      c.fillStyle = r.color; c.textAlign = 'left';
      c.font = '600 11px "JetBrains Mono", Consolas, monospace';
      c.fillText(r.note, X(r.v) + 7, y);
    });
    c.fillStyle = '#5c6b88'; c.textAlign = 'left'; c.textBaseline = 'bottom';
    c.font = '9px "JetBrains Mono", Consolas, monospace';
    c.fillText('单站 Pd = 0.9 作用距离 / m', x0, H - 2);
    c.strokeStyle = 'rgba(255,255,255,.14)'; c.setLineDash([3, 3]);
    c.beginPath(); c.moveTo(X(502), pad.t - 4); c.lineTo(X(502), H - pad.b); c.stroke();
    c.setLineDash([]);
  }

  /* ---------- 时延条 ---------- */
  function buildLatency() {
    const el = document.getElementById('latencyBar');
    if (!el) return;
    const L = D.latency;
    const segs = [
      { k: 'CPI', v: L.cpi, c: 'linear-gradient(180deg,#2ad8c6,#19a99c)' },
      { k: '站侧处理', v: L.procEdge, c: 'linear-gradient(180deg,#4d8dff,#2f6ae0)' },
      { k: '回传', v: L.uplink, c: 'linear-gradient(180deg,#8b7cf6,#6d5ce0)' },
      { k: 'AI 推理', v: L.aiInfer, c: 'linear-gradient(180deg,#ffc857,#e0a32f)' },
      { k: '融合', v: L.fuse, c: 'linear-gradient(180deg,#3ee08f,#25b06d)' },
      { k: '告警', v: L.alarm, c: 'linear-gradient(180deg,#ff8a5c,#e0603a)' }
    ];
    const total = L.total;
    el.innerHTML = segs.map(s =>
      '<div class="lat-seg" style="flex:0 0 ' + (s.v / total * 100).toFixed(2) + '%;background:' + s.c + ';" title="' + s.k + ' ' + s.v.toFixed(2) + ' ms"></div>'
    ).join('');
  }

  /* ---------- 交互绑定 ---------- */
  function updateRdReadout() {
    const pdEl = document.getElementById('rdPd');
    const sup = document.getElementById('rdSupp');
    const hint = document.getElementById('rdHint');
    const pd = interp(D.mti.vSweep, rdState.mti ? D.mti.pdOn : D.mti.pdOff, rdState.v);
    if (pdEl) {
      pdEl.textContent = pd.toFixed(2) + (pd >= 0.9 ? ' · 检测到' : pd > 0.3 ? ' · 临界' : ' · 漏检');
      pdEl.style.color = pd >= 0.9 ? 'var(--green)' : (pd > 0.3 ? 'var(--amber)' : 'var(--red)');
    }
    if (sup) sup.textContent = rdState.mti ? '29.2 dB' : '0 dB';
    if (hint) {
      hint.textContent = Math.abs(rdState.v) < D.mti.blindZone
        ? '⚠ 目标速度落在 MTI 速度盲区（±1.17 m/s）。工程对策：改用 MTD 滤波器组并显式保留零速通道，或在航路侧向增设交叉视角站点。'
        : '杂波比目标回波高 30 dB，且带 0.35 m/s 多普勒展宽；MTI 利用“杂波无多普勒、目标有”的差异抑制杂波。';
      hint.style.color = Math.abs(rdState.v) < D.mti.blindZone ? 'var(--amber)' : '';
    }
  }

  function bindRD() {
    const range = document.getElementById('rdV');
    const mti = document.getElementById('rdMti');
    const out = document.getElementById('rdVOut');
    if (!range || !mti) return;
    const update = () => {
      rdState.v = parseFloat(range.value);
      rdState.mti = mti.checked;
      if (out) out.textContent = rdState.v.toFixed(1) + ' m/s';
      rdBg = rdImage();
      drawRD(); drawPd(); updateRdReadout();
    };
    range.addEventListener('input', update);
    mti.addEventListener('change', update);
    update();
  }

  function bindRho() {
    const range = document.getElementById('rhoRange');
    if (!range) return;
    const out = document.getElementById('rhoOut');
    const th = document.getElementById('rhoThroughput');
    const loss = document.getElementById('rhoLoss');
    const pdEl = document.getElementById('rhoPd');
    const pdNote = document.getElementById('rhoPdNote');
    const T = D.tradeoff;
    const update = () => {
      rhoState.rho = parseFloat(range.value);
      const r = rhoState.rho / 100;
      const t = interp(T.rho, T.throughput, r);
      const pd = interp(T.rho, T.pd, r);
      const lossPct = (1 - t / T.throughput[0]) * 100;
      if (out) out.textContent = rhoState.rho + '%';
      if (th) th.textContent = t.toFixed(0) + ' Mbps';
      if (loss) loss.textContent = '吞吐损失 ' + lossPct.toFixed(1) + '%';
      if (pdEl) pdEl.textContent = pd.toFixed(3);
      if (pdNote) pdNote.textContent = (pd >= 0.9 ? '满足 ≥0.9' : '未达 0.9') + ' · ' + (lossPct <= 25 ? '损失 ≤25%' : '损失 >25%');
      drawRho();
    };
    range.addEventListener('input', update);
    update();
  }

  function drawAll() {
    drawRD(); drawPd(); drawRho(); drawCdf(); drawPred(); drawRange();
  }

  function init() {
    buildLatency();
    bindRD();
    bindRho();
    drawCdf(); drawPred(); drawRange(); drawRho();
    let rt = 0;
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(drawAll, 160); });
  }

  window.Lab = { init, drawAll };
})();
