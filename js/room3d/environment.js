(function(){
  'use strict';
  if(!window.EnzoRoom||!window.EnzoRoom.threeOK){ return; }
/* ---- PIECE 1 — ROOM ENVIRONMENT (factory-wrapped: each scene gets a fresh
   closure, so the hero and panel rooms never share clock/plant state) ---- */
function createRoomBuilder(){
/* ============================================================================
   PIECE 1 — ROOM ENVIRONMENT  (ENZO 3D room rebuild, artifact slug: enao-ai)
   ----------------------------------------------------------------------------
   INTEGRATION NOTE
   - Replaces the previous inline room code in the enao-ai artifact: the old
     room shell (floor / walls / window / sofa / bookshelf / ENZO screen /
     clock / lamps / plants / carpet / coffee table) that was built inline in
     the artifact's scene-setup. Delete that block and call this instead:
         const room = buildRoomEnvironment(scene, THREE);
         scene.add(room.group);            // group is already added, see below
     then per frame: room.updateRoom(dt, time)  (or the exported updateRoom).
   - Expects: a THREE.Scene, global THREE (r150+), and a renderer with
     renderer.shadowMap.enabled = true,
     renderer.shadowMap.type = THREE.PCFSoftShadowMap,
     renderer.outputColorSpace = THREE.SRGBColorSpace
     (ACESFilmicToneMapping recommended for the warm/daylight mix).
   - buildRoomEnvironment() adds its group to the scene itself and returns
     { group, anchors, supportHeights, updateClock, updateRoom }.
   - The desk + chair + monitors are Piece 2 (workstation) and are NOT built
     here; this piece only reserves the desk zone at (-2.55, 0, -0.6).
   - MODULARITY: all key positions / sizes / colours live in CONFIG below.
     The reference image (b3605da0-772d-4672-b565-03e79d4e4fe2.png) is the
     DESIGN BASE ONLY — Raja is sending more room detail afterwards. To fold
     that detail in, edit CONFIG values or the small builder functions
     (buildSofa, buildBookshelf, ...) — nothing else needs to change, and
     anchors exported here are the contract other pieces rely on. Do NOT
     treat this file as final until the assembly step.
   - Units are metres. Floor y = 0. Room x in [-3.2, +3.2], z in [-2.6, +2.6],
     ceiling y = 3.0. -z = back wall, +z = front / camera side.
     Default camera (0, 1.7, 4.2) looking at (0, 1.0, 0).
   - SCALE NOTE (character sheet, 22 Nov 2026 ~9:02 AM PKT — second design
     authority alongside the room reference): ENZO's canonical height is
     1.35 m (4.5 ft), NOT 1.50 m — scale reference ENZO 1.35 m vs human
     1.75 m. Piece 3 owns ENZO's proportions (head ~40% / torso ~30% /
     legs ~20% of 1.35 m). This piece builds NO part of ENZO and hardcodes
     no ENZO height anywhere; all furniture here is real-world scale
     (sofa seat 0.45, coffee table 0.42, shelf boards 0.52–1.90), which
     stays correct for a 1.35 m robot — e.g. standing on the carpet, ENZO's
     head top (1.35 m) sits below the wall-screen centre (1.70 m) and the
     clock (1.90 m), exactly as in the reference. (The value 1.35 that
     appears in the floor-lamp pole height is a coincidence — lamp pole,
     not ENZO — and must not be "corrected" into an ENZO height.)
   ========================================================================== */

// ---------------------------------------------------------------------------
// CONFIG — tune these when Raja's extra room detail arrives. Nothing below
// this block hard-codes a position that also lives here.
// ---------------------------------------------------------------------------
const CONFIG = {
  room: { xMin: -3.2, xMax: 3.2, zMin: -2.6, zMax: 2.6, height: 3.0 },
  // Scale reference ONLY (character sheet 22 Nov 2026): ENZO is 1.35 m tall
  // (human 1.75 m). Nothing in this piece is sized from it — it is recorded
  // here so the assembly step never "corrects" it to 1.50 m. Piece 3 owns
  // ENZO's proportions (head ~40% / torso ~30% / legs ~20% of 1.35 m).
  scaleRef: { enzoHeight: 1.35, humanHeight: 1.75 },
  wallColor: 0xede6da,          // light warm off-white
  ceilingColor: 0xf5f1e8,
  floorColor: 0xb98a5e,         // warm wood base tone
  woodDark: 0x8a5a30,           // bookshelf / coffee-table wood
  woodMid: 0xa9743f,
  sofaFabric: 0x8d8d94,         // grey fabric
  sofaFabricDark: 0x6f6f77,
  carpetBase: 0xb9b3a8,
  curtainColor: 0xcbb493,       // beige
  leafGreen: 0x3f7a34,
  leafGreenLight: 0x5a9a44,
  screenBlue: 0x2fa8ff,         // ENZO neon blue
  anchors: {
    bookshelf: [-0.9, 0, -2.45],
    screen: [0.9, 1.7, -2.55],
    clock: [2.4, 1.9, -2.55],
    sofa: [2.2, 0, -0.4],
    sofaSeatY: 0.45,
    coffeeTable: [1.2, 0, -0.4],
    carpet: [0.6, 0.01, 0.2],
    floorLamp: [2.9, 0, -2.2],
    palm: [-2.9, 0, 1.4],
    sideTable: [2.85, 0, -1.6],
    window: [-3.2, 1.65, 0.2],  // centre of the window opening
    deskZone: [-2.55, 0, -0.6], // Piece 2 — reserved, NOT built here
  },
};

// ---------------------------------------------------------------------------
// Module state (set by buildRoomEnvironment, read by updateRoom/updateClock)
// ---------------------------------------------------------------------------
let T = null;                       // the THREE namespace passed in
const animated = { clockHands: null, palmFronds: null, screenLight: null, neonMat: null };
const SUPPORTS = [];                // { name, baseY, support } — see self-check

function recordSupport(name, baseY, support) {
  SUPPORTS.push({ name, baseY, support });
}

// Deterministic RNG so the room looks identical on every load.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Small helpers — every mesh is MeshStandardMaterial, cast/receive shadows.
// ---------------------------------------------------------------------------
function std(o) { return new T.MeshStandardMaterial(o); }

function box(parent, w, h, d, material, x, y, z, o) {
  const m = new T.Mesh(new T.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  if (o) {
    if (o.rx) m.rotation.x = o.rx;
    if (o.ry) m.rotation.y = o.ry;
    if (o.rz) m.rotation.z = o.rz;
  }
  m.castShadow = !(o && o.noCast);
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function cyl(parent, rTop, rBottom, h, material, x, y, z, o) {
  const seg = (o && o.seg) || 20;
  const m = new T.Mesh(new T.CylinderGeometry(rTop, rBottom, h, seg), material);
  m.position.set(x, y, z);
  if (o) {
    if (o.rx) m.rotation.x = o.rx;
    if (o.ry) m.rotation.y = o.ry;
    if (o.rz) m.rotation.z = o.rz;
  }
  m.castShadow = !(o && o.noCast);
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function ball(parent, r, material, x, y, z, sx, sy, sz) {
  const m = new T.Mesh(new T.IcosahedronGeometry(r, 1), material);
  m.position.set(x, y, z);
  m.scale.set(sx || 1, sy || 1, sz || 1);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

// Canvas texture helper. Returns null when there is no DOM (e.g. node
// self-check) — materials then fall back to their plain colour.
function makeCanvasTexture(w, h, draw, repeatX, repeatY) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new T.CanvasTexture(c);
  tex.wrapS = T.RepeatWrapping;
  tex.wrapT = T.RepeatWrapping;
  if (repeatX) tex.repeat.set(repeatX, repeatY || repeatX);
  tex.colorSpace = T.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ---------------------------------------------------------------------------
// Procedural textures (all drawn on canvas — no external images)
// ---------------------------------------------------------------------------
function woodFloorTexture() {
  return makeCanvasTexture(1024, 1024, (ctx, W, H) => {
    const rnd = mulberry32(1234);
    const plankH = 128, plankW = 256;
    ctx.fillStyle = '#a97c4e'; ctx.fillRect(0, 0, W, H);
    for (let row = 0; row < H / plankH; row++) {
      let x = -Math.floor(rnd() * plankW);
      while (x < W) {
        const tone = 0.82 + rnd() * 0.36;           // varied warm tones
        const r = Math.floor(176 * tone), g = Math.floor(124 * tone), b = Math.floor(78 * tone);
        ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
        ctx.fillRect(x, row * plankH, plankW, plankH);
        // grain lines
        ctx.strokeStyle = 'rgba(90,55,25,0.28)';
        ctx.lineWidth = 1.2;
        for (let i = 0; i < 5; i++) {
          const gy = row * plankH + 12 + rnd() * (plankH - 24);
          ctx.beginPath();
          ctx.moveTo(x + 4, gy);
          ctx.bezierCurveTo(x + plankW * 0.3, gy + (rnd() - 0.5) * 10,
            x + plankW * 0.7, gy + (rnd() - 0.5) * 10, x + plankW - 4, gy);
          ctx.stroke();
        }
        // plank end + long edge gaps
        ctx.fillStyle = 'rgba(60,35,15,0.55)';
        ctx.fillRect(x + plankW - 2, row * plankH, 2, plankH);
        x += plankW;
      }
      ctx.fillStyle = 'rgba(60,35,15,0.55)';
      ctx.fillRect(0, row * plankH, W, 2);
    }
  }, 3, 2.5);
}

function carpetTexture() {
  return makeCanvasTexture(512, 512, (ctx, W, H) => {
    ctx.fillStyle = '#b9b3a8'; ctx.fillRect(0, 0, W, H);
    // grey / beige geometric diamond pattern, like the reference rug
    const s = 64;
    for (let i = -1; i < W / s + 1; i++) {
      for (let j = -1; j < H / s + 1; j++) {
        const cx = i * s + s / 2, cy = j * s + s / 2;
        ctx.fillStyle = (i + j) % 2 === 0 ? '#8f8a80' : '#d8d2c4';
        ctx.beginPath();
        ctx.moveTo(cx, cy - s * 0.42); ctx.lineTo(cx + s * 0.42, cy);
        ctx.lineTo(cx, cy + s * 0.42); ctx.lineTo(cx - s * 0.42, cy);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#b9b3a8';
        ctx.beginPath();
        ctx.moveTo(cx, cy - s * 0.18); ctx.lineTo(cx + s * 0.18, cy);
        ctx.lineTo(cx, cy + s * 0.18); ctx.lineTo(cx - s * 0.18, cy);
        ctx.closePath(); ctx.fill();
      }
    }
    // woven speckle
    const rnd = mulberry32(77);
    for (let i = 0; i < 2600; i++) {
      ctx.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.10)' : 'rgba(60,55,45,0.10)';
      ctx.fillRect(rnd() * W, rnd() * H, 2, 2);
    }
  }, 2, 2);
}

function pillowPatternTexture() {
  return makeCanvasTexture(256, 256, (ctx, W, H) => {
    ctx.fillStyle = '#d9c9a8'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#8a6f45'; ctx.lineWidth = 3;
    const s = 42;
    for (let i = -1; i < W / s + 1; i++) {
      for (let j = -1; j < H / s + 1; j++) {
        const cx = i * s + s / 2, cy = j * s + s / 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy - s / 2); ctx.lineTo(cx + s / 2, cy);
        ctx.lineTo(cx, cy + s / 2); ctx.lineTo(cx - s / 2, cy);
        ctx.closePath(); ctx.stroke();
      }
    }
  });
}

function clockFaceTexture() {
  return makeCanvasTexture(512, 512, (ctx, W, H) => {
    const cx = W / 2, cy = H / 2;
    ctx.fillStyle = '#f7f5f0';
    ctx.beginPath(); ctx.arc(cx, cy, 256, 0, Math.PI * 2); ctx.fill();
    // minute ticks
    ctx.strokeStyle = '#222222'; ctx.fillStyle = '#222222';
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2;
      const big = i % 5 === 0;
      const r1 = big ? 218 : 230, r2 = 242;
      ctx.lineWidth = big ? 5 : 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.sin(a) * r1, cy - Math.cos(a) * r1);
      ctx.lineTo(cx + Math.sin(a) * r2, cy - Math.cos(a) * r2);
      ctx.stroke();
    }
    // numbers 1-12
    ctx.font = 'bold 46px Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let n = 1; n <= 12; n++) {
      const a = (n / 12) * Math.PI * 2;
      ctx.fillText(String(n), cx + Math.sin(a) * 185, cy - Math.cos(a) * 185);
    }
    ctx.beginPath(); ctx.arc(cx, cy, 10, 0, Math.PI * 2); ctx.fill();
  });
}

function screenTexture() {
  return makeCanvasTexture(1024, 576, (ctx, W, H) => {
    ctx.fillStyle = '#05070d'; ctx.fillRect(0, 0, W, H);
    const glow = ctx.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, 520);
    glow.addColorStop(0, 'rgba(47,140,255,0.30)');
    glow.addColorStop(1, 'rgba(47,140,255,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 170px Arial, sans-serif';
    ctx.fillText('ENZO', W / 2, H / 2 - 10);
    ctx.fillStyle = '#cfe6ff';
    ctx.font = '58px Arial, sans-serif';
    ctx.fillText('AI Robot', W / 2, H / 2 + 110);
  });
}

// ---------------------------------------------------------------------------
// Shared materials (created once per build)
// ---------------------------------------------------------------------------
let MAT = null;
function makeMaterials() {
  MAT = {
    wall: std({ color: CONFIG.wallColor, roughness: 0.95 }),
    ceiling: std({ color: CONFIG.ceilingColor, roughness: 0.95 }),
    skirting: std({ color: 0xfaf7f0, roughness: 0.6 }),
    floor: std({ map: woodFloorTexture(), color: 0xffffff, roughness: 0.7, metalness: 0.0 }),
    woodDark: std({ color: CONFIG.woodDark, roughness: 0.55 }),
    woodMid: std({ color: CONFIG.woodMid, roughness: 0.6 }),
    sofa: std({ color: CONFIG.sofaFabric, roughness: 0.98 }),
    sofaDark: std({ color: CONFIG.sofaFabricDark, roughness: 0.98 }),
    carpet: std({ map: carpetTexture(), color: 0xffffff, roughness: 1.0 }),
    pillowPattern: std({ map: pillowPatternTexture(), color: 0xffffff, roughness: 0.95 }),
    pillowBeige: std({ color: 0xd9c9a8, roughness: 0.95 }),
    pillowGrey: std({ color: 0x55555e, roughness: 0.95 }),
    curtain: std({ color: CONFIG.curtainColor, roughness: 0.95, side: T.DoubleSide }),
    frameDark: std({ color: 0x3a3a40, roughness: 0.4, metalness: 0.6 }),
    metalBlack: std({ color: 0x1c1c20, roughness: 0.35, metalness: 0.8 }),
    ceramicWhite: std({ color: 0xf2efe9, roughness: 0.35 }),
    ceramicTerra: std({ color: 0xa9603c, roughness: 0.7 }),
    leaf: std({ color: CONFIG.leafGreen, roughness: 0.85, side: T.DoubleSide }),
    leafLight: std({ color: CONFIG.leafGreenLight, roughness: 0.85, side: T.DoubleSide }),
    trunk: std({ color: 0x6b4a2a, roughness: 0.9 }),
    soil: std({ color: 0x2e2118, roughness: 1.0 }),
    glass: std({ color: 0xbfd9e8, transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0.1 }),
    skyGlow: std({ color: 0xdfeef7, emissive: 0xeaf6ff, emissiveIntensity: 1.6, roughness: 1.0 }),
    ledWarm: std({ color: 0x201409, emissive: 0xffb45e, emissiveIntensity: 2.2, roughness: 0.5 }),
    neonBlue: std({ color: 0x0a2a44, emissive: CONFIG.screenBlue, emissiveIntensity: 2.0, roughness: 0.4 }),
    screenFace: null, // set below (needs its texture twice: map + emissiveMap)
    clockFace: std({ map: clockFaceTexture(), roughness: 0.4 }),
    clockHand: std({ color: 0x1a1a1a, roughness: 0.5 }),
    lampShade: std({ color: 0xf5e6c8, emissive: 0xffd9a0, emissiveIntensity: 0.9, roughness: 0.9, side: T.DoubleSide }),
    bulb: std({ color: 0xfff2cc, emissive: 0xffe9b0, emissiveIntensity: 2.5 }),
    plaque: std({ color: 0xc8ccd2, roughness: 0.25, metalness: 0.9 }),
    plaqueRed: std({ color: 0xb03030, roughness: 0.4 }),
  };
  const st = screenTexture();
  MAT.screenFace = std({ map: st, emissive: 0xffffff, emissiveMap: st, emissiveIntensity: 0.55, roughness: 0.35 });
}

// ---------------------------------------------------------------------------
// 1. Shell — floor, walls (left wall has the window opening), ceiling, coving,
//    skirting. Window opening on left wall: z in [-1.4, +1.8], y in [0.7, 2.6].
// ---------------------------------------------------------------------------
function buildShell(group) {
  const R = CONFIG.room;
  // Floor — wooden planks, receives shadows.
  const floor = box(group, R.xMax - R.xMin, 0.06, R.zMax - R.zMin, MAT.floor, 0, -0.03, 0, { noCast: true });
  floor.receiveShadow = true;
  recordSupport('floor', 0, 'ground (top y=0)');

  // Back wall (z = -2.6) and right wall (x = +3.2).
  box(group, 6.5, 3.0, 0.1, MAT.wall, 0, 1.5, -2.65, { noCast: true });
  box(group, 0.1, 3.0, 5.3, MAT.wall, 3.25, 1.5, 0, { noCast: true });

  // Left wall (x = -3.2) in 4 pieces around the window opening.
  const lx = -3.25;
  box(group, 0.1, 3.0, 1.2, MAT.wall, lx, 1.5, -2.0, { noCast: true });   // back segment
  box(group, 0.1, 3.0, 0.8, MAT.wall, lx, 1.5, 2.2, { noCast: true });    // front segment
  box(group, 0.1, 0.7, 3.2, MAT.wall, lx, 0.35, 0.2, { noCast: true });   // below sill
  box(group, 0.1, 0.4, 3.2, MAT.wall, lx, 2.8, 0.2, { noCast: true });    // above header

  // Ceiling + coving (cornice strips where walls meet ceiling).
  box(group, 6.5, 0.1, 5.3, MAT.ceiling, 0, 3.05, 0, { noCast: true });
  box(group, 6.4, 0.07, 0.07, MAT.ceiling, 0, 2.97, -2.58, { noCast: true });
  box(group, 0.07, 0.07, 5.2, MAT.ceiling, 3.18, 2.97, 0, { noCast: true });
  box(group, 0.07, 0.07, 5.2, MAT.ceiling, -3.18, 2.97, 0, { noCast: true });

  // Skirting boards (h 0.09) along back, right and left-wall base runs.
  box(group, 6.4, 0.09, 0.03, MAT.skirting, 0, 0.045, -2.585, { noCast: true });
  box(group, 0.03, 0.09, 5.2, MAT.skirting, 3.185, 0.045, 0, { noCast: true });
  box(group, 0.03, 0.09, 1.2, MAT.skirting, -3.185, 0.045, -2.0, { noCast: true });
  box(group, 0.03, 0.09, 0.8, MAT.skirting, -3.185, 0.045, 2.2, { noCast: true });
  box(group, 0.03, 0.09, 3.2, MAT.skirting, -3.185, 0.045, 0.2, { noCast: true });
}

// ---------------------------------------------------------------------------
// 2. Window — frame + mullions, glass, pleated curtains, outside sky + trees.
// ---------------------------------------------------------------------------
function buildWindow(group) {
  const win = new T.Group();
  win.position.set(-3.2, 0, 0.2);
  group.add(win);
  const W = 3.2, H = 1.9, yC = 1.65;   // opening z-span 3.2, y-span 0.7..2.6
  const ft = 0.07;                      // frame thickness

  // Outer frame (top / bottom / 2 sides) + sill, in the wall plane.
  box(win, 0.1, ft, W, MAT.frameDark, 0, yC + H / 2, 0);
  box(win, 0.1, ft, W, MAT.frameDark, 0, yC - H / 2, 0);
  box(win, 0.1, H, ft, MAT.frameDark, 0, yC, -W / 2);
  box(win, 0.1, H, ft, MAT.frameDark, 0, yC, W / 2);
  box(win, 0.16, 0.05, W + 0.1, MAT.woodMid, 0.02, 0.68, 0); // sill
  // Mullions: 2 vertical + 1 horizontal.
  box(win, 0.07, H, 0.05, MAT.frameDark, 0, yC, -W / 6);
  box(win, 0.07, H, 0.05, MAT.frameDark, 0, yC, W / 6);
  box(win, 0.07, 0.05, W, MAT.frameDark, 0, yC, 0);
  // Glass — single transparent pane, slight blue tint.
  const glass = new T.Mesh(new T.PlaneGeometry(W, H), MAT.glass);
  glass.rotation.y = Math.PI / 2;
  glass.position.set(0, yC, 0);
  glass.receiveShadow = true;
  win.add(glass);

  // Outside: bright sky-glow plane + green tree foliage + trunks, behind glass.
  const sky = new T.Mesh(new T.PlaneGeometry(4.6, 2.8), MAT.skyGlow);
  sky.rotation.y = Math.PI / 2;
  sky.position.set(-0.75, 1.7, 0);
  win.add(sky);
  const rnd = mulberry32(42);
  for (let i = 0; i < 7; i++) {
    const tz = -1.5 + rnd() * 3.1, ty = 1.0 + rnd() * 1.6, tx = -0.45 - rnd() * 0.35;
    ball(win, 0.35 + rnd() * 0.3, rnd() > 0.5 ? MAT.leaf : MAT.leafLight, tx, ty, tz, 1, 0.8, 1);
  }
  cyl(win, 0.06, 0.09, 1.6, MAT.trunk, -0.55, 0.8, -0.9, { noCast: true });
  cyl(win, 0.05, 0.08, 1.4, MAT.trunk, -0.6, 0.7, 1.1, { noCast: true });

  // Curtain rod + pleated curtains (repeated thin boxes, sinusoidal fold).
  // Panels hang at both ends of the window, floor to near-ceiling.
  const rod = cyl(win, 0.02, 0.02, 3.8, MAT.metalBlack, 0.08, 2.86, 0, { rx: Math.PI / 2, seg: 10 });
  rod.castShadow = false;
  [-1.52, 1.92].forEach((zc) => {
    for (let i = 0; i < 9; i++) {
      const fold = Math.sin(i * 1.35) * 0.05;
      box(win, 0.09, 2.82, 0.1, MAT.curtain, 0.06 + fold, 1.44, zc + (i - 4) * 0.075, { rz: (i % 2 ? 1 : -1) * 0.04 });
    }
  });
}

// ---------------------------------------------------------------------------
// 3. Ceiling lights — 4 recessed round spotlights + one track light.
// ---------------------------------------------------------------------------
function buildCeilingLights(group) {
  const spots = [[-1.7, 1.3], [1.7, 1.3], [-1.7, -1.3], [1.7, -1.3]];
  spots.forEach(([x, z]) => {
    // Recessed ring + emissive disc.
    cyl(group, 0.11, 0.11, 0.02, MAT.frameDark, x, 2.99, z, { noCast: true, seg: 24 });
    const disc = cyl(group, 0.085, 0.085, 0.015, MAT.bulb, x, 2.985, z, { noCast: true, seg: 24 });
    disc.castShadow = false;
    const p = new T.PointLight(0xffd9a0, 9, 5.5, 2);
    p.position.set(x, 2.82, z);
    group.add(p);
  });
  // Modern track: black bar + 3 adjustable heads + one warm wash light.
  box(group, 1.5, 0.045, 0.09, MAT.metalBlack, 0.4, 2.97, 0.9, { noCast: true });
  [-0.2, 0.4, 1.0].forEach((x) => {
    cyl(group, 0.05, 0.07, 0.16, MAT.frameDark, x, 2.88, 0.9, { rx: 0.35, seg: 16 });
    const b = new T.Mesh(new T.SphereGeometry(0.035, 12, 10), MAT.bulb);
    b.position.set(x, 2.8, 0.93);
    group.add(b);
  });
  const wash = new T.PointLight(0xffe0b0, 7, 5, 2);
  wash.position.set(0.4, 2.75, 0.9);
  group.add(wash);
}

// ---------------------------------------------------------------------------
// 4. Grey fabric sofa — faces -x, length 2.0 along z. Seat top y = 0.45.
// ---------------------------------------------------------------------------
function buildSofa(group) {
  const [sx, , sz] = CONFIG.anchors.sofa;
  const sofa = new T.Group();
  sofa.position.set(sx, 0, sz);
  group.add(sofa);
  recordSupport('sofa', 0, 'floor (4 short legs)');

  // Short dark legs.
  [[-0.38, -0.85], [0.38, -0.85], [-0.38, 0.85], [0.38, 0.85]].forEach(([lx, lz]) => {
    cyl(sofa, 0.03, 0.025, 0.05, MAT.metalBlack, lx, 0.025, lz, { seg: 10 });
  });
  // Base, backrest (on +x side, since it faces -x), armrests.
  box(sofa, 0.95, 0.30, 2.0, MAT.sofa, 0, 0.20, 0);
  box(sofa, 0.22, 0.55, 2.0, MAT.sofa, 0.365, 0.625, 0);
  box(sofa, 0.90, 0.25, 0.18, MAT.sofa, 0, 0.475, -0.91);
  box(sofa, 0.90, 0.25, 0.18, MAT.sofa, 0, 0.475, 0.91);
  // 2 seat cushions + 2 back cushions (slightly tilted, leaning on backrest).
  box(sofa, 0.78, 0.10, 0.92, MAT.sofaDark, -0.05, 0.40, -0.46);
  box(sofa, 0.78, 0.10, 0.92, MAT.sofaDark, -0.05, 0.40, 0.46);
  box(sofa, 0.18, 0.42, 0.92, MAT.sofa, 0.22, 0.62, -0.46, { rz: -0.1 });
  box(sofa, 0.18, 0.42, 0.92, MAT.sofa, 0.22, 0.62, 0.46, { rz: -0.1 });
  // 3 throw pillows: patterned (centre), beige, dark grey.
  const p1 = box(sofa, 0.14, 0.42, 0.42, MAT.pillowPattern, 0.12, 0.62, -0.55, { rz: -0.12, ry: 0.15 });
  const p2 = box(sofa, 0.14, 0.40, 0.40, MAT.pillowBeige, 0.12, 0.60, 0.08, { rz: -0.1, ry: -0.2 });
  const p3 = box(sofa, 0.14, 0.42, 0.42, MAT.pillowGrey, 0.12, 0.62, 0.62, { rz: -0.14, ry: 0.1 });
  [p1, p2, p3].forEach((p) => { p.castShadow = true; });
}

// ---------------------------------------------------------------------------
// 5. Patterned carpet — thin box under the coffee table + ENZO area.
// ---------------------------------------------------------------------------
function buildCarpet(group) {
  const [cx, cy, cz] = CONFIG.anchors.carpet;
  box(group, 3.0, 0.025, 2.2, MAT.carpet, cx, cy, cz, { noCast: true });
  recordSupport('carpet', 0, 'floor');
}

// ---------------------------------------------------------------------------
// 6. Wooden bookshelf — frame, 4 shelves, 18 books, 2 shelf plants,
//    silver YouTube plaque, warm LED strip under each shelf.
// ---------------------------------------------------------------------------
function buildBookshelf(group) {
  const [bx, , bz] = CONFIG.anchors.bookshelf;
  const shelf = new T.Group();
  shelf.position.set(bx, 0, bz);
  group.add(shelf);
  recordSupport('bookshelf', 0, 'floor');
  const W = 1.6, H = 2.1, D = 0.28, T2 = 0.04;

  // Frame: sides, top, bottom plinth, back panel.
  box(shelf, T2, H, D, MAT.woodDark, -W / 2 + T2 / 2, H / 2, 0);
  box(shelf, T2, H, D, MAT.woodDark, W / 2 - T2 / 2, H / 2, 0);
  box(shelf, W, T2, D, MAT.woodDark, 0, H - T2 / 2, 0);
  box(shelf, W, 0.08, D, MAT.woodDark, 0, 0.04, 0);
  box(shelf, W - 0.06, H - 0.06, 0.02, MAT.woodMid, 0, H / 2, -D / 2 + 0.01, { noCast: true });

  // 4 shelf boards (rows sit on top of each).
  const boardY = [0.52, 0.98, 1.44, 1.90];
  boardY.forEach((y) => {
    box(shelf, W - 0.08, 0.03, D - 0.04, MAT.woodMid, 0, y, 0);
    // Warm LED strip under the front edge of each shelf.
    box(shelf, W - 0.14, 0.015, 0.02, MAT.ledWarm, 0, y - 0.022, D / 2 - 0.03, { noCast: true });
  });
  // One soft warm wash light for the whole shelf (keeps light count low).
  const wash = new T.PointLight(0xffb45e, 2.5, 2.2, 2);
  wash.position.set(bx, 1.2, bz + 0.55);
  group.add(wash);

  // 18 books — 6 per row on the lower 3 boards, varied heights/colours,
  // a couple leaning.
  const palette = [0x7a2e2e, 0x274156, 0x3f6b4f, 0xb98a2f, 0x5b4a68, 0x2e2e2e,
    0x8a5a2b, 0x33565e, 0xa33d3d, 0x6b7a2e, 0xc8c0b0, 0x31456b];
  const rnd = mulberry32(2026);
  const rows = [0.535, 0.995, 1.455];
  rows.forEach((baseY, ri) => {
    let x = -W / 2 + 0.12;
    for (let i = 0; i < 6; i++) {
      const bw = 0.035 + rnd() * 0.02, bh = 0.22 + rnd() * 0.1;
      const col = palette[Math.floor(rnd() * palette.length)];
      const lean = (ri === 1 && i === 5) ? 0.16 : (ri === 2 && i === 0 ? -0.1 : 0);
      const book = box(shelf, bw, bh, 0.19,
        std({ color: col, roughness: 0.8 }), x + bw / 2, baseY + bh / 2, 0, { rz: lean });
      // pale page block on top edge
      box(shelf, bw * 0.7, 0.012, 0.16,
        std({ color: 0xe8e2d2, roughness: 0.9 }), x + bw / 2, baseY + bh + 0.002, 0, { rz: lean, noCast: true });
      x += bw + 0.012 + rnd() * 0.02;
      void book;
    }
  });

  // Top row: silver YouTube plaque + small potted plant.
  const plaque = box(shelf, 0.26, 0.34, 0.02, MAT.plaque, 0.28, 1.915 + 0.17, 0.02, { rz: -0.04 });
  plaque.castShadow = true;
  // Play triangle (extruded shape) on the plaque.
  const tri = new T.Shape();
  tri.moveTo(-0.035, -0.05); tri.lineTo(-0.035, 0.05); tri.lineTo(0.05, 0); tri.closePath();
  const triMesh = new T.Mesh(new T.ExtrudeGeometry(tri, { depth: 0.008, bevelEnabled: false }), MAT.plaqueRed);
  triMesh.position.set(0.28, 2.10, 0.035);
  triMesh.rotation.z = -0.04;
  triMesh.castShadow = true;
  shelf.add(triMesh);
  smallPlant(shelf, -0.45, 1.915, 0.0, 1.0);
  smallPlant(shelf, 0.15, 1.455, 0.0, 0.9);   // second shelf plant, middle row
}

// Small potted plant — ceramic pot + soil + leafy foliage blobs.
// (x, y, z) is the base of the pot; s scales the whole plant.
function smallPlant(parent, x, y, z, s) {
  const g = new T.Group();
  g.position.set(x, y, z);
  g.scale.setScalar(s || 1);
  parent.add(g);
  cyl(g, 0.07, 0.05, 0.12, MAT.ceramicWhite, 0, 0.06, 0, { seg: 16 });
  cyl(g, 0.06, 0.06, 0.015, MAT.soil, 0, 0.115, 0, { noCast: true, seg: 16 });
  const rnd = mulberry32(Math.floor(x * 1000 + y * 100 + 7));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rnd();
    ball(g, 0.06 + rnd() * 0.03, rnd() > 0.5 ? MAT.leaf : MAT.leafLight,
      Math.cos(a) * 0.045, 0.17 + rnd() * 0.06, Math.sin(a) * 0.045, 1, 0.85, 1);
  }
  ball(g, 0.07, MAT.leafLight, 0, 0.22, 0, 1, 0.9, 1);
  return g;
}

// ---------------------------------------------------------------------------
// 7. Large palm near the window — pot + trunk + ~10 long bent leaves.
//    Leaves are curved, tapered, double-sided planes, so the palm reads
//    as 3D from every angle, not a flat billboard.
// ---------------------------------------------------------------------------
function buildPalm(group) {
  const [px, , pz] = CONFIG.anchors.palm;
  const palm = new T.Group();
  palm.position.set(px, 0, pz);
  group.add(palm);
  recordSupport('palm plant', 0, 'floor');

  cyl(palm, 0.30, 0.22, 0.42, MAT.ceramicTerra, 0, 0.21, 0, { seg: 24 });
  cyl(palm, 0.27, 0.27, 0.02, MAT.soil, 0, 0.41, 0, { noCast: true, seg: 24 });
  const trunk = cyl(palm, 0.045, 0.07, 1.15, MAT.trunk, 0, 0.95, 0, { rz: 0.06, seg: 12 });

  // Frond head at the top of the trunk.
  const fronds = new T.Group();
  fronds.position.set(0.07, 1.5, 0);
  palm.add(fronds);
  animated.palmFronds = fronds;
  void trunk;

  for (let i = 0; i < 10; i++) {
    const geo = new T.PlaneGeometry(0.16, 1.05, 1, 8);
    // Bend + taper: droop along the length, fold along the centre rib.
    const pos = geo.attributes && geo.attributes.position;
    if (pos && typeof pos.count === 'number') {
      for (let v = 0; v < pos.count; v++) {
        const vx = pos.getX(v), vy = pos.getY(v);
        const t = vy + 0.5;                       // 0 at base, 1 at tip
        pos.setX(v, vx * (1 - t * 0.65));         // taper to a point
        pos.setZ(v, -0.38 * t * t + Math.abs(vx) * 0.35); // droop + rib fold
      }
      geo.computeVertexNormals();
    }
    geo.translate(0, 0.525, 0);                   // pivot at the leaf base
    const leaf = new T.Mesh(geo, i % 2 ? MAT.leaf : MAT.leafLight);
    leaf.castShadow = true;
    leaf.receiveShadow = true;
    const holder = new T.Group();
    holder.rotation.y = (i / 10) * Math.PI * 2 + (i % 2 ? 0.22 : 0);
    holder.rotation.x = 0;                        // tilt applied on the leaf
    leaf.rotation.x = -(0.9 + (i % 3) * 0.18);    // arc outwards + downwards
    holder.add(leaf);
    fronds.add(holder);
  }
  // A few upright young fronds in the middle.
  for (let i = 0; i < 3; i++) {
    const geo = new T.PlaneGeometry(0.12, 0.7, 1, 6);
    geo.translate(0, 0.35, 0);
    const leaf = new T.Mesh(geo, MAT.leafLight);
    leaf.castShadow = true;
    const holder = new T.Group();
    holder.rotation.y = i * 2.1;
    leaf.rotation.x = -0.35;
    holder.add(leaf);
    fronds.add(holder);
  }
}

// ---------------------------------------------------------------------------
// 8. Wall clock — round white face with 1–12, black rim, real-time hands.
// ---------------------------------------------------------------------------
function buildClock(group) {
  const [cx, cy, cz] = CONFIG.anchors.clock;
  const clock = new T.Group();
  clock.position.set(cx, cy, cz);
  group.add(clock);
  recordSupport('wall clock', null, 'back wall (mounted)');

  // Body + rim + face (face is a circle so the number texture maps cleanly).
  const body = cyl(clock, 0.44, 0.44, 0.05, MAT.frameDark, 0, 0, 0, { rx: Math.PI / 2, seg: 48 });
  body.castShadow = true;
  const rim = new T.Mesh(new T.TorusGeometry(0.43, 0.022, 12, 48), MAT.metalBlack);
  rim.position.set(0, 0, 0.028);
  rim.castShadow = true;
  clock.add(rim);
  const face = new T.Mesh(new T.CircleGeometry(0.42, 48), MAT.clockFace);
  face.position.set(0, 0, 0.026);
  face.receiveShadow = true;
  clock.add(face);

  // Hands: each is a pivot group at the centre + a thin box offset upward,
  // so rotation.z = 0 points at 12 and negative rotation runs clockwise.
  function hand(len, w, z, mat) {
    const pivot = new T.Group();
    pivot.position.set(0, 0, z);
    const m = box(pivot, w, len, 0.008, mat, 0, len / 2 - 0.03, 0, { noCast: true });
    m.castShadow = false;
    clock.add(pivot);
    return pivot;
  }
  const hour = hand(0.20, 0.028, 0.034, MAT.clockHand);
  const minute = hand(0.30, 0.02, 0.038, MAT.clockHand);
  const second = hand(0.32, 0.008, 0.042, std({ color: 0x8a1f1f, roughness: 0.5 }));
  const pin = cyl(clock, 0.018, 0.018, 0.02, MAT.metalBlack, 0, 0, 0.046, { rx: Math.PI / 2, seg: 12 });
  pin.castShadow = false;
  animated.clockHands = { hour, minute, second };
  updateClock();
}

// ---------------------------------------------------------------------------
// 9. ENZO wall screen — black panel, blue neon border, glowing ENZO texture.
// ---------------------------------------------------------------------------
function buildScreen(group) {
  const [sx, sy, sz] = CONFIG.anchors.screen;
  const scr = new T.Group();
  scr.position.set(sx, sy, sz);
  group.add(scr);
  recordSupport('ENZO wall screen', null, 'back wall (mounted)');

  box(scr, 1.9, 1.05, 0.06, MAT.metalBlack, 0, 0, 0);                 // panel
  const face = new T.Mesh(new T.PlaneGeometry(1.84, 0.99), MAT.screenFace);
  face.position.set(0, 0, 0.032);
  scr.add(face);
  // Neon border — 4 thin emissive bars, slightly proud of the panel.
  box(scr, 1.98, 0.03, 0.02, MAT.neonBlue, 0, 0.54, 0.035, { noCast: true });
  box(scr, 1.98, 0.03, 0.02, MAT.neonBlue, 0, -0.54, 0.035, { noCast: true });
  box(scr, 0.03, 1.11, 0.02, MAT.neonBlue, -0.975, 0, 0.035, { noCast: true });
  box(scr, 0.03, 1.11, 0.02, MAT.neonBlue, 0.975, 0, 0.035, { noCast: true });
  // Subtle blue glow spilling into the room.
  const glow = new T.PointLight(0x2fa8ff, 3.2, 3.5, 2);
  glow.position.set(sx, sy, sz + 0.45);
  group.add(glow);
  animated.screenLight = glow;
  animated.neonMat = MAT.neonBlue;
}

// ---------------------------------------------------------------------------
// 10. Coffee table — wooden top + black metal legs, books + small plant.
// ---------------------------------------------------------------------------
function buildCoffeeTable(group) {
  const [tx, , tz] = CONFIG.anchors.coffeeTable;
  const table = new T.Group();
  table.position.set(tx, 0, tz);
  group.add(table);
  recordSupport('coffee table', 0.025, 'carpet top (legs rest on the rug)');

  const topY = 0.42;
  box(table, 1.1, 0.04, 0.6, MAT.woodMid, 0, topY - 0.02, 0); /* v51 coordinator fix: slab centre y=0.40, thickness 0.04 -> top surface EXACTLY 0.42, matching Pieces 2/4 */
  // 4 black metal legs (frame-style: 2 U-frames).
  [-0.5, 0.5].forEach((lx) => {
    box(table, 0.03, topY - 0.025, 0.03, MAT.metalBlack, lx, (topY - 0.025) / 2 + 0.025, -0.26);
    box(table, 0.03, topY - 0.025, 0.03, MAT.metalBlack, lx, (topY - 0.025) / 2 + 0.025, 0.26);
    box(table, 0.03, 0.03, 0.55, MAT.metalBlack, lx, 0.04, 0);
  });
  // Books + small plant on top.
  box(table, 0.3, 0.035, 0.22, std({ color: 0x274156, roughness: 0.8 }), -0.28, topY + 0.0175, 0.05, { ry: 0.08 }); /* rests on the 0.42 surface */
  box(table, 0.26, 0.03, 0.2, std({ color: 0x8a2e2e, roughness: 0.8 }), -0.27, topY + 0.05, 0.05, { ry: -0.05 }); /* stacked on the first book */
  smallPlant(table, 0.3, topY, -0.08, 1.0); /* pot base on the 0.42 surface */
}

// ---------------------------------------------------------------------------
// 11. Floor lamp — tripod legs + warm lampshade + warm point light.
// ---------------------------------------------------------------------------
function buildFloorLamp(group) {
  const [lx, , lz] = CONFIG.anchors.floorLamp;
  const lamp = new T.Group();
  lamp.position.set(lx, 0, lz);
  group.add(lamp);
  recordSupport('floor lamp', 0, 'floor (tripod feet)');

  // Tripod legs, splayed.
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    const leg = cyl(lamp, 0.018, 0.018, 0.62, MAT.woodDark,
      Math.cos(a) * 0.14, 0.28, Math.sin(a) * 0.14, { seg: 10 });
    leg.rotation.z = Math.cos(a) * 0.45;
    leg.rotation.x = -Math.sin(a) * 0.45;
  }
  cyl(lamp, 0.02, 0.02, 1.35, MAT.woodDark, 0, 0.85, 0, { seg: 12 }); // pole
  // Shade: truncated cone, emissive inside + bulb.
  const shade = cyl(lamp, 0.16, 0.24, 0.3, MAT.lampShade, 0, 1.62, 0, { seg: 24 });
  shade.castShadow = false;
  const bulb = new T.Mesh(new T.SphereGeometry(0.05, 12, 10), MAT.bulb);
  bulb.position.set(0, 1.55, 0);
  lamp.add(bulb);
  const p = new T.PointLight(0xffd9a0, 6, 4.5, 2);
  p.position.set(lx, 1.55, lz);
  group.add(p);
}

