/* =========================================================
   Personnage animé — moteur d'animation
   ---------------------------------------------------------
   Principe « 2,5D » : chaque partie du visage est un calque
   placé à une profondeur z. Quand la tête tourne (lacet) ou
   lève/baisse le menton (tangage), chaque calque est projeté
   selon sa profondeur : le nez (z élevé) se déplace plus que
   les oreilles (z négatif). Cela donne l'illusion de volume
   sans moteur 3D.
   Les textures fines (boucles, barbe, sourcils) sont peintes
   une seule fois dans des <canvas> puis insérées dans le SVG :
   beaucoup de détail, peu de coût à chaque image.
   ========================================================= */
(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const f = (n) => (Math.round(n * 100) / 100).toString();
  const DEG = Math.PI / 180;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Générateur pseudo-aléatoire déterministe (même rendu à chaque chargement) */
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Test « point dans forme » sur un canvas neutre (coordonnées SVG) */
  const hitCanvas = document.createElement('canvas');
  hitCanvas.width = hitCanvas.height = 1000;
  const hctx = hitCanvas.getContext('2d');
  const inside = (path, x, y, rule = 'nonzero') => hctx.isPointInPath(path, x, y, rule);

  /* Peint une texture dans un canvas (coordonnées SVG) et renvoie son URL */
  function paint(box, draw, scale = 2.5) {
    const c = document.createElement('canvas');
    c.width = Math.ceil(box.w * scale);
    c.height = Math.ceil(box.h * scale);
    const ctx = c.getContext('2d');
    ctx.setTransform(scale, 0, 0, scale, -box.x * scale, -box.y * scale);
    draw(ctx);
    return c.toDataURL('image/png');
  }
  function placeImage(sel, box, url) {
    const el = $(sel);
    el.setAttribute('href', url);
    el.setAttribute('x', box.x);
    el.setAttribute('y', box.y);
    el.setAttribute('width', box.w);
    el.setAttribute('height', box.h);
  }

  /* =======================================================
     1. CONSTRUCTION DES DÉTAILS PROCÉDURAUX
     ======================================================= */

  /* --- Silhouette des cheveux : couronne bosselée de boucles + contour net (line-up) --- */
  function buildHairPath() {
    const r = rng(11);
    const cx = 500, cy = 352, rx = 254, ry = 250;
    const a0 = Math.PI - 0.04, a1 = 2 * Math.PI + 0.04;
    const N = 27;
    const pts = [];
    for (let i = 0; i <= N; i++) {
      let t = i / N;
      const inner = i > 0 && i < N;
      if (inner) t += (r() - 0.5) * 0.35 / N;
      const a = a0 + (a1 - a0) * t;
      const wob = inner ? (r() - 0.5) * 7 : 0;
      pts.push([cx + (rx + wob) * Math.cos(a), cy + (ry + wob) * Math.sin(a)]);
    }
    let d = `M ${f(pts[0][0])} ${f(pts[0][1])}`;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const rad = Math.hypot(x1 - x0, y1 - y0) * (0.56 + r() * 0.12);
      d += ` A ${f(rad)} ${f(rad)} 0 0 1 ${f(x1)} ${f(y1)}`;
    }
    // côté droit (dégradé), favori, ligne frontale nette, côté gauche
    d += ' C 752 380 734 400 730 420 L 720 470 L 716 525 L 704 525 C 705 495 706 465 706 440' +
         ' C 704 410 700 380 695 345 C 692 320 688 296 684 278 C 680 266 672 261 660 260' +
         ' C 580 257 420 257 340 260 C 328 261 320 266 316 278 C 312 296 308 320 305 345' +
         ' C 300 380 296 410 294 440 C 294 465 295 495 296 525 L 284 525 L 280 470 L 270 420' +
         ' C 266 400 248 380 246 362 Z';
    return d;
  }

  const hairD = buildHairPath();
  const hairPath = new Path2D(hairD);
  $('#hairBase').setAttribute('d', hairD);
  $('#hairLine').setAttribute('d', hairD);

  /* --- Texture des boucles (afro court) --- */
  const hairBox = { x: 225, y: 85, w: 550, h: 450 };
  function sheenAt(x, y) {
    const dx = (x - 565) / 170, dy = (y - 175) / 95;
    let s = 0.22 + 0.78 * Math.exp(-(dx * dx + dy * dy));
    if (y > 315) s *= clamp(1 - (y - 315) / 70, 0.15, 1);
    return s;
  }
  placeImage('#hairTex', hairBox, paint(hairBox, (ctx) => {
    ctx.save();
    ctx.clip(hairPath);
    ctx.fillStyle = '#141414';
    ctx.fillRect(hairBox.x, hairBox.y, hairBox.w, hairBox.h);

    const r = rng(23);
    const curls = [];
    const step = 12.5;
    let row = 0;
    for (let y = 90; y < 380; y += step * 0.8, row++) {
      for (let x = 230 + (row % 2) * step * 0.5; x < 775; x += step) {
        const px = x + (r() - 0.5) * step * 0.7;
        const py = y + (r() - 0.5) * step * 0.6;
        if (!inside(hairPath, px, py)) continue;
        curls.push({ x: px, y: py, R: 6 + r() * 4, a: r() * Math.PI * 2 });
      }
    }
    curls.sort((p, q) => p.y - q.y);
    ctx.lineCap = 'round';
    for (const c of curls) {
      const s = sheenAt(c.x, c.y);
      const g = ctx.createRadialGradient(c.x - c.R * 0.3, c.y - c.R * 0.35, c.R * 0.1, c.x, c.y, c.R);
      const v = Math.round(34 + s * 46);
      g.addColorStop(0, `rgb(${v},${v},${v})`);
      g.addColorStop(1, '#090909');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(c.x, c.y, c.R, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 1.8; ctx.strokeStyle = 'rgba(0,0,0,.95)'; ctx.stroke();
      // spirale interne
      ctx.beginPath(); ctx.arc(c.x + c.R * 0.12, c.y + c.R * 0.15, c.R * 0.48, c.a, c.a + 4.2);
      ctx.lineWidth = 1.3; ctx.stroke();
      // reflet (lumière en haut à gauche)
      ctx.beginPath(); ctx.arc(c.x, c.y, c.R * 0.7, -2.8, -1.5);
      ctx.lineWidth = 1.4 + s * 1.1;
      ctx.strokeStyle = `rgba(205,205,205,${(0.18 + s * 0.6).toFixed(3)})`;
      ctx.stroke();
    }
    // trame de brillance (halftone) sur le dessus
    for (let y = 100; y < 310; y += 6) {
      for (let x = 360; x < 770; x += 6) {
        const xx = x + ((y / 6) % 2) * 3;
        const dx = (xx - 565) / 150, dy = (y - 170) / 70;
        const s = Math.exp(-(dx * dx + dy * dy));
        if (s < 0.25) continue;
        ctx.fillStyle = `rgba(215,215,215,${(0.1 + s * 0.12).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(xx, y, 0.6 + s * 1.1, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }));

  /* --- Pointillé du dégradé (fade) sur les tempes --- */
  const stippleBox = { x: 240, y: 290, w: 520, h: 250 };
  placeImage('#stippleTex', stippleBox, paint(stippleBox, (ctx) => {
    ctx.save();
    ctx.clip(hairPath);
    const r = rng(31);
    for (let i = 0; i < 5200; i++) {
      const x = stippleBox.x + r() * stippleBox.w;
      const y = stippleBox.y + 8 + r() * (stippleBox.h - 8);
      if (x > 322 && x < 678) continue;
      if (r() > 1 - (y - 298) / 245) continue;
      ctx.fillStyle = `rgba(20,14,10,${(0.35 + r() * 0.5).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(x, y, 0.6 + r() * 0.9, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }));

  /* --- Barbe de quelques jours le long de la mâchoire --- */
  const faceD = $('#facePath').getAttribute('d');
  const beardBand = new Path2D(faceD + ' ' + $('#beardInnerPath').getAttribute('d'));
  const stubbleBox = { x: 268, y: 540, w: 464, h: 312 };
  function hairs(ctx, r, count, box, test, angleOf, lenMin, lenVar, alphaOf) {
    let n = 0;
    for (let i = 0; i < count * 8 && n < count; i++) {
      const x = box.x + r() * box.w;
      const y = box.y + r() * box.h;
      if (!test(x, y)) continue;
      n++;
      const al = alphaOf(x, y, r);
      if (al <= 0.02) continue;
      const ang = angleOf(x, y) + (r() - 0.5) * 0.7;
      const len = lenMin + r() * lenVar;
      ctx.strokeStyle = `rgba(30,17,11,${al.toFixed(3)})`;
      ctx.lineWidth = 0.9 + r() * 0.7;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
      ctx.stroke();
    }
  }
  placeImage('#stubbleTex', stubbleBox, paint(stubbleBox, (ctx) => {
    ctx.save();
    ctx.clip(beardBand, 'evenodd');
    const g = ctx.createLinearGradient(0, 555, 0, 850);
    g.addColorStop(0, 'rgba(80,42,26,0)');
    g.addColorStop(0.3, 'rgba(80,42,26,.16)');
    g.addColorStop(1, 'rgba(62,32,20,.3)');
    ctx.fillStyle = g;
    ctx.fillRect(stubbleBox.x, stubbleBox.y, stubbleBox.w, stubbleBox.h);
    const r = rng(41);
    for (let i = 0; i < 2200; i++) {
      const x = stubbleBox.x + r() * stubbleBox.w, y = stubbleBox.y + r() * stubbleBox.h;
      if (y < 620 && r() > (y - 585) / 35) continue;
      ctx.fillStyle = `rgba(36,20,13,${(0.2 + r() * 0.3).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(x, y, 0.5 + r() * 0.8, 0, Math.PI * 2); ctx.fill();
    }
    ctx.lineCap = 'round';
    hairs(ctx, r, 950, stubbleBox,
      (x, y) => inside(beardBand, x, y, 'evenodd'),
      (x, y) => Math.atan2(y - 540, x - 500),
      3, 4,
      (x, y, rr) => clamp((y - 588) / 80, 0, 1) * (0.3 + rr() * 0.45));
    ctx.restore();
  }));

  /* --- Moustache légère --- */
  const mustacheBox = { x: 418, y: 646, w: 164, h: 50 };
  const mustachePath = new Path2D('M 424 692 C 440 668 470 652 500 654 C 530 652 560 668 576 692 C 556 678 530 670 500 672 C 470 670 444 678 424 692 Z');
  placeImage('#mustacheTex', mustacheBox, paint(mustacheBox, (ctx) => {
    ctx.save();
    ctx.clip(mustachePath);
    ctx.fillStyle = 'rgba(80,42,26,.2)';
    ctx.fillRect(mustacheBox.x, mustacheBox.y, mustacheBox.w, mustacheBox.h);
    ctx.lineCap = 'round';
    hairs(ctx, rng(53), 230, mustacheBox,
      (x, y) => inside(mustachePath, x, y),
      (x) => Math.PI / 2 - (x - 500) / 75 * 0.75,
      3.5, 4,
      (x, y, rr) => (0.35 + rr() * 0.5) * clamp(1 - Math.abs(x - 500) / 95, 0.25, 1));
    ctx.restore();
  }));

  /* --- Barbiche sous la lèvre --- */
  const soulBox = { x: 472, y: 728, w: 56, h: 38 };
  placeImage('#soulTex', soulBox, paint(soulBox, (ctx) => {
    ctx.lineCap = 'round';
    hairs(ctx, rng(67), 90, soulBox,
      (x, y) => ((x - 500) / 17) ** 2 + ((y - 746) / 11) ** 2 < 1,
      (x) => Math.PI / 2 + (x - 500) / 60,
      3.5, 4,
      (x, y, rr) => 0.45 + rr() * 0.45);
  }));

  /* --- Sourcils épais (texture poil par poil) --- */
  const browBox = { x: 312, y: 394, w: 152, h: 54 };
  const browPath = new Path2D('M 456 441 C 452 428 448 420 444 414 C 410 401 362 399 326 411 C 317 414 317 421 326 423 C 362 418 404 423 456 441 Z');
  const browURL = paint(browBox, (ctx) => {
    ctx.save();
    ctx.fillStyle = '#1b120d';
    ctx.fill(browPath);
    ctx.clip(browPath);
    const r = rng(77);
    ctx.lineCap = 'round';
    for (let i = 0; i < 420; i++) {
      const x = 318 + r() * 142, y = 398 + r() * 46;
      if (!inside(browPath, x, y)) continue;
      const ang = -Math.PI / 2 - (452 - x) / 130 * 1.15 + (r() - 0.5) * 0.35;
      const len = 6 + r() * 7;
      ctx.strokeStyle = r() < 0.7 ? 'rgba(8,5,3,.9)' : 'rgba(110,80,60,.55)';
      ctx.lineWidth = 0.9 + r() * 0.8;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
      ctx.stroke();
    }
    ctx.restore();
    // quelques poils qui dépassent du bord supérieur
    const r2 = rng(78);
    ctx.lineCap = 'round';
    for (let i = 0; i < 40; i++) {
      const x = 330 + r2() * 118;
      const t = (x - 326) / 130;
      const y = lerp(412, 422, t) - 2;
      const ang = -Math.PI / 2 - (452 - x) / 130 * 1.15;
      ctx.strokeStyle = 'rgba(15,10,7,.7)';
      ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(x, y + 3); ctx.lineTo(x + Math.cos(ang) * 6, y + 3 + Math.sin(ang) * 6); ctx.stroke();
    }
  });
  placeImage('#browTexL', browBox, browURL);
  placeImage('#browTexR', browBox, browURL);

  /* =======================================================
     2. RÉFÉRENCES DOM
     ======================================================= */
  const el = {
    stage: $('#stage'), svg: $('#perso'), body: $('#body'), head: $('#head'),
    earL: $('#earL'), earR: $('#earR'), jawShadow: $('#jawShadow'),
    browL: $('#browL'), browR: $('#browR'),
    glassesRig: $('#glassesRig'), glints: document.querySelectorAll('#perso .glint'),
    cheekL: $('#cheekL'), cheekR: $('#cheekR'),
    upperLip: $('#upperLip'), lowerLip: $('#lowerLip'), mouthInside: $('#mouthInside'),
    mouthLine: $('#mouthLine'), mouthClip: $('#mouthClipPath'), teeth: $('#teeth'), tongue: $('#tongue'),
    lipHighlight: $('#lipHighlight'), lipShadow: $('#lipShadow'), soulPatch: $('#soulPatch'),
    upperLipHl: $('#upperLipHl'), lowerLipShade: $('#lowerLipShade'),
    lensShadows: document.querySelectorAll('#perso .lens-shadow'),
    foldL: $('#foldL'), foldR: $('#foldR'), dimpleL: $('#dimpleL'), dimpleR: $('#dimpleR'),
    bubble: $('#bubble'), bubbleText: $('#bubbleText'), hint: $('#hint'),
    follow: $('#follow'), voice: $('#voice'), sayText: $('#sayText'),
  };
  const zLayers = [...document.querySelectorAll('#head [data-z]')].map((n) => ({ n, z: +n.dataset.z }));
  const arms = {
    L: { front: $('#armFrontL'), back: $('#armBackL') },
    R: { front: $('#armFrontR'), back: $('#armBackR') },
  };
  const eyes = ['L', 'R'].map((s) => ({
    side: s,
    outer: s === 'L' ? [330, 496] : [670, 496],
    inner: s === 'L' ? [446, 503] : [554, 503],
    white: $('#white' + s), clip: $('#eyeClipPath' + s), iris: $('#iris' + s),
    lidShadow: $('#lidShadow' + s), lid: $('#lid' + s), lower: $('#lower' + s),
    crease: $('#crease' + s), lash: $('#lash' + s),
  }));

  /* =======================================================
     3. ÉTAT DE L'ANIMATION
     ======================================================= */
  const EXPRESSIONS = {
    neutre:  { smile: 0.12, brow: 0,    frown: 0,   open: 0 },
    sourire: { smile: 1,    brow: 0.25, frown: 0,   open: 0.05 },
    surpris: { smile: 0,    brow: 1,    frown: 0,   open: 0.35 },
    serieux: { smile: -0.35, brow: 0,   frown: 1,   open: 0 },
  };
  const POSES = {
    left:  { yaw: -27, pitch: 1,   roll: 2.5 },
    front: { yaw: 0,   pitch: 0,   roll: 0 },
    low:   { yaw: 12,  pitch: 14,  roll: -3 },
    right: { yaw: 28,  pitch: -2,  roll: -1.5 },
  };

  // valeurs courantes (S) et cibles (T)
  const S = { yaw: 0, pitch: 0, roll: 0, gx: 0, gy: 0, smile: 0.12, brow: 0, frown: 0, open: 0, glasses: 0 };
  const T = { ...S };

  let expression = 'neutre';
  let glassesDown = false;
  let mode = 'follow';            // 'follow' | 'pose'
  let lastPointer = -10;          // instant du dernier mouvement de souris (s)
  let wander = { at: 0, yaw: 0, pitch: 0, gx: 0, gy: 0 };
  let blink = { next: 1.2, start: -1, double: false };
  let wink = -10;
  let nod = -10, shake = -10;
  let glint = { start: 1.5, next: 6 };
  let reaction = -10;

  // parole
  let talking = false, talkPulse = 0, talkEnd = Infinity, speechStarted = false;
  let fullText = '', shownChars = 0, talkStart = 0, simulated = false, bubbleHideTimer = 0, fallbackTimer = 0;

  let now = performance.now() / 1000;
  let last = now;

  /* =======================================================
     4. GÉOMÉTRIE DYNAMIQUE (yeux, bouche)
     ======================================================= */
  function eyeGeometry(e, open, squint) {
    const [ox, oy] = e.outer, [ix, iy] = e.inner;
    const dx = ix - ox, my = (oy + iy) / 2;
    const ly = 24 - 7 * squint;                  // paupière inférieure
    const uy = lerp(ly, -34, open);              // paupière supérieure (fermée = collée à l'inférieure)
    const P = (k, yy) => `${f(ox + dx * k)} ${f(my + yy)}`;
    const upper = `M ${ox} ${oy} C ${P(0.28, uy)} ${P(0.72, uy * 0.92)} ${ix} ${iy}`;
    const shape = `${upper} C ${P(0.72, ly)} ${P(0.28, ly)} ${ox} ${oy} Z`;
    const lower = `M ${ix} ${iy} C ${P(0.72, ly)} ${P(0.28, ly)} ${ox} ${oy}`;
    const cu = lerp(ly - 8, -50, open);
    const crease = `M ${P(0.1, cu * 0.45 - 6)} C ${P(0.32, cu)} ${P(0.68, cu * 0.95)} ${P(0.95, cu * 0.4 - 5)}`;
    const sgn = dx > 0 ? 1 : -1;
    const lash = `M ${f(ox + sgn * 3)} ${f(oy - 1)} q ${f(-sgn * 9)} ${f(-3 - 3 * open)} ${f(-sgn * 15)} ${f(-1 - 2 * open)}`;
    return { shape, upper, lower, crease, lash, cx: (ox + ix) / 2, cy: my };
  }

  function updateEyes(closeL, closeR, squint) {
    for (const e of eyes) {
      const close = e.side === 'L' ? closeL : closeR;
      const open = clamp(1 - close, 0, 1) * (1 - 0.16 * Math.max(0, squint)) + 0.12 * Math.max(0, S.brow) * (1 - close);
      const g = eyeGeometry(e, clamp(open, 0, 1.1), Math.max(0, squint));
      e.white.setAttribute('d', g.shape);
      e.clip.setAttribute('d', g.shape);
      e.lidShadow.setAttribute('d', g.upper);
      e.lid.setAttribute('d', g.upper);
      e.lower.setAttribute('d', g.lower);
      e.crease.setAttribute('d', g.crease);
      e.lash.setAttribute('d', g.lash);
      const ix = g.cx + S.gx * 13 + (e.side === 'L' ? 2 : -2);
      const iy = g.cy + 1 + S.gy * 6;
      e.iris.setAttribute('transform', `translate(${f(ix)} ${f(iy)})`);
    }
  }

  function updateMouth(open, smile) {
    const cy = 690;
    const w = 74 + smile * 5 - open * 6;
    const cyc = cy + 4 - smile * 13 + open * 3;
    const Lx = 500 - w, Rx = 500 + w;
    const sp = Math.max(0, smile) * 2;
    const uY = cy + 6 - open * 5 + sp;
    const lY = cy + 6 + open * 30 + sp;
    const top = cy - 26 - open * 4;
    const dip = cy - 17 - open * 4;
    const bot = cy + 43 + open * 30 - smile * 2;
    const L = `${f(Lx)} ${f(cyc)}`, R = `${f(Rx)} ${f(cyc)}`;

    const upperInner = `C ${f(Rx - 26)} ${f(uY)} 524 ${f(uY)} 500 ${f(uY)} C 476 ${f(uY)} ${f(Lx + 26)} ${f(uY)} ${L}`;
    el.upperLip.setAttribute('d',
      `M ${L} C ${f(Lx + 22)} ${f(cyc - 8)} 474 ${f(top)} 488 ${f(top)} Q 500 ${f(dip)} 512 ${f(top)}` +
      ` C 526 ${f(top)} ${f(Rx - 22)} ${f(cyc - 8)} ${R} ${upperInner} Z`);
    el.lowerLip.setAttribute('d',
      `M ${L} C ${f(Lx + 26)} ${f(lY)} 476 ${f(lY)} 500 ${f(lY)} C 524 ${f(lY)} ${f(Rx - 26)} ${f(lY)} ${R}` +
      ` C ${f(Rx - 12)} ${f(bot - 12)} 532 ${f(bot)} 500 ${f(bot)} C 468 ${f(bot)} ${f(Lx + 12)} ${f(bot - 12)} ${L} Z`);
    const inside = `M ${L} C ${f(Lx + 26)} ${f(uY)} 476 ${f(uY)} 500 ${f(uY)} C 524 ${f(uY)} ${f(Rx - 26)} ${f(uY)} ${R}` +
      ` C ${f(Rx - 26)} ${f(lY)} 524 ${f(lY)} 500 ${f(lY)} C 476 ${f(lY)} ${f(Lx + 26)} ${f(lY)} ${L} Z`;
    el.mouthInside.setAttribute('d', inside);
    el.mouthClip.setAttribute('d', inside);
    el.mouthLine.setAttribute('d', inside);
    const th = Math.min(1, open * 2.4) * 9;
    el.teeth.setAttribute('d', `M ${f(Lx + 18)} ${f(uY - 3)} L ${f(Rx - 18)} ${f(uY - 3)} L ${f(Rx - 22)} ${f(uY + th)} L ${f(Lx + 22)} ${f(uY + th)} Z`);
    el.tongue.setAttribute('cy', f(lY - 2));
    el.tongue.setAttribute('ry', f(open * 11));
    el.lipHighlight.setAttribute('cy', f(lY + (bot - lY) * 0.45));
    const hy = (uY + top) / 2 + 2;
    el.upperLipHl.setAttribute('d', `M ${f(486)} ${f(hy - 3)} Q 500 ${f(hy + 1)} ${f(514)} ${f(hy - 3)}`);
    const sy2 = lY + 4;
    el.lowerLipShade.setAttribute('d', `M ${f(Lx + 20)} ${f(sy2 - 1)} C 470 ${f(sy2 + 3)} 530 ${f(sy2 + 3)} ${f(Rx - 20)} ${f(sy2 - 1)}`);
    el.lipShadow.setAttribute('cy', f(bot + 9));
    el.soulPatch.setAttribute('transform', `translate(0 ${f(open * 30 - smile * 2)})`);
    el.dimpleL.setAttribute('d', `M ${f(Lx - 3)} ${f(cyc - 7)} Q ${f(Lx - 9)} ${f(cyc)} ${f(Lx - 3)} ${f(cyc + 7)}`);
    el.dimpleR.setAttribute('d', `M ${f(Rx + 3)} ${f(cyc - 7)} Q ${f(Rx + 9)} ${f(cyc)} ${f(Rx + 3)} ${f(cyc + 7)}`);
    const fo = (0.22 + 0.4 * Math.max(0, smile)).toFixed(2);
    el.foldL.setAttribute('d', `M 448 642 C 432 656 ${f(Lx - 6)} ${f(cyc - 26)} ${f(Lx - 7)} ${f(cyc - 6)}`);
    el.foldR.setAttribute('d', `M 552 642 C 568 656 ${f(Rx + 6)} ${f(cyc - 26)} ${f(Rx + 7)} ${f(cyc - 6)}`);
    el.foldL.setAttribute('opacity', fo);
    el.foldR.setAttribute('opacity', fo);
  }

  /* =======================================================
     5. PROJECTION 2,5D
     ======================================================= */
  const XC = 500, YC = 480;
  function layer(z, yaw, pitch) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    // x' = XC + (x - XC)·cos(lacet) + z·sin(lacet) ; y' = YC + (y - YC)·cos(tangage) − z·sin(tangage)
    return [cy, cp, XC - XC * cy + z * sy, YC - YC * cp - z * sp];
  }
  const mstr = (m) => `matrix(${m[0].toFixed(4)} 0 0 ${m[1].toFixed(4)} ${f(m[2])} ${f(m[3])})`;
  const apply = (m, x, y) => [m[0] * x + m[2], m[1] * y + m[3]];

  function setArm(a, d) {
    a.querySelector('.arm-body').setAttribute('d', d);
    a.querySelector('.arm-hl').setAttribute('d', d);
  }

  /* =======================================================
     6. BOUCLE D'ANIMATION
     ======================================================= */
  const smooth = (k, dt) => 1 - Math.exp(-k * dt);
  const easeBell = (p) => Math.sin(Math.PI * clamp(p, 0, 1));

  function frame(ms) {
    now = ms / 1000;
    const dt = Math.min(0.05, Math.max(0, now - last));
    last = now;

    /* --- cibles de la tête --- */
    const idle = now - lastPointer > 4;
    if (mode === 'follow' && idle) {
      if (now > wander.at) {
        const r = Math.random;
        wander = {
          at: now + 1.4 + r() * 2.4,
          yaw: (r() - 0.5) * 30, pitch: (r() - 0.5) * 12,
          gx: (r() - 0.5) * 1.6, gy: (r() - 0.5) * 0.9,
        };
        if (Math.random() < 0.25) wander.yaw = wander.pitch = wander.gx = wander.gy = 0;
      }
      T.yaw = wander.yaw; T.pitch = wander.pitch; T.roll = -wander.yaw * 0.06;
      T.gx = wander.gx; T.gy = wander.gy;
    }

    /* --- expression --- */
    const ex = EXPRESSIONS[expression];
    T.smile = ex.smile; T.brow = ex.brow; T.frown = ex.frown;
    let openTarget = ex.open;
    T.glasses = glassesDown ? 1 : 0;
    if (glassesDown) { T.brow = Math.max(T.brow, 0.2); }

    // réaction au clic
    const rt = now - reaction;
    if (rt < 1.6) { T.smile = Math.max(T.smile, 0.9); T.brow = Math.max(T.brow, 0.5 * easeBell(rt / 1.6)); }

    // clin d'œil
    const wt = now - wink;
    let winkClose = 0;
    if (wt < 0.75) {
      winkClose = wt < 0.12 ? wt / 0.12 : wt < 0.5 ? 1 : 1 - (wt - 0.5) / 0.25;
      T.smile = Math.max(T.smile, 0.75);
    }

    // parole
    if (talking) {
      talkPulse *= Math.exp(-dt * 7);
      const n = 0.5 + 0.5 * Math.sin(now * 17.3) * Math.sin(now * 5.1 + 1.3);
      const m = 0.5 + 0.5 * Math.sin(now * 11.7 + 0.7);
      openTarget = clamp(0.12 + 0.55 * n * m + 0.45 * talkPulse, 0, 1);
      if (simulated) {
        const p = clamp((now - talkStart) / (talkEnd - talkStart), 0, 1);
        revealTo(Math.ceil(fullText.length * p));
        if (now >= talkEnd) endTalk();
        else if (Math.random() < dt * 9) talkPulse = 1;
      }
    }

    /* --- lissage (ressorts amortis) --- */
    const kHead = mode === 'pose' ? 4 : 6;
    S.yaw += (T.yaw - S.yaw) * smooth(kHead, dt);
    S.pitch += (T.pitch - S.pitch) * smooth(kHead, dt);
    S.roll += (T.roll - S.roll) * smooth(kHead, dt);
    S.gx += (T.gx - S.gx) * smooth(14, dt);
    S.gy += (T.gy - S.gy) * smooth(14, dt);
    S.smile += (T.smile - S.smile) * smooth(8, dt);
    S.brow += (T.brow - S.brow) * smooth(9, dt);
    S.frown += (T.frown - S.frown) * smooth(8, dt);
    S.glasses += (T.glasses - S.glasses) * smooth(7, dt);
    S.open += (openTarget - S.open) * smooth(talking ? 22 : 10, dt);

    /* --- micro-mouvements vivants --- */
    const amp = reduceMotion ? 0.3 : 1;
    const breath = Math.sin(now * 2 * Math.PI / 4.2);
    let yawD = S.yaw + amp * 1.6 * Math.sin(now * 0.7);
    let pitchD = S.pitch + amp * 1.1 * Math.sin(now * 0.93 + 1) + breath * 0.5;
    let rollD = S.roll + amp * 0.9 * Math.sin(now * 0.51 + 2);
    const nt = now - nod;
    if (nt < 1.5) pitchD += -10 * Math.sin(2 * Math.PI * 2.1 * nt) * Math.exp(-2.4 * nt);
    const st = now - shake;
    if (st < 1.6) yawD += 16 * Math.sin(2 * Math.PI * 1.9 * st) * Math.exp(-2.1 * st);
    if (talking) { pitchD += 1.2 * Math.sin(now * 6.3); rollD += 0.8 * Math.sin(now * 3.7); }

    const yaw = clamp(yawD, -34, 34) * DEG;
    const pitch = clamp(pitchD, -20, 20) * DEG;

    /* --- clignements --- */
    let blinkClose = 0;
    if (blink.start < 0 && now > blink.next) { blink.start = now; }
    if (blink.start >= 0) {
      const p = (now - blink.start) / 0.17;
      blinkClose = p < 0.45 ? p / 0.45 : 1 - (p - 0.45) / 0.55;
      if (p >= 1) {
        blink.start = -1;
        if (!blink.double && Math.random() < 0.18) { blink.double = true; blink.next = now + 0.12; }
        else { blink.double = false; blink.next = now + 2.2 + Math.random() * 3.8; }
      }
    }
    blinkClose = clamp(blinkClose, 0, 1);

    /* --- application --- */
    el.body.setAttribute('transform', `translate(500 1000) scale(1 ${f(1 + 0.007 * breath)}) translate(-500 -1000)`);
    const headY = -4 * breath;
    el.head.setAttribute('transform', `translate(0 ${f(headY)}) rotate(${f(rollD)} 500 760)`);

    for (const L of zLayers) L.n.setAttribute('transform', mstr(layer(L.z, yaw, pitch)));

    // oreilles : celle du côté visible s'élargit, l'autre passe derrière la joue
    const sy = Math.sin(yaw);
    const sL = clamp(sy > 0 ? 1 + 0.6 * sy : 1 + 1.7 * sy, 0.06, 1.4);
    const sR = clamp(sy < 0 ? 1 - 0.6 * sy : 1 - 1.7 * sy, 0.06, 1.4);
    const mEar = layer(-60, yaw, pitch);
    el.earL.setAttribute('transform', `${mstr(mEar)} translate(296 0) scale(${f(sL)} 1) translate(-296 0)`);
    el.earR.setAttribute('transform', `${mstr(mEar)} translate(704 0) scale(${f(sR)} 1) translate(-704 0)`);

    // ombre portée de la mâchoire sur le cou
    el.jawShadow.setAttribute('transform', `translate(0 ${f(headY)}) rotate(${f(rollD)} 500 760) ${mstr(layer(10, yaw, pitch))}`);

    // pommettes qui remontent avec le sourire
    const cheekUp = -7 * Math.max(0, S.smile);
    el.cheekL.setAttribute('cy', f(600 + cheekUp));
    el.cheekR.setAttribute('cy', f(598 + cheekUp));

    // lunettes : relevées sur le front (verre vu en biais → écrasé verticalement)
    const gd = S.glasses;
    const gSy = 1 - 0.42 * gd, gSx = 1 - 0.03 * gd, gTy = -212 * gd;
    el.glassesRig.setAttribute('transform', `translate(0 ${f(gTy)}) translate(500 497) scale(${gSx.toFixed(4)} ${gSy.toFixed(4)}) translate(-500 -497)`);
    for (const sh of el.lensShadows) sh.setAttribute('opacity', f(0.32 * (1 - gd)));

    // branches des lunettes : de la charnière à l'oreille
    const mG = layer(120, yaw, pitch);
    const mE = mEar;
    const hingeY = 497 + (446 - 497) * gSy + gTy;
    for (const side of ['L', 'R']) {
      const hx = 500 + ((side === 'L' ? 256 : 744) - 500) * gSx;
      const ex = side === 'L' ? 296 : 704;
      const [ax, ay] = apply(mG, hx, hingeY);
      const [bx, by] = apply(mE, ex, 474);
      const d = `M ${f(ax)} ${f(ay)} L ${f(bx)} ${f(by)}`;
      const visibleSide = side === 'L' ? yaw > 8 * DEG : yaw < -8 * DEG;
      setArm(arms[side].front, visibleSide ? d : '');
      setArm(arms[side].back, visibleSide ? '' : d);
    }

    // reflet qui balaie les verres
    if (now > glint.next) { glint.start = now; glint.next = now + 6 + Math.random() * 5; }
    const gp = (now - glint.start) / 0.9;
    const gx = gp >= 0 && gp <= 1 ? lerp(250, 790, gp * gp * (3 - 2 * gp)) : -200;
    for (const g of el.glints) g.setAttribute('transform', `translate(${f(gx)} 0)`);

    // sourcils
    const browUp = -S.brow * 11 + S.frown * 5;
    const browRot = S.frown * 7 - S.brow * 2.5;
    const winkBrow = winkClose * 5;
    el.browL.setAttribute('transform', `translate(0 ${f(browUp + winkBrow)}) rotate(${f(browRot + winkClose * 3)} 392 424)`);
    el.browR.setAttribute('transform', `translate(0 ${f(browUp - winkClose * 3)}) rotate(${f(-browRot)} 608 424)`);

    // yeux & bouche
    updateEyes(Math.max(blinkClose, winkClose), blinkClose, S.smile * 0.9 + winkClose * 0.3);
    updateMouth(S.open, S.smile - S.frown * 0.15 + winkClose * 0.15);

    requestAnimationFrame(frame);
  }

  /* =======================================================
     7. INTERACTIONS
     ======================================================= */
  function onPointer(e) {
    if (!el.follow.checked) return;
    const r = el.svg.getBoundingClientRect();
    const hx = r.left + r.width * 0.5;
    const hy = r.top + r.height * 0.48;
    const dx = clamp((e.clientX - hx) / Math.max(320, window.innerWidth * 0.5), -1, 1);
    const dy = clamp((e.clientY - hy) / Math.max(320, window.innerHeight * 0.5), -1, 1);
    mode = 'follow';
    lastPointer = performance.now() / 1000;
    T.yaw = dx * 27;
    T.pitch = -dy * 14;
    T.roll = -dx * 2.5;
    T.gx = clamp(dx * 1.7, -1, 1);
    T.gy = clamp(dy * 1.7, -1, 1);
    el.hint.classList.add('hide');
  }
  window.addEventListener('pointermove', onPointer, { passive: true });
  window.addEventListener('pointerdown', onPointer, { passive: true });

  el.stage.addEventListener('click', () => {
    reaction = performance.now() / 1000;
    nod = reaction;
    el.hint.classList.add('hide');
  });

  function setExpression(name) {
    expression = name;
    document.querySelectorAll('[data-expr]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.expr === name)));
  }
  function toggleGlasses(force) {
    glassesDown = typeof force === 'boolean' ? force : !glassesDown;
    const b = document.querySelector('[data-act="glasses"]');
    b.setAttribute('aria-pressed', String(glassesDown));
    b.textContent = glassesDown ? 'Remettre les lunettes' : 'Relever les lunettes';
  }
  function doAction(name) {
    const t = performance.now() / 1000;
    if (name === 'wink') wink = t;
    else if (name === 'glasses') toggleGlasses();
    else if (name === 'nod') nod = t;
    else if (name === 'shake') shake = t;
    else if (name === 'glint') glint.next = t;
  }
  function setPose(name) {
    const p = POSES[name];
    mode = 'pose';
    el.follow.checked = false;
    T.yaw = p.yaw; T.pitch = p.pitch; T.roll = p.roll;
    T.gx = clamp(p.yaw / 25, -1, 1) * 0.6;
    T.gy = -p.pitch / 20;
    document.querySelectorAll('[data-pose]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.pose === name)));
  }

  document.querySelectorAll('[data-expr]').forEach((b) => b.addEventListener('click', () => setExpression(b.dataset.expr)));
  document.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => doAction(b.dataset.act)));
  document.querySelectorAll('[data-pose]').forEach((b) => b.addEventListener('click', () => setPose(b.dataset.pose)));
  el.follow.addEventListener('change', () => {
    if (el.follow.checked) {
      mode = 'follow';
      lastPointer = -10;
      document.querySelectorAll('[data-pose]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    }
  });

  /* --- Parole : synthèse vocale du navigateur + bouche animée --- */
  const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
  let voices = [];
  const loadVoices = () => { voices = synth ? synth.getVoices() : []; };
  if (synth) { loadVoices(); synth.addEventListener?.('voiceschanged', loadVoices); }
  const pickVoice = () => voices.find((v) => /^fr(-|_)FR/i.test(v.lang)) || voices.find((v) => /^fr/i.test(v.lang)) || null;

  function revealTo(n) {
    n = clamp(n, 0, fullText.length);
    if (n <= shownChars) return;
    shownChars = n;
    el.bubbleText.textContent = fullText.slice(0, n);
  }
  function startSimulation() {
    simulated = true;
    talkStart = performance.now() / 1000;
    talkEnd = talkStart + Math.max(1.4, fullText.length * 0.065);
  }
  function speak(text) {
    text = text.trim();
    if (!text) return;
    stopTalk(true);
    fullText = text;
    shownChars = 0;
    el.bubbleText.textContent = '';
    el.bubble.classList.add('show');
    clearTimeout(bubbleHideTimer);
    talking = true;
    talkPulse = 1;
    speechStarted = false;
    simulated = false;

    const voice = pickVoice();
    if (synth && el.voice.checked && voice) {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = voice.lang;
      u.voice = voice;
      u.rate = 1.02;
      u.pitch = 0.85;
      u.onstart = () => { speechStarted = true; };
      u.onboundary = (e) => {
        speechStarted = true;
        talkPulse = 1;
        if (typeof e.charIndex === 'number') revealTo(e.charIndex + (e.charLength || 1));
      };
      u.onend = () => { revealTo(fullText.length); endTalk(); };
      u.onerror = () => { if (talking && !simulated) startSimulation(); };
      synth.speak(u);
      // si la voix ne démarre pas (navigateur sans voix), on simule
      fallbackTimer = setTimeout(() => { if (talking && !speechStarted) { synth.cancel(); startSimulation(); } }, 1500);
    } else {
      startSimulation();
    }
  }
  function endTalk() {
    talking = false;
    simulated = false;
    talkEnd = Infinity;
    clearTimeout(fallbackTimer);
    revealTo(fullText.length);
    clearTimeout(bubbleHideTimer);
    bubbleHideTimer = setTimeout(() => el.bubble.classList.remove('show'), 2200);
  }
  function stopTalk(silent) {
    if (synth) synth.cancel();
    clearTimeout(fallbackTimer);
    talking = false;
    simulated = false;
    talkEnd = Infinity;
    if (!silent) { clearTimeout(bubbleHideTimer); el.bubble.classList.remove('show'); }
  }
  $('#sayBtn').addEventListener('click', () => speak(el.sayText.value));
  $('#stopBtn').addEventListener('click', () => stopTalk(false));

  /* --- Raccourcis clavier --- */
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) speak(el.sayText.value);
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 's') setExpression(expression === 'sourire' ? 'neutre' : 'sourire');
    else if (k === 'w') doAction('wink');
    else if (k === 'l') doAction('glasses');
    else if (k === 'o') doAction('nod');
    else if (k === 'n') doAction('shake');
    else if (k === 'p') speak(el.sayText.value);
  });

  /* --- API publique (pratique pour piloter le personnage depuis la console ou un montage vidéo) --- */
  window.personnage = {
    expression: setExpression,
    pose: setPose,
    action: doAction,
    lunettes: toggleGlasses,
    parler: speak,
    stop: () => stopTalk(false),
    suivre: (on = true) => { el.follow.checked = on; el.follow.dispatchEvent(new Event('change')); },
  };

  requestAnimationFrame(frame);
})();
