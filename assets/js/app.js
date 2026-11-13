/* =========================================================
   app.js —— 页面渲染、首屏雷达动画、图集灯箱、初始化
   ========================================================= */
(function () {
  'use strict';
  const { $, $$, fmt, TAU } = window.UI;
  const D = window.DATA;

  /* ---------- 表格工具 ---------- */
  function asset(p) {
    return (window.__ASSETS && window.__ASSETS[p]) || p;
  }

  function table(headers, rows, opts) {
    opts = opts || {};
    const head = '<tr>' + headers.map(h => '<th>' + h + '</th>').join('') + '</tr>';
    const body = rows.map(r =>
      '<tr' + (r.cls ? ' class="' + r.cls + '"' : '') + '>' +
      r.cells.map(c => {
        if (c && c.html !== undefined) return '<td class="' + (c.cls || '') + '">' + c.html + '</td>';
        return '<td class="' + ((c && c.cls) || '') + '">' + c + '</td>';
      }).join('') + '</tr>'
    ).join('');
    return '<table class="data">' + head + body + '</table>';
  }

  /* ---------- 场景与痛点 ---------- */
  function renderContext() {
    const pg = $('#painGrid');
    if (pg) {
      pg.innerHTML = D.pains.map((p, i) =>
        '<article class="pain">' +
        '<span class="pain-idx">0' + (i + 1) + '</span>' +
        '<h4>' + p.title + '</h4>' +
        '<p>' + p.now + '</p>' +
        '<p class="impact">' + p.impact + '</p>' +
        '</article>'
      ).join('');
    }

    const ew = $('#existingWrap');
    if (ew) {
      ew.innerHTML = table(['现有方案', '能力边界', '为何难以支撑航路级保障'],
        D.existing.map(e => ({
          cls: e.highlight ? 'hl' : '',
          cells: ['<b>' + e.name + '</b>', e.limit, e.why]
        })));
    }

    const kw = $('#kpiWrap');
    if (kw) {
      kw.innerHTML = table(['编号', 'KPI', '定义', '目标值', '仿真结果', '状态'],
        D.kpis.map(k => ({
          cells: [
            { html: '<b>' + k.id + '</b>', cls: 'num' },
            '<b>' + k.name + '</b>',
            k.def,
            { html: k.target, cls: 'num' },
            { html: '<b>' + k.actual + '</b><br><span style="font-size:11px;color:#6b7c9a">' + k.note + '</span>' },
            { html: '<span class="chip ' + (k.state === 'pass' ? 'ok' : 'watch') + '">' + (k.state === 'pass' ? '✓ 达成' : '◔ 待验证') + '</span>' }
          ]
        })));
    }
  }

  /* ---------- 技术链路 ---------- */
  function renderTech() {
    const pipe = $('#pipeline');
    if (pipe) {
      const steps = [
        { n: '01', t: '感知', p: '每 CPI 采集回波 → 参考除法 → MTI → 二维 FFT → CFAR 与峰值提取', ms: '20.0 ms', sub: 'CPI' },
        { n: '02', t: '上报', p: '站侧只上报点迹（距离、方位、SIR、时间戳），原始 IQ 不出站', ms: '0.5 ms', sub: '≈40 B / 点迹' },
        { n: '03', t: '定位', p: 'NLOSNet 逐站估置信度与附加距离 → 去偏 → EKF（Joseph 形式）', ms: '0.07 ms', sub: '边缘 MEC' },
        { n: '04', t: '预测', p: 'TrajNet 取最近 8 点预测未来 15 步（1.5 s），叠加航路意图', ms: '0.02 ms', sub: '7 198 参数' },
        { n: '05', t: '决策', p: '时空双门限（30 m / 10 m）→ 告警 → 减速 → 航路重规划', ms: '1.0 ms', sub: '区域中心' }
      ];
      pipe.innerHTML = steps.map(s =>
        '<div class="pipe-step"><span class="no">' + s.n + '</span><h4>' + s.t + '</h4><p>' + s.p + '</p>' +
        '<div class="ms">' + s.ms + '<span>' + s.sub + '</span></div></div>'
      ).join('');
    }

    const cl = $('#cdfLegend');
    if (cl) {
      cl.innerHTML = D.positioning.map(p =>
        '<span><i style="background:' + p.color + '"></i>' + p.key + ' ' + p.name + '</span>'
      ).join('');
    }
  }

  /* ---------- 资源协同 ---------- */
  function renderResource() {
    const ls = $('#layerStack');
    if (!ls) return;
    const cols = ['#35e0d0', '#4d8dff', '#a78bfa'];
    ls.innerHTML = D.computeLayers.map((l, i) =>
      '<div class="layer"><b><i class="layer-dot" style="background:' + cols[i] + '"></i>' + l.layer + '</b>' +
      '<p>' + l.job + '<br><span style="color:#5f6f8d;font-size:10.5px">' + l.place + '</span></p>' +
      '<em>' + l.tops + '</em></div>'
    ).join('');
  }

  /* ---------- 部署与路径 ---------- */
  function renderDeploy() {
    const ds = $('#deployStrip');
    if (ds) {
      const items = [
        { k: '通感节点', v: '12', u: '站 / 2 km 航路' },
        { k: '站间距', v: '175', u: 'm（交错 ±120 m）' },
        { k: '挂高', v: '60', u: 'm（楼顶 / 杆塔）' },
        { k: '单站覆盖', v: '502', u: 'm（Pd=0.9）' },
        { k: '邻站重叠', v: '≈40', u: '%（航路无空洞）' },
        { k: '站间同步', v: 'μs', u: '级时间戳对齐' }
      ];
      ds.innerHTML = items.map(i =>
        '<div class="dparam"><span>' + i.k + '</span><b>' + i.v + '</b><em>' + i.u + '</em></div>'
      ).join('');
    }

    const bw = $('#bomWrap');
    if (bw) {
      bw.innerHTML = table(['类别', '设备 / 模块', '关键规格', '数量'],
        D.billOfMaterials.map(b => ({
          cells: ['<b>' + b.cat + '</b>', b.item, b.spec, { html: b.qty, cls: 'num' }]
        })));
    }

    const rm = $('#roadmap');
    if (rm) {
      rm.innerHTML = D.roadmap.map(r =>
        '<div class="road"><span class="road-node"></span>' +
        '<div class="road-card"><span class="pid">' + r.id + '</span>' +
        '<h4>' + r.title + '</h4><span class="time">' + r.time + '</span>' +
        '<p>验收门槛：' + r.gate + '</p></div></div>'
      ).join('');
    }

    const rg = $('#replicateGrid');
    if (rg) {
      rg.innerHTML = D.replicable.map(r =>
        '<article class="rep"><div class="rep-top"><h4>' + r.form + '</h4>' +
        '<span class="reuse">复用度 ' + r.reuse + '</span></div>' +
        '<div class="scene">' + r.scene + '</div><p>' + r.diff + '</p></article>'
      ).join('');
    }
  }

  /* ---------- 验证 ---------- */
  function renderVerify() {
    const pw = $('#posWrap');
    if (pw) {
      pw.innerHTML = table(['方案', 'CEP95 / m', 'RMSE / m', 'P50 / m', 'P90 / m', '相对纯 GNSS'],
        D.positioning.map(p => ({
          cls: p.key === 'C' ? 'hl' : '',
          cells: [
            { html: '<b>' + p.key + '</b>　' + p.name + '<br><span style="font-size:11px;color:#6b7c9a">' + p.desc + '</span>' },
            { html: '<b>' + p.cep95.toFixed(2) + '</b>', cls: 'num' },
            { html: p.rmse.toFixed(2), cls: 'num' },
            { html: p.p50.toFixed(2), cls: 'num' },
            { html: p.p90.toFixed(2), cls: 'num' },
            { html: p.improve ? '<b style="color:var(--cyan)">↑ ' + (p.improve * 100).toFixed(1) + '%</b>' : '—', cls: 'num' }
          ]
        })));
    }

    const files = {
      fig01: 'fig01_scene', fig02: 'fig02_arch', fig03: 'fig03_rd_map', fig04: 'fig04_mti',
      fig05: 'fig05_range', fig06: 'fig06_cdf', fig07: 'fig07_err_time', fig08: 'fig08_nlos',
      fig09: 'fig09_tradeoff', fig10: 'fig10_latency', fig11: 'fig11_roadmap', fig12: 'fig12_conflict'
    };
    const gal = $('#gallery');
    if (gal) {
      gal.innerHTML = D.figures.map(f => {
        const src = asset('assets/img/' + (files[f.id] || f.id) + '.webp');
        return '<figure class="gal" data-src="' + src + '" data-cap="' + f.title + ' · ' + f.desc + '">' +
          '<img src="' + src + '" alt="' + f.title + '" loading="lazy">' +
          '<figcaption><b>' + f.title + '</b><span>' + f.desc + '</span></figcaption></figure>';
      }).join('');
      gal.addEventListener('click', e => {
        const fig = e.target.closest('.gal');
        if (!fig) return;
        openLightbox(fig.dataset.src, fig.dataset.cap);
      });
    }
  }

  /* ---------- 佐证与专利 ---------- */
  function renderEvidence() {
    const E = D.evidence;
    if (!E) return;

    const eg = $('#evGrid');
    if (eg) {
      eg.innerHTML = E.certs.map(c => {
        const src = asset(c.img);
        const cap = c.org + ' 《技术应用证明》 · ' + c.date;
        return '<article class="ev-card">' +
          '<div class="ev-thumb" data-src="' + src + '" data-cap="' + cap + '">' +
          '<img src="' + src + '" alt="' + c.org + ' 技术应用证明" loading="lazy">' +
          '<span class="ev-badge">' + c.no + ' / 03</span>' +
          '<span class="ev-mask">单位名称已模糊</span>' +
          '</div>' +
          '<div class="ev-body">' +
          '<div class="ev-sector">' + c.sector + '</div>' +
          '<h4>' + c.org + '</h4>' +
          '<p class="ev-quote">“' + c.quote + '”</p>' +
          '<div class="ev-facts">' + c.facts.map(f => '<span>' + f + '</span>').join('') + '</div>' +
          '<div class="ev-foot"><span>应用领域：' + c.scope + '</span><b>' + c.date + '</b></div>' +
          '</div></article>';
      }).join('');
      eg.addEventListener('click', e => {
        const t = e.target.closest('.ev-thumb');
        if (!t) return;
        openLightbox(t.dataset.src, t.dataset.cap);
      });
    }

    const pg = $('#ptGrid');
    if (pg) {
      pg.innerHTML = E.patents.map((p, i) => {
        const src = asset(p.thumb);
        const full = asset(p.img);
        const cap = '专利申请受理通知书 · ' + p.no + ' · ' + p.name;
        return '<article class="pt-card">' +
          '<div class="pt-thumb" data-src="' + full + '" data-cap="' + cap + '">' +
          '<img src="' + src + '" alt="' + p.name + ' 受理通知书" loading="lazy">' +
          '<span class="ev-badge">' + String(i + 1).padStart(2, '0') + '</span>' +
          '</div>' +
          '<div class="pt-body">' +
          '<div class="pt-no">' + p.no + '</div>' +
          '<h4>' + p.short + '</h4>' +
          '<div class="pt-map">' + p.maps + '</div>' +
          '</div></article>';
      }).join('');
      pg.addEventListener('click', e => {
        const t = e.target.closest('.pt-thumb');
        if (!t) return;
        openLightbox(t.dataset.src, t.dataset.cap);
      });
    }

    const ct = $('#claimText');
    if (ct) ct.textContent = E.claim;

    const cf = $('#claimFlow');
    if (cf) {
      cf.innerHTML = E.reviewFlow.map(s =>
        '<div class="cf-step ' + (s.state === 'done' ? 'done' : s.state === 'now' ? 'now' : '') + '">' +
        '<i></i><b>' + s.name + '</b><em>' + s.note + '</em></div>'
      ).join('');
    }
  }

  /* ---------- 灯箱 ---------- */
  function openLightbox(src, cap) {
    const lb = $('#lightbox');
    if (!lb) return;
    $('#lbImg').src = src;
    $('#lbImg').alt = cap || '';
    $('#lbCap').textContent = cap || '';
    lb.hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeLightbox() {
    const lb = $('#lightbox');
    if (!lb) return;
    lb.hidden = true;
    document.body.style.overflow = '';
  }
  function bindLightbox() {
    const lb = $('#lightbox');
    if (!lb) return;
    $('#lbClose').addEventListener('click', closeLightbox);
    lb.addEventListener('click', e => { if (e.target === lb) closeLightbox(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLightbox(); });
  }

  /* ---------- 首屏：低空航路通感走廊动画 ---------- */
  function initHero() {
    const cvs = $('#heroCanvas');
    if (!cvs) return;
    const ctx = cvs.getContext('2d');
    let W = 0, H = 0, dpr = 1, t0 = performance.now(), visible = true, last = 0;
    const N_ST = 12;
    const drones = [];
    for (let i = 0; i < 6; i++) drones.push({ p: i / 6 + 0.015 * i, v: 0.012 + 0.005 * (i % 3), ph: i * 1.7 });

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = cvs.clientWidth; H = cvs.clientHeight;
      cvs.width = Math.round(W * dpr); cvs.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener('resize', resize);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (e) { visible = e[0].isIntersecting; }).observe(cvs);
    }

    function frame(ts) {
      requestAnimationFrame(frame);
      if (!visible || ts - last < 33) return;
      last = ts;
      const t = (ts - t0) / 1000;
      ctx.clearRect(0, 0, W, H);
      const m = Math.max(46, W * 0.038);
      const baseY = H - 96;
      const span = W - 2 * m;
      const xs = function (i) { return m + span * i / (N_ST - 1); };

      /* 走廊光带 */
      const g = ctx.createLinearGradient(0, baseY - 50, 0, baseY + 28);
      g.addColorStop(0, 'rgba(53,224,208,0)');
      g.addColorStop(0.55, 'rgba(53,224,208,.07)');
      g.addColorStop(1, 'rgba(53,224,208,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, baseY - 50, W, 78);

      /* 航路虚线 */
      ctx.save();
      ctx.setLineDash([10, 16]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(53,224,208,.30)';
      ctx.beginPath(); ctx.moveTo(m, baseY); ctx.lineTo(W - m, baseY); ctx.stroke();
      ctx.restore();

      /* 目标位置 */
      const ds = drones.map(function (d, i) {
        const u = (((d.p + t * d.v) % 1) + 1) % 1;
        return { x: m + span * u, y: baseY + Math.sin(t * 0.9 + d.ph) * 9, u: u };
      });

      /* 站点 + 波束 */
      for (let i = 0; i < N_ST; i++) {
        const x = xs(i);
        let near = null, nd = 1e9;
        for (let k = 0; k < ds.length; k++) {
          const d = Math.abs(ds[k].x - x);
          if (d < nd) { nd = d; near = ds[k]; }
        }
        const active = nd < 120;
        if (active && near) {
          ctx.save();
          ctx.strokeStyle = 'rgba(62,224,143,' + (0.42 * (1 - nd / 120)).toFixed(3) + ')';
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 4]);
          ctx.beginPath(); ctx.moveTo(x, baseY - 16); ctx.lineTo(near.x, near.y); ctx.stroke();
          ctx.restore();
          ctx.beginPath();
          ctx.arc(x, baseY - 16, 5 + 4 * Math.abs(Math.sin(t * 2.2 + i)), 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(62,224,143,.35)';
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.moveTo(x, baseY - 36);
        ctx.lineTo(x + 5, baseY - 26);
        ctx.lineTo(x - 5, baseY - 26);
        ctx.closePath();
        if (active) { ctx.shadowColor = '#3ee08f'; ctx.shadowBlur = 10; }
        ctx.fillStyle = active ? '#3ee08f' : 'rgba(255,182,72,.5)';
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = active ? 'rgba(62,224,143,.55)' : 'rgba(122,168,255,.14)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, baseY - 26); ctx.lineTo(x, baseY); ctx.stroke();
        ctx.font = '8px "JetBrains Mono", Consolas, monospace';
        ctx.fillStyle = active ? 'rgba(62,224,143,.9)' : 'rgba(120,140,170,.4)';
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText((i + 1 < 10 ? '0' : '') + (i + 1), x, baseY + 8);
      }

      /* 目标 */
      for (let i = 0; i < ds.length; i++) {
        const d = ds[i];
        ctx.save();
        ctx.fillStyle = 'rgba(120,240,235,.95)';
        ctx.shadowColor = '#35e0d0'; ctx.shadowBlur = 12;
        ctx.beginPath(); ctx.arc(d.x, d.y, 2.6, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }

      /* 角标 */
      ctx.font = '9.5px "JetBrains Mono", Consolas, monospace';
      ctx.fillStyle = 'rgba(140,158,190,.5)';
      ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      ctx.fillText('低空航路 · 2 000 m', m, baseY - 50);
      ctx.textAlign = 'right';
      ctx.fillText('12 × 6G ISAC 节点 · 10 Hz', W - m, baseY - 50);
    }
    requestAnimationFrame(frame);
  }

  /* ---------- 错误提示 ---------- */
  window.__errs = [];
  window.addEventListener('error', e => {
    window.__errs.push(String(e.message || e.error) + ' @' + (e.filename || '') + ':' + (e.lineno || 0));
    const box = $('#jsError');
    if (!box) return;
    box.hidden = false;
    box.textContent = '页面脚本错误：' + (e.message || e.error) + '\n' + (e.filename || '') + ':' + (e.lineno || '');
  });

  /* ---------- 初始化 ---------- */
  function boot() {
    const qs0 = new URLSearchParams(location.search);
    if (qs0.has('shot')) document.documentElement.classList.add('shot');
    renderContext();
    renderTech();
    renderResource();
    renderDeploy();
    renderVerify();
    renderEvidence();
    bindLightbox();
    window.UI.initScrollSpy();
    window.UI.initReveal();
    window.UI.initCounters();
    if (window.Scene) window.Scene.init();
    if (window.Lab) window.Lab.init();
    initHero();

    /* 深链：直接定位到锚点（截图 / 分享用） */
    const hash = location.hash;
    const qs = new URLSearchParams(location.search);
    if (qs.has('y')) {
      setTimeout(() => {
        document.documentElement.style.scrollBehavior = 'auto';
        window.scrollTo(0, parseInt(qs.get('y'), 10) || 0);
      }, 250);
    } else if (hash && hash.length > 1) {
      setTimeout(() => {
        const el = document.querySelector(hash);
        if (!el) return;
        document.documentElement.style.scrollBehavior = 'auto';
        window.scrollTo(0, el.offsetTop - 64);
      }, 250);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
