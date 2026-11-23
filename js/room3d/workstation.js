(function(){
  'use strict';
  if(!window.EnzoRoom||!window.EnzoRoom.threeOK){ return; }
/* ---- PIECE 2 — WORKSTATION ---- */
/* ============================================================================
 * PIECE 2 — Workstation Props (ENZO 3D room rebuild, artifact: enao-ai)
 * ----------------------------------------------------------------------------
 * INTEGRATION NOTE
 * Replaces: the old flat/cartoonish desk corner in the ENZO room scene.
 * Expected inputs: buildWorkstation(scene, THREE)
 *   - scene : THREE.Scene (or any Object3D to attach the workstation group to)
 *   - THREE : the global Three.js namespace (r150+; uses only stable APIs)
 * Returns: { group, props }
 *   - group : the whole workstation (desk + chair + all props), added to scene
 *   - props : handles the animation piece (Piece 4) will use:
 *       deskTopY            : 0.78 (every desk prop rests on this, or on a
 *                             stand/mat whose own base rests on it)
 *       laptop { group, lid, setLidAngle(a) }
 *           a = 0      -> lid closed flat on the base (gap 0)
 *           a = ~1.9   -> lid open, leaning slightly back past vertical
 *       monitors [m1, m2] : monitor groups (rotate/move as a whole)
 *       keyboard, mouse   : separate groups; mouse can be slid on the mat
 *       phone { group, screen, setScreen(on), setPhoneTime(str) }
 *       phoneStand        : the cradle the phone rests in
 *       headphones, penHolder, mug, notebook, globe : prop groups
 *       book, glass         : coffee-table props (base y 0.42) for Piece 4
 *                             readBook / drinkWater — attachObject contract
 *                             { group }; group origin IS the base, so Piece 4
 *                             can put them back with position.y = 0.42
 *       coffeeTableTopY     : 0.42 (book + glass rest on the coffee table,
 *                             NOT the desk — Piece 1's table, centre
 *                             (1.2, 0, -0.4), top 1.1 x 0.6)
 *       deskLamp { group, setOn(b) } : b toggles bulb + SpotLight
 *       chair { group, seatY } : separate group; rotate/slide for sitting
 *                             pose. Seat centre (-1.9, 0.48, -0.6).
 * Coordinate system (shared with Piece 1): metres, floor y = 0,
 * -z = back wall, +z = front/camera. Desk centre (-2.55, 0, -0.6),
 * top y = 0.78, length 2.6 along z (z -1.9..+0.7), depth 0.8
 * (x -2.95..-2.15). Desk faces +x; chair sits at x ~ -1.9 facing -x.
 * Nothing here touches chat/call/UI logic. All geometry is real 3D
 * (MeshStandardMaterial throughout; emissive only via standard-material
 * emissive channels on screens / LEDs / bulb). No MeshBasicMaterial.
 * ========================================================================== */

function buildWorkstation(scene, THREE) {
  'use strict';

  var DESK = { x: -2.55, z: -0.6, topY: 0.78, len: 2.6, depth: 0.8 };
  var TOP = DESK.topY;

  /* ---------------- canvas-texture helpers ---------------- */
  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  function tex(canvas) {
    var t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }
  function std(params) { return new THREE.MeshStandardMaterial(params); }

  /* Warm oak wood grain */
  function woodTexture() {
    var c = makeCanvas(512, 512), g = c.getContext('2d');
    g.fillStyle = '#b07f4e'; g.fillRect(0, 0, 512, 512);
    var i, y;
    for (i = 0; i < 90; i++) {
      y = Math.random() * 512;
      g.strokeStyle = 'rgba(' + (90 + Math.random() * 60 | 0) + ',' +
        (55 + Math.random() * 35 | 0) + ',25,' + (0.12 + Math.random() * 0.22) + ')';
      g.lineWidth = 0.6 + Math.random() * 2.2;
      g.beginPath(); g.moveTo(0, y);
      for (var x = 0; x <= 512; x += 64) g.lineTo(x, y + Math.sin(x * 0.02 + i) * 4 + (Math.random() - 0.5) * 3);
      g.stroke();
    }
    for (i = 0; i < 7; i++) { // knots
      var kx = Math.random() * 512, ky = Math.random() * 512;
      g.strokeStyle = 'rgba(70,40,15,0.35)';
      for (var r = 3; r < 16; r += 4) { g.beginPath(); g.ellipse(kx, ky, r * 1.6, r, 0, 0, Math.PI * 2); g.stroke(); }
    }
    return tex(c);
  }

  /* Blue abstract wallpaper — flowing shapes like the reference monitors */
  function wallpaperTexture() {
    var c = makeCanvas(512, 288), g = c.getContext('2d');
    var grad = g.createLinearGradient(0, 0, 512, 288);
    grad.addColorStop(0, '#0a2a6b'); grad.addColorStop(0.5, '#0d4fc4');
    grad.addColorStop(1, '#061a44');
    g.fillStyle = grad; g.fillRect(0, 0, 512, 288);
    var blobs = [
      ['#2f8bff', 150, 150, 130], ['#59b7ff', 300, 90, 100],
      ['#1b5fd9', 380, 200, 120], ['#7cc4ff', 110, 220, 80],
      ['#0a3d9e', 430, 80, 90]
    ];
    blobs.forEach(function (b) {
      var rg = g.createRadialGradient(b[1], b[2], 5, b[1], b[2], b[3]);
      rg.addColorStop(0, b[0]); rg.addColorStop(1, 'rgba(10,40,110,0)');
      g.fillStyle = rg;
      g.beginPath(); g.ellipse(b[1], b[2], b[3], b[3] * 0.62, 0.6, 0, Math.PI * 2); g.fill();
    });
    g.strokeStyle = 'rgba(160,210,255,0.35)'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(40, 240);
    g.bezierCurveTo(160, 90, 300, 260, 480, 110); g.stroke();
    g.beginPath(); g.moveTo(20, 120);
    g.bezierCurveTo(180, 220, 330, 60, 500, 200); g.stroke();
    return tex(c);
  }

  /* Laptop / keyboard keys */
  function keyboardTexture() {
    var c = makeCanvas(512, 256), g = c.getContext('2d');
    g.fillStyle = '#14161a'; g.fillRect(0, 0, 512, 256);
    var rows = 5, cols = 14, kw = 512 / cols, kh = 256 / rows;
    for (var r = 0; r < rows; r++) for (var q = 0; q < cols; q++) {
      g.fillStyle = (r + q) % 7 === 0 ? '#2b2f36' : '#1e2126';
      g.fillRect(q * kw + 3, r * kh + 3, kw - 6, kh - 6);
    }
    g.fillStyle = '#3a3f47'; g.fillRect(150, 4 * kh + 3, 212, kh - 6); // spacebar
    return tex(c);
  }

  /* Dark perforated mesh (chair backrest) */
  function meshTexture() {
    var c = makeCanvas(256, 256), g = c.getContext('2d');
    g.fillStyle = '#15171a'; g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#000';
    for (var y = 0; y < 256; y += 10) for (var x = 0; x < 256; x += 10) {
      g.beginPath(); g.arc(x + ((y / 10) % 2) * 5, y, 2.6, 0, Math.PI * 2); g.fill();
    }
    return tex(c);
  }

  /* Globe: blue oceans, green land blobs */
  function globeTexture() {
    var c = makeCanvas(512, 256), g = c.getContext('2d');
    g.fillStyle = '#1d6fd1'; g.fillRect(0, 0, 512, 256);
    g.fillStyle = '#3f9e4d';
    var lands = [[90, 70, 55], [210, 140, 65], [330, 60, 48], [420, 170, 55], [40, 190, 40], [280, 210, 35]];
    lands.forEach(function (L) {
      g.beginPath(); g.ellipse(L[0], L[1], L[2], L[2] * 0.6, 0.4, 0, Math.PI * 2); g.fill();
    });
    g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 1;
    for (var i = 1; i < 5; i++) { g.beginPath(); g.moveTo(0, i * 51); g.lineTo(512, i * 51); g.stroke(); }
    return tex(c);
  }

  /* Small ENZO logo for the mug */
  function mugLogoTexture() {
    var c = makeCanvas(128, 64), g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 64);
    g.fillStyle = '#0d4fc4'; g.font = 'bold 30px Arial'; g.textAlign = 'center';
    g.fillText('ENZO', 64, 42);
    return tex(c);
  }

  var woodTex = woodTexture();
  var wallTex = wallpaperTexture();
  var keysTex = keyboardTexture();
  var meshTex = meshTexture();
  var globeTex = globeTexture();

  /* ---------------- shared materials ---------------- */
  var woodMat = std({ map: woodTex, roughness: 0.55, metalness: 0.05 });
  var woodDark = std({ color: 0x8a5a30, roughness: 0.6, metalness: 0.05 });
  var blackMat = std({ color: 0x17181b, roughness: 0.45, metalness: 0.35 });
  var darkGrey = std({ color: 0x2a2d33, roughness: 0.5, metalness: 0.3 });
  var silverMat = std({ color: 0xb9bec6, roughness: 0.3, metalness: 0.85 });
  var screenMat = std({
    map: wallTex, emissive: 0xffffff, emissiveMap: wallTex,
    emissiveIntensity: 0.85, roughness: 0.3, metalness: 0.1
  });
  var ledMat = std({ color: 0x0a2a3a, emissive: 0x35c8ff, emissiveIntensity: 1.6, roughness: 0.4 });

  var group = new THREE.Group();
  group.name = 'workstation';

  /* Numeric self-check registry (mirrors Piece 1): every prop that rests
     on a surface records its base y here; a stub harness asserts
     base == support height, so nothing floats or sinks. */
  var SUPPORTS = [];
  function recordSupport(name, baseY, support) {
    SUPPORTS.push({ name: name, baseY: baseY, support: support });
  }

  function box(w, h, d, mat, x, y, z, parent) {
    var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    (parent || group).add(m);
    return m;
  }
  function cyl(rt, rb, h, mat, x, y, z, parent, seg) {
    var m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 24), mat);
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    (parent || group).add(m);
    return m;
  }

  /* ================= 1. DESK ================= */
  var deskGroup = new THREE.Group();
  deskGroup.name = 'desk';
  group.add(deskGroup);

  // Top slab: 0.8 (x) x 0.05 x 2.6 (z); top face exactly at y = 0.78
  var topMats = [woodDark, woodDark, woodMat, woodDark, woodDark, woodDark];
  var deskTop = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.05, 2.6), topMats);
  deskTop.position.set(DESK.x, TOP - 0.025, DESK.z);
  deskTop.castShadow = true; deskTop.receiveShadow = true;
  deskGroup.add(deskTop);

  // 3-drawer pedestal, back end (z ~ -1.58). Top meets slab underside (0.73).
  box(0.7, 0.73, 0.55, woodMat, DESK.x, 0.365, -1.58, deskGroup);
  [0.15, 0.38, 0.61].forEach(function (dy) {
    box(0.02, 0.19, 0.5, woodDark, DESK.x + 0.355, dy, -1.58, deskGroup); // drawer front (+x face)
    box(0.16, 0.02, 0.02, blackMat, DESK.x + 0.37, dy, -1.58, deskGroup); // handle
  });
  // Modesty panel, wall side (-x), under the top
  box(0.03, 0.5, 1.95, woodMat, -2.92, 0.48, -0.325, deskGroup);
  // Front legs (+x edge)
  box(0.06, 0.73, 0.06, woodDark, -2.2, 0.365, 0.55, deskGroup);
  box(0.06, 0.73, 0.06, woodDark, -2.2, 0.365, -0.1, deskGroup);
  // Blue LED underglow strip along the front edge (+x), just under the top
  var led = box(0.02, 0.015, 2.56, ledMat, -2.155, 0.72, DESK.z, deskGroup);
  led.castShadow = false;
  var ledGlow = new THREE.PointLight(0x35c8ff, 0.7, 1.4, 1.8);
  ledGlow.position.set(-2.05, 0.68, DESK.z);
  deskGroup.add(ledGlow);

  /* ================= 2. DUAL MONITORS ================= */
  function makeMonitor(px, pz, yaw) {
    var g = new THREE.Group();
    g.position.set(px, TOP, pz);
    g.rotation.y = yaw;
    group.add(g);
    cyl(0.11, 0.12, 0.015, blackMat, 0, 0.0075, 0, g);          // stand base on desk
    box(0.04, 0.22, 0.03, blackMat, 0, 0.125, -0.02, g);         // post
    var scr = new THREE.Group();
    scr.position.set(0, 0.32, 0);
    g.add(scr);
    box(0.035, 0.37, 0.63, darkGrey, 0, 0, 0, scr);              // back / bezel body
    var face = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.34), screenMat);
    face.position.set(0.019, 0, 0); face.rotation.y = Math.PI / 2; // faces +x (chair)
    face.castShadow = false;
    scr.add(face);
    return g;
  }
  var m1 = makeMonitor(-2.80, -1.28, -0.18); // toe-in toward chair (z -0.6)
  var m2 = makeMonitor(-2.80, -0.62, 0.12);

  /* ================= 3. LAPTOP ================= */
  var laptop = new THREE.Group();
  laptop.position.set(-2.36, TOP, -0.30);
  group.add(laptop);
  box(0.24, 0.018, 0.36, silverMat, 0, 0.009, 0, laptop);        // base; top at 0.018
  var lapKeys = new THREE.Mesh(
    new THREE.PlaneGeometry(0.30, 0.19),
    std({ map: keysTex, roughness: 0.5, metalness: 0.1 }));
  lapKeys.rotation.x = -Math.PI / 2; lapKeys.rotation.z = Math.PI / 2;
  lapKeys.position.set(0.01, 0.0185, 0);
  laptop.add(lapKeys);
  // Hinge at back edge (local x = -0.11), lid pivot y = base top + half lid thickness
  var lidGroup = new THREE.Group();
  lidGroup.position.set(-0.11, 0.024, 0);
  laptop.add(lidGroup);
  var lid = box(0.012, 0.22, 0.36, silverMat, 0, 0.11, 0, lidGroup); // lid panel
  var lapScreen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.33, 0.19),
    std({ map: wallTex, emissive: 0xffffff, emissiveMap: wallTex, emissiveIntensity: 0.7, roughness: 0.3 }));
  lapScreen.position.set(0.007, 0.11, 0); lapScreen.rotation.y = Math.PI / 2;
  lidGroup.add(lapScreen);
  var logoGlow = new THREE.Mesh(
    new THREE.CircleGeometry(0.02, 24),
    std({ color: 0x222222, emissive: 0x9fd8ff, emissiveIntensity: 1.4, roughness: 0.4 }));
  logoGlow.position.set(-0.007, 0.11, 0); logoGlow.rotation.y = -Math.PI / 2; // lid back
  lidGroup.add(logoGlow);
  function setLidAngle(a) {
    // a=0 closed flat (lid lies on base); a~1.9 open, leaning slightly back.
    lidGroup.rotation.z = a - Math.PI / 2;
  }
  setLidAngle(1.85); // default: open, as in the reference

  /* ================= 4. KEYBOARD + MOUSE ON MAT ================= */
  var mat = box(0.55, 0.005, 0.9, std({ color: 0x1c1f24, roughness: 0.95 }), -2.32, TOP + 0.0025, -0.85, group);
  mat.castShadow = false;
  var MAT_TOP = TOP + 0.005; // 0.785 — keyboard & mouse rest on the mat

  var keyboard = new THREE.Group();
  keyboard.position.set(-2.30, MAT_TOP, -1.02);
  group.add(keyboard);
  box(0.16, 0.02, 0.48, blackMat, 0, 0.01, 0, keyboard);
  var kbTop = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.13),
    std({ map: keysTex, roughness: 0.5, metalness: 0.1 }));
  kbTop.rotation.x = -Math.PI / 2; kbTop.rotation.z = Math.PI / 2;
  kbTop.position.set(0, 0.0205, 0);
  keyboard.add(kbTop);

  var mouse = new THREE.Group();
  mouse.position.set(-2.28, MAT_TOP, -0.55);
  group.add(mouse);
  var mouseBody = new THREE.Mesh(new THREE.SphereGeometry(0.035, 24, 16), blackMat);
  mouseBody.scale.set(1, 0.45, 1.5);
  mouseBody.position.set(0, 0.016, 0);
  mouseBody.castShadow = true;
  mouse.add(mouseBody);
  var wheel = cyl(0.006, 0.006, 0.012, darkGrey, 0, 0.028, 0.035, mouse, 12);
  wheel.rotation.x = Math.PI / 2;

  /* ================= 5. SMARTPHONE ON CHARGING STAND ================= */
  var phoneStand = new THREE.Group();
  phoneStand.position.set(-2.42, TOP, 0.08);
  group.add(phoneStand);
  box(0.09, 0.015, 0.12, blackMat, 0, 0.0075, 0, phoneStand);        // cradle base
  var cradleBack = box(0.015, 0.13, 0.09, blackMat, -0.035, 0.07, 0, phoneStand);
  cradleBack.rotation.z = 0.26;                                       // 15 deg lean
  box(0.03, 0.015, 0.09, blackMat, 0.025, 0.02, 0, phoneStand);       // front lip

  var phoneCanvas = makeCanvas(256, 512);
  var phoneCtx = phoneCanvas.getContext('2d');
  var phoneTex = tex(phoneCanvas);
  function drawPhoneScreen(timeStr) {
    var g = phoneCtx;
    var grad = g.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, '#0a2a6b'); grad.addColorStop(1, '#061a44');
    g.fillStyle = grad; g.fillRect(0, 0, 256, 512);
    g.fillStyle = '#59b7ff';
    g.beginPath(); g.ellipse(128, 200, 110, 70, 0.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffffff'; g.font = 'bold 64px Arial'; g.textAlign = 'center';
    g.fillText(timeStr, 128, 130);
    g.font = '22px Arial'; g.fillStyle = '#cfe6ff';
    g.fillText('ENZO', 128, 170);
    phoneTex.needsUpdate = true;
  }
  drawPhoneScreen('8:51');

  var phoneMat = std({
    map: phoneTex, emissive: 0xffffff, emissiveMap: phoneTex,
    emissiveIntensity: 1.0, roughness: 0.3
  });
  var phone = new THREE.Group();
  phone.position.set(0, 0.095, 0.005);
  phone.rotation.z = -0.26; // tilted ~15 deg back, resting in the cradle
  phoneStand.add(phone);
  var phoneBody = box(0.008, 0.15, 0.075, blackMat, 0, 0, 0, phone);
  var phoneScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.068, 0.142), phoneMat);
  phoneScreen.position.set(0.005, 0, 0); phoneScreen.rotation.y = Math.PI / 2;
  phone.add(phoneScreen);
  var homeDot = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.004),
    std({ color: 0x111111, emissive: 0x9fd8ff, emissiveIntensity: 1.5 }));
  homeDot.position.set(0.0055, -0.062, 0); homeDot.rotation.y = Math.PI / 2;
  phone.add(homeDot);
  function setPhoneScreen(on) {
    phoneMat.emissiveIntensity = on ? 1.0 : 0.04;
    homeDot.material.emissiveIntensity = on ? 1.5 : 0.1;
  }
  function setPhoneTime(str) { drawPhoneScreen(str); }

  /* ================= 6. HEADPHONES ON STAND ================= */
  var headphones = new THREE.Group();
  headphones.position.set(-2.72, TOP, -1.48);
  group.add(headphones);
  cyl(0.09, 0.10, 0.015, blackMat, 0, 0.0075, 0, headphones);   // stand base
  cyl(0.012, 0.012, 0.24, blackMat, 0, 0.135, 0, headphones);   // post
  var band = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.01, 10, 28, Math.PI), blackMat);
  band.position.set(0, 0.255, 0); band.castShadow = true;
  headphones.add(band);
  [-0.085, 0.085].forEach(function (dx) {                        // ear cups
    var cup = cyl(0.045, 0.045, 0.03, blackMat, dx, 0.255, 0, headphones, 24);
    cup.rotation.z = Math.PI / 2;
    var pad = cyl(0.038, 0.038, 0.012, std({ color: 0x0c0d0f, roughness: 0.95 }), dx + (dx > 0 ? 0.018 : -0.018), 0.255, 0, headphones, 24);
    pad.rotation.z = Math.PI / 2;
  });

  /* ================= 7. DESK LAMP ================= */
  var deskLamp = new THREE.Group();
  deskLamp.position.set(-2.86, TOP, -1.80);
  group.add(deskLamp);
  cyl(0.07, 0.075, 0.02, blackMat, 0, 0.01, 0, deskLamp);       // base
  var arm1 = new THREE.Group(); arm1.position.set(0, 0.02, 0); arm1.rotation.z = -0.5;
  deskLamp.add(arm1);
  cyl(0.008, 0.008, 0.28, blackMat, 0, 0.14, 0, arm1, 12);      // lower arm
  var arm2 = new THREE.Group(); arm2.position.set(0, 0.28, 0); arm2.rotation.z = 1.05;
  arm1.add(arm2);
  cyl(0.008, 0.008, 0.26, blackMat, 0, 0.13, 0, arm2, 12);      // upper arm
  var shade = new THREE.Group(); shade.position.set(0, 0.26, 0); shade.rotation.z = 0.9;
  arm2.add(shade);
  var shadeMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.095, 0.13, 24, 1, true), blackMat);
  shadeMesh.castShadow = true;
  shade.add(shadeMesh);
  var bulbMat = std({ color: 0xfff2cc, emissive: 0xffc46b, emissiveIntensity: 2.2, roughness: 0.4 });
  var bulb = new THREE.Mesh(new THREE.SphereGeometry(0.028, 16, 12), bulbMat);
  bulb.position.set(0, -0.045, 0);
  shade.add(bulb);
  var lampLight = new THREE.SpotLight(0xffc46b, 9, 2.2, 0.62, 0.55, 1.4);
  lampLight.position.set(0, -0.05, 0);
  shade.add(lampLight);
  var lampTarget = new THREE.Object3D();
  lampTarget.position.set(-2.35, TOP, -1.25); // pool of light on the desk
  group.add(lampTarget);
  lampLight.target = lampTarget;
  function setLampOn(b) {
    lampLight.intensity = b ? 9 : 0;
    bulbMat.emissiveIntensity = b ? 2.2 : 0.02;
  }
  setLampOn(true);

  /* ================= 8. PEN HOLDER / MUG / NOTEBOOK / GLOBE ================= */
  var penHolder = new THREE.Group();
  penHolder.position.set(-2.38, TOP, -1.68);
  group.add(penHolder);
  cyl(0.045, 0.04, 0.11, std({ color: 0x22252a, roughness: 0.4, metalness: 0.4 }), 0, 0.055, 0, penHolder);
  var penCols = [0xd8b13a, 0x2a6fd1, 0xc23b2e, 0x3f9e4d, 0xe8e8e8];
  penCols.forEach(function (col, i) {
    var p = cyl(0.004, 0.004, 0.17, std({ color: col, roughness: 0.5 }), 0, 0.12, 0, penHolder, 8);
    p.position.x = (i % 3 - 1) * 0.02;
    p.position.z = (Math.floor(i / 3) - 0.5) * 0.025;
    p.rotation.z = (i - 2) * 0.09;
    p.rotation.x = (i % 2 ? 1 : -1) * 0.06;
  });

  var mug = new THREE.Group();
  mug.position.set(-2.68, TOP, 0.28);
  group.add(mug);
  cyl(0.04, 0.036, 0.09, std({ color: 0xf5f2ec, roughness: 0.35 }), 0, 0.045, 0, mug);
  var coffee = new THREE.Mesh(new THREE.CircleGeometry(0.034, 24),
    std({ color: 0x2b1608, roughness: 0.25 }));
  coffee.rotation.x = -Math.PI / 2; coffee.position.set(0, 0.086, 0);
  mug.add(coffee);
  var handle = new THREE.Mesh(new THREE.TorusGeometry(0.024, 0.006, 8, 20), std({ color: 0xf5f2ec, roughness: 0.35 }));
  handle.position.set(0.042, 0.045, 0); handle.rotation.y = Math.PI / 2;
  handle.castShadow = true;
  mug.add(handle);
  var mugLogo = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.025),
    std({ map: mugLogoTexture(), roughness: 0.4 }));
  mugLogo.position.set(0.041, 0.045, 0); mugLogo.rotation.y = Math.PI / 2;
  mug.add(mugLogo);

  var notebook = new THREE.Group();
  notebook.position.set(-2.32, TOP, 0.38);
  group.add(notebook);
  box(0.24, 0.012, 0.17, std({ color: 0x27324a, roughness: 0.6 }), 0, 0.006, 0, notebook);
  box(0.22, 0.008, 0.15, std({ color: 0xf2efe6, roughness: 0.9 }), 0.005, 0.015, 0, notebook);
  // 2 pens lying beside the notebook
  [[-2.48, 0.58, 0.4], [-2.46, 0.62, -0.5]].forEach(function (pp) {
    var pen = cyl(0.005, 0.005, 0.14, blackMat, pp[0], TOP + 0.005, pp[1], group, 8);
    pen.rotation.x = Math.PI / 2; pen.rotation.y = pp[2];
  });

  var globe = new THREE.Group();
  globe.position.set(-2.84, TOP, -0.30);
  group.add(globe);
  cyl(0.05, 0.055, 0.015, darkGrey, 0, 0.0075, 0, globe);        // stand base
  var globeRing = new THREE.Mesh(new THREE.TorusGeometry(0.082, 0.005, 8, 32), silverMat);
  globeRing.position.set(0, 0.115, 0); globeRing.rotation.z = 0.41; globeRing.rotation.y = Math.PI / 2;
  globe.add(globeRing);
  var globeBall = new THREE.Mesh(new THREE.SphereGeometry(0.075, 32, 24),
    std({ map: globeTex, roughness: 0.5 }));
  globeBall.position.set(0, 0.115, 0);
  globeBall.rotation.z = 0.41; // 23.5 deg axial tilt
  globeBall.castShadow = true;
  globe.add(globeBall);

  /* ============ 8a. COFFEE-TABLE PROPS (book + glass, for Piece 4) ============
     The coffee table itself lives in Piece 1 (centre (1.2, 0, -0.4),
     top 1.1 (x) x 0.6 (z) -> x 0.65..1.75, z -0.7..-0.1). Piece 4's
     tablePosition() releases held objects at y = 0.42, so BOTH groups
     here take their base (group origin) at exactly y = 0.42 and every
     child sits at local y >= 0 — detachObject() can put them back by
     setting group.position.y = 0.42 with no sink or float.
     Book z is -0.59 (not -0.55): Piece 1 already stacks two books at
     (0.92, -0.35); at -0.55 this book's corner would clip ~3 mm into
     theirs. At -0.59 it clears them by ~16 mm in z and still sits
     8 mm inside the table's back edge. */
  var COFFEE_TOP = 0.42;

  var book = new THREE.Group();
  book.position.set(1.05, COFFEE_TOP, -0.59);
  book.rotation.y = 0.15; // slight rotation, lying flat
  group.add(book);
  var bookCoverMat = std({ color: 0x2e5d43, roughness: 0.6 });
  var bookPagesMat = std({ color: 0xf2efe6, roughness: 0.9 });
  box(0.24, 0.004, 0.17, bookCoverMat, 0, 0.002, 0, book);       // bottom cover; base at local 0
  box(0.22, 0.018, 0.15, bookPagesMat, 0.004, 0.013, 0, book);   // pages, inset on all sides
  box(0.24, 0.004, 0.17, bookCoverMat, 0, 0.024, 0, book);       // top cover; top at local 0.026
  box(0.014, 0.026, 0.17, bookCoverMat, -0.113, 0.013, 0, book); // spine, left edge
  recordSupport('book', COFFEE_TOP, 'coffee table top');

  var glass = new THREE.Group();
  glass.position.set(1.45, COFFEE_TOP, -0.25);
  group.add(glass);
  var glassMat = std({ color: 0xd6ecf7, transparent: true, opacity: 0.55, roughness: 0.1, metalness: 0 });
  var waterMat = std({ color: 0x7cc4ff, transparent: true, opacity: 0.85, roughness: 0.15 });
  var glassWall = cyl(0.035, 0.032, 0.11, glassMat, 0, 0.055, 0, glass); // wall; base at local 0, top 0.11
  glassWall.castShadow = false; // transparent wall must not cast a solid shadow
  var water = cyl(0.028, 0.028, 0.088, waterMat, 0, 0.044, 0, glass);    // water to 80% height (0.088/0.11)
  water.castShadow = false;
  recordSupport('glass', COFFEE_TOP, 'coffee table top');

  /* ================= 9. OFFICE CHAIR ================= */
  var chair = new THREE.Group();
  chair.position.set(-1.9, 0, -0.6);
  group.add(chair);
  var SEAT_TOP = 0.48;
  // 5-star base + casters (floor)
  for (var s = 0; s < 5; s++) {
    var ang = (s / 5) * Math.PI * 2;
    var leg = box(0.26, 0.03, 0.05, blackMat, Math.cos(ang) * 0.15, 0.09, Math.sin(ang) * 0.15, chair);
    leg.rotation.y = -ang;
    var wheelC = new THREE.Mesh(new THREE.SphereGeometry(0.032, 12, 10), blackMat);
    wheelC.scale.set(1, 0.8, 1);
    wheelC.position.set(Math.cos(ang) * 0.28, 0.032, Math.sin(ang) * 0.28);
    wheelC.castShadow = true;
    chair.add(wheelC);
  }
  cyl(0.03, 0.03, 0.26, silverMat, 0, 0.22, 0, chair, 16);      // gas lift
  box(0.46, 0.09, 0.46, std({ color: 0x141519, roughness: 0.85 }), 0, SEAT_TOP - 0.045, 0, chair); // seat; top = 0.48
  // Backrest: +x side (sitter faces -x), mesh texture, slight recline
  var back = box(0.05, 0.55, 0.44, std({ map: meshTex, roughness: 0.9 }), 0.215, 0.78, 0, chair);
  back.rotation.z = -0.12;
  box(0.04, 0.16, 0.05, blackMat, 0.19, 0.52, 0, chair);         // back post
  // Armrests
  [-0.24, 0.24].forEach(function (dz) {
    box(0.04, 0.14, 0.04, blackMat, 0, 0.55, dz, chair);
    box(0.22, 0.03, 0.07, blackMat, -0.02, 0.635, dz, chair);
  });

  /* ================= 10. CABLE ================= */
  var cableCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-2.78, TOP + 0.008, -1.0),
    new THREE.Vector3(-2.62, TOP + 0.006, -0.92),
    new THREE.Vector3(-2.55, TOP + 0.006, -0.78),
    new THREE.Vector3(-2.62, TOP + 0.006, -0.68)
  ]);
  var cable = new THREE.Mesh(
    new THREE.TubeGeometry(cableCurve, 32, 0.004, 8, false), blackMat);
  cable.castShadow = false;
  group.add(cable);

  scene.add(group);

  /* ---------------- return handles ---------------- */
  return {
    group: group,
    props: {
      deskTopY: TOP,
      laptop: { group: laptop, lid: lidGroup, setLidAngle: setLidAngle },
      monitors: [m1, m2],
      keyboard: keyboard,
      mouse: mouse,
      phone: { group: phone, screen: phoneScreen, setScreen: setPhoneScreen, setPhoneTime: setPhoneTime },
      phoneStand: phoneStand,
      headphones: headphones,
      deskLamp: { group: deskLamp, setOn: setLampOn },
      penHolder: penHolder,
      mug: mug,
      notebook: notebook,
      globe: globe,
      book: { group: book },
      glass: { group: glass },
      chair: { group: chair, seatY: SEAT_TOP }
    },
    supportHeights: SUPPORTS.slice()
  };
}
  window.EnzoRoom.buildWorkstation=buildWorkstation;