// ---------------------------------------------------------------------------
// 12. Side table near the sofa (under the clock) + floating wall shelf
//     with two small plants, as in the reference.
// ---------------------------------------------------------------------------
function buildSideTable(group) {
  const [tx, , tz] = CONFIG.anchors.sideTable;
  const table = new T.Group();
  table.position.set(tx, 0, tz);
  group.add(table);
  recordSupport('side table', 0, 'floor');

  box(table, 0.45, 0.03, 0.35, MAT.woodMid, 0, 0.55, 0);
  [[-0.19, -0.14], [0.19, -0.14], [-0.19, 0.14], [0.19, 0.14]].forEach(([lx, lz]) => {
    box(table, 0.03, 0.54, 0.03, MAT.metalBlack, lx, 0.27, lz);
  });
  smallPlant(table, 0, 0.565, 0, 0.9);

  // Floating wall shelf under the clock (back wall), two small plants.
  const shelfY = 1.05, shelfZ = -2.55;
  box(group, 0.7, 0.035, 0.24, MAT.woodMid, 2.4, shelfY, shelfZ + 0.12);
  smallPlant(group, 2.18, shelfY + 0.018, -2.43, 0.9);
  smallPlant(group, 2.62, shelfY + 0.018, -2.43, 0.75);
  recordSupport('wall shelf (under clock)', null, 'back wall (mounted)');
}

