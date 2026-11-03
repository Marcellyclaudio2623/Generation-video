/* =========================================================
   Personnage animé — moteur d'animation
   ---------------------------------------------------------
   Principe « 2,5D » : chaque partie du visage est un calque
   placé à une profondeur z. Quand la tête tourne (lacet) ou
   lève/baisse le menton (tangage), chaque calque est projeté
   selon sa profondeur : le nez (z élevé) se déplace plus que
   les oreilles (z négatif). Cela donne l'illusion de volume
   sans moteur 3D.
   Les textures fines (boucles, barbe, sourcils, moustache)
   sont peintes une seule fois dans des <canvas>, puis
   insérées dans le SVG : beaucoup de détail, peu de calcul
   à chaque image.
   ========================================================= */
(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const f = (n) => (Math.round(n * 100) / 100).toString();
  const DEG = Math.PI / 180;
  const TAU = Math.PI * 2;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Générateur pseudo-aléatoire déterministe (même dessin à chaque chargement) */
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

  /* Test « point dans une forme » (coordonnées SVG) */
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

  /* Trace des poils courts dans une zone (barbe, moustache) */
  function hairs(ctx, r, count, box, test, angleOf, lenMin, lenVar, alphaOf, widthMin = 0.9, widthVar = 0.7) {
    let n = 0;
    for (let i = 0; i < count * 10 && n < count; i++) {
      const x = box.x + r() * box.w;
      const y = box.y + r() * box.h;
      if (!test(x, y)) continue;
      n++;
      const al = alphaOf(x, y, r);
      if (al <= 0.02) continue;
      const ang = angleOf(x, y) + (r() - 0.5) * 0.6;
      const len = lenMin + r() * lenVar;
      ctx.strokeStyle = `rgba(20,11,7,${al.toFixed(3)})`;
      ctx.lineWidth = widthMin + r() * widthVar;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(
        x + Math.cos(ang) * len * 0.5 + Math.cos(ang + 1.57) * 0.8, y + Math.sin(ang) * len * 0.5 + Math.sin(ang + 1.57) * 0.8,
        x + Math.cos(ang) * len, y + Math.sin(ang) * len);
      ctx.stroke();
    }
  }

  /* =======================================================
     1. CHEVEUX
     ======================================================= */

  /* Silhouette : couronne bosselée (boucles) + ligne frontale arrondie
     (cotes : front à y≈242 au centre, coins arrondis, tempes à x≈310/690) */
  function buildHair() {
    const r = rng(11);
    const cx = 500, cy = 350, rx = 258, ry = 250;
    const a0 = Math.PI - 0.05, a1 = TAU + 0.05;
    const N = 21;
    const pts = [];
    for (let i = 0; i <= N; i++) {
      const edge = i === 0 || i === N;
      let t = i / N;
      if (!edge) t += (r() - 0.5) * 0.4 / N;
      const a = a0 + (a1 - a0) * t;
      const wob = edge ? 0 : (r() - 0.5) * 8;
      pts.push([cx + (rx + wob) * Math.cos(a), cy + (ry + wob) * Math.sin(a)]);
    }
    const bumps = [];
    let d = `M ${f(pts[0][0])} ${f(pts[0][1])}`;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const c = Math.hypot(x1 - x0, y1 - y0);
      const rad = c * (0.6 + r() * 0.14);
      d += ` A ${f(rad)} ${f(rad)} 0 0 1 ${f(x1)} ${f(y1)}`;
      // centre du cercle de la bosse (à l'intérieur de la tête)
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      const dx = (x1 - x0) / c, dy = (y1 - y0) / c;
      const h = Math.sqrt(Math.max(0, rad * rad - (c / 2) * (c / 2)));
      bumps.push({ x0, y0, x1, y1, rad, cx: mx - dy * h, cy: my + dx * h });
    }
    // côté droit (dégradé), favori, ligne frontale arrondie, côté gauche
    d += ' C 754 382 742 402 734 420 L 724 470 L 716 505 L 704 505 L 716 420' +
         ' C 708 402 700 388 694 372 C 690 350 688 320 684 300 C 680 284 664 270 636 264' +
         ' C 600 254 560 244 500 242 C 440 244 400 254 364 264 C 336 270 320 284 316 300' +
         ' C 312 320 310 350 306 372 C 300 388 292 402 284 420 L 296 505 L 284 505 L 276 470' +
         ' L 266 420 C 258 402 246 382 242 362 Z';
    return { d, bumps };
  }

  const hair = buildHair();
  const hairPath = new Path2D(hair.d);
  $('#hairBase').setAttribute('d', hair.d);
  $('#hairLine').setAttribute('d', hair.d);

  /* Brillance : plus forte en haut à gauche (lumière) et sur le sommet */
  function sheenAt(x, y) {
    const a = Math.exp(-(((x - 420) / 150) ** 2 + ((y - 165) / 80) ** 2));
    const b = 0.6 * Math.exp(-(((x - 300) / 70) ** 2 + ((y - 260) / 90) ** 2));
    let s = 0.18 + 0.82 * Math.max(a, b);
    if (y > 330) s *= clamp(1 - (y - 330) / 60, 0.2, 1);
    return s;
  }

  /* Texture : boucles en « rubans » enroulés, cernés de noir, avec reflets gris */
  const hairBox = { x: 225, y: 85, w: 550, h: 440 };
  placeImage('#hairTex', hairBox, paint(hairBox, (ctx) => {
    ctx.save();
    ctx.clip(hairPath);
    ctx.fillStyle = '#060606';
    ctx.fillRect(hairBox.x, hairBox.y, hairBox.w, hairBox.h);

    const r = rng(23);
    const curls = [];
    const step = 14.5;
    let row = 0;
    for (let y = 88; y < 410; y += step * 0.78, row++) {
      for (let x = 228 + (row % 2) * step * 0.5; x < 775; x += step) {
        const px = x + (r() - 0.5) * step * 0.8;
        const py = y + (r() - 0.5) * step * 0.7;
        if (!inside(hairPath, px, py)) continue;
        if (py > 395) continue;
        const rx = 9 + r() * 6;
        curls.push({
          x: px, y: py, rx, ry: rx * (0.55 + r() * 0.35),
          rot: r() * Math.PI, a0: r() * TAU, sw: 3.3 + r() * 2.4,
          w: 4.4 + r() * 2, hl: r(),
        });
      }
    }
    curls.sort((p, q) => p.y - q.y);
    ctx.lineCap = 'round';
    for (const c of curls) {
      const s = sheenAt(c.x, c.y);
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.rot);
      ctx.beginPath();
      ctx.ellipse(0, 0, c.rx, c.ry, 0, c.a0, c.a0 + c.sw);
      ctx.strokeStyle = '#000';
      ctx.lineWidth = c.w + 4;
      ctx.stroke();
      const g = Math.round(22 + s * 26);
      ctx.strokeStyle = `rgb(${g},${g},${g + 1})`;
      ctx.lineWidth = c.w;
      ctx.stroke();
      if (c.hl < 0.1 + 0.62 * s) {
        const st = c.a0 + c.sw * (0.12 + 0.2 * ((c.hl * 7) % 1));
        ctx.beginPath();
        ctx.ellipse(0, 0, c.rx - 0.6, c.ry - 0.6, 0, st, st + c.sw * 0.28);
        ctx.strokeStyle = `rgba(200,200,204,${(0.35 + 0.6 * s).toFixed(3)})`;
        ctx.lineWidth = 1.5 + s * 1.2;
        ctx.stroke();
        // point de brillance (éclat blanc) sur les boucles les plus exposées
        if (s > 0.5 && c.hl < 0.2) {
          const m = st + c.sw * 0.14;
          ctx.fillStyle = 'rgba(255,255,255,.9)';
          ctx.beginPath();
          ctx.ellipse((c.rx - 0.6) * Math.cos(m), (c.ry - 0.6) * Math.sin(m), 1.9, 1.1, m + Math.PI / 2, 0, TAU);
          ctx.fill();
        }
      }
      ctx.restore();
    }

    // trames grises (halftone) sur le dessus, comme sur l'illustration
    ctx.globalCompositeOperation = 'lighten';
    const patches = [[330, 190, 42, 32], [462, 140, 46, 24], [565, 160, 52, 34], [640, 185, 32, 22], [282, 300, 22, 40]];
    for (const [px, py, prx, pry] of patches) {
      for (let y = py - pry; y <= py + pry; y += 6) {
        for (let x = px - prx; x <= px + prx; x += 6) {
          const xx = x + ((Math.round(y / 6)) % 2) * 3;
          const k = ((xx - px) / prx) ** 2 + ((y - py) / pry) ** 2;
          if (k > 1) continue;
          ctx.fillStyle = 'rgb(78,78,80)';
          ctx.beginPath();
          ctx.arc(xx, y, 2.1 * (1 - k * 0.4), 0, TAU);
          ctx.fill();
        }
      }
    }
    ctx.globalCompositeOperation = 'source-over';

    // reflets sur le bord des boucles extérieures (côté lumière : gauche et dessus)
    ctx.lineCap = 'round';
    for (const b of hair.bumps) {
      const mx = (b.x0 + b.x1) / 2;
      if (mx > 640) continue;
      let s0 = Math.atan2(b.y0 - b.cy, b.x0 - b.cx);
      let s1 = Math.atan2(b.y1 - b.cy, b.x1 - b.cx);
      if (s1 < s0) s1 += TAU;
      const k = mx < 470 ? 0.75 : 0.45;
      ctx.beginPath();
      ctx.arc(b.cx, b.cy, b.rad - 4, s0 + (s1 - s0) * 0.22, s0 + (s1 - s0) * 0.7);
      ctx.strokeStyle = `rgba(150,150,154,${k})`;
      ctx.lineWidth = 2.6;
      ctx.stroke();
    }
    ctx.restore();
  }));

  /* Mèches qui dépassent du contour (boucles libres + quelques cheveux fins) */
  const wispBox = { x: 225, y: 80, w: 550, h: 300 };
  placeImage('#wispTex', wispBox, paint(wispBox, (ctx) => {
    const r = rng(91);
    ctx.lineCap = 'round';
    hair.bumps.forEach((b, i) => {
      const mx = (b.x0 + b.x1) / 2, my = (b.y0 + b.y1) / 2;
      if (my > 330 || r() > 0.6) return;
      const nx = mx - b.cx, ny = my - b.cy, nl = Math.hypot(nx, ny);
      const ax = b.cx + (nx / nl) * (b.rad + 1), ay = b.cy + (ny / nl) * (b.rad + 1);
      const tang = Math.atan2(ny, nx) + Math.PI / 2;
      const s = sheenAt(ax, ay + 20);
      ctx.save();
      ctx.translate(ax + (nx / nl) * 2, ay + (ny / nl) * 2);
      ctx.rotate(tang + (r() - 0.5) * 0.8);
      const rx = 5 + r() * 2.5, ry = 3.5 + r() * 1.8, a0 = Math.PI * (0.9 + r() * 0.3), sw = 3.2 + r() * 1.2;
      ctx.beginPath(); ctx.ellipse(0, -ry * 0.4, rx, ry, 0, a0, a0 + sw);
      ctx.strokeStyle = '#000'; ctx.lineWidth = 5.6; ctx.stroke();
      ctx.strokeStyle = `rgb(${Math.round(24 + s * 24)},${Math.round(24 + s * 24)},${Math.round(25 + s * 24)})`;
      ctx.lineWidth = 2.6; ctx.stroke();
      if (s > 0.35) {
        ctx.beginPath(); ctx.ellipse(0, -ry * 0.4, rx - 0.4, ry - 0.4, 0, a0 + 0.4, a0 + 1.1);
        ctx.strokeStyle = `rgba(200,200,204,${(0.3 + 0.5 * s).toFixed(2)})`; ctx.lineWidth = 1.2; ctx.stroke();
      }
      ctx.restore();
      // cheveux fins isolés
      if (i % 3 === 0) {
        ctx.strokeStyle = 'rgba(0,0,0,.85)';
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        const ox = (nx / nl) * 9, oy = (ny / nl) * 9;
        ctx.bezierCurveTo(ax + ox * 0.4 + 3, ay + oy * 0.4, ax + ox * 0.8 - 3, ay + oy * 0.8, ax + ox, ay + oy);
        ctx.stroke();
      }
    });
  }));

  /* Pointillé du dégradé (fade) sur les tempes */
  const stippleBox = { x: 240, y: 330, w: 520, h: 190 };
  placeImage('#stippleTex', stippleBox, paint(stippleBox, (ctx) => {
    ctx.save();
    ctx.clip(hairPath);
    const r = rng(31);
    for (let i = 0; i < 4200; i++) {
      const x = stippleBox.x + r() * stippleBox.w;
      const y = stippleBox.y + r() * stippleBox.h;
      if (x > 314 && x < 686) continue;
      if (r() > 1 - (y - 340) / 175) continue;
      ctx.fillStyle = `rgba(16,11,8,${(0.4 + r() * 0.5).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, 0.6 + r() * 0.9, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }));

  /* =======================================================
     2. BARBE, MOUSTACHE, SOURCILS
     ======================================================= */
  const faceD = $('#facePath').getAttribute('d');
  const facePath2D = new Path2D(faceD);
  const beardBand = new Path2D(faceD + ' ' + $('#beardInnerPath').getAttribute('d'));

  /* Barbe de quelques jours : hachures le long de la mâchoire, plus denses au bord */
  const stubbleBox = { x: 270, y: 580, w: 460, h: 272 };
  placeImage('#stubbleTex', stubbleBox, paint(stubbleBox, (ctx) => {
    ctx.save();
    ctx.clip(beardBand, 'evenodd');
    const g = ctx.createLinearGradient(0, 590, 0, 846);
    g.addColorStop(0, 'rgba(70,36,22,0)');
    g.addColorStop(0.35, 'rgba(70,36,22,.18)');
    g.addColorStop(1, 'rgba(50,26,16,.34)');
    ctx.fillStyle = g;
    ctx.fillRect(stubbleBox.x, stubbleBox.y, stubbleBox.w, stubbleBox.h);
    // trame régulière (halftone) dans la barbe
    for (let y = 600; y < 850; y += 5) {
      for (let x = 272; x < 730; x += 5) {
        const xx = x + ((y / 5) % 2) * 2.5;
        if (!inside(beardBand, xx, y, 'evenodd')) continue;
        ctx.fillStyle = `rgba(60,30,18,${(0.12 + clamp((y - 600) / 250, 0, 1) * 0.2).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(xx, y, 0.95, 0, TAU); ctx.fill();
      }
    }
    ctx.lineCap = 'round';
    const r = rng(41);
    const ang = (x, y) => Math.atan2(y - 560, x - 500);
    hairs(ctx, r, 1500, stubbleBox,
      (x, y) => inside(beardBand, x, y, 'evenodd'),
      ang, 6, 6,
      (x, y, rr) => {
        const a = ang(x, y);
        const nearEdge = !inside(facePath2D, x + Math.cos(a) * 13, y + Math.sin(a) * 13);
        return clamp((y - 596) / 60, 0, 1) * (nearEdge ? 0.6 + rr() * 0.35 : 0.12 + rr() * 0.3);
      }, 0.7, 0.45);
    ctx.restore();
  }));

  /* Moustache fine (hachures vers le bas et l'extérieur) + liaisons vers le menton */
  const mustacheBox = { x: 380, y: 646, w: 240, h: 112 };
  const mustachePath = new Path2D('M 404 692 C 420 670 450 656 500 652 C 550 656 580 670 596 692 C 580 684 552 674 518 668 L 500 671 L 482 668 C 448 674 420 684 404 692 Z');
  const linkL = new Path2D('M 398 690 C 393 706 392 726 394 748 L 404 748 C 403 728 404 710 410 694 Z');
  const linkR = new Path2D('M 602 690 C 607 706 608 726 606 748 L 596 748 C 597 728 596 710 590 694 Z');
  placeImage('#mustacheTex', mustacheBox, paint(mustacheBox, (ctx) => {
    ctx.lineCap = 'round';
    ctx.save();
    ctx.clip(mustachePath);
    ctx.fillStyle = 'rgba(80,42,26,.16)';
    ctx.fillRect(mustacheBox.x, mustacheBox.y, mustacheBox.w, mustacheBox.h);
    ctx.restore();
    hairs(ctx, rng(53), 240, { x: 400, y: 648, w: 200, h: 46 },
      (x, y) => inside(mustachePath, x, y) && Math.abs(x - 500) > 5,
      (x) => Math.PI / 2 + (500 - x) / 100 * 1.05,
      6.5, 5.5,
      (x, y, rr) => (0.5 + rr() * 0.4) * clamp(0.55 + Math.abs(x - 500) / 90, 0.55, 1),
      0.8, 0.55);
    hairs(ctx, rng(54), 30, { x: 390, y: 688, w: 22, h: 62 },
      (x, y) => inside(linkL, x, y), () => Math.PI / 2 + 0.35, 5, 5,
      (x, y, rr) => 0.3 + rr() * 0.35, 0.7, 0.4);
    hairs(ctx, rng(55), 30, { x: 588, y: 688, w: 22, h: 62 },
      (x, y) => inside(linkR, x, y), () => Math.PI / 2 - 0.35, 5, 5,
      (x, y, rr) => 0.3 + rr() * 0.35, 0.7, 0.4);
  }));

  /* Sourcils épais : texture poil par poil, poils redressés côté nez */
  const browBox = { x: 310, y: 389, w: 156, h: 64 };
  const browPath = new Path2D('M 454 446 C 460 440 459 428 452 420 C 448 417 446 416 444 415 C 414 403 364 401 328 414 C 319 417 318 426 327 428 C 362 425 410 429 454 446 Z');
  const browURL = paint(browBox, (ctx) => {
    ctx.save();
    ctx.fillStyle = '#160e0a';
    ctx.fill(browPath);
    ctx.clip(browPath);
    const r = rng(77);
    ctx.lineCap = 'round';
    for (let i = 0; i < 640; i++) {
      const x = 316 + r() * 146, y = 399 + r() * 49;
      if (!inside(browPath, x, y)) continue;
      const ang = -Math.PI / 2 - (452 - x) / 130 * 1.2 + (r() - 0.5) * 0.35;
      const len = 6 + r() * 7;
      ctx.strokeStyle = r() < 0.72 ? 'rgba(6,4,3,.92)' : 'rgba(105,78,60,.5)';
      ctx.lineWidth = 0.9 + r() * 0.8;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
      ctx.stroke();
    }
    ctx.restore();
    // poils qui dépassent : bord supérieur + tête du sourcil (côté nez)
    const r2 = rng(78);
    ctx.lineCap = 'round';
    for (let i = 0; i < 46; i++) {
      const x = 330 + r2() * 120;
      const y = lerp(414, 405, clamp((x - 330) / 50, 0, 1)) + (x > 420 ? (x - 420) * 0.3 : 0);
      const ang = -Math.PI / 2 - (452 - x) / 130 * 1.2 + (r2() - 0.5) * 0.3;
      ctx.strokeStyle = 'rgba(12,8,6,.75)';
      ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(x, y + 3); ctx.lineTo(x + Math.cos(ang) * 6, y + 3 + Math.sin(ang) * 6); ctx.stroke();
    }
    // tête du sourcil : poils dressés qui débordent du bord arrondi
    for (let i = 0; i < 48; i++) {
      const t = r2();
      const x = 444 + t * 13 + (r2() - 0.5) * 3;
      const y = 418 + t * 22 + (r2() - 0.5) * 4;
      const ang = -Math.PI / 2 + 0.1 + (r2() - 0.5) * 0.6;
      const len = 6 + r2() * 7;
      ctx.strokeStyle = 'rgba(10,6,4,.85)';
      ctx.lineWidth = 1 + r2() * 0.5;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len); ctx.stroke();
    }
  });
  placeImage('#browTexL', browBox, browURL);
  placeImage('#browTexR', browBox, browURL);

  /* =======================================================
     3. RÉFÉRENCES DOM
     ======================================================= */
  const el = {
    stage: $('#stage'), svg: $('#perso'), body: $('#body'), head: $('#head'),
    earL: $('#earL'), earR: $('#earR'), jawShadow: $('#jawShadow'),
    browL: $('#browL'), browR: $('#browR'),
    rigs: document.querySelectorAll('#perso .glasses-rig'),
    lensClips: document.querySelectorAll('#perso .lens-clip-rig'),
    eyeGhost: $('#eyeGhost'),
    glints: document.querySelectorAll('#perso .glint'),
    lensShadows: document.querySelectorAll('#perso .lens-shadow'),
    cheekL: $('#cheekL'), cheekR: $('#cheekR'),
    upperLip: $('#upperLip'), lowerLip: $('#lowerLip'), mouthInside: $('#mouthInside'),
    mouthLine: $('#mouthLine'), mouthClip: $('#mouthClipPath'), teeth: $('#teeth'), tongue: $('#tongue'),
    lipHighlight: $('#lipHighlight'), lipShadow: $('#lipShadow'), lipShadowDots: $('#lipShadowDots'),
    upperLipHl: $('#upperLipHl'), lowerLipShade: $('#lowerLipShade'), lowerLipLine: $('#lowerLipLine'),
    lipSpark: $('#lipSpark'), lipCreases: $('#lipCreases'), teethLines: $('#teethLines'),
    twinkle: $('#twinkle'), motes: $('#motes'),
    cornerL: $('#cornerL'), cornerR: $('#cornerR'),
    foldL: $('#foldL'), foldR: $('#foldR'),
    bubble: $('#bubble'), bubbleText: $('#bubbleText'), hint: $('#hint'),
    follow: $('#follow'), voice: $('#voice'), sayText: $('#sayText'),
  };
  // (les poussières sont ajoutées plus bas, une fois l'état créé)
  const zLayers = [...document.querySelectorAll('#head [data-z]')].map((n) => ({ n, z: +n.dataset.z }));
  const arms = {
    L: { front: $('#armFrontL'), back: $('#armBackL') },
    R: { front: $('#armFrontR'), back: $('#armBackR') },
  };
  /* Copie des yeux affichée PAR-DESSUS les verres, en gris (comme sur l'illustration).
     Une vraie copie DOM plutôt qu'un <use> : les styles CSS s'y appliquent partout. */
  const ghostRig = $('#eyesRig').cloneNode(true);
  ghostRig.id = 'eyesRigG';
  ghostRig.querySelectorAll('[id]').forEach((n) => { n.id += 'G'; });
  el.eyeGhost.appendChild(ghostRig);
  const both = (id) => [$('#' + id), $('#' + id + 'G')];
  const eyes = ['L', 'R'].map((s) => ({
    side: s,
    outer: s === 'L' ? [320, 496] : [680, 496],
    inner: s === 'L' ? [445, 504] : [555, 504],
    clip: $('#eyeClipPath' + s),
    white: both('white' + s), iris: both('iris' + s),
    lidShadow: both('lidShadow' + s), lid: both('lid' + s), lower: both('lower' + s), water: both('water' + s),
    crease: both('crease' + s), bag: both('bag' + s), lash: both('lash' + s),
  }));
  const setD = (pair, d) => { pair[0].setAttribute('d', d); pair[1].setAttribute('d', d); };

  /* =======================================================
     4. ÉTAT DE L'ANIMATION
     ======================================================= */
  const EXPRESSIONS = {
    neutre:  { smile: 0.1,   brow: 0,    frown: 0, open: 0 },
    sourire: { smile: 1,     brow: 0.25, frown: 0, open: 0.05 },
    surpris: { smile: 0,     brow: 1,    frown: 0, open: 0.35 },
    serieux: { smile: -0.35, brow: 0,    frown: 1, open: 0 },
  };
  const POSES = {
    left:  { yaw: -27, pitch: 1,  roll: 2.5 },
    front: { yaw: 0,   pitch: 0,  roll: 0 },
    low:   { yaw: 12,  pitch: 14, roll: -3 },
    right: { yaw: 28,  pitch: -2, roll: -1.5 },
  };

  // valeurs courantes (S) et cibles (T)
  const S = { yaw: 0, pitch: 0, roll: 0, gx: 0, gy: 0, smile: 0.1, brow: 0, frown: 0, open: 0, glasses: 0 };
  const T = { ...S };

  let expression = 'neutre';
  let glassesUp = false;
  let mode = 'follow';            // 'follow' | 'pose'
  let lastPointer = -10;          // instant du dernier mouvement de souris (s)
  let wander = { at: 0, yaw: 0, pitch: 0, gx: 0, gy: 0 };
  const blink = { next: 1.2, start: -1, double: false };
  let wink = -10;
  let nod = -10, shake = -10;
  const glint = { start: 1.5, next: 6 };
  let reaction = -10;

  // parole
  let talking = false, talkPulse = 0, talkEnd = Infinity, speechStarted = false;
  let fullText = '', shownChars = 0, talkStart = 0, simulated = false, bubbleHideTimer = 0, fallbackTimer = 0;

  let now = performance.now() / 1000;
  let last = now;
  let specX = 0;                  // décalage horizontal des reflets (lumière fixe, tête qui tourne)

  // reflets qui glissent sur les surfaces quand la tête tourne
  const specs = [...document.querySelectorAll('#perso .spec')].map((n) => ({ n, sx: +n.dataset.sx, sy: +n.dataset.sy }));

  // scintillement (étoile) sur les verres et la monture
  const twinkle = { next: 3, start: -10, x: 0, y: 0 };
  const TWINKLE_SPOTS = [[326, 467], [563, 467], [272, 437], [489, 441], [339, 462]];

  // poussières en suspension dans la lumière
  const motes = [];
  {
    const r = rng(101);
    for (let i = 0; i < 22; i++) {
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      const m = {
        c, x0: r() * 1000, y0: r() * 1000, v: 6 + r() * 12, amp: 6 + r() * 16,
        w: 0.2 + r() * 0.5, ph: r() * TAU, rad: 1.2 + r() * 2.6,
      };
      c.setAttribute('r', f(m.rad * 2));
      c.setAttribute('fill', 'url(#mote)');
      c.setAttribute('opacity', f(0.1 + r() * 0.25));
      motes.push(m);
    }
  }

  for (const m of motes) el.motes.appendChild(m.c);

  /* =======================================================
     5. GÉOMÉTRIE DYNAMIQUE (yeux, bouche)
     ======================================================= */
  function eyeGeometry(e, open, squint) {
    const [ox, oy] = e.outer, [ix, iy] = e.inner;
    const dx = ix - ox, my = (oy + iy) / 2;
    const ly = 22 - 7 * squint;                  // paupière inférieure
    const uy = lerp(ly, -32, open);              // paupière supérieure (fermée = collée à l'inférieure)
    const P = (k, yy) => `${f(ox + dx * k)} ${f(my + yy)}`;
    const upper = `M ${ox} ${oy} C ${P(0.3, uy)} ${P(0.74, uy * 0.92)} ${ix} ${iy}`;
    const shape = `${upper} C ${P(0.72, ly)} ${P(0.28, ly)} ${ox} ${oy} Z`;
    const lower = `M ${ix} ${iy} C ${P(0.72, ly)} ${P(0.28, ly)} ${ox} ${oy}`;
    const c1 = lerp(ly - 6, -31, open), c2 = lerp(ly - 8, -42, open), c3 = lerp(ly - 6, -22, open);
    const crease = `M ${P(0.1, c1)} C ${P(0.36, c2)} ${P(0.72, c2)} ${P(0.97, c3)}`;
    const bq = -4 * squint;
    const bag = `M ${P(0.52, 30 + bq)} C ${P(0.7, 33 + bq)} ${P(0.86, 28 + bq)} ${P(0.98, 17 + bq)}` +
                ` M ${P(0.05, 22 + bq)} C ${P(0.14, 28 + bq)} ${P(0.24, 31 + bq)} ${P(0.33, 32 + bq)}`;
    const sgn = dx > 0 ? 1 : -1;
    let lash = `M ${f(ox + sgn * 4)} ${f(oy)} q ${f(-sgn * 7)} ${f(1.5 + 1.5 * open)} ${f(-sgn * 13)} ${f(4 + 1.5 * open)}`;
    // cils sur la moitié extérieure de la paupière (vers le haut ouvert, vers le bas fermé)
    const bz = (t, a, b, c, d) => (1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t * t * c + t ** 3 * d;
    const X = [ox, ox + dx * 0.3, ox + dx * 0.74, ix], Y = [oy, my + uy, my + uy * 0.92, iy];
    const up = 0.85 * open - 0.35 * (1 - open);
    for (const [t, len] of [[0.08, 9], [0.17, 8.5], [0.27, 7], [0.38, 5.5]]) {
      const x = bz(t, ...X), y = bz(t, ...Y);
      lash += ` M ${f(x)} ${f(y)} q ${f(-sgn * len * 0.3)} ${f(-len * 0.6 * up)} ${f(-sgn * len * 0.75)} ${f(-len * up + 0.5)}`;
    }
    return { shape, upper, lower, crease, bag, lash, cx: (ox + ix) / 2, cy: my };
  }

  function updateEyes(closeL, closeR, squint) {
    for (const e of eyes) {
      const close = e.side === 'L' ? closeL : closeR;
      const open = clamp(1 - close, 0, 1) * (1 - 0.16 * Math.max(0, squint)) + 0.12 * Math.max(0, S.brow) * (1 - close);
      const g = eyeGeometry(e, clamp(open, 0, 1.1), Math.max(0, squint));
      e.clip.setAttribute('d', g.shape);
      setD(e.white, g.shape);
      setD(e.lidShadow, g.upper);
      setD(e.lid, g.upper);
      setD(e.lower, g.lower);
      setD(e.water, g.lower);
      setD(e.crease, g.crease);
      setD(e.bag, g.bag);
      setD(e.lash, g.lash);
      const ix = g.cx + (e.side === 'L' ? 6.5 : -6.5) + S.gx * 12;
      const iy = g.cy - 9 + S.gy * 6;
      const tr = `translate(${f(ix)} ${f(iy)})`;
      e.iris[0].setAttribute('transform', tr);
      e.iris[1].setAttribute('transform', tr);
    }
  }

  function updateMouth(open, smile) {
    const cy = 699;                                   // ligne de la bouche
    const w = 86 + smile * 5 - open * 7;              // demi-largeur
    const cyc = 701 - smile * 13 + open * 3;          // hauteur des coins
    const Lx = 500 - w, Rx = 500 + w;
    const sp = Math.max(0, smile) * 2;
    const uY = cy - open * 5 + sp;
    const lY = cy + open * 30 + sp;
    const top = 672 - open * 4;                       // sommets de l'arc de Cupidon
    const bot = 736 + open * 30 - smile * 2;          // bas de la lèvre inférieure
    const L = `${f(Lx)} ${f(cyc)}`, R = `${f(Rx)} ${f(cyc)}`;

    const upperInner = `C ${f(Rx - 26)} ${f(uY)} 524 ${f(uY)} 500 ${f(uY)} C 476 ${f(uY)} ${f(Lx + 26)} ${f(uY)} ${L}`;
    el.upperLip.setAttribute('d',
      `M ${L} C ${f(Lx + 50)} ${f(cyc - 2)} 464 ${f(top + 2)} 482 ${f(top)} Q 500 ${f(top + 10)} 518 ${f(top)}` +
      ` C 536 ${f(top + 2)} ${f(Rx - 50)} ${f(cyc - 2)} ${R} ${upperInner} Z`);
    el.lowerLip.setAttribute('d',
      `M ${L} C ${f(Lx + 26)} ${f(lY)} 476 ${f(lY)} 500 ${f(lY)} C 524 ${f(lY)} ${f(Rx - 26)} ${f(lY)} ${R}` +
      ` C ${f(Rx - 6)} ${f(cyc + 20)} 540 ${f(bot)} 500 ${f(bot)} C 460 ${f(bot)} ${f(Lx + 6)} ${f(cyc + 20)} ${L} Z`);
    const mouth = `M ${L} C ${f(Lx + 26)} ${f(uY)} 476 ${f(uY)} 500 ${f(uY)} C 524 ${f(uY)} ${f(Rx - 26)} ${f(uY)} ${R}` +
      ` C ${f(Rx - 26)} ${f(lY)} 524 ${f(lY)} 500 ${f(lY)} C 476 ${f(lY)} ${f(Lx + 26)} ${f(lY)} ${L} Z`;
    el.mouthInside.setAttribute('d', mouth);
    el.mouthClip.setAttribute('d', mouth);
    el.mouthLine.setAttribute('d', mouth);
    const th = Math.min(1, open * 2.4) * 9;
    el.teeth.setAttribute('d', `M ${f(Lx + 18)} ${f(uY - 3)} L ${f(Rx - 18)} ${f(uY - 3)} L ${f(Rx - 22)} ${f(uY + th)} L ${f(Lx + 22)} ${f(uY + th)} Z`);
    el.tongue.setAttribute('cy', f(lY - 2));
    el.tongue.setAttribute('ry', f(open * 11));
    const hlY = lY + (bot - lY) * 0.47;
    el.lipHighlight.setAttribute('cy', f(hlY));
    el.lipSpark.setAttribute('cx', f(470 + specX * 0.5));
    el.lipSpark.setAttribute('cy', f(hlY - 1.5));
    el.lipHighlight.setAttribute('cx', f(478 + specX * 0.5));
    // ridules verticales de la lèvre inférieure
    let cr = '';
    for (const x of [462, 474, 487, 500, 513, 526, 538]) {
      const y0 = lY + 5, y1 = lY + (bot - lY) * (0.55 + (x % 3) * 0.08);
      cr += `M ${x} ${f(y0)} Q ${f(x + 1.5)} ${f((y0 + y1) / 2)} ${f(x + 0.5)} ${f(y1)} `;
    }
    el.lipCreases.setAttribute('d', cr);
    // séparations des dents (visibles bouche ouverte)
    let tl = '';
    for (const x of [462, 481, 500, 519, 538]) tl += `M ${x} ${f(uY - 3)} L ${f(x - 0.5)} ${f(uY + th)} `;
    el.teethLines.setAttribute('d', open > 0.04 ? tl : '');
    const hy = (top + uY) / 2;
    el.upperLipHl.setAttribute('d', `M 489 ${f(hy - 1)} Q 500 ${f(hy + 2)} 511 ${f(hy - 1)}`);
    el.lowerLipShade.setAttribute('d', `M ${f(Lx + 24)} ${f(lY + 4)} C 470 ${f(lY + 8)} 530 ${f(lY + 8)} ${f(Rx - 24)} ${f(lY + 4)}`);
    el.lowerLipLine.setAttribute('d', `M 450 ${f(bot - 8)} C 470 ${f(bot + 1)} 486 ${f(bot + 4)} 500 ${f(bot + 4)} C 514 ${f(bot + 4)} 530 ${f(bot + 1)} 550 ${f(bot - 8)} C 530 ${f(bot - 3)} 514 ${f(bot - 1)} 500 ${f(bot - 1)} C 486 ${f(bot - 1)} 470 ${f(bot - 3)} 450 ${f(bot - 8)} Z`);
    // ombre en croissant sous la lèvre inférieure (avec trame)
    const cres = `M 462 ${f(bot + 1)} C 480 ${f(bot + 14)} 520 ${f(bot + 14)} 538 ${f(bot + 1)} C 520 ${f(bot + 7)} 480 ${f(bot + 7)} 462 ${f(bot + 1)} Z`;
    el.lipShadow.setAttribute('d', cres);
    el.lipShadowDots.setAttribute('d', `M 452 ${f(bot)} C 478 ${f(bot + 22)} 522 ${f(bot + 22)} 548 ${f(bot)} C 522 ${f(bot + 10)} 478 ${f(bot + 10)} 452 ${f(bot)} Z`);
    el.cornerL.setAttribute('cx', f(Lx + 1)); el.cornerL.setAttribute('cy', f(cyc));
    el.cornerR.setAttribute('cx', f(Rx - 1)); el.cornerR.setAttribute('cy', f(cyc));
    const fo = (0.12 + 0.4 * Math.max(0, smile)).toFixed(2);
    el.foldL.setAttribute('d', `M 446 640 C 430 656 ${f(Lx - 4)} ${f(cyc - 28)} ${f(Lx - 5)} ${f(cyc - 6)}`);
    el.foldR.setAttribute('d', `M 554 640 C 570 656 ${f(Rx + 4)} ${f(cyc - 28)} ${f(Rx + 5)} ${f(cyc - 6)}`);
    el.foldL.setAttribute('opacity', fo);
    el.foldR.setAttribute('opacity', fo);
  }

  /* =======================================================
     6. PROJECTION 2,5D
     ======================================================= */
  const XC = 500, YC = 480;
  function layer(z, yaw, pitch) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    // x' = XC + (x − XC)·cos(lacet) + z·sin(lacet) ; y' = YC + (y − YC)·cos(tangage) − z·sin(tangage)
    return [cy, cp, XC - XC * cy + z * sy, YC - YC * cp - z * sp];
  }
  const mstr = (m) => `matrix(${m[0].toFixed(4)} 0 0 ${m[1].toFixed(4)} ${f(m[2])} ${f(m[3])})`;
  const apply = (m, x, y) => [m[0] * x + m[2], m[1] * y + m[3]];

  function setArm(a, d) {
    a.querySelector('.arm-body').setAttribute('d', d);
    a.querySelector('.arm-hl').setAttribute('d', d);
  }

  /* =======================================================
     7. BOUCLE D'ANIMATION
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
    T.glasses = glassesUp ? 1 : 0;
    if (glassesUp) T.brow = Math.max(T.brow, 0.2);

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
    const breath = Math.sin(now * TAU / 4.2);
    let yawD = S.yaw + amp * 1.6 * Math.sin(now * 0.7);
    let pitchD = S.pitch + amp * 1.1 * Math.sin(now * 0.93 + 1) + breath * 0.5;
    let rollD = S.roll + amp * 0.9 * Math.sin(now * 0.51 + 2);
    const nt = now - nod;
    if (nt < 1.5) pitchD += -10 * Math.sin(TAU * 2.1 * nt) * Math.exp(-2.4 * nt);
    const st = now - shake;
    if (st < 1.6) yawD += 16 * Math.sin(TAU * 1.9 * st) * Math.exp(-2.1 * st);
    if (talking) { pitchD += 1.2 * Math.sin(now * 6.3); rollD += 0.8 * Math.sin(now * 3.7); }

    const yaw = clamp(yawD, -34, 34) * DEG;
    const pitch = clamp(pitchD, -20, 20) * DEG;

    /* --- clignements --- */
    let blinkClose = 0;
    if (blink.start < 0 && now > blink.next) blink.start = now;
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

    // reflets : la lumière vient d'en haut à gauche et ne bouge pas → les reflets glissent
    const sYaw = Math.sin(yaw), sPitch = Math.sin(pitch);
    specX = -12 * sYaw;
    for (const sp of specs) sp.n.setAttribute('transform', `translate(${f(sp.sx * sYaw)} ${f(sp.sy * sPitch)})`);

    // étoile de scintillement
    if (now > twinkle.next) {
      const [tx, ty] = TWINKLE_SPOTS[Math.floor(Math.random() * TWINKLE_SPOTS.length)];
      Object.assign(twinkle, { start: now, next: now + 4 + Math.random() * 5, x: tx, y: ty });
    }
    const tp = (now - twinkle.start) / 0.65;
    el.twinkle.setAttribute('transform', tp >= 0 && tp <= 1
      ? `translate(${twinkle.x} ${twinkle.y}) rotate(${f(tp * 60)}) scale(${f(Math.sin(Math.PI * tp) * 0.95)})`
      : 'scale(0)');

    // poussières qui flottent lentement vers le haut
    for (const m of motes) {
      const t = reduceMotion ? 0 : now;
      let y = (m.y0 - t * m.v) % 1040;
      if (y < -20) y += 1040;
      m.c.setAttribute('cx', f(m.x0 + m.amp * Math.sin(t * m.w + m.ph)));
      m.c.setAttribute('cy', f(y));
    }

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
    el.cheekL.setAttribute('cy', f(612 + cheekUp));
    el.cheekR.setAttribute('cy', f(610 + cheekUp));

    // lunettes : relevées sur le front (verres vus en biais → écrasés verticalement)
    const gd = S.glasses;
    const gSy = 1 - 0.42 * gd, gSx = 1 - 0.03 * gd, gTy = -215 * gd;
    const rig = `translate(0 ${f(gTy)}) translate(500 501) scale(${gSx.toFixed(4)} ${gSy.toFixed(4)}) translate(-500 -501)`;
    for (const g of el.rigs) g.setAttribute('transform', rig);
    for (const c of el.lensClips) c.setAttribute('transform', c.classList.contains('mirror') ? `${rig} matrix(-1 0 0 1 1000 0)` : rig);
    // ombre des verres sur les joues : celle du côté qui sort du visage s'efface en 3/4
    const sy2 = Math.sin(yaw);
    el.lensShadows[0].setAttribute('opacity', f(0.3 * (1 - gd) * clamp(1 + sy2 * 2.4, 0, 1)));
    el.lensShadows[1].setAttribute('opacity', f(0.3 * (1 - gd) * clamp(1 - sy2 * 2.4, 0, 1)));
    // yeux vus à travers les verres : décalage de parallaxe entre z=85 (yeux) et z=120 (verres)
    el.eyeGhost.setAttribute('transform', `translate(${f(-35 * Math.tan(yaw))} ${f(35 * Math.tan(pitch))})`);

    // branches des lunettes : de la charnière jusqu'au haut de l'oreille
    const mG = layer(120, yaw, pitch);
    const hingeY = 501 + (450 - 501) * gSy + gTy;
    for (const side of ['L', 'R']) {
      const hx = 500 + ((side === 'L' ? 250 : 750) - 500) * gSx;
      const ex = side === 'L' ? 296 : 704;
      const [ax, ay] = apply(mG, hx, hingeY);
      const [bx, by] = apply(mEar, ex, 482);
      const d = `M ${f(ax)} ${f(ay)} L ${f(bx)} ${f(by)}`;
      const visibleSide = side === 'L' ? yaw > 8 * DEG : yaw < -8 * DEG;
      setArm(arms[side].front, visibleSide ? d : '');
      setArm(arms[side].back, visibleSide ? '' : d);
    }

    // reflet qui balaie les verres
    if (now > glint.next) { glint.start = now; glint.next = now + 6 + Math.random() * 5; }
    const gp = (now - glint.start) / 0.9;
    const gx = gp >= 0 && gp <= 1 ? lerp(250, 800, gp * gp * (3 - 2 * gp)) : -200;
    for (const g of el.glints) g.setAttribute('transform', `translate(${f(gx)} 0)`);

    // sourcils
    const browUp = -S.brow * 11 + S.frown * 5;
    const browRot = S.frown * 7 - S.brow * 2.5;
    el.browL.setAttribute('transform', `translate(0 ${f(browUp + winkClose * 5)}) rotate(${f(browRot + winkClose * 3)} 392 420)`);
    el.browR.setAttribute('transform', `translate(0 ${f(browUp - winkClose * 3)}) rotate(${f(-browRot)} 608 420)`);

    // yeux & bouche
    updateEyes(Math.max(blinkClose, winkClose), blinkClose, S.smile * 0.9 + winkClose * 0.3);
    updateMouth(S.open, S.smile - S.frown * 0.15 + winkClose * 0.15);

    requestAnimationFrame(frame);
  }

  /* =======================================================
     8. INTERACTIONS
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
    if (!EXPRESSIONS[name]) return;
    expression = name;
    document.querySelectorAll('[data-expr]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.expr === name)));
  }
  function toggleGlasses(force) {
    glassesUp = typeof force === 'boolean' ? force : !glassesUp;
    const b = document.querySelector('[data-act="glasses"]');
    b.setAttribute('aria-pressed', String(glassesUp));
    b.textContent = glassesUp ? 'Remettre les lunettes' : 'Relever les lunettes';
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
    if (!p) return;
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
    text = String(text || '').trim();
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