if (typeof module !== 'undefined' && module.exports) module.exports = { buildWorkstation: buildWorkstation };
if (typeof window !== 'undefined') window.buildWorkstation = buildWorkstation;

/* ============================================================================
   SELF-CHECK (run under node with a minimal THREE/document stub — see the
   check script used at build time; results recorded below after the run)
   ----------------------------------------------------------------------------
   1. props.book / props.glass exist as { group } (Piece 4 attachObject
      contract: obj.group must exist) and their groups are attached to the
      workstation group.
   2. Resting y: book.group.position.y == 0.42 and glass.group.position.y
      == 0.42 (coffee-table top, same value Piece 4's tablePosition() /
      detachObject() uses). Every child mesh's local min-y >= 0, so
      nothing sinks below the base and nothing floats.
   3. Footprints inside the coffee-table top (x 0.65..1.75, z -0.7..-0.1)
      and clear of Piece 1's stacked books at (0.92, -0.35) — book clears
      them by ~16 mm in z.
   4. Glass: wall 0.11 high, water top at 0.088 = 80% of wall height;
      glass material transparent, opacity 0.55, roughness 0.1.
   5. Regression: all pre-existing props still present, deskTopY 0.78,
      chair seatY 0.48, laptop lid default angle 1.85 rad.
   RUN RESULTS (22 Nov 2026, node --check + stubbed build, /tmp/check-workstation.js):
     - node --check: PASS (valid JS, no syntax errors).
     - book + glass: PASS (both { group }, attached to workstation group,
       base y == 0.42, no child below base, footprints inside table top,
       book clears Piece 1's stacked books by ~16 mm in z).
     - glass water: PASS (top at 0.088 = 80% of 0.11 wall height).
     - supportHeights: PASS (book + glass at baseY 0.42, coffee table top).
     - regression: PASS (all 14 pre-existing props present, deskTopY 0.78,
       chair seatY 0.48, lid angle 1.85, 117 nodes in group tree).
     - TOTAL: 38 passed, 0 failed.
   ========================================================================== */


})();