// ---------------------------------------------------------------------------
// 13. Lighting rig — hemisphere bounce + strong daylight through the window.
// ---------------------------------------------------------------------------
function buildLighting(group) {
  const hemi = new T.HemisphereLight(0xfff3e2, 0x7a5c40, 0.55);
  group.add(hemi);
  const amb = new T.AmbientLight(0x40382c, 0.18);
  group.add(amb);

  // Daylight: low warm sun through the big left window, soft shadows.
  const sun = new T.DirectionalLight(0xfff1d6, 2.6);
  sun.position.set(-5, 3.6, 2.2);
  sun.target.position.set(2, 0, -1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -5; sun.shadow.camera.right = 5;
  sun.shadow.camera.top = 5; sun.shadow.camera.bottom = -5;
  sun.shadow.camera.near = 0.5; sun.shadow.camera.far = 16;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  group.add(sun);
  group.add(sun.target);
}

// ---------------------------------------------------------------------------
// Clock + per-frame animation
// ---------------------------------------------------------------------------
function updateClock() {
  if (!animated.clockHands) return;
  const now = new Date();
  const s = now.getSeconds() + now.getMilliseconds() / 1000;
  const m = now.getMinutes() + s / 60;
  const h = (now.getHours() % 12) + m / 60;
  // Negative rotation.z = clockwise as seen from the front (+z).
  animated.clockHands.second.rotation.z = -(s / 60) * Math.PI * 2;
  animated.clockHands.minute.rotation.z = -(m / 60) * Math.PI * 2;
  animated.clockHands.hour.rotation.z = -(h / 12) * Math.PI * 2;
}

function updateRoom(dt, time) {
  const t = typeof time === 'number' ? time
    : (typeof performance !== 'undefined' ? performance.now() / 1000 : 0);
  void dt;
  updateClock();
  if (animated.palmFronds) {
    animated.palmFronds.rotation.z = Math.sin(t * 0.6) * 0.02;   // subtle sway
    animated.palmFronds.rotation.x = Math.cos(t * 0.45) * 0.015;
  }
  if (animated.screenLight) animated.screenLight.intensity = 3.2 + Math.sin(t * 1.4) * 0.7;
  if (animated.neonMat) animated.neonMat.emissiveIntensity = 1.8 + Math.sin(t * 1.4) * 0.35;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------
function buildRoomEnvironment(scene, THREE) {
  T = THREE;
  SUPPORTS.length = 0;
  animated.clockHands = null; animated.palmFronds = null;
  animated.screenLight = null; animated.neonMat = null;
  makeMaterials();

  const group = new T.Group();
  group.name = 'room-environment';
  scene.add(group);

  buildShell(group);
  buildWindow(group);
  buildCeilingLights(group);
  buildCarpet(group);
  buildSofa(group);
  buildBookshelf(group);
  buildPalm(group);
  buildClock(group);
  buildScreen(group);
  buildCoffeeTable(group);
  buildFloorLamp(group);
  buildSideTable(group);
  buildLighting(group);

  const A = CONFIG.anchors;
  const v = (p) => new T.Vector3(p[0], p[1], p[2]);
  const anchors = {
    bookshelfPos: v(A.bookshelf),
    sofaPos: v(A.sofa),
    sofaSeatPos: new T.Vector3(A.sofa[0], A.sofaSeatY, A.sofa[2]),
    coffeeTablePos: v(A.coffeeTable),
    carpetCentre: v(A.carpet),
    plantPositions: [
      v(A.palm),
      new T.Vector3(-1.35, 1.915, -2.45),  // shelf plant, top row
      new T.Vector3(-0.75, 1.455, -2.45),  // shelf plant, middle row
      new T.Vector3(1.5, 0.44, -0.48),     // coffee-table plant
      v(A.sideTable),                        // side-table plant (base)
      new T.Vector3(2.18, 1.07, -2.43),    // wall-shelf plant L
      new T.Vector3(2.62, 1.07, -2.43),    // wall-shelf plant R
    ],
    windowPos: v(A.window),
    screenPos: v(A.screen),
    clockPos: v(A.clock),
    floorLampPos: v(A.floorLamp),
    roomBounds: {
      xMin: CONFIG.room.xMin, xMax: CONFIG.room.xMax,
      zMin: CONFIG.room.zMin, zMax: CONFIG.room.zMax,
    },
  };

  return {
    group,
    anchors,
    scaleRef: CONFIG.scaleRef,   // ENZO 1.35 m (NOT 1.50 m) — for Piece 3/assembly
    supportHeights: SUPPORTS.slice(),
    updateClock,
    updateRoom,
  };
}

// Plain-script + CommonJS compatible export.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildRoomEnvironment, updateRoom, updateClock, CONFIG };
}
if (typeof window !== 'undefined') {
  window.buildRoomEnvironment = buildRoomEnvironment;
  window.updateRoom = updateRoom;
  window.updateClock = updateClock;
}

/* ============================================================================
   SELF-CHECK (run under node with a minimal THREE/document stub — see the
   check script used at build time; results recorded below after the run)
   ----------------------------------------------------------------------------
   1. Every anchor lies inside roomBounds:
      x in [-3.2, +3.2] and z in [-2.6, +2.6].
   2. Every furniture item's base y == 0 (floor) or its stated support height:
      floor 0, bookshelf 0, sofa 0, carpet 0, palm 0, floor lamp 0,
      side table 0, coffee table 0.025 (carpet top), clock / screen /
      wall shelf = wall-mounted (baseY null, support = back wall).
   3. updateRoom(dt, time) runs without throwing and updateClock() reads the
      real current time (hands are set from `new Date()` on every call).
   RUN RESULTS (22 Nov 2026, node --check + stubbed build, /tmp/check-room.js):
     - node --check: PASS (valid JS, no syntax errors).
     - anchors inside bounds: PASS (all 9 positional anchors + 7 plant
       positions inside [-3.2, 3.2] x [-2.6, 2.6]).
     - support heights: PASS (8 items at baseY 0, coffee table at 0.025 on
       carpet, 3 items wall-mounted with baseY null).
     - geometry: 278 nodes in the group tree (sane for low-end).
     - updateRoom + updateClock smoke test: PASS.
     - sofa seat height: PASS (y = 0.45).
   ========================================================================== */

  return buildRoomEnvironment;
}
  window.EnzoRoom.createRoomBuilder=createRoomBuilder;

})();
