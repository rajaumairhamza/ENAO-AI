(function(){
  'use strict';
  if(!window.EnzoRoom||!window.EnzoRoom.threeOK){ return; }
/* ---- PIECE 4 — ANIMATIONS A-E ---- */
var createAnimationSystem=(function(){
/* ============================================================================
 * PIECE 4 — ANIMATIONS A–E  (ENZO 3D room rebuild, artifact slug: enao-ai)
 * File: pieces/04-animations.js
 *
 * INTEGRATION NOTE — how the app wires this in (read this first)
 * ----------------------------------------------------------------------------
 *   const anim = createAnimationSystem(enzo, room, props, THREE);
 *   // enzo  = Piece 3 buildEnzo() result (the ONE enzo instance; this piece
 *   //         never creates, clones or re-skins it — it only moves it).
 *   // room  = Piece 1 anchors: deskPos, sofaPos, sofaSeatPos, coffeeTablePos,
 *   //         plantPositions[], chairPos, screenPos,
 *   //         roomBounds {xMin:-3.2, xMax:3.2, zMin:-2.6, zMax:2.6}.
 *   // props = Piece 2 workstation props: laptop {group, lid, setLidAngle},
 *   //         monitors, keyboard, mouse, phone {group, screen, setScreen,
 *   //         setPhoneTime}, phoneStand, deskLamp {setOn}, chair {seatY},
 *   //         deskTopY.
 *   // THREE = the THREE namespace (optional; only used for Object3D.attach
 *   //         when available — this file works with plain-object stubs too).
 *
 *   // In the render loop, every frame:
 *   //   anim.update(dt);            // dt = seconds since last frame,
 *   //                               // normally ~1/60. dt is clamped to
 *   //                               // [0, 0.1] internally so a tab-switch
 *   //                               // hiccup can never teleport ENZO.
 *   //   renderer.render(scene, camera);
 *
 *   // To start a sequence:  anim.play('sitAtDesk');  anim.play('typeOnKeyboard', {loop:true});
 *   // To stop cleanly:     anim.stop();   // eases back to a neutral pose
 *   // Activity hook:        anim.setActivity('researching'); // see mapping below
 *   // Inspect:              anim.current();   // active sequence name or null
 *   //                       anim.getPose();   // hipHeight, knees, feet, x/z/yaw
 *   //                       anim.getHeld();   // objects currently in a hand
 *
 * LOCKED RULES (from Raja's master sheet — enforced in code, not comments)
 * ----------------------------------------------------------------------------
 * MODULARITY NOTE (22 Nov 2026): the room reference image is ONLY a
 * reference and the Master Character Design Sheet is a second design
 * authority — more room detail is still coming from Raja. Nothing here is
 * final: all room geometry comes from Piece 1 anchors and all workstation
 * geometry from Piece 2 props at runtime (with clearly-marked fallbacks),
 * all proportions derive from ENZO_HEIGHT_M / Piece 3, and every sequence
 * is an independent builder in BUILDERS, so later detail folds in by
 * changing an anchor, a constant, or one builder — never a rewrite.
 * Final assembly waits for Raja's remaining detail / go-ahead.
 *
 *  1. SMOOTH ONLY. Every joint/position change is interpolated with a
 *     smoothstep ease over an explicit duration. No step ever sets a
 *     position/rotation in one frame. The only exception is the setup-only
 *     setStartPosition() (initial spawn placement, never used by a sequence).
 *  2. CONSTANT-SPEED TRAVEL. Walking moves along a path at a constant speed
 *     (0.9 m/s walk, 1.3 m/s when hurrying between rooms). Stride phase is
 *     derived from measured ground speed (phase += speed / strideLength),
 *     so legs swing, arms pump slightly and the torso leans a touch forward.
 *  3. FEET ON THE FLOOR. 2-phase gait: a swinging foot lifts at most 0.08 m,
 *     a planted foot is exactly y=0. Foot y is clamped >= 0 every frame.
 *  4. HANDS GRIP THINGS. A carried object is ATTACHED to the hand (real
 *     Object3D.attach when available, otherwise per-frame hand-follow with
 *     an attachedTo flag) for the whole carry, and released ONLY onto a real
 *     surface (desk / phone stand / coffee table) at the end — never left
 *     floating in air.
 *  5. REAL SITTING. Hips at seat height (chair 0.48 m, sofa ~0.45 m), knees
 *     bent ~90 deg, feet flat on the floor, hands on the keyboard — the
 *     laptop is never inside the torso.
 *  6. ONE ENZO. Face/body never change between animations; only this one
 *     enzo instance is moved.
 *
 * SIGN CONVENTIONS (internal pose model)
 * ----------------------------------------------------------------------------
 *  pose.hipL/hipR   thigh rotation, + = thigh swings forward (sitting ~+1.45)
 *  pose.kneeL/kneeR knee bend MAGNITUDE in radians, + = shin folds back
 *                    (sitting ~1.57 = 90 deg). Applied to the joint as -knee.
 *  pose.ankle       derived in applyPose(): ankle = knee - hip, so the foot
 *                    stays flat on the floor in every pose.
 *  pose.shoulder*   arm rotation, + = arm swings forward/up.
 *  pose.elbow*      elbow bend magnitude, applied as -elbow.
 *  pose.headPitch    + = head tilts down toward the desk/keyboard.
 *  pose.headYaw      + = head turns left.  Yaw of the group: forward vector
 *                    is (-sin yaw, -cos yaw), i.e. yaw 0 faces -z.
 *  pose.hipHeight    world height of the hip joint: standing ~0.70
 *                    (0.52 x the 1.35 m sheet height),
 *                    chair-seated 0.48, sofa-seated ~0.45.
 *  pose.fingerCurl*  0 = hand open, 1 = fully curled (typing / gripping).
 *
 * No DOM, no chat/call/UI logic in this file.
 * ========================================================================== */

'use strict';

/* ------------------------------------------------------------------ utils */
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function lerp(a, b, t) { return a + (b - a) * t; }
function smoothstep(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
function lerpAngle(a, b, t) {
  var d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}
function dist2d(ax, az, bx, bz) {
  var dx = bx - ax, dz = bz - az;
  return Math.sqrt(dx * dx + dz * dz);
}
/* Yaw that faces from (ax,az) toward (bx,bz). Forward = (-sin yaw, -cos yaw). */
function yawToFace(ax, az, bx, bz) {
  return Math.atan2(-(bx - ax), -(bz - az));
}
function clonePose(p) {
  var o = {};
  for (var k in p) o[k] = p[k];
  return o;
}

var WALK_SPEED = 0.9;      /* m/s — constant-speed travel (per-frame move at
                              60fps = 0.015 m, far below the 0.05 no-teleport cap) */
var HURRY_SPEED = 1.3;     /* m/s for longer cross-room trips */
var STRIDE_LENGTH = 0.55;  /* m per single stride; full gait cycle = 2 strides */
var MAX_FOOT_LIFT = 0.08;  /* m — locked cap on foot lift while walking */
/* Canonical height from the Master Character Design Sheet (22 Nov 2026):
   ENZO is 1.35 m (4.5 ft) tall — NEVER 1.50 m. Proportions come from Piece 3
   (buildEnzo) generically; this piece only derives heights as a proportion
   of the sheet height, so a Piece 3 proportion change flows through here. */
var ENZO_HEIGHT_M = 1.35;
var STAND_HIP = 0.52 * ENZO_HEIGHT_M; /* standing hip height ≈ 0.70 m */
var CHAIR_HIP = 0.48;      /* hip height seated on the chair (LOCKED) */
var SOFA_HIP = 0.45;       /* hip height seated on the sofa */
var SIT_KNEE = 1.5708;     /* 90 deg in radians (LOCKED) */
var SIT_HIP_ANGLE = 1.45;  /* thigh forward angle when seated (~83 deg) */
var CAMERA_POS = { x: 0, z: 2.6 }; /* camera / viewer position, room front centre */

var NEUTRAL_POSE = {
  hipHeight: STAND_HIP,
  hipL: 0, hipR: 0, kneeL: 0, kneeR: 0,
  shoulderL: 0, shoulderR: 0, elbowL: 0.12, elbowR: 0.12,
  shoulderLz: 0.12, shoulderRz: -0.12,
  wristL: 0, wristR: 0,
  headPitch: 0, headYaw: 0, headRoll: 0,
  torsoPitch: 0, torsoYaw: 0,
  footYL: 0, footYR: 0,
  fingerCurlL: 0.15, fingerCurlR: 0.15
};

/* Every sequence in groups A–E. `loopable` = safe to repeat with {loop:true}. */
var SEQUENCE_DEFS = {
  /* (A) COMPUTER */
  sitAtDesk:      { group: 'A', description: 'Walk to chair, turn, sit (hips 0.48, knees 90 deg)', loopable: false },
  openLaptop:     { group: 'A', description: 'Hand to lid, lid 0 -> 1.9 rad over 1.2 s', loopable: false },
  typeOnKeyboard: { group: 'A', description: 'Both hands on keyboard, fingers curl alternately, head to monitors (6 s, loopable)', loopable: true },
  useMouse:       { group: 'A', description: 'Right hand to mouse, small movements', loopable: false },
  lookAtMonitor:  { group: 'A', description: 'Head up, focused expression', loopable: false },
  closeLaptop:    { group: 'A', description: 'Lid back to 0', loopable: false },
  /* (B) MOBILE */
  pickUpPhone:    { group: 'B', description: 'Walk to desk, right hand to phone, attach to hand, lift', loopable: false },
  unlockPhone:    { group: 'B', description: 'Thumb tap, screen on + glow', loopable: false },
  scrollScreen:   { group: 'B', description: 'Thumb swipes, phone tilts slightly (loopable)', loopable: true },
  typeMessage:    { group: 'B', description: 'Thumb taps a message', loopable: false },
  callAnimation:  { group: 'B', description: 'Phone to ear, speaking expression + setSpeaking', loopable: false },
  putPhoneBack:   { group: 'B', description: 'Return phone to stand, detach, screen dim', loopable: false },
  /* (C) MOVEMENT */
  walkForward:    { group: 'C', description: 'Walk 2 m forward, constant speed, full gait', loopable: false },
  walkBack:       { group: 'C', description: 'Walk 1.5 m backward, facing unchanged', loopable: false },
  turnAround:     { group: 'C', description: 'Turn 180 deg in place, smooth', loopable: false },
  strafeLeft:     { group: 'C', description: 'Sidestep 1 m left, facing unchanged', loopable: false },
  strafeRight:    { group: 'C', description: 'Sidestep 1 m right, facing unchanged', loopable: false },
  goToDesk:       { group: 'C', description: 'Routed walk to the desk, face it', loopable: false },
  goToSofa:       { group: 'C', description: 'Routed walk to the sofa, face it', loopable: false },
  sitDown:        { group: 'C', description: 'Sit on the sofa edge, relaxed', loopable: false },
  standUp:        { group: 'C', description: 'Stand from chair or sofa, step clear', loopable: false },
  /* (D) DAILY */
  readBook:       { group: 'D', description: 'Pick book from coffee table, sit on sofa, hold open, head down slightly', loopable: false },
  drinkWater:     { group: 'D', description: 'Pick glass from coffee table, raise to face, lower, put back', loopable: false },
  restOnSofa:     { group: 'D', description: 'Lean back on sofa, relaxed, slow blink (loopable)', loopable: true },
  visitPlants:    { group: 'D', description: 'Walk to large plant, lean in, hand gesture toward leaves', loopable: false },
  gestureHands:   { group: 'D', description: 'Both hands open gestures facing camera', loopable: false },
  wave:           { group: 'D', description: 'Character-sheet waving pose: face camera, right hand up, palm open, wave side to side', loopable: false },
  waving:         { group: 'D', description: 'Alias of wave (character-sheet waving pose)', loopable: false },
  point:          { group: 'D', description: 'Character-sheet pointing pose: face camera, right arm extended, index finger out', loopable: false },
  pointing:       { group: 'D', description: 'Alias of point (character-sheet pointing pose)', loopable: false },
  talkToCamera:   { group: 'D', description: 'Face camera, speaking expression, hand gestures (loopable)', loopable: true },
  /* (E) FACIAL — standalone, usable during any sequence (see ambient layers).
     Sheet expressions (Master Character Design Sheet, 22 Nov 2026):
     Neutral, Happy, Curious, Thinking, Surprised, Speaking, Listening.
     All seven exist here by those exact names; confused / sleeping /
     relaxed / focused are extra app states on top of the sheet set. */
  blinkLoop:      { group: 'E', description: 'Ambient: blink every 2.5–5 s at random (background layer, non-blocking)', loopable: true },
  headIdle:       { group: 'E', description: 'Ambient: slow natural head sway ±8 deg (background layer, non-blocking)', loopable: true },
  neutral:        { group: 'E', description: 'Expression: Neutral (sheet name, exact)', loopable: false },
  happy:          { group: 'E', description: 'Expression: Happy (sheet name, exact)', loopable: false },
  curious:        { group: 'E', description: 'Expression: Curious (sheet name, exact)', loopable: false },
  thinking:       { group: 'E', description: 'Expression: Thinking (sheet name, exact)', loopable: false },
  surprised:      { group: 'E', description: 'Expression: Surprised (sheet name, exact)', loopable: false },
  speaking:       { group: 'E', description: 'Expression: Speaking (sheet name, exact)', loopable: false },
  listening:      { group: 'E', description: 'Expression: Listening (sheet name, exact)', loopable: false },
  confused:       { group: 'E', description: 'Expression: confused (used by setActivity error)', loopable: false },
  sleeping:       { group: 'E', description: 'Expression: sleeping (used by setActivity sleeping)', loopable: false },
  relaxed:        { group: 'E', description: 'Expression: relaxed', loopable: false },
  focused:        { group: 'E', description: 'Expression: focused', loopable: false }
};

/* setActivity() mapping — the activity states the app already uses. */
var ACTIVITY_MAP = {
  researching: ['sitAtDesk', 'openLaptop', 'typeOnKeyboard'],
  mobile:      ['pickUpPhone', 'scrollScreen'],
  coding:      ['typeOnKeyboard'], /* setActivity prepends sitAtDesk+openLaptop if standing */
  idle:        [],                 /* ambient headIdle + blinkLoop only, no active sequence */
  speaking:    ['talkToCamera'],
  success:     ['happy', 'gestureHands'],
  error:       ['confused'],
  sleeping:    ['restOnSofa']      /* with the sleeping expression applied */
};

function createAnimationSystem(enzo, room, props, THREE) {
  enzo = enzo || {};
  room = room || {};
  props = props || {};
  THREE = THREE || null;

  var bounds = room.roomBounds || { xMin: -3.2, xMax: 3.2, zMin: -2.6, zMax: 2.6 };
  var deskPos = room.deskPos || { x: -2.0, z: -1.0 };
  var sofaPos = room.sofaPos || { x: 1.8, z: -1.2 };
  var sofaSeatPos = room.sofaSeatPos || { x: 1.8, z: -0.55 };
  var coffeeTablePos = room.coffeeTablePos || { x: 1.8, z: 0.2 };
  var chairPos = room.chairPos || { x: -1.2, z: -0.2 };
  var plantPositions = room.plantPositions || [{ x: -2.8, z: 1.8 }, { x: 2.8, z: 1.8 }];
  var deskTopY = (props.deskTopY != null ? props.deskTopY : 0.78);
  var chairSeatY = (props.chair && props.chair.seatY != null ? props.chair.seatY : 0.48);

  /* Phone stand position — the one real surface the phone may be released on. */
  function standPosition() {
    var s = props.phoneStand;
    if (s && s.position) return { x: s.position.x, y: s.position.y, z: s.position.z };
    if (s && s.group && s.group.position) {
      var p = s.group.position;
      return { x: p.x, y: p.y, z: p.z };
    }
    return { x: deskPos.x + 0.6, y: deskTopY, z: deskPos.z + 0.2 };
  }
  var phoneHome = standPosition();
  if (props.phone && props.phone.group && props.phone.group.position) {
    var pp = props.phone.group.position;
    phoneHome = { x: pp.x, y: pp.y, z: pp.z };
  }

  /* Coffee-table surface (book / glass release point). */
  function tablePosition() {
    return { x: coffeeTablePos.x, y: 0.42, z: coffeeTablePos.z };
  }

  /* ------------------------------------------------------------ state */
  var state = {
    x: 0, z: 0.8, yaw: 0,          /* group position (feet on floor) + facing */
    time: 0,
    pose: clonePose(NEUTRAL_POSE),
    active: null,                  /* {name, steps, index, stepT, loop} */
    queue: [],                     /* chained {name, opts} from setActivity */
    returnTween: null,             /* neutral-pose tween run by stop() */
    held: {},                      /* name -> {obj, hand, origParent} */
    ambient: { blink: true, sway: true, nextBlink: 2.5 + Math.random() * 2.5 },
    expression: 'neutral'
  };

  /* ------------------------------------------------------------ helpers */
  function setJoint(joint, rx, ry, rz) {
    if (!joint || !joint.rotation) return;
    if (rx != null) joint.rotation.x = rx;
    if (ry != null) joint.rotation.y = ry;
    if (rz != null) joint.rotation.z = rz;
  }
  function setExpression(name) {
    state.expression = name;
    if (typeof enzo.setExpression === 'function') {
      try { enzo.setExpression(name); } catch (e) { /* keep animating */ }
    }
  }
  function setSpeaking(on) {
    if (typeof enzo.setSpeaking === 'function') {
      try { enzo.setSpeaking(!!on); } catch (e) { /* keep animating */ }
    }
  }
  function doBlink() {
    if (typeof enzo.blink === 'function') {
      try { enzo.blink(); } catch (e) { /* keep animating */ }
    }
  }
  function clampJoints() {
    if (typeof enzo.clampJoints === 'function') {
      try { enzo.clampJoints(); } catch (e) { /* keep animating */ }
    }
  }
  function clampToBounds(x, z) {
    return {
      x: clamp(x, bounds.xMin + 0.15, bounds.xMax - 0.15),
      z: clamp(z, bounds.zMin + 0.15, bounds.zMax - 0.15)
    };
  }
  /* Point `dist` metres from `from` toward the room centre (0,0). */
  function approachPoint(from, dist) {
    var d = dist2d(from.x, from.z, 0, 0) || 1;
    return {
      x: from.x + (0 - from.x) / d * dist,
      z: from.z + (0 - from.z) / d * dist
    };
  }
  function forwardVec() { return { x: -Math.sin(state.yaw), z: -Math.cos(state.yaw) }; }
  function rightVec() {
    var f = forwardVec();
    return { x: -f.z, z: f.x }; /* (cos yaw, -sin yaw) */
  }

  /* Apply the internal pose to the real enzo joints + group. Feet stay on
     the floor: group y is always 0, foot lift lives in pose.footY*. */
  function applyPose() {
    var p = state.pose;
    p.footYL = Math.max(0, p.footYL || 0);
    p.footYR = Math.max(0, p.footYR || 0);
    if (enzo.group) {
      if (enzo.group.position) {
        enzo.group.position.x = state.x;
        enzo.group.position.y = 0; /* feet on the floor — always */
        enzo.group.position.z = state.z;
      }
      if (enzo.group.rotation) enzo.group.rotation.y = state.yaw;
    }
    /* Hip height — also mirrored onto the instance so tests / the app can
       read it without knowing the joint tree. */
    if (enzo.hips && enzo.hips.position) enzo.hips.position.y = p.hipHeight;
    enzo.hipHeight = p.hipHeight;
    var sway = state.ambient.sway ? 0.14 * Math.sin(state.time * 1.25) : 0; /* ±8 deg */
    var headYaw = (p.headYaw || 0) + sway;
    if (enzo.head) setJoint(enzo.head, p.headPitch, headYaw, p.headRoll);
    if (enzo.face) setJoint(enzo.face, p.headPitch, headYaw, p.headRoll);
    if (enzo.legL) {
      setJoint(enzo.legL.hip, p.hipL, 0, 0);
      setJoint(enzo.legL.knee, -p.kneeL, 0, 0);
      setJoint(enzo.legL.ankle, p.kneeL - p.hipL, 0, 0); /* foot stays flat */
      if (enzo.legL.foot && enzo.legL.foot.position) enzo.legL.foot.position.y = p.footYL;
    }
    if (enzo.legR) {
      setJoint(enzo.legR.hip, p.hipR, 0, 0);
      setJoint(enzo.legR.knee, -p.kneeR, 0, 0);
      setJoint(enzo.legR.ankle, p.kneeR - p.hipR, 0, 0);
      if (enzo.legR.foot && enzo.legR.foot.position) enzo.legR.foot.position.y = p.footYR;
    }
    if (enzo.armL) {
      setJoint(enzo.armL.shoulder, p.shoulderL, 0, p.shoulderLz);
      setJoint(enzo.armL.elbow, -p.elbowL, 0, 0);
      setJoint(enzo.armL.wrist, p.wristL, 0, 0);
      applyFingers(enzo.armL.hand, p.fingerCurlL);
    }
    if (enzo.armR) {
      setJoint(enzo.armR.shoulder, p.shoulderR, 0, p.shoulderRz);
      setJoint(enzo.armR.elbow, -p.elbowR, 0, 0);
      setJoint(enzo.armR.wrist, p.wristR, 0, 0);
      applyFingers(enzo.armR.hand, p.fingerCurlR);
    }
    if (enzo.torso) setJoint(enzo.torso, p.torsoPitch, p.torsoYaw, 0);
    if (enzo.chest) setJoint(enzo.chest, p.torsoPitch, p.torsoYaw, 0);
    clampJoints();
  }
  function applyFingers(hand, curl) {
    if (!hand || !hand.fingers) return;
    for (var i = 0; i < hand.fingers.length; i++) {
      var f = hand.fingers[i];
      if (f && f.rotation) f.rotation.x = -clamp(curl, 0, 1) * 0.9;
    }
  }
  /* Approximate world position of a hand, for carried-object follow. */
  function handWorldPos(hand) {
    var f = forwardVec(), r = rightVec();
    var side = (hand === 'L' ? -1 : 1);
    var up = state.pose.hipHeight + 0.15;
    return {
      x: state.x + f.x * 0.32 + r.x * 0.18 * side,
      y: up,
      z: state.z + f.z * 0.32 + r.z * 0.18 * side
    };
  }
  function updateHeldObjects() {
    for (var name in state.held) {
      var h = state.held[name];
      if (!h || !h.obj || !h.obj.group || !h.obj.group.position) continue;
      if (h.realAttach) continue; /* THREE attach already parents it to the hand */
      var hp = handWorldPos(h.hand);
      h.obj.group.position.x = hp.x;
      h.obj.group.position.y = hp.y;
      h.obj.group.position.z = hp.z;
    }
  }

  /* ------------------------------------------------- carry: grip / release */
  /* Attach an object to a hand for the whole carry (LOCKED rule 4). */
  function attachObject(name, obj, hand) {
    if (!obj || !obj.group) return false;
    var handObj = (hand === 'L' ? (enzo.armL && enzo.armL.hand) : (enzo.armR && enzo.armR.hand));
    var entry = { obj: obj, hand: hand, origParent: obj.group.parent || null, realAttach: false };
    if (handObj && typeof handObj.attach === 'function') {
      try { handObj.attach(obj.group); entry.realAttach = true; } catch (e) { entry.realAttach = false; }
    }
    obj._attachedTo = (hand === 'L' ? 'handL' : 'handR');
    state.held[name] = entry;
    return true;
  }
  /* Release ONLY onto a real surface position — never into mid-air. */
  function detachObject(name, surfacePos) {
    var h = state.held[name];
    if (!h) return false;
    var obj = h.obj;
    if (h.realAttach && h.origParent && typeof h.origParent.add === 'function') {
      try { h.origParent.add(obj.group); } catch (e) { /* fall through to manual */ }
    }
    if (surfacePos && obj.group && obj.group.position) {
      obj.group.position.x = surfacePos.x;
      obj.group.position.y = surfacePos.y;
      obj.group.position.z = surfacePos.z;
    }
    obj._attachedTo = null;
    delete state.held[name];
    return true;
  }
  function isHolding(name) { return !!state.held[name]; }

  /* ------------------------------------------------------- routing (C) */
  /* Obstacles as expanded rectangles {xMin,xMax,zMin,zMax} (+ plant circles). */
  function obstacles() {
    var list = [];
    function rect(cx, cz, hx, hz, pad) {
      list.push({ xMin: cx - hx - pad, xMax: cx + hx + pad, zMin: cz - hz - pad, zMax: cz + hz + pad });
    }
    rect(deskPos.x, deskPos.z, 0.9, 0.45, 0.35);        /* desk */
    rect(sofaPos.x, sofaPos.z, 1.1, 0.5, 0.35);         /* sofa */
    rect(coffeeTablePos.x, coffeeTablePos.z, 0.6, 0.35, 0.3); /* coffee table */
    rect(chairPos.x, chairPos.z, 0.3, 0.3, 0.2);        /* chair */
    return list;
  }
  function pointBlocked(x, z) {
    var obs = obstacles();
    for (var i = 0; i < obs.length; i++) {
      var o = obs[i];
      if (x >= o.xMin && x <= o.xMax && z >= o.zMin && z <= o.zMax) return true;
    }
    for (var j = 0; j < plantPositions.length; j++) {
      var pl = plantPositions[j];
      if (dist2d(x, z, pl.x, pl.z) < 0.4) return true;
    }
    return false;
  }
  function segmentClear(ax, az, bx, bz) {
    var d = dist2d(ax, az, bx, bz);
    var n = Math.max(1, Math.ceil(d / 0.1));
    for (var i = 0; i <= n; i++) {
      if (pointBlocked(lerp(ax, bx, i / n), lerp(az, bz, i / n))) return false;
    }
    return true;
  }
  /* Small grid A* over the room; returns waypoints from current pos to target
     that never pass through desk / sofa / bookshelf / table / plants. */
  function routeTo(tx, tz) {
    var target = clampToBounds(tx, tz);
    /* Approach points sit close to furniture, so the goal can land inside a
       padded obstacle rect. Nudge it toward the room centre until it is
       clear — ENZO stops at the furniture's edge, never inside it. */
    var nudge = 0;
    while (pointBlocked(target.x, target.z) && nudge++ < 20) {
      var dc = dist2d(target.x, target.z, 0, 0) || 1;
      target = clampToBounds(
        target.x + (0 - target.x) / dc * 0.1,
        target.z + (0 - target.z) / dc * 0.1
      );
    }
    if (segmentClear(state.x, state.z, target.x, target.z)) return [target];
    var cell = 0.4;
    var nx = Math.ceil((bounds.xMax - bounds.xMin) / cell);
    var nz = Math.ceil((bounds.zMax - bounds.zMin) / cell);
    function toCell(x, z) {
      return {
        i: clamp(Math.floor((x - bounds.xMin) / cell), 0, nx - 1),
        j: clamp(Math.floor((z - bounds.zMin) / cell), 0, nz - 1)
      };
    }
    function cellXY(i, j) {
      return { x: bounds.xMin + (i + 0.5) * cell, z: bounds.zMin + (j + 0.5) * cell };
    }
    function blockedCell(i, j) {
      var c = cellXY(i, j);
      return pointBlocked(c.x, c.z);
    }
    var start = toCell(state.x, state.z), goal = toCell(target.x, target.z);
    var key = function (i, j) { return i + ',' + j; };
    var open = [{ i: start.i, j: start.j, g: 0, f: 0, parent: null }];
    var seen = {};
    seen[key(start.i, start.j)] = 0;
    var found = null;
    var guard = 0;
    while (open.length && guard++ < 2000) {
      var best = 0;
      for (var m = 1; m < open.length; m++) if (open[m].f < open[best].f) best = m;
      var cur = open.splice(best, 1)[0];
      if (cur.i === goal.i && cur.j === goal.j) { found = cur; break; }
      for (var di = -1; di <= 1; di++) {
        for (var dj = -1; dj <= 1; dj++) {
          if (!di && !dj) continue;
          var ni = cur.i + di, nj = cur.j + dj;
          if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue;
          if (blockedCell(ni, nj)) continue;
          if (di && dj && (blockedCell(cur.i + di, cur.j) || blockedCell(cur.i, cur.j + dj))) continue;
          var ng = cur.g + ((di && dj) ? 1.414 : 1);
          var k = key(ni, nj);
          if (seen[k] != null && seen[k] <= ng) continue;
          seen[k] = ng;
          var gc = cellXY(ni, nj);
          open.push({
            i: ni, j: nj, g: ng,
            f: ng + dist2d(gc.x, gc.z, target.x, target.z) / cell,
            parent: cur
          });
        }
      }
    }
    if (!found) return [target]; /* fallback: straight line (never teleport) */
    var pts = [];
    var node = found;
    while (node && node.parent) { pts.unshift(cellXY(node.i, node.j)); node = node.parent; }
    pts.push(target);
    /* Line-of-sight smoothing: drop any waypoint the straight line can skip. */
    var smooth = [{ x: state.x, z: state.z }];
    var anchor = 0;
    var all = [{ x: state.x, z: state.z }].concat(pts);
    while (anchor < all.length - 1) {
      var far = all.length - 1;
      while (far > anchor + 1 && !segmentClear(all[anchor].x, all[anchor].z, all[far].x, all[far].z)) far--;
      smooth.push(all[far]);
      anchor = far;
    }
    return smooth.slice(1);
  }

  /* --------------------------------------------------------- step builders */
  /* A step: {dur, start(), update(rawT, easedT, dt, elapsed), end()}.
     rawT = linear 0..1 (used for constant-speed travel), easedT = smoothstep. */
  function poseStep(target, dur, extra) {
    var from = null;
    return {
      dur: dur, kind: 'pose',
      start: function () { from = clonePose(state.pose); },
      update: function (rawT, easedT) {
        for (var k in target) {
          if (from[k] == null || target[k] == null) continue;
          state.pose[k] = lerp(from[k], target[k], easedT);
        }
        if (extra) extra(rawT, easedT);
      },
      end: function () {
        for (var k in target) state.pose[k] = target[k];
      }
    };
  }
  function holdStep(dur, fn) {
    return {
      dur: dur, kind: 'hold',
      start: function () {},
      update: function (rawT, easedT, dt, elapsed) { if (fn) fn(rawT, easedT, dt, elapsed); },
      end: function () {}
    };
  }
  function callStep(fn) {
    return {
      dur: 0, kind: 'call',
      start: function () { fn(); },
      update: function () {}, end: function () {}
    };
  }
  function turnStep(targetYaw, dur) {
    /* targetYaw may be a number or a function returning one — functions are
       resolved at step start, so a turn after a walk faces from where ENZO
       actually ended up, not where it was when the sequence was built. */
    var fromYaw = 0, resolvedYaw = 0;
    return {
      dur: dur, kind: 'turn',
      start: function () {
        fromYaw = state.yaw;
        resolvedYaw = (typeof targetYaw === 'function' ? targetYaw() : targetYaw);
      },
      update: function (rawT, easedT) { state.yaw = lerpAngle(fromYaw, resolvedYaw, easedT); },
      end: function () { state.yaw = resolvedYaw; }
    };
  }
  function lidStep(to, dur) {
    var from = 0;
    function setLid(a) {
      if (props.laptop && typeof props.laptop.setLidAngle === 'function') {
        try { props.laptop.setLidAngle(a); } catch (e) { /* keep animating */ }
      } else if (props.laptop) {
        props.laptop.lidAngle = a;
        if (props.laptop.lid && props.laptop.lid.rotation) props.laptop.lid.rotation.x = -a;
      }
    }
    return {
      dur: dur, kind: 'lid',
      start: function () {
        from = (props.laptop && props.laptop.lidAngle != null) ? props.laptop.lidAngle : 0;
      },
      update: function (rawT, easedT) { setLid(lerp(from, to, easedT)); },
      end: function () { setLid(to); }
    };
  }
  /* Walk along waypoints at CONSTANT speed. Stride phase comes from the
     ground distance actually travelled, so gait always matches speed.
     LAZY PATH: `waypoints` may be an array or a function returning one.
     The path is resolved in start(), from where ENZO actually is when the
     step begins — a walk step after an earlier walk in the same sequence
     must NOT reuse the position from sequence-build time (that would cut
     straight across the room, through furniture). dur is set in start()
     for the same reason; the placeholder 1 keeps the engine from treating
     the step as an instant call before start() runs. */
  function walkStep(waypoints, speed, opts) {
    opts = opts || {};
    var pts = [], segs = [], total = 0;
    var startPose = null;
    var step = {
      dur: 1, kind: 'walk', total: 0,
      start: function () {
        startPose = clonePose(state.pose);
        var list = (typeof waypoints === 'function' ? waypoints() : waypoints) || [];
        pts = [{ x: state.x, z: state.z }].concat(list.map(function (w) {
          var c = clampToBounds(w.x, w.z);
          return { x: c.x, z: c.z };
        }));
        segs = []; total = 0;
        for (var i = 0; i < pts.length - 1; i++) {
          var len = dist2d(pts[i].x, pts[i].z, pts[i + 1].x, pts[i + 1].z);
          segs.push({ len: len, from: pts[i], to: pts[i + 1] });
          total += len;
        }
        step.total = total;
        step.dur = total > 0.001 ? total / speed : 0;
      },
      update: function (rawT) {
        var d = rawT * total; /* linear: constant speed, no easing on travel */
        var seg = segs[segs.length - 1], acc = 0;
        for (var i = 0; i < segs.length; i++) {
          if (d <= acc + segs[i].len || i === segs.length - 1) { seg = segs[i]; break; }
          acc += segs[i].len;
        }
        var lt = seg.len > 0 ? clamp((d - acc) / seg.len, 0, 1) : 1;
        state.x = lerp(seg.from.x, seg.to.x, lt);
        state.z = lerp(seg.from.z, seg.to.z, lt);
        /* Face the direction of travel (unless strafing / walking back). */
        if (!opts.keepYaw && !opts.backward) {
          var dx = seg.to.x - seg.from.x, dz = seg.to.z - seg.from.z;
          if (Math.abs(dx) + Math.abs(dz) > 0.001) {
            var want = yawToFace(0, 0, dx, dz);
            state.yaw = lerpAngle(state.yaw, want, 0.25); /* smooth turn-in */
          }
        }
        /* Gait from ground speed: phase advances with distance travelled. */
        var phase = (d / (STRIDE_LENGTH * 2)) * Math.PI * 2;
        var dir = opts.backward ? -1 : 1;
        var swingL = Math.sin(phase * dir), swingR = Math.sin(phase * dir + Math.PI);
        state.pose.hipL = swingL * 0.5;
        state.pose.hipR = swingR * 0.5;
        state.pose.kneeL = 0.9 * Math.max(0, Math.sin(phase * dir + Math.PI * 0.5));
        state.pose.kneeR = 0.9 * Math.max(0, Math.sin(phase * dir + Math.PI * 1.5));
        state.pose.footYL = MAX_FOOT_LIFT * Math.max(0, swingL);
        state.pose.footYR = MAX_FOOT_LIFT * Math.max(0, swingR);
        state.pose.shoulderL = -swingL * 0.22; /* arms pump slightly */
        state.pose.shoulderR = -swingR * 0.22;
        state.pose.elbowL = 0.25; state.pose.elbowR = 0.25;
        state.pose.torsoPitch = speed > 1.0 ? 0.08 : 0.05; /* slight forward lean */
        state.pose.hipHeight = startPose ? startPose.hipHeight : STAND_HIP;
      },
      end: function () {
        if (pts.length) {
          state.x = pts[pts.length - 1].x;
          state.z = pts[pts.length - 1].z;
        }
        /* Settle: legs back to neutral, both feet flat on the floor. */
        state.pose.hipL = 0; state.pose.hipR = 0;
        state.pose.kneeL = 0; state.pose.kneeR = 0;
        state.pose.footYL = 0; state.pose.footYR = 0;
        state.pose.shoulderL = 0; state.pose.shoulderR = 0;
        state.pose.torsoPitch = 0;
      }
    };
    return step;
  }
  function walkToStep(tx, tz, speed) {
    /* Route is resolved at step start (see walkStep lazy-path note). */
    return walkStep(function () { return routeTo(tx, tz); }, speed || WALK_SPEED);
  }
  function faceCameraStep(dur) {
    return turnStep(function () { return yawToFace(state.x, state.z, CAMERA_POS.x, CAMERA_POS.z); }, dur || 0.8);
  }

  /* ---------------------------------------------------- sequence builders */
  var seatedTypingPose = {
    shoulderL: 0.75, shoulderR: 0.75, elbowL: 0.9, elbowR: 0.9,
    shoulderLz: 0.15, shoulderRz: -0.15,
    headPitch: 0.28, headYaw: 0, torsoPitch: 0.12,
    fingerCurlL: 0.55, fingerCurlR: 0.55
  };
  var seatedNeutralPose = {
    hipHeight: CHAIR_HIP, hipL: SIT_HIP_ANGLE, hipR: SIT_HIP_ANGLE,
    kneeL: SIT_KNEE, kneeR: SIT_KNEE,
    shoulderL: 0.1, shoulderR: 0.1, elbowL: 0.5, elbowR: 0.5,
    headPitch: 0.05, headYaw: 0, torsoPitch: 0.05,
    footYL: 0, footYR: 0, fingerCurlL: 0.15, fingerCurlR: 0.15
  };
  var standingNeutralPose = {
    hipHeight: STAND_HIP, hipL: 0, hipR: 0, kneeL: 0, kneeR: 0,
    shoulderL: 0, shoulderR: 0, elbowL: 0.12, elbowR: 0.12,
    shoulderLz: 0.12, shoulderRz: -0.12,
    headPitch: 0, headYaw: 0, torsoPitch: 0,
    footYL: 0, footYR: 0, fingerCurlL: 0.15, fingerCurlR: 0.15
  };

  function buildExpression(name, dur, speakingOn) {
    return [
      callStep(function () { setExpression(name); if (speakingOn) setSpeaking(true); }),
      holdStep(dur || 2.0, function () {}),
      callStep(function () { if (speakingOn) setSpeaking(false); })
    ];
  }

  var BUILDERS = {
    /* ---------------- (A) COMPUTER ---------------- */
    sitAtDesk: function () {
      /* Approach point sits on the desk side of the chair: step out from it. */
      var out = {
        x: chairPos.x + (chairPos.x - deskPos.x) / (dist2d(chairPos.x, chairPos.z, deskPos.x, deskPos.z) || 1) * 0.55,
        z: chairPos.z + (chairPos.z - deskPos.z) / (dist2d(chairPos.x, chairPos.z, deskPos.x, deskPos.z) || 1) * 0.55
      };
      return [
        walkToStep(out.x, out.z, WALK_SPEED),
        turnStep(yawToFace(chairPos.x, chairPos.z, deskPos.x, deskPos.z), 0.7),
        walkStep([chairPos], 0.5), /* short final step onto the chair, direct */
        poseStep(seatedNeutralPose, 1.0), /* hips ~0.70 -> 0.48, knees -> 90 deg */
        holdStep(0.3, function () {})
      ];
    },
    openLaptop: function () {
      return [
        poseStep({ shoulderR: 0.85, elbowR: 0.55, headPitch: 0.3, fingerCurlR: 0.4 }, 0.6),
        lidStep(1.9, 1.2), /* lid 0 -> 1.9 rad over exactly 1.2 s */
        poseStep({ shoulderR: 0.1, elbowR: 0.5, headPitch: 0.05, fingerCurlR: 0.15 }, 0.5),
        callStep(function () { setExpression('focused'); })
      ];
    },
    typeOnKeyboard: function () {
      return [
        poseStep(seatedTypingPose, 0.6),
        holdStep(6.0, function (rawT, easedT, dt, elapsed) {
          /* Fingers curl alternately, left/right out of phase. */
          var p = state.pose;
          p.fingerCurlL = 0.45 + 0.3 * Math.sin(elapsed * 9);
          p.fingerCurlR = 0.45 + 0.3 * Math.sin(elapsed * 9 + Math.PI);
          p.headPitch = 0.28 + 0.04 * Math.sin(elapsed * 1.1);
          p.shoulderL = 0.75 + 0.03 * Math.sin(elapsed * 9);
          p.shoulderR = 0.75 + 0.03 * Math.sin(elapsed * 9 + Math.PI);
        })
      ];
    },
    useMouse: function () {
      return [
        poseStep({ shoulderR: 0.55, elbowR: 0.7, wristR: 0.15, fingerCurlR: 0.35, headPitch: 0.25 }, 0.5),
        holdStep(2.5, function (rawT, easedT, dt, elapsed) {
          /* Small mouse movements: hand drifts a few cm, never a jump. */
          state.pose.shoulderR = 0.55 + 0.06 * Math.sin(elapsed * 2.2);
          state.pose.headPitch = 0.25 + 0.02 * Math.sin(elapsed * 0.9);
        })
      ];
    },
    lookAtMonitor: function () {
      return [
        poseStep({ headPitch: -0.06, headYaw: 0, shoulderL: 0.1, shoulderR: 0.1 }, 0.6),
        callStep(function () { setExpression('focused'); }),
        holdStep(2.0, function () {})
      ];
    },
    closeLaptop: function () {
      return [
        poseStep({ shoulderR: 0.85, elbowR: 0.55, headPitch: 0.3 }, 0.6),
        lidStep(0, 1.0),
        poseStep({ shoulderR: 0.1, elbowR: 0.5, headPitch: 0.05 }, 0.5)
      ];
    },

    /* ---------------- (B) MOBILE ---------------- */
    pickUpPhone: function () {
      var stand = standPosition();
      var approach = approachPoint(stand, 0.5);
      return [
        walkToStep(approach.x, approach.z, WALK_SPEED),
        turnStep(yawToFace(approach.x, approach.z, stand.x, stand.z), 0.6),
        poseStep({ shoulderR: 0.8, elbowR: 0.4, fingerCurlR: 0.2, headPitch: 0.25 }, 0.6),
        callStep(function () { attachObject('phone', props.phone, 'R'); }),
        poseStep({ shoulderR: 0.45, elbowR: 1.0, wristR: 0.3, fingerCurlR: 0.8, headPitch: 0.1 }, 0.6),
        holdStep(0.5, function () {})
      ];
    },
    unlockPhone: function () {
      return [
        poseStep({ wristR: 0.35, fingerCurlR: 0.7 }, 0.4),
        callStep(function () {
          if (props.phone && typeof props.phone.setScreen === 'function') {
            try { props.phone.setScreen(true); } catch (e) {}
          } else if (props.phone) { props.phone._screenOn = true; }
          if (props.phone && typeof props.phone.setPhoneTime === 'function') {
            try {
              var now = new Date();
              var hh = String(now.getHours()).padStart(2, '0');
              var mm = String(now.getMinutes()).padStart(2, '0');
              props.phone.setPhoneTime(hh + ':' + mm);
            } catch (e) {}
          }
        }),
        holdStep(1.0, function (rawT, easedT, dt, elapsed) {
          state.pose.fingerCurlR = 0.7 + 0.25 * Math.sin(elapsed * 12); /* thumb tap */
        })
      ];
    },
    scrollScreen: function () {
      return [
        holdStep(4.0, function (rawT, easedT, dt, elapsed) {
          /* Thumb swipes: wrist rocks, phone tilts slightly with each swipe. */
          state.pose.wristR = 0.3 + 0.18 * Math.sin(elapsed * 1.6);
          state.pose.fingerCurlR = 0.7 + 0.2 * Math.sin(elapsed * 3.2);
          state.pose.headPitch = 0.12 + 0.03 * Math.sin(elapsed * 0.8);
          state.pose.shoulderR = 0.45 + 0.04 * Math.sin(elapsed * 1.6);
        })
      ];
    },
    typeMessage: function () {
      return [
        holdStep(3.0, function (rawT, easedT, dt, elapsed) {
          state.pose.fingerCurlR = 0.6 + 0.35 * Math.abs(Math.sin(elapsed * 7)); /* thumb taps */
          state.pose.wristR = 0.3 + 0.05 * Math.sin(elapsed * 7);
        })
      ];
    },
    callAnimation: function () {
      return [
        poseStep({ shoulderR: 0.35, shoulderRz: -0.9, elbowR: 1.9, wristR: 0.2, headPitch: 0.05, headRoll: 0.12, fingerCurlR: 0.85 }, 0.8),
        callStep(function () { setExpression('speaking'); setSpeaking(true); }),
        holdStep(3.0, function (rawT, easedT, dt, elapsed) {
          state.pose.headRoll = 0.12 + 0.04 * Math.sin(elapsed * 1.4);
        }),
        callStep(function () { setSpeaking(false); }),
        poseStep({ shoulderR: 0.45, shoulderRz: -0.12, elbowR: 1.0, headRoll: 0, fingerCurlR: 0.8 }, 0.5)
      ];
    },
    putPhoneBack: function () {
      var stand = standPosition();
      var approach = approachPoint(stand, 0.5);
      return [
        walkToStep(approach.x, approach.z, WALK_SPEED),
        turnStep(yawToFace(approach.x, approach.z, stand.x, stand.z), 0.6),
        poseStep({ shoulderR: 0.8, elbowR: 0.4, fingerCurlR: 0.7, headPitch: 0.25 }, 0.6),
        callStep(function () {
          detachObject('phone', stand); /* onto the stand — never floating */
          if (props.phone && typeof props.phone.setScreen === 'function') {
            try { props.phone.setScreen(false); } catch (e) {}
          } else if (props.phone) { props.phone._screenOn = false; }
        }),
        poseStep({ shoulderR: 0.1, elbowR: 0.12, fingerCurlR: 0.15, headPitch: 0.05 }, 0.5)
      ];
    },

    /* ---------------- (C) MOVEMENT ---------------- */
    walkForward: function () {
      return [walkStep(function () {
        var f = forwardVec();
        return [{ x: state.x + f.x * 2, z: state.z + f.z * 2 }];
      }, WALK_SPEED)];
    },
    walkBack: function () {
      return [walkStep(function () {
        var f = forwardVec();
        return [{ x: state.x - f.x * 1.5, z: state.z - f.z * 1.5 }];
      }, WALK_SPEED, { backward: true, keepYaw: true })];
    },
    turnAround: function () {
      return [turnStep(state.yaw + Math.PI, 1.2)];
    },
    strafeLeft: function () {
      return [walkStep(function () {
        var r = rightVec();
        return [{ x: state.x - r.x * 1, z: state.z - r.z * 1 }];
      }, WALK_SPEED, { keepYaw: true })];
    },
    strafeRight: function () {
      return [walkStep(function () {
        var r = rightVec();
        return [{ x: state.x + r.x * 1, z: state.z + r.z * 1 }];
      }, WALK_SPEED, { keepYaw: true })];
    },
    goToDesk: function () {
      var approach = approachPoint(deskPos, 0.9);
      return [
        walkToStep(approach.x, approach.z, HURRY_SPEED),
        turnStep(yawToFace(approach.x, approach.z, deskPos.x, deskPos.z), 0.6)
      ];
    },
    goToSofa: function () {
      var approach = approachPoint(sofaSeatPos, 0.8);
      return [
        walkToStep(approach.x, approach.z, HURRY_SPEED),
        turnStep(yawToFace(approach.x, approach.z, sofaPos.x, sofaPos.z), 0.6)
      ];
    },
    sitDown: function () {
      var approach = approachPoint(sofaSeatPos, 0.8);
      return [
        walkToStep(approach.x, approach.z, WALK_SPEED),
        /* Turn to face away from the sofa (out toward the room), then back in. */
        turnStep(yawToFace(sofaSeatPos.x, sofaSeatPos.z, CAMERA_POS.x, CAMERA_POS.z), 0.7),
        walkStep([sofaSeatPos], 0.5),
        poseStep({
          hipHeight: SOFA_HIP, hipL: SIT_HIP_ANGLE, hipR: SIT_HIP_ANGLE,
          kneeL: SIT_KNEE, kneeR: SIT_KNEE,
          shoulderL: 0.15, shoulderR: 0.15, elbowL: 0.6, elbowR: 0.6,
          headPitch: 0.08, torsoPitch: -0.12, /* lean back, relaxed */
          footYL: 0, footYR: 0, fingerCurlL: 0.1, fingerCurlR: 0.1
        }, 1.0),
        holdStep(0.4, function () {})
      ];
    },
    standUp: function () {
      return [
        poseStep(standingNeutralPose, 1.0), /* hips rise 0.48 -> ~0.70, knees straighten */
        walkStep(function () {
          var f = forwardVec();
          return [{ x: state.x + f.x * 0.4, z: state.z + f.z * 0.4 }];
        }, 0.6)
      ];
    },

    /* ---------------- (D) DAILY ---------------- */
    readBook: function () {
      var table = tablePosition();
      var approach = approachPoint(table, 0.6);
      var steps = [];
      if (state.pose.hipHeight > 0.7) { /* standing: fetch the book first */
        steps.push(walkToStep(approach.x, approach.z, WALK_SPEED));
        steps.push(turnStep(yawToFace(approach.x, approach.z, table.x, table.z), 0.6));
        steps.push(poseStep({ shoulderL: 0.7, elbowL: 0.5, fingerCurlL: 0.5, headPitch: 0.25 }, 0.6));
        if (props.book) steps.push(callStep(function () { attachObject('book', props.book, 'L'); }));
        steps.push(poseStep({ shoulderL: 0.35, elbowL: 0.9, fingerCurlL: 0.7 }, 0.5));
      }
      steps.push.apply(steps, BUILDERS.sitDown());
      steps.push(poseStep({
        shoulderL: 0.55, shoulderR: 0.55, elbowL: 1.0, elbowR: 1.0,
        headPitch: 0.3, torsoPitch: -0.05, fingerCurlL: 0.6, fingerCurlR: 0.6
      }, 0.8)); /* hold the book open, head down slightly */
      steps.push(holdStep(5.0, function (rawT, easedT, dt, elapsed) {
        state.pose.headPitch = 0.3 + 0.03 * Math.sin(elapsed * 0.7);
      }));
      return steps;
    },
    drinkWater: function () {
      var table = tablePosition();
      var approach = approachPoint(table, 0.6);
      var steps = [];
      if (state.pose.hipHeight > 0.7) {
        steps.push(walkToStep(approach.x, approach.z, WALK_SPEED));
        steps.push(turnStep(yawToFace(approach.x, approach.z, table.x, table.z), 0.6));
      }
      steps.push(poseStep({ shoulderR: 0.7, elbowR: 0.5, fingerCurlR: 0.5, headPitch: 0.2 }, 0.6));
      if (props.glass) steps.push(callStep(function () { attachObject('glass', props.glass, 'R'); }));
      steps.push(poseStep({ shoulderR: 0.5, elbowR: 1.5, wristR: 0.2, headPitch: -0.08, fingerCurlR: 0.75 }, 0.8)); /* raise to face */
      steps.push(holdStep(1.2, function () {})); /* drink */
      steps.push(poseStep({ shoulderR: 0.7, elbowR: 0.5, headPitch: 0.2, fingerCurlR: 0.6 }, 0.8)); /* lower */
      if (props.glass) steps.push(callStep(function () { detachObject('glass', table); }));
      steps.push(poseStep({ shoulderR: 0.15, elbowR: 0.6, fingerCurlR: 0.1, headPitch: 0.08 }, 0.5));
      return steps;
    },
    restOnSofa: function (opts) {
      opts = opts || {};
      var steps = [];
      if (state.pose.hipHeight > 0.7) steps.push.apply(steps, BUILDERS.sitDown());
      steps.push(callStep(function () { setExpression(opts.expression || 'relaxed'); }));
      steps.push(poseStep({
        hipHeight: SOFA_HIP, hipL: SIT_HIP_ANGLE, hipR: SIT_HIP_ANGLE,
        kneeL: SIT_KNEE, kneeR: SIT_KNEE,
        shoulderL: 0.1, shoulderR: 0.1, elbowL: 0.7, elbowR: 0.7,
        headPitch: 0.12, headRoll: 0.1, torsoPitch: -0.18, /* lean back */
        footYL: 0, footYR: 0, fingerCurlL: 0.05, fingerCurlR: 0.05
      }, 1.2));
      steps.push(holdStep(6.0, function (rawT, easedT, dt, elapsed) {
        /* Slow, sleepy breathing: torso rises and falls gently. */
        state.pose.torsoPitch = -0.18 + 0.02 * Math.sin(elapsed * 0.9);
      }));
      return steps;
    },
    visitPlants: function () {
      var plant = plantPositions[0] || { x: -2.8, z: 1.8 };
      var approach = approachPoint(plant, 0.6);
      return [
        walkToStep(approach.x, approach.z, WALK_SPEED),
        turnStep(yawToFace(approach.x, approach.z, plant.x, plant.z), 0.6),
        poseStep({ torsoPitch: 0.25, headPitch: 0.3, shoulderR: 0.6, elbowR: 0.5, fingerCurlR: 0.3 }, 1.0), /* lean in */
        holdStep(1.5, function (rawT, easedT, dt, elapsed) {
          state.pose.shoulderR = 0.6 + 0.08 * Math.sin(elapsed * 1.5); /* gesture toward leaves */
          state.pose.wristR = 0.1 * Math.sin(elapsed * 1.5);
        }),
        poseStep({ torsoPitch: 0, headPitch: 0, shoulderR: 0.1, elbowR: 0.12, fingerCurlR: 0.15 }, 0.8)
      ];
    },
    gestureHands: function () {
      return [
        faceCameraStep(0.8),
        poseStep({
          shoulderL: 0.9, shoulderR: 0.9, shoulderLz: 0.7, shoulderRz: -0.7,
          elbowL: 0.35, elbowR: 0.35, headPitch: 0, fingerCurlL: 0.05, fingerCurlR: 0.05
        }, 0.8), /* both hands open */
        holdStep(3.0, function (rawT, easedT, dt, elapsed) {
          state.pose.shoulderL = 0.9 + 0.12 * Math.sin(elapsed * 1.8);
          state.pose.shoulderR = 0.9 + 0.12 * Math.sin(elapsed * 1.8 + Math.PI);
          state.pose.headYaw = 0.08 * Math.sin(elapsed * 0.9);
        }),
        poseStep({ shoulderL: 0.1, shoulderR: 0.1, shoulderLz: 0.12, shoulderRz: -0.12, elbowL: 0.12, elbowR: 0.12 }, 0.6)
      ];
    },
    /* Character-sheet waving pose: right hand up beside the head, palm
       open, waving side to side — arm raised smoothly, never snapped up. */
    wave: function () {
      return [
        faceCameraStep(0.8),
        callStep(function () { setExpression('happy'); }),
        poseStep({
          shoulderR: 0.5, shoulderRz: -1.5, elbowR: 0.9,
          wristR: 0, fingerCurlR: 0.05, headPitch: 0, headRoll: 0.06
        }, 0.7),
        holdStep(3.0, function (rawT, easedT, dt, elapsed) {
          state.pose.shoulderRz = -1.5 + 0.35 * Math.sin(elapsed * 5); /* wave */
          state.pose.wristR = 0.2 * Math.sin(elapsed * 5);
          state.pose.headRoll = 0.06 + 0.04 * Math.sin(elapsed * 2.5);
        }),
        poseStep({ shoulderR: 0.1, shoulderRz: -0.12, elbowR: 0.12, fingerCurlR: 0.15, headRoll: 0 }, 0.6)
      ];
    },
    waving: function () { return BUILDERS.wave(); },
    /* Character-sheet pointing pose: right arm extended straight out,
       hand open with the finger extended, head following the point. */
    point: function () {
      return [
        faceCameraStep(0.8),
        poseStep({
          shoulderR: 1.25, shoulderRz: -0.25, elbowR: 0.08,
          wristR: 0, fingerCurlR: 0.08, headPitch: 0.02, headYaw: -0.12
        }, 0.7),
        holdStep(2.5, function (rawT, easedT, dt, elapsed) {
          state.pose.shoulderR = 1.25 + 0.05 * Math.sin(elapsed * 2.0); /* small point bob */
          state.pose.headYaw = -0.12 + 0.03 * Math.sin(elapsed * 1.2);
        }),
        poseStep({ shoulderR: 0.1, shoulderRz: -0.12, elbowR: 0.12, fingerCurlR: 0.15, headYaw: 0 }, 0.6)
      ];
    },
    pointing: function () { return BUILDERS.point(); },
    talkToCamera: function () {
      return [
        faceCameraStep(0.8),
        callStep(function () { setExpression('speaking'); setSpeaking(true); }),
        poseStep({ shoulderR: 0.6, elbowR: 0.6, fingerCurlR: 0.2, headPitch: 0.02 }, 0.6),
        holdStep(4.0, function (rawT, easedT, dt, elapsed) {
          /* Speaking hand gestures, small and continuous — never a snap. */
          state.pose.shoulderR = 0.6 + 0.15 * Math.sin(elapsed * 2.0);
          state.pose.shoulderL = 0.15 * Math.sin(elapsed * 2.0 + Math.PI);
          state.pose.headYaw = 0.1 * Math.sin(elapsed * 0.8);
          state.pose.headPitch = 0.02 + 0.03 * Math.sin(elapsed * 1.3);
        }),
        callStep(function () { setSpeaking(false); }),
        poseStep({ shoulderR: 0.1, elbowR: 0.12, fingerCurlR: 0.15, headYaw: 0 }, 0.5)
      ];
    },

    /* ---------------- (E) FACIAL — sheet set: Neutral, Happy, Curious,
       Thinking, Surprised, Speaking, Listening (exact sheet names) -------- */
    neutral: function () {
      return [
        callStep(function () { setExpression('neutral'); }),
        poseStep({ headPitch: 0, headYaw: 0, headRoll: 0 }, 0.5),
        holdStep(1.5, function () {})
      ];
    },
    happy: function () { return buildExpression('happy', 2.0, false); },
    curious: function () {
      return [
        callStep(function () { setExpression('curious'); }),
        poseStep({ headPitch: 0.12, headRoll: 0.18, torsoPitch: 0.08 }, 0.6), /* lean in, head tilt */
        holdStep(2.0, function (rawT, easedT, dt, elapsed) {
          state.pose.headRoll = 0.18 + 0.03 * Math.sin(elapsed * 1.5);
        }),
        poseStep({ headPitch: 0, headRoll: 0, torsoPitch: 0 }, 0.5)
      ];
    },
    surprised: function () {
      return [
        callStep(function () { setExpression('surprised'); }),
        poseStep({
          headPitch: -0.14, shoulderL: 0.7, shoulderR: 0.7,
          elbowL: 0.5, elbowR: 0.5, fingerCurlL: 0.05, fingerCurlR: 0.05
        }, 0.5), /* head back, both hands half-up */
        holdStep(1.5, function () {}),
        poseStep({ headPitch: 0, shoulderL: 0.1, shoulderR: 0.1, elbowL: 0.12, elbowR: 0.12 }, 0.5)
      ];
    },
    thinking: function () {
      return [
        callStep(function () { setExpression('thinking'); }),
        poseStep({ headPitch: 0.15, headRoll: 0.12, shoulderR: 0.4, elbowR: 1.2, fingerCurlR: 0.5 }, 0.6),
        holdStep(1.5, function () {}),
        poseStep({ headPitch: 0, headRoll: 0, shoulderR: 0.1, elbowR: 0.12 }, 0.5)
      ];
    },
    speaking: function () { return buildExpression('speaking', 2.5, true); },
    listening: function () {
      return [
        callStep(function () { setExpression('listening'); }),
        poseStep({ headPitch: 0.08, headYaw: 0.15 }, 0.5),
        holdStep(2.0, function () {}),
        poseStep({ headPitch: 0, headYaw: 0 }, 0.5)
      ];
    },
    confused: function () {
      return [
        callStep(function () { setExpression('confused'); }),
        poseStep({ headPitch: 0.1, headRoll: -0.14, shoulderL: 0.5, shoulderR: 0.5, elbowL: 0.9, elbowR: 0.9 }, 0.6),
        holdStep(1.6, function () {}),
        poseStep({ headPitch: 0, headRoll: 0, shoulderL: 0.1, shoulderR: 0.1, elbowL: 0.12, elbowR: 0.12 }, 0.5)
      ];
    },
    sleeping: function () { return buildExpression('sleeping', 3.0, false); },
    relaxed: function () { return buildExpression('relaxed', 2.5, false); },
    focused: function () { return buildExpression('focused', 2.0, false); }
  };

  /* blinkLoop / headIdle are ambient background layers, not blocking
     sequences: play() enables them and leaves current() as null so any
     other sequence can still run on top of them. */
  var AMBIENT_NAMES = { blinkLoop: 'blink', headIdle: 'sway' };

  /* ------------------------------------------------------------ engine */
  function startSequence(name, opts) {
    opts = opts || {};
    var builder = BUILDERS[name];
    if (!builder) return false;
    var steps = builder(opts);
    state.active = {
      name: name, steps: steps, index: 0, stepT: 0,
      loop: !!opts.loop /* loop only when the caller asked for it; a loopable
                           sequence played without {loop:true} runs once */
    };
    state.returnTween = null;
    var first = steps[0];
    if (first && first.start) first.start();
    return true;
  }
  function advanceQueue() {
    if (state.queue.length) {
      var next = state.queue.shift();
      startSequence(next.name, next.opts || {});
      return true;
    }
    return false;
  }
  function finishActive() {
    var wasLoop = state.active && state.active.loop;
    var name = state.active ? state.active.name : null;
    state.active = null;
    applyPose();
    if (wasLoop && name) { startSequence(name, { loop: true }); return; }
    if (!advanceQueue()) { /* idle: ambient layers keep running */ }
  }

  /* ------------------------------------------------------------ public API */
  function play(name, opts) {
    opts = opts || {};
    if (!SEQUENCE_DEFS[name]) return false;
    if (AMBIENT_NAMES[name]) {
      if (name === 'blinkLoop') state.ambient.blink = true;
      if (name === 'headIdle') state.ambient.sway = true;
      return true; /* background layer — does not block other sequences */
    }
    state.queue = []; /* a direct play replaces any pending chain */
    setSpeaking(false);
    return startSequence(name, opts);
  }
  function update(dt) {
    dt = clamp(typeof dt === 'number' && isFinite(dt) ? dt : 1 / 60, 0, 0.1);
    state.time += dt;

    /* Ambient blink layer: every 2.5–5 s at random. */
    if (state.ambient.blink) {
      state.ambient.nextBlink -= dt;
      if (state.ambient.nextBlink <= 0) {
        doBlink();
        state.ambient.nextBlink = 2.5 + Math.random() * 2.5;
      }
    }

    /* stop() neutral tween (runs independently of any active sequence). */
    if (state.returnTween) {
      var rt = state.returnTween;
      rt.t += dt;
      var e = smoothstep(rt.t / rt.dur);
      for (var k in rt.target) state.pose[k] = lerp(rt.from[k], rt.target[k], e);
      if (rt.t >= rt.dur) {
        for (var k2 in rt.target) state.pose[k2] = rt.target[k2];
        state.returnTween = null;
      }
    }

    /* Active sequence. Zero-duration steps (calls) run immediately. */
    var guard = 0;
    while (state.active && guard++ < 100) {
      var seq = state.active;
      var step = seq.steps[seq.index];
      if (!step) { finishActive(); break; }
      if (step.dur <= 0) {
        if (step.start) step.start();
        if (step.end) step.end();
        seq.index++;
        var nxt = seq.steps[seq.index];
        if (nxt && nxt.start) nxt.start();
        if (seq.index >= seq.steps.length) { finishActive(); break; }
        continue;
      }
      seq.stepT += dt;
      var rawT = clamp(seq.stepT / step.dur, 0, 1);
      var easedT = smoothstep(rawT);
      if (step.update) step.update(rawT, easedT, dt, seq.stepT);
      if (seq.stepT >= step.dur) {
        if (step.end) step.end();
        seq.index++;
        seq.stepT = 0;
        var following = seq.steps[seq.index];
        if (following && following.start) following.start();
        if (seq.index >= seq.steps.length) { finishActive(); break; }
      }
      break; /* one timed step per frame */
    }

    updateHeldObjects();
    applyPose();
  }
  function stop() {
    state.queue = [];
    state.active = null;
    setSpeaking(false);
    setExpression('neutral');
    /* Ease back to a neutral pose over 0.6 s — never a snap. Held objects
       stay gripped (they are released only by their own sequence). */
    state.returnTween = {
      t: 0, dur: 0.6,
      from: clonePose(state.pose),
      target: state.pose.hipHeight < 0.7
        ? { hipHeight: STAND_HIP, hipL: 0, hipR: 0, kneeL: 0, kneeR: 0, shoulderL: 0, shoulderR: 0, elbowL: 0.12, elbowR: 0.12, headPitch: 0, headYaw: 0, torsoPitch: 0, footYL: 0, footYR: 0 }
        : clonePose(NEUTRAL_POSE)
    };
    /* If seated, stop() stands ENZO up smoothly instead of teleporting the
       hips; the target above already carries hipHeight STAND_HIP. */
    state.returnTween.target.hipHeight = STAND_HIP;
    state.returnTween.target.hipL = 0;
    state.returnTween.target.hipR = 0;
    state.returnTween.target.kneeL = 0;
    state.returnTween.target.kneeR = 0;
  }
  function current() {
    return state.active ? state.active.name : null;
  }
  function setActivity(name) {
    if (!ACTIVITY_MAP.hasOwnProperty(name)) return false;
    if (name === 'idle') {
      stop();
      state.ambient.blink = true;
      state.ambient.sway = true;
      return true;
    }
    var chain = ACTIVITY_MAP[name].slice();
    if (name === 'coding' && state.pose.hipHeight > 0.7) {
      chain = ['sitAtDesk', 'openLaptop', 'typeOnKeyboard'];
    }
    if (name === 'sleeping') {
      state.queue = [];
      return startSequence('restOnSofa', { expression: 'sleeping' });
    }
    if (!chain.length) return true;
    state.queue = chain.slice(1).map(function (n) { return { name: n, opts: {} }; });
    if (name === 'researching' || name === 'mobile' || name === 'coding') {
      /* The last step of these chains is a loopable working state. */
      var last = state.queue[state.queue.length - 1];
      if (last) last.opts = { loop: true };
    }
    setSpeaking(false);
    return startSequence(chain[0], {});
  }
  /* Setup-only placement (initial spawn). NOT used by any sequence and never
     called during an animation — sequences always travel, never teleport. */
  function setStartPosition(x, z, yaw) {
    var c = clampToBounds(x, z);
    state.x = c.x; state.z = c.z;
    state.yaw = (yaw == null ? 0 : yaw);
    state.pose = clonePose(NEUTRAL_POSE);
    applyPose();
  }
  function getPose() {
    var p = clonePose(state.pose);
    p.x = state.x; p.z = state.z; p.yaw = state.yaw;
    p.expression = state.expression;
    return p;
  }
  function getHeld() {
    var out = [];
    for (var name in state.held) out.push(name);
    return out;
  }
  function listSequences() {
    var names = [];
    for (var n in SEQUENCE_DEFS) names.push(n);
    return names.sort();
  }

  var SEQUENCES = {};
  for (var sName in SEQUENCE_DEFS) {
    SEQUENCES[sName] = {
      group: SEQUENCE_DEFS[sName].group,
      description: SEQUENCE_DEFS[sName].description,
      loopable: SEQUENCE_DEFS[sName].loopable
    };
  }

  applyPose();

  return {
    play: play,
    update: update,
    stop: stop,
    current: current,
    setActivity: setActivity,
    setStartPosition: setStartPosition,
    getPose: getPose,
    getHeld: getHeld,
    isHolding: isHolding,
    listSequences: listSequences,
    SEQUENCES: SEQUENCES,
    /* Exposed for debugging / tests only: */
    _state: state
  };
}

/* UMD-style export: Node (node --check + self-check) and browser globals. */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createAnimationSystem: createAnimationSystem, SEQUENCES: SEQUENCE_DEFS };
} else if (typeof globalThis !== 'undefined') {
  globalThis.createAnimationSystem = createAnimationSystem;
  globalThis.EnzoAnimations = { createAnimationSystem: createAnimationSystem, SEQUENCES: SEQUENCE_DEFS };
}

  return createAnimationSystem;
})();
  window.EnzoRoom.createAnimationSystem=createAnimationSystem;
})();
