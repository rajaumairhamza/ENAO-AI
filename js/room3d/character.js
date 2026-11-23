(function(){
  'use strict';
  if(!window.EnzoRoom||!window.EnzoRoom.threeOK){ return; }
/* ---- PIECE 3 — CHARACTER (ONE canonical ENZO) ---- */
/**
 * ============================================================================
 * PIECE 03 — CHARACTER CONSISTENCY (canonical ENZO model)
 * ENZO 3D room rebuild · artifact slug: enao-ai
 * ----------------------------------------------------------------------------
 * INTEGRATION NOTE — read this first
 * ----------------------------------------------------------------------------
 * This file builds ENZO exactly ONCE. There are no per-animation variants:
 * the animation piece (movement / gestures / lip-sync) and the camera piece
 * must ONLY move the handles this file exposes — never rebuild, rescale or
 * swap any mesh. Same face, eyes, body, hands, legs and blue lights in
 * EVERY animation.
 *
 *   const enzo = buildEnzo(THREE);
 *   roomGroup.add(enzo.group);            // feet at local y = 0
 *
 *   // Movement piece: walk / idle / turn / teleport-run
 *   enzo.group.position / enzo.group.rotation.y   // root only
 *   enzo.legL.hip.rotation.x  etc.                // joints, via clampJoints()
 *
 *   // Gesture / expression piece:
 *   enzo.setExpression('thinking');               // face + lights
 *   enzo.blink();                                 // 100 ms eye blink
 *   enzo.setSpeaking(0.0 - 1.0);                  // mouth open amount
 *   enzo.resetPose();                             // neutral standing
 *   enzo.clampJoints();                           // call after any joint write
 *
 *   // Camera piece: frame on enzo.head (world y ~1.08) or enzo.group.
 *   // Glow pulse: enzo.glowMaterial.emissiveIntensity = 1.0 + 0.4*sin(t)
 *   //   (ONE shared material drives every blue light, so it pulses evenly.)
 *
 * JOINT HIERARCHY (pivot origins — rotations happen around these points)
 * ----------------------------------------------------------------------------
 *   enzo.group (root, origin at floor between the feet, y = 0)
 *   ├─ legL.hip  (Group @ -0.095, 0.34, 0)
 *   │   ├─ thigh mesh, hip ring light
 *   │   └─ legL.knee (Group @ 0, -0.135, 0 rel. hip → world y 0.205)
 *   │       ├─ shin mesh, knee ring light
 *   │       └─ legL.ankle (Group @ 0, -0.135, 0 rel. knee → world y 0.07)
 *   │           └─ legL.foot (boot mesh; sole at y = 0)
 *   ├─ legR.hip … (mirror of legL)
 *   └─ torso (Group @ 0, 0.34, 0 — origin at hip line)
 *       ├─ pelvis, abdomen, chest, chestPlate ('ENZO' canvas texture)
 *       ├─ neck cylinder + neck ring light
 *       ├─ armL.shoulder (Group @ -0.198, 0.324, 0 rel. torso → world y 0.664)
 *       │   ├─ upper-arm mesh, shoulder ring light
 *       │   └─ armL.elbow (Group @ 0, -0.198, 0)
 *       │       ├─ forearm mesh, elbow ring light
 *       │       └─ armL.wrist (Group @ 0, -0.189, 0)
 *       │           └─ armL.hand: palm mesh + fingers[0..4] (thumb first)
 *       ├─ armR.shoulder … (mirror of armL)
 *       └─ head (Group @ 0, 0.405, 0 rel. torso → world y 0.745, neck base)
 *           └─ helmet shell, facePlate, eyes, mouth, ears, antenna
 *               (all face meshes offset +0.335 in y inside this group, so the
 *                head pivots at the neck, not at its own centre)
 *
 * LOCKED DESIGN (Raja's Master Character Design Sheet — never change)
 * ----------------------------------------------------------------------------
 * Colours: glossy white #F8FAFC · metallic silver #CBD5E1 · face black
 * #080D1A · electric blue #3B82F6 · cyan glow #00D9FF · purple #8B5CF6 accent ·
 * green #22C55E + amber #F59E0B tiny accents only.
 * Proportions (total height 1.35 m, per the sheet's scale reference:
 * ENZO 4.5 ft / 1.35 m vs human 5.8 ft / 1.75 m): head 0.54 m (40%) ·
 * torso 0.405 m (30%) · legs hip→ankle 0.27 m (20%) · neck 0.065 m ·
 * boots 0.07 m. Antenna tip may extend slightly above 1.35 m.
 * Reference: ~/workspace/user/media_library/image/db91288d-04d7-4e94-95fc-b627cacd576a.png
 * Sheet expressions: Neutral, Happy, Curious, Thinking (+ spec: Surprised,
 * Speaking, Listening). Bonus extras must never break those 7.
 * Sheet details: glossy black oval face screen; two big glowing cyan-blue
 * eyes; friendly animated digital smile; white + silver metallic outer head
 * frame; circular mechanical side ear components with blue rings; small blue
 * illuminated details on the head; rectangular digital chest display with
 * the exact name 'ENZO' (glowing cyan); blue LED accents on shoulders,
 * chest, arms, waist, legs; articulated knees + ankles; stable realistic
 * robotic feet; 5 clear robotic fingers per hand; dark metallic silver joints.
 *
 * PAST-BUG GUARD: the face plate is a black ellipsoid whose front (z = 0.289)
 * sits PROUD of the helmet shell front (z = 0.2592). It is never buried
 * inside the shell. Eyes / mouth sit on the face plate surface, never
 * inside the helmet. See MEASUREMENTS.faceFrontZ / helmetFrontZ.
 * EXPRESSION RULE (sheet consistency): expressions change ONLY eye/mouth
 * scale, mouth rotation, head tilt and glow. Eye base positions
 * (userData.baseX / baseY), the face plate and every other mesh NEVER move
 * between expressions. setExpression() always starts from resetFace().
 * ============================================================================
 */

function buildEnzo(THREE) {
  'use strict';

  // --------------------------------------------------------------------------
  // Dimensions (metres, room scale). Single source of truth — the
  // measurements object at the bottom is derived from these, never re-typed.
  // Total 1.35 m = head 0.54 (40%) + torso 0.405 (30%) + legs 0.27 (20%)
  //               + neck 0.065 + boots 0.07 (remainder 10%).
  // --------------------------------------------------------------------------
  var TOTAL_HEIGHT = 1.35;
  var HEAD_R = 0.27;                 // helmet sphere radius
  var HEAD_H = HEAD_R * 2;           // 0.54 = 40% of total
  var HEAD_CY = 1.08;                // head centre, world y (head top 1.35)
  var HIP_Y = 0.34;                  // hip pivot, world y
  var KNEE_Y = 0.205;                // knee pivot, world y
  var ANKLE_Y = 0.07;                // ankle pivot, world y
  var BOOT_H = 0.07;                 // boot height; sole at y = 0
  var NECK_H = 0.065;                // neck height (neck base → head bottom)
  var NECK_BASE_Y = 0.745;           // neck pivot, world y
  var SHOULDER_Y = 0.664;            // shoulder pivot, world y
  var FACE_CENTRE = { x: 0, y: HEAD_CY, z: 0.10 };   // face-plate ellipsoid centre
  var FACE_RADII = { x: 0.225, y: 0.243, z: 0.189 }; // face-plate ellipsoid radii

  // Front-most z of helmet shell and of face plate (both at head centre height).
  var HELMET_FRONT_Z = HEAD_R * 0.96;                       // 0.2592
  var FACE_FRONT_Z = FACE_CENTRE.z + FACE_RADII.z;          // 0.289 — proud by ~0.030

  // Joint limits (radians), baked in — see LIMITS below.
  var D = (THREE.MathUtils && THREE.MathUtils.degToRad)
    ? THREE.MathUtils.degToRad
    : function (deg) { return deg * Math.PI / 180; };
  var clamp = (THREE.MathUtils && THREE.MathUtils.clamp)
    ? THREE.MathUtils.clamp
    : function (v, lo, hi) { return Math.min(hi, Math.max(lo, v)); };

  var LIMITS = {
    shoulder: { x: [-D(100), D(100)], y: [-D(45), D(45)], z: [-D(100), D(100)] },
    elbow:    { x: [-D(130), 0] },          // flexion is negative rotation.x
    wrist:    { x: [-D(30), D(30)], z: [-D(30), D(30)] },
    hip:      { x: [-D(90), D(90)], z: [-D(30), D(30)] },
    knee:     { x: [0, D(120)] },           // flexion is positive rotation.x
    ankle:    { x: [-D(25), D(25)], z: [-D(20), D(20)] },
    neck:     { yaw: [-D(35), D(35)], pitch: [-D(20), D(20)] }  // head.rotation
  };

  // --------------------------------------------------------------------------
  // Materials — one shared instance per surface so the whole model stays
  // consistent. glowBlue is shared by EVERY blue light (see lights array).
  // Physically based: glossy white body, metallic silver armour, deep glossy
  // black screen, bright cyan-blue eyes / LEDs.
  // --------------------------------------------------------------------------
  var matWhite = new THREE.MeshStandardMaterial({
    color: 0xF8FAFC, roughness: 0.30, metalness: 0.15   // glossy white body
  });
  var matHelmet = new THREE.MeshStandardMaterial({
    color: 0xF8FAFC, roughness: 0.22, metalness: 0.10   // glossy shell
  });
  var matSilver = new THREE.MeshStandardMaterial({
    color: 0xCBD5E1, roughness: 0.35, metalness: 0.60   // metallic silver armour
  });
  var matJointDark = new THREE.MeshStandardMaterial({
    color: 0x475569, roughness: 0.35, metalness: 0.85   // dark metallic silver joints
  });
  var matFace = new THREE.MeshStandardMaterial({
    color: 0x080D1A, roughness: 0.15, metalness: 0.20   // deep glossy black screen
  });
  var matDark = new THREE.MeshStandardMaterial({
    color: 0x0A1628, roughness: 0.30, metalness: 0.30
  });
  // Shared blue glow — chest ring, joint rings, boot lights, ear rings.
  var glowBlue = new THREE.MeshStandardMaterial({
    color: 0x3B82F6, emissive: 0x3B82F6, emissiveIntensity: 1.2,
    roughness: 0.30, metalness: 0.10
  });
  var matCyan = new THREE.MeshStandardMaterial({
    color: 0x062A33, emissive: 0x00D9FF, emissiveIntensity: 2.0,
    roughness: 0.25, metalness: 0.10
  });
  var matPurple = new THREE.MeshStandardMaterial({
    color: 0x8B5CF6, emissive: 0x8B5CF6, emissiveIntensity: 0.9,
    roughness: 0.35, metalness: 0.10
  });
  var matGreen = new THREE.MeshStandardMaterial({
    color: 0x22C55E, emissive: 0x22C55E, emissiveIntensity: 1.4,
    roughness: 0.35, metalness: 0.10
  });
  var matAmber = new THREE.MeshStandardMaterial({
    color: 0xF59E0B, emissive: 0xF59E0B, emissiveIntensity: 1.4,
    roughness: 0.35, metalness: 0.10
  });

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------
  function mesh(geo, mat, x, y, z) {
    var m = new THREE.Mesh(geo, mat);
    m.position.set(x || 0, y || 0, z || 0);
    return m;
  }
  function ring(radius, tube, mat) {
    // Torus in the XY plane (axis = Z). Callers rotate it to wrap a limb.
    return new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 10, 40), mat);
  }
  function capsule(r, len, mat, x, y, z) {
    return mesh(new THREE.CapsuleGeometry(r, len, 6, 16), mat, x, y, z);
  }

  // 'ENZO' chest-plate texture. Guarded: without a DOM (node self-check)
  // fall back to a plain dark plate so buildEnzo() still runs anywhere.
  var chestTexture = null;
  if (typeof document !== 'undefined' && THREE.CanvasTexture) {
    var cv = document.createElement('canvas');
    cv.width = 512; cv.height = 256;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#0A1628';
    ctx.fillRect(0, 0, 512, 256);
    ctx.strokeStyle = '#00D9FF';
    ctx.lineWidth = 6;
    ctx.strokeRect(14, 14, 484, 228);
    ctx.font = 'bold 118px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#00D9FF';
    ctx.shadowBlur = 28;
    ctx.fillStyle = '#00D9FF';
    ctx.fillText('ENZO', 256, 134);
    chestTexture = new THREE.CanvasTexture(cv);
  }
  var matChestFront = chestTexture
    ? new THREE.MeshStandardMaterial({
        map: chestTexture, emissive: 0xFFFFFF, emissiveMap: chestTexture,
        emissiveIntensity: 0.9, roughness: 0.30, metalness: 0.20
      })
    : new THREE.MeshStandardMaterial({
        color: 0x0A1628, emissive: 0x00D9FF, emissiveIntensity: 0.7,
        roughness: 0.30, metalness: 0.20
      });

  // --------------------------------------------------------------------------
  // Root
  // --------------------------------------------------------------------------
  var group = new THREE.Group();
  var lights = [];   // every blue-light mesh, all sharing glowBlue

  function addLight(parent, lightMesh) {
    lights.push(lightMesh);
    parent.add(lightMesh);
    return lightMesh;
  }

  // --------------------------------------------------------------------------
  // LEGS — hip pivot -> thigh -> knee pivot -> shin -> ankle pivot -> boot.
  // Hip y 0.34, knee y 0.205, ankle y 0.07, boot sole y 0.00.
  // --------------------------------------------------------------------------
  function buildLeg(side) {   // side: -1 = left, +1 = right
    var hip = new THREE.Group();
    hip.position.set(0.095 * side, HIP_Y, 0);

    var thigh = capsule(0.054, 0.027, matWhite, 0, -0.0675, 0);
    hip.add(thigh);
    var hipRing = ring(0.058, 0.008, glowBlue);
    hipRing.rotation.x = Math.PI / 2;
    hipRing.position.y = -0.018;
    addLight(hip, hipRing);
    // Silver hip cap.
    hip.add(mesh(new THREE.SphereGeometry(0.056, 24, 16), matSilver, 0, 0, 0));

    var knee = new THREE.Group();
    knee.position.set(0, -0.135, 0);
    hip.add(knee);
    knee.add(mesh(new THREE.SphereGeometry(0.058, 24, 16), matJointDark, 0, 0, 0));
    var kneeRing = ring(0.059, 0.008, glowBlue);
    kneeRing.rotation.x = Math.PI / 2;
    addLight(knee, kneeRing);

    var shin = capsule(0.045, 0.045, matWhite, 0, -0.0675, 0);
    knee.add(shin);

    var ankle = new THREE.Group();
    ankle.position.set(0, -0.135, 0);
    knee.add(ankle);

    // Boot: flat sole at y = 0 (ankle world y 0.07, boot centre -0.035 rel.
    // ankle, half-height 0.035 → sole exactly 0.00). Toe forward (+z).
    var boot = mesh(new THREE.BoxGeometry(0.10, BOOT_H, 0.18), matWhite, 0, -0.035, 0.027);
    ankle.add(boot);
    var toeCap = mesh(new THREE.BoxGeometry(0.095, 0.032, 0.045), matSilver, 0, -0.05, 0.104);
    ankle.add(toeCap);
    var bootLight = mesh(new THREE.BoxGeometry(0.063, 0.011, 0.011), glowBlue, 0, -0.018, 0.115);
    addLight(ankle, bootLight);
    var bootTopLight = ring(0.047, 0.006, glowBlue);
    bootTopLight.rotation.x = Math.PI / 2;
    bootTopLight.position.y = -0.0045;
    addLight(ankle, bootTopLight);

    return { hip: hip, knee: knee, ankle: ankle, foot: boot };
  }
  var legL = buildLeg(-1);
  var legR = buildLeg(1);
  group.add(legL.hip);
  group.add(legR.hip);

  // --------------------------------------------------------------------------
  // TORSO — group origin at hip line (world y 0.34). Chest top meets neck.
  // --------------------------------------------------------------------------
  var torso = new THREE.Group();
  torso.position.set(0, HIP_Y, 0);
  group.add(torso);

  var pelvis = mesh(new THREE.SphereGeometry(0.144, 32, 24), matWhite, 0, 0.027, 0);
  pelvis.scale.set(1.15, 0.55, 0.85);
  torso.add(pelvis);

  var abdomen = mesh(
    new THREE.CylinderGeometry(0.135, 0.117, 0.18, 32), matWhite, 0, 0.144, 0);
  torso.add(abdomen);
  var bellyLight = mesh(new THREE.SphereGeometry(0.011, 12, 8), matCyan, 0, 0.144, 0.133);
  torso.add(bellyLight);   // small cyan navel light (not a blue ring light)

  var chest = mesh(new THREE.SphereGeometry(0.171, 32, 24), matWhite, 0, 0.288, 0);
  chest.scale.set(1.05, 0.90, 0.74);
  torso.add(chest);

  // Chest ring light around the torso (ellipse, axis Y) — waist-level LED.
  var chestRing = ring(0.149, 0.007, glowBlue);
  chestRing.rotation.x = Math.PI / 2;
  chestRing.scale.set(1, 0.78, 1);
  chestRing.position.y = 0.212;
  addLight(torso, chestRing);

  // Chest plate: dark rounded box, 'ENZO' canvas texture on the +z face
  // (BoxGeometry material index 4). Front z ≈ 0.134, proud of the chest.
  var plateMats = [matDark, matDark, matDark, matDark, matChestFront, matDark];
  var chestPlate = new THREE.Mesh(new THREE.BoxGeometry(0.243, 0.153, 0.023), plateMats);
  chestPlate.position.set(0, 0.279, 0.122);
  torso.add(chestPlate);

  // Tiny status accents on the chest (green = ok, amber = attention).
  // Seated ON the chest surface (ellipsoid-checked), not floating.
  torso.add(mesh(new THREE.SphereGeometry(0.008, 10, 8), matGreen, 0.09, 0.374, 0.084));
  torso.add(mesh(new THREE.SphereGeometry(0.008, 10, 8), matAmber, 0.09, 0.347, 0.098));

  // Neck: silver cylinder + blue ring at its base.
  var neckMesh = mesh(new THREE.CylinderGeometry(0.05, 0.059, NECK_H, 24), matSilver, 0, 0.4375, 0);
  torso.add(neckMesh);
  var neckRing = ring(0.056, 0.007, glowBlue);
  neckRing.rotation.x = Math.PI / 2;
  neckRing.position.y = 0.41;
  addLight(torso, neckRing);

  // --------------------------------------------------------------------------
  // ARMS — shoulder pivot -> upper arm -> elbow pivot -> forearm ->
  // wrist pivot -> hand (palm + 5 separate finger meshes, thumb first).
  // Neutral pose: arms hang relaxed straight down at the sides.
  // --------------------------------------------------------------------------
  function buildHand(side) {   // side: -1 = left, +1 = right
    var hand = new THREE.Group();
    // Palm: rounded-ish white box, fingers point down (-y), palm faces +z.
    var palm = mesh(new THREE.BoxGeometry(0.052, 0.068, 0.023), matWhite, 0, -0.0405, 0);
    hand.add(palm);
    // Wrist cuff ring.
    var wristRing = ring(0.038, 0.006, glowBlue);
    wristRing.rotation.x = Math.PI / 2;
    wristRing.position.y = -0.0045;
    addLight(hand, wristRing);

    // Fingers: separate capsule meshes, geometry translated so each mesh
    // origin is its knuckle — rotating finger.rotation.x curls that finger.
    // Order: [thumb, index, middle, ring, pinky]. Thumb on the inner side
    // (toward the body): left hand +x, right hand -x.
    var fingers = [];
    var fingerSpecs = [
      { x: -0.022,  len: 0.031, r: 0.0068 },   // index
      { x: -0.0077, len: 0.036, r: 0.0072 },   // middle
      { x: 0.0077,  len: 0.033, r: 0.0070 },   // ring
      { x: 0.022,   len: 0.026, r: 0.0063 }    // pinky
    ];
    fingerSpecs.forEach(function (spec) {
      var geo = new THREE.CapsuleGeometry(spec.r, spec.len, 4, 10);
      geo.translate(0, -(spec.len / 2 + spec.r), 0);   // pivot at knuckle
      var f = new THREE.Mesh(geo, matWhite);
      f.position.set(spec.x, -0.072, 0.0036);
      hand.add(f);
      fingers.push(f);
    });
    // Thumb: angled out from the palm's inner edge, pointing down-forward.
    var thumbGeo = new THREE.CapsuleGeometry(0.0077, 0.023, 4, 10);
    thumbGeo.translate(0, -(0.023 / 2 + 0.0077), 0);
    var thumb = new THREE.Mesh(thumbGeo, matWhite);
    thumb.position.set(-0.0297 * side, -0.027, 0.0072);
    thumb.rotation.z = 0.85 * side;   // splay away from the palm
    thumb.rotation.x = -0.25;         // slightly forward
    hand.add(thumb);
    fingers.unshift(thumb);           // fingers[0] = thumb

    return { group: hand, palm: palm, fingers: fingers };
  }

  function buildArm(side) {   // side: -1 = left, +1 = right
    var shoulder = new THREE.Group();
    shoulder.position.set(0.198 * side, SHOULDER_Y - HIP_Y, 0);  // rel. torso
    torso.add(shoulder);
    shoulder.add(mesh(new THREE.SphereGeometry(0.050, 24, 16), matWhite, 0, 0, 0));
    var shoulderRing = ring(0.052, 0.008, glowBlue);
    shoulderRing.rotation.x = Math.PI / 2;
    shoulderRing.position.y = -0.027;
    addLight(shoulder, shoulderRing);

    var upperArm = capsule(0.041, 0.117, matWhite, 0, -0.099, 0);
    shoulder.add(upperArm);
    // Purple accent stripe on the upper arm (locked palette accent).
    var armStripe = mesh(new THREE.BoxGeometry(0.011, 0.09, 0.011), matPurple, 0, -0.099, 0.041);
    shoulder.add(armStripe);

    var elbow = new THREE.Group();
    elbow.position.set(0, -0.198, 0);
    shoulder.add(elbow);
    elbow.add(mesh(new THREE.SphereGeometry(0.042, 24, 16), matJointDark, 0, 0, 0));
    var elbowRing = ring(0.044, 0.007, glowBlue);
    elbowRing.rotation.x = Math.PI / 2;
    addLight(elbow, elbowRing);

    var forearm = capsule(0.036, 0.117, matWhite, 0, -0.0945, 0);
    elbow.add(forearm);

    var wrist = new THREE.Group();
    wrist.position.set(0, -0.189, 0);
    elbow.add(wrist);

    var hand = buildHand(side);
    wrist.add(hand.group);

    return { shoulder: shoulder, elbow: elbow, wrist: wrist, hand: hand.group,
             palm: hand.palm, fingers: hand.fingers };
  }
  var armL = buildArm(-1);
  var armR = buildArm(1);

  // --------------------------------------------------------------------------
  // HEAD — pivot group at the neck base (world y 0.745). All head meshes are
  // offset +0.335 in y inside this group (head centre world y 1.08).
  // Helmet: squashed sphere, glossy. Face plate: black ellipsoid PROUD of
  // the shell (front z 0.289 vs shell 0.2592). Eyes + mouth sit ON the plate.
  // --------------------------------------------------------------------------
  var head = new THREE.Group();
  head.position.set(0, NECK_BASE_Y - HIP_Y, 0);   // rel. torso → world y 0.745
  torso.add(head);
  var HY = HEAD_CY - NECK_BASE_Y;   // 0.335 — head-centre height in this group

  var helmet = mesh(new THREE.SphereGeometry(HEAD_R, 48, 32), matHelmet, 0, HY, 0);
  helmet.scale.set(1.04, 1.0, 0.96);
  head.add(helmet);
  // Silver trim ring hugging the helmet shell (sized to the shell's
  // cross-section at this height, so it sits ON the shell, not floating).
  var helmetTrim = ring(0.26, 0.009, matSilver);
  helmetTrim.rotation.x = Math.PI / 2;
  helmetTrim.position.y = HY - 0.10;
  helmetTrim.scale.set(1.04, 0.96, 1);
  head.add(helmetTrim);

  // Face plate — black ellipsoid, front proud of the helmet shell.
  var facePlate = mesh(
    new THREE.SphereGeometry(1, 48, 32), matFace,
    FACE_CENTRE.x, HY, FACE_CENTRE.z);
  facePlate.scale.set(FACE_RADII.x, FACE_RADII.y, FACE_RADII.z);
  head.add(facePlate);

  // Eyes — separate emissive cyan meshes so they can blink / scale / look.
  // Face-plate surface at (±0.095, 1.143) is z ≈ 0.264; eye centres at
  // z = 0.267 sit on the plate, fronts proud of it.
  function buildEye(x) {
    var eye = mesh(new THREE.SphereGeometry(0.038, 24, 16), matCyan, x, HY + 0.063, 0.267);
    eye.scale.set(1, 1, 0.45);
    eye.userData.baseY = HY + 0.063;
    eye.userData.baseX = x;
    head.add(eye);
    return eye;
  }
  var eyeL = buildEye(-0.095);
  var eyeR = buildEye(0.095);
  // Eye sparkle dots (small white glints, upper-outer corner of each eye).
  head.add(mesh(new THREE.SphereGeometry(0.009, 10, 8), matWhite, -0.108, HY + 0.079, 0.282));
  head.add(mesh(new THREE.SphereGeometry(0.009, 10, 8), matWhite, 0.081, HY + 0.079, 0.282));

  // Mouth — emissive cyan torus segment (smile = lower half, rotation.z = π).
  // Face-plate surface at (0, 0.981) is z ≈ 0.273; mouth at z = 0.274.
  var mouth = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.010, 12, 32, Math.PI), matCyan);
  mouth.position.set(0, HY - 0.099, 0.274);
  mouth.rotation.z = Math.PI;   // smile (∪)
  mouth.userData.baseY = HY - 0.099;
  head.add(mouth);

  // Ear / headphone modules — cylinders on the head sides + blue rings.
  [-1, 1].forEach(function (side) {
    var ear = mesh(new THREE.CylinderGeometry(0.077, 0.077, 0.045, 32), matSilver,
      0.275 * side, HY, 0);
    ear.rotation.z = Math.PI / 2;   // cylinder axis → x
    head.add(ear);
    var earCap = mesh(new THREE.CylinderGeometry(0.054, 0.054, 0.05, 32), matWhite,
      0.275 * side, HY, 0);
    earCap.rotation.z = Math.PI / 2;
    head.add(earCap);
    var earRing = ring(0.065, 0.007, glowBlue);
    earRing.rotation.y = Math.PI / 2;   // ring plane → YZ, axis x
    earRing.position.set(0.299 * side, HY, 0);
    addLight(head, earRing);
  });

  // Small blue illuminated detail on the head front, above the face plate.
  head.add(mesh(new THREE.SphereGeometry(0.007, 10, 8), matCyan, 0, HY + 0.25, 0.096));

  // Antenna — short nub + glowing tip. Tip top ≈ 1.392, i.e. 0.042 above
  // the 1.35 m body height.
  var antenna = mesh(new THREE.CylinderGeometry(0.009, 0.013, 0.032, 12), matSilver,
    0, HY + 0.276, 0);
  head.add(antenna);
  var antennaTip = mesh(new THREE.SphereGeometry(0.013, 12, 8), matCyan,
    0, HY + 0.299, 0);
  head.add(antennaTip);

  // --------------------------------------------------------------------------
  // Measurements — derived from the construction constants above.
  // --------------------------------------------------------------------------
  var measurements = {
    totalHeight: HEAD_CY + HEAD_R,                 // 1.35 (head top)
    overallHeight: HEAD_CY + 0.299 + 0.013,        // 1.392 incl. antenna tip
    headHeight: HEAD_H,                            // 0.54
    headFraction: HEAD_H / TOTAL_HEIGHT,           // 0.40
    torsoHeight: NECK_BASE_Y - HIP_Y,              // 0.405
    torsoFraction: (NECK_BASE_Y - HIP_Y) / TOTAL_HEIGHT,   // 0.30
    legHeight: HIP_Y - ANKLE_Y,                    // 0.27
    legFraction: (HIP_Y - ANKLE_Y) / TOTAL_HEIGHT,         // 0.20
    neckHeight: NECK_H,                            // 0.065
    bootHeight: BOOT_H,                            // 0.07
    footSoleY: ANKLE_Y - 0.035 - BOOT_H / 2,       // 0.00
    faceFrontZ: FACE_FRONT_Z,                      // 0.289
    helmetFrontZ: HELMET_FRONT_Z,                  // 0.2592
    faceProudBy: FACE_FRONT_Z - HELMET_FRONT_Z     // ~0.030
  };

  // --------------------------------------------------------------------------
  // API
  // --------------------------------------------------------------------------
  // The 7 sheet/spec expressions first, then bonus extras (which must never
  // break the 7). 'neutral' is the sheet's default expression.
  var EXPRESSIONS = ['neutral', 'happy', 'curious', 'thinking', 'surprised',
    'speaking', 'listening', 'excited', 'confused', 'sad', 'focused',
    'sleeping', 'success', 'error'];
  var SHEET_EXPRESSIONS = ['neutral', 'happy', 'curious', 'thinking',
    'surprised', 'speaking', 'listening'];

  var enzo = {
    group: group,
    head: head,
    neck: head,   // alias: the head group IS the neck pivot
    face: { eyes: { left: eyeL, right: eyeR }, mouth: mouth, facePlate: facePlate },
    torso: torso,
    armL: armL,
    armR: armR,
    legL: legL,
    legR: legR,
    lights: lights,
    glowMaterial: glowBlue,
    eyeMaterial: matCyan,
    mouthMaterial: matCyan,
    LIMITS: LIMITS,
    measurements: measurements,
    expressions: EXPRESSIONS,
    sheetExpressions: SHEET_EXPRESSIONS,
    currentExpression: 'neutral',
    speakingAmount: 0
  };
  // Named torso parts (attached to the torso group for discoverability).
  torso.chest = chest;
  torso.chestPlate = chestPlate;
  torso.abdomen = abdomen;
  torso.pelvis = pelvis;
  torso.neckMesh = neckMesh;
  enzo.torso = torso;

  function setGlow(hex, intensity) {
    glowBlue.color.set(hex);
    glowBlue.emissive.set(hex);
    glowBlue.emissiveIntensity = intensity;
  }

  function resetFace() {
    eyeL.position.y = eyeL.userData.baseY;
    eyeR.position.y = eyeR.userData.baseY;
    eyeL.position.x = eyeL.userData.baseX;
    eyeR.position.x = eyeR.userData.baseX;
    eyeL.scale.set(1, 1, 0.45);
    eyeR.scale.set(1, 1, 0.45);
    mouth.position.y = mouth.userData.baseY;
    mouth.rotation.z = Math.PI;
    mouth.scale.set(1, 1, 1);
    head.rotation.set(0, 0, 0);
    setGlow(0x3B82F6, 1.2);
    matCyan.emissiveIntensity = 2.0;
    enzo.speakingAmount = 0;
  }

  enzo.setSpeaking = function (amount) {
    amount = clamp(Number(amount) || 0, 0, 1);
    enzo.speakingAmount = amount;
    // Open smile: taller + slightly narrower as amount rises.
    mouth.scale.set(1 - 0.15 * amount, 1 + 1.4 * amount, 1);
    mouth.rotation.z = Math.PI;
    return enzo;
  };

  // EXPRESSION RULE: only eye/mouth SCALE, mouth rotation, head tilt and
  // glow change here. Eye base positions, the face plate and every other
  // mesh never move — see the self-check (eye positions asserted identical
  // across all 7 sheet expressions).
  enzo.setExpression = function (name) {
    resetFace();
    switch (name) {
      case 'neutral':
        // Sheet Neutral: round cyan eyes + gentle smile (defaults, slightly
        // smaller smile than happy).
        mouth.scale.set(0.9, 0.9, 1);
        break;
      case 'happy':
        // Sheet Happy: eyes curve up into happy arcs + bigger smile.
        // (Arc approximated by wide, squashed eyes — positions never move.)
        eyeL.scale.set(1.15, 0.5, 0.45);
        eyeR.scale.set(1.15, 0.5, 0.45);
        mouth.scale.set(1.3, 1.25, 1);
        break;
      case 'curious':
        // Sheet Curious: eyes wide + small round mouth.
        eyeL.scale.set(1.3, 1.3, 0.45);
        eyeR.scale.set(1.3, 1.3, 0.45);
        mouth.scale.set(0.5, 0.5, 1);
        head.rotation.z = 0.08;                 // slight curious tilt
        break;
      case 'thinking':
        // Sheet Thinking: one eye half-closed, other narrowed looking
        // up-side (scale asymmetry only — hand-to-chin is animation's job),
        // small flat mouth, head tilted.
        eyeL.scale.set(1, 0.45, 0.45);         // half-closed
        eyeR.scale.set(1, 0.9, 0.45);          // looking up-side
        mouth.scale.set(0.7, 0.2, 1);          // small flat mouth
        head.rotation.z = 0.12;
        head.rotation.x = -0.06;                // gaze up-side
        setGlow(0x8B5CF6, 1.4);                 // purple
        break;
      case 'surprised':
        // Spec Surprised: wide eyes + small open round mouth.
        eyeL.scale.set(1.4, 1.4, 0.45);
        eyeR.scale.set(1.4, 1.4, 0.45);
        mouth.scale.set(0.8, 1.3, 1);           // round open mouth
        setGlow(0x00D9FF, 2.0);
        break;
      case 'speaking':
        // Spec Speaking: mouth opens / closes via setSpeaking().
        enzo.setSpeaking(0.6);
        break;
      case 'listening':
        // Spec Listening: attentive eyes, slight head tilt / lean-in.
        eyeL.scale.set(1.1, 1.1, 0.45);
        eyeR.scale.set(1.1, 1.1, 0.45);
        mouth.scale.set(0.8, 0.8, 1);
        head.rotation.x = -0.08;                // slight lean-in
        head.rotation.z = 0.05;                 // slight tilt
        break;
      case 'excited':
        eyeL.scale.set(1.25, 1.25, 0.45);
        eyeR.scale.set(1.25, 1.25, 0.45);
        mouth.scale.set(1.3, 1.3, 1);
        setGlow(0x00D9FF, 1.8);
        break;
      case 'confused':
        eyeL.scale.set(1.1, 1.1, 0.45);         // one eye raised (scale only)
        mouth.rotation.z = Math.PI + 0.35;      // crooked smile
        mouth.scale.set(0.8, 0.8, 1);
        head.rotation.z = 0.15;
        setGlow(0xF59E0B, 1.3);                 // amber
        break;
      case 'sad':
        eyeL.scale.set(1, 0.8, 0.45); eyeR.scale.set(1, 0.8, 0.45);
        mouth.rotation.z = 0;                   // frown (∩)
        mouth.scale.set(0.9, 0.9, 1);
        head.rotation.x = 0.12;                 // head bowed
        setGlow(0x3B82F6, 0.5);                 // dim blue
        break;
      case 'focused':
        eyeL.scale.set(0.9, 0.75, 0.45); eyeR.scale.set(0.9, 0.75, 0.45);
        mouth.scale.set(0.7, 0.2, 1);           // thin line
        setGlow(0x3B82F6, 1.4);
        break;
      case 'sleeping':
        eyeL.scale.set(1, 0.08, 0.45); eyeR.scale.set(1, 0.08, 0.45);
        mouth.scale.set(0.6, 0.2, 1);
        head.rotation.x = 0.18;                 // chin down
        setGlow(0x3B82F6, 0.15);                // lights dimmed
        matCyan.emissiveIntensity = 0.4;
        break;
      case 'success':
        eyeL.scale.set(1.15, 1.15, 0.45); eyeR.scale.set(1.15, 1.15, 0.45);
        mouth.scale.set(1.35, 1.35, 1);
        setGlow(0x22C55E, 1.6);                 // green
        break;
      case 'error':
        eyeL.scale.set(1, 0.6, 0.45); eyeR.scale.set(1, 0.6, 0.45);
        mouth.rotation.z = 0;                   // frown
        mouth.scale.set(0.9, 0.9, 1);
        setGlow(0xF59E0B, 1.8);                 // amber warning light — the palette has no red
        break;
      default:
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[ENZO] unknown expression "' + name + '", using neutral. ' +
            'Valid: ' + EXPRESSIONS.join(', '));
        }
        break;
    }
    enzo.currentExpression = EXPRESSIONS.indexOf(name) !== -1 ? name : 'neutral';
    return enzo;
  };

  var blinkTimer = null;
  enzo.blink = function () {
    if (enzo.currentExpression === 'sleeping') return enzo;  // already closed
    var prevL = eyeL.scale.y, prevR = eyeR.scale.y;
    eyeL.scale.y = 0.1;
    eyeR.scale.y = 0.1;
    if (blinkTimer) clearTimeout(blinkTimer);
    blinkTimer = setTimeout(function () {
      eyeL.scale.y = prevL;
      eyeR.scale.y = prevR;
      blinkTimer = null;
    }, 100);
    return enzo;
  };

  enzo.clampJoints = function () {
    function clampRot(obj, lim) {
      if (!obj || !obj.rotation) return;
      if (lim.x) obj.rotation.x = clamp(obj.rotation.x, lim.x[0], lim.x[1]);
      if (lim.y) obj.rotation.y = clamp(obj.rotation.y, lim.y[0], lim.y[1]);
      if (lim.z) obj.rotation.z = clamp(obj.rotation.z, lim.z[0], lim.z[1]);
    }
    clampRot(armL.shoulder, LIMITS.shoulder);
    clampRot(armR.shoulder, LIMITS.shoulder);
    clampRot(armL.elbow, LIMITS.elbow);
    clampRot(armR.elbow, LIMITS.elbow);
    clampRot(armL.wrist, LIMITS.wrist);
    clampRot(armR.wrist, LIMITS.wrist);
    clampRot(legL.hip, LIMITS.hip);
    clampRot(legR.hip, LIMITS.hip);
    clampRot(legL.knee, LIMITS.knee);
    clampRot(legR.knee, LIMITS.knee);
    clampRot(legL.ankle, LIMITS.ankle);
    clampRot(legR.ankle, LIMITS.ankle);
    head.rotation.y = clamp(head.rotation.y, LIMITS.neck.yaw[0], LIMITS.neck.yaw[1]);
    head.rotation.x = clamp(head.rotation.x, LIMITS.neck.pitch[0], LIMITS.neck.pitch[1]);
    // Curl fingers into a sane range (0 = straight, ~1.9 rad = full curl).
    [armL, armR].forEach(function (arm) {
      arm.fingers.forEach(function (f) {
        f.rotation.x = clamp(f.rotation.x, 0, 1.9);
      });
    });
    return enzo;
  };

  enzo.resetPose = function () {
    [armL.shoulder, armR.shoulder, armL.elbow, armR.elbow,
     armL.wrist, armR.wrist, legL.hip, legR.hip,
     legL.knee, legR.knee, legL.ankle, legR.ankle].forEach(function (j) {
      j.rotation.set(0, 0, 0);
    });
    [armL, armR].forEach(function (arm) {
      arm.fingers.forEach(function (f) { f.rotation.set(0, 0, 0); });
      // Thumb keeps its built-in splay (set at construction, not a pose).
      arm.fingers[0].rotation.z = 0.85 * (arm === armL ? -1 : 1);
      arm.fingers[0].rotation.x = -0.25;
    });
    group.rotation.set(0, 0, 0);
    enzo.setExpression('neutral');
    return enzo;
  };

  // Neutral standing pose on build.
  enzo.resetPose();
  return enzo;
}
  window.EnzoRoom.buildEnzo=buildEnzo;

// Node / bundler export (harmless in the browser, where THREE is global).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildEnzo: buildEnzo };
}


})();
