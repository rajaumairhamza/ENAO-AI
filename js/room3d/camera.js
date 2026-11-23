(function(){
  'use strict';
  if(!window.EnzoRoom||!window.EnzoRoom.threeOK){ return; }

/* ---- PIECE 5 — CAMERAS (ES-module exports stripped for this classic script) ---- */
var createCameraSystem=(function(){
/**
 * PIECE 5 — ENZO 3D Room: Camera System
 * Artifact: enao-ai (ENZO AI web app)
 * ---------------------------------------------------------------------------
 * STATUS: BASE BUILD ONLY — NOT FINAL.
 * The reference image (room with window + desk left, bookshelf + ENZO screen
 * on the back wall, sofa + coffee table right, ENZO centre) is ONLY a
 * reference. More room detail is coming from Raja afterwards and the final
 * assembly waits for it. This piece is therefore built to be ADJUSTABLE:
 *
 *   - Every anchor, offset, bound and timing lives in DEFAULT_TUNING below.
 *   - The app (or a later piece) can override any of it WITHOUT editing the
 *     mode logic, by passing `props.cameraTuning` (or `room.cameraTuning`)
 *     with only the keys that change, e.g.:
 *         createCameraSystem(camera, enzo, room, {
 *           cameraTuning: { deskPos: [-1.9, 1.3, 1.3], walkBehind: 2.4 }
 *         }, THREE)
 *   - Mode behaviour is data-driven (one resolver per mode), so a new anchor
 *     from Raja's later detail is a one-line tuning change, not a rewrite.
 *
 * INTEGRATION (how the app wires this in):
 *   import { createCameraSystem } from './05-cameras.js';
 *   const camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 100);
 *   const cams = createCameraSystem(camera, enzo, room, props, THREE);
 *   // every frame, inside the render loop (AFTER Piece 4 moves ENZO):
 *   cams.update(clock.getDelta());            // dt in seconds; defaults to 1/60
 *   // whenever Piece 4 changes activity:
 *   cams.autoSelect(animation.current());     // 'researching' | 'coding' | ...
 *   // manual override (operator / UI button):
 *   cams.setMode('enzoCloseup');              // holds 20s, then gently returns to auto
 *
 * CONTRACTS (from the other pieces — this file does NOT rebuild them):
 *   - Room: x in [-3.2, +3.2], z in [-2.6, +2.6], floor y=0, ceiling y=3.0.
 *     Desk along left wall centre (-2.55, 0, -0.6), desk top y=0.78.
 *     Chair (-1.9, 0, -0.6). Sofa right (2.2, 0, -0.4).
 *     Coffee table (1.2, 0, -0.4). ENZO home (0.3, 0, 0.4).
 *     Wall screen (0.9, 1.7, -2.55). Laptop on desk; phone on stand on desk.
 *   - ENZO is 1.35 m tall (character sheet, 4.5 ft — second design authority
 *     alongside the room reference). All ENZO framing in this file derives
 *     from the LIVE enzo.head world position and 1.35 m proportions; no
 *     1.50 m height is used anywhere. The only height number kept is the
 *     enzoHeadHeight fallback (~1.18 m head centre) for the case where the
 *     enzo.head handle is unavailable — and even that is a fraction of 1.35.
 *   - enzo.group is the animated root (position animated by Piece 4).
 *   - enzo.head.getWorldPosition(vec3) gives the live head position.
 *   - Piece 4: current() returns the active sequence name or null;
 *     setActivity(name) maps researching/coding/mobile/idle/speaking/
 *     success/error/sleeping.
 *   - props may carry live handles: props.laptop / props.laptopPosition and
 *     props.phone / props.phonePosition (object with getWorldPosition(),
 *     or .position, or plain {x, y, z}). Anything missing falls back to the
 *     tuning anchors below. room.bounds (if supplied) overrides the bounds.
 *
 * GUARANTEES:
 *   - All 6 modes stay inside the room (clamped x ±3.1, y 0.3..2.9,
 *     z -2.5..5.0, never below y=0.25). The fullRoom shot sits at z=4.6,
 *     i.e. just outside the open front of the room, looking in — that is
 *     intentional and inside the allowed z range.
 *   - No snap cuts, ever: every mode change blends position + lookAt target
 *     over ~1.2s with smoothstep easing, AND no single frame ever moves the
 *     camera more than maxStepPerFrame (0.09 m) — even if the app hands us
 *     a camera that starts far outside the room, it glides back in instead
 *     of jumping.
 *   - No chat / call / UI logic in this file.
 */

// ---------------------------------------------------------------------------
// Adjustable tuning — the ONLY place numbers live. Override via
// props.cameraTuning / room.cameraTuning; mode code below never hard-codes
// a position. (Values below are the room image + master-sheet base, with
// ENZO heights from the character sheet: canonical height 1.35 m / 4.5 ft.
// Raja's later detail lands here.)
// ---------------------------------------------------------------------------
const DEFAULT_TUNING = {
  // Room clamp for the camera (front is open: z may go to 5.0 for the wide shot).
  bounds: { minX: -3.1, maxX: 3.1, minY: 0.3, maxY: 2.9, minZ: -2.5, maxZ: 5.0 },
  minYFloor: 0.25,            // absolute floor — camera never goes below this.
  transitionSeconds: 1.2,     // smoothstep blend time for every mode change.
  manualHoldSeconds: 20,      // manual setMode() hold before gently returning to auto.
  maxStepPerFrame: 0.09,      // metres — hard cap on any single-frame camera move.
  settleTau: 0.15,            // exponential settle time-constant (static modes).
  walkLagTau: 0.30,           // tracking lag for walkingCamera (~0.3s, feels handheld).

  // Mode anchors — [x, y, z]. See the room spec in the header.
  fullRoomPos: [0, 2.1, 4.6],       // wide shot, whole room in frame.
  fullRoomTarget: [0, 1.0, -0.6],
  enzoCloseupOffset: [0.9, 0.25, 1.4], // added to live head position.
  laptopPos: [-0.9, 1.5, -0.6],     // over-the-shoulder desk shot.
  laptopTarget: [-2.55, 0.82, -0.6], // laptop on the desk.
  phoneFallback: [-2.35, 1.0, -0.35], // phone on its stand on the desk.
  mobileOffset: [0.35, 0.25, 0.6],  // added to live phone position.
  walkBehind: 2.2,                  // tracking distance behind ENZO.
  walkHeight: 1.6,                  // tracking camera height above the floor
                                    // (0.25 m above ENZO's 1.35 m head: slight
                                    // downward tracking angle, not an ENZO height).
  walkLookHeight: 1.1,              // lookAt height on ENZO while walking:
                                    // upper-chest / face line of a 1.35 m body
                                    // (~0.81 x 1.35 m), NOT a hardcoded 1.50 m.
  deskPos: [-1.9, 1.3, 1.3],        // side profile of ENZO seated at desk.
  deskTarget: [-2.3, 0.9, -0.6],

  // ENZO fallbacks (only used if enzo.head / enzo.group are unavailable).
  // Canonical height 1.35 m (character sheet); head centre sits at ~1.18 m
  // (~0.87 x 1.35 m) — the big round head spans roughly 1.02–1.35 m.
  enzoHeadHeight: 1.18,
  enzoHome: [0.3, 0, 0.4],
};

const CAMERA_MODES = [
  'fullRoom',
  'enzoCloseup',
  'laptopCloseup',
  'mobileCloseup',
  'walkingCamera',
  'deskWorking',
];

// Activity (Piece 4) -> camera mode. Keys are matched after lower-casing and
// stripping spaces / _ / -. Anything unrecognised falls back to 'fullRoom'.
const AUTO_MAP = {
  researching: 'laptopCloseup',
  coding: 'deskWorking',
  mobile: 'mobileCloseup',
  speaking: 'enzoCloseup',
  talktocamera: 'enzoCloseup',
  greeting: 'enzoCloseup',
  success: 'enzoCloseup',
  error: 'enzoCloseup',
  idle: 'fullRoom',
  sleeping: 'fullRoom',
  sleep: 'fullRoom',
  rest: 'fullRoom',
};

// Walking / movement sequences (Piece 4 sequence names such as 'walkToDesk',
// 'moveToSofa', 'goToWindow') -> tracking shot. Checked after AUTO_MAP.
const WALK_PATTERN = /walk|move|goto|approach|stroll|tour|roam|wander/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function smoothstep(t) {
  t = Math.min(1, Math.max(0, t));
  return t * t * (3 - 2 * t);
}

function isNum(n) {
  return typeof n === 'number' && isFinite(n);
}

/**
 * Clamp a Vector3-like {x, y, z} inside the room bounds, in place.
 * Never lets y drop below max(bounds.minY, 0.25). Returns the same object.
 * Exported so the app / other pieces can reuse the exact same clamp.
 */
function clampCameraPosition(v, bounds) {
  const b = bounds || DEFAULT_TUNING.bounds;
  const minY = Math.max(b.minY, DEFAULT_TUNING.minYFloor);
  v.x = Math.min(b.maxX, Math.max(b.minX, v.x));
  v.y = Math.min(b.maxY, Math.max(minY, v.y));
  v.z = Math.min(b.maxZ, Math.max(b.minZ, v.z));
  return v;
}

// Move `v` toward `prev` by at most maxStep — the no-snap-cut guarantee.
function limitStep(v, prev, maxStep) {
  const dx = v.x - prev.x;
  const dy = v.y - prev.y;
  const dz = v.z - prev.z;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (d > maxStep && d > 0) {
    const s = maxStep / d;
    v.x = prev.x + dx * s;
    v.y = prev.y + dy * s;
    v.z = prev.z + dz * s;
  }
  return v;
}

function mapActivityToMode(activityName) {
  if (activityName == null) return 'fullRoom';
  const key = String(activityName).toLowerCase().replace(/[\s_-]+/g, '');
  if (AUTO_MAP[key]) return AUTO_MAP[key];
  if (WALK_PATTERN.test(key)) return 'walkingCamera';
  return 'fullRoom';
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
function createCameraSystem(camera, enzo, room, props, THREE) {
  props = props || {};
  room = room || {};

  // --- Resolve tuning (defaults <- room.cameraTuning <- props.cameraTuning).
  const tuning = Object.assign(
    {},
    DEFAULT_TUNING,
    room.cameraTuning || {},
    props.cameraTuning || {}
  );
  const bounds = Object.assign(
    {},
    DEFAULT_TUNING.bounds,
    (room.bounds || props.bounds || {}),
    ((room.cameraTuning && room.cameraTuning.bounds) || {}),
    ((props.cameraTuning && props.cameraTuning.bounds) || {})
  );
  bounds.minY = Math.max(bounds.minY, tuning.minYFloor);

  const V = (arr) => new THREE.Vector3(arr[0], arr[1], arr[2]);
  const fullRoomPos = V(tuning.fullRoomPos);
  const fullRoomTarget = V(tuning.fullRoomTarget);
  const enzoCloseupOffset = V(tuning.enzoCloseupOffset);
  const laptopPos = V(tuning.laptopPos);
  const laptopTarget = V(tuning.laptopTarget);
  const phoneFallback = V(tuning.phoneFallback);
  const mobileOffset = V(tuning.mobileOffset);
  const deskPos = V(tuning.deskPos);
  const deskTarget = V(tuning.deskTarget);
  const enzoHome = V(tuning.enzoHome);

  // --- Scratch vectors (no per-frame allocation in the hot path).
  const tmpHead = new THREE.Vector3();
  const tmpEnzo = new THREE.Vector3();
  const tmpPhone = new THREE.Vector3();
  const tmpFacing = new THREE.Vector3();
  const tmpDesiredPos = new THREE.Vector3();
  const tmpDesiredTarget = new THREE.Vector3();
  const tmpBlendPos = new THREE.Vector3();
  const tmpBlendTarget = new THREE.Vector3();
  const prevPos = new THREE.Vector3();
  const prevTarget = new THREE.Vector3();
  const tmpClamped = new THREE.Vector3();

  // --- State.
  const currentPos = camera.position.clone();
  const currentTarget = fullRoomTarget.clone();
  let mode = 'fullRoom';
  let lastAutoMode = 'fullRoom';
  let manual = false;
  let manualTimer = 0;
  let transitioning = true; // ease in from wherever the camera starts.
  let transitionT = 0;
  let transitionDuration = tuning.transitionSeconds;
  const transitionFromPos = currentPos.clone();
  const transitionFromTarget = currentTarget.clone();
  const behindDir = new THREE.Vector3(0, 0, 1); // default: camera on +z side.
  let lastEnzoPos = null;
  let elapsed = 0;

  // --- Live position resolvers (props handles win, tuning anchors are fallback).
  function getEnzoPosition(out) {
    if (enzo && enzo.group && enzo.group.position && isNum(enzo.group.position.x)) {
      return out.copy(enzo.group.position);
    }
    if (enzo && enzo.position && isNum(enzo.position.x)) {
      return out.copy(enzo.position);
    }
    return out.copy(enzoHome);
  }

  function getHeadPosition(out) {
    if (enzo && enzo.head && typeof enzo.head.getWorldPosition === 'function') {
      try {
        enzo.head.getWorldPosition(out);
        return out;
      } catch (e) { /* fall through to the group-based fallback */ }
    }
    getEnzoPosition(tmpEnzo);
    return out.set(tmpEnzo.x, tmpEnzo.y + tuning.enzoHeadHeight, tmpEnzo.z);
  }

  // Resolve any handle: getWorldPosition() object, { position } object, or
  // plain {x, y, z}. Returns `fallback` (cloned) when nothing usable is given.
  function resolveHandle(handle, out, fallback) {
    if (handle) {
      if (typeof handle.getWorldPosition === 'function') {
        try {
          handle.getWorldPosition(out);
          return out;
        } catch (e) { /* fall through */ }
      }
      if (handle.position && isNum(handle.position.x)) return out.copy(handle.position);
      if (isNum(handle.x) && isNum(handle.y) && isNum(handle.z)) {
        return out.set(handle.x, handle.y, handle.z);
      }
    }
    return out.copy(fallback);
  }

  function getLaptopPosition(out) {
    return resolveHandle(
      props.laptop || props.laptopPosition || room.laptop || null,
      out,
      laptopTarget
    );
  }

  function getPhonePosition(out) {
    return resolveHandle(
      props.phone || props.phonePosition || room.phone || null,
      out,
      phoneFallback
    );
  }

  // "Behind ENZO": opposite his facing. Facing comes from the group
  // quaternion (or rotation.y); if that is unavailable, from his movement
  // direction; if he is standing still, keep the last behind direction.
  function updateBehindDir(ePos) {
    let facing = null;
    if (enzo && enzo.group) {
      if (enzo.group.quaternion) {
        facing = tmpFacing.set(0, 0, -1).applyQuaternion(enzo.group.quaternion);
      } else if (enzo.group.rotation && isNum(enzo.group.rotation.y)) {
        const ry = enzo.group.rotation.y;
        facing = tmpFacing.set(-Math.sin(ry), 0, -Math.cos(ry));
      }
    }
    if (facing && facing.x * facing.x + facing.z * facing.z > 1e-6) {
      behindDir.set(-facing.x, 0, -facing.z).normalize();
    } else if (lastEnzoPos) {
      const dx = ePos.x - lastEnzoPos.x;
      const dz = ePos.z - lastEnzoPos.z;
      const lenSq = dx * dx + dz * dz;
      if (lenSq > 1e-8) {
        const inv = 1 / Math.sqrt(lenSq);
        behindDir.set(-dx * inv, 0, -dz * inv);
      }
    }
    if (!lastEnzoPos) lastEnzoPos = ePos.clone();
    else lastEnzoPos.copy(ePos);
  }

  // --- Desired position + lookAt target for a mode (recomputed every frame,
  // so follow-modes track ENZO / the phone live). Always room-clamped.
  function computeDesired(modeName, outPos, outTarget) {
    switch (modeName) {
      case 'fullRoom':
        outPos.copy(fullRoomPos);
        outTarget.copy(fullRoomTarget);
        break;

      case 'enzoCloseup': {
        getHeadPosition(tmpHead);
        outPos.set(
          tmpHead.x + enzoCloseupOffset.x,
          tmpHead.y + enzoCloseupOffset.y,
          tmpHead.z + enzoCloseupOffset.z
        );
        outTarget.copy(tmpHead);
        break;
      }

      case 'laptopCloseup':
        outPos.copy(laptopPos);
        getLaptopPosition(tmpPhone);
        outTarget.copy(tmpPhone);
        break;

      case 'mobileCloseup': {
        getPhonePosition(tmpPhone);
        outPos.set(
          tmpPhone.x + mobileOffset.x,
          tmpPhone.y + mobileOffset.y,
          tmpPhone.z + mobileOffset.z
        );
        outTarget.copy(tmpPhone);
        break;
      }

      case 'walkingCamera': {
        getEnzoPosition(tmpEnzo);
        updateBehindDir(tmpEnzo);
        outPos.set(
          tmpEnzo.x + behindDir.x * tuning.walkBehind,
          tmpEnzo.y + tuning.walkHeight,
          tmpEnzo.z + behindDir.z * tuning.walkBehind
        );
        outTarget.set(tmpEnzo.x, tmpEnzo.y + tuning.walkLookHeight, tmpEnzo.z);
        break;
      }

      case 'deskWorking':
      default:
        outPos.copy(deskPos);
        outTarget.copy(deskTarget);
        break;
    }
    clampCameraPosition(outPos, bounds);
    return outPos;
  }

  function beginTransition(name, transitionSeconds) {
    mode = name;
    transitionFromPos.copy(currentPos);
    transitionFromTarget.copy(currentTarget);
    transitionT = 0;
    transitionDuration =
      isNum(transitionSeconds) && transitionSeconds > 0
        ? transitionSeconds
        : tuning.transitionSeconds;
    transitioning = true;
  }

  // --- Public API.
  function setMode(name, opts) {
    if (CAMERA_MODES.indexOf(name) === -1) return false;
    opts = opts || {};
    manual = true;
    manualTimer =
      isNum(opts.duration) && opts.duration > 0
        ? opts.duration
        : tuning.manualHoldSeconds;
    if (opts.instant === true) {
      // Init-only escape hatch: place the camera immediately. Normal use
      // always blends (see beginTransition); never use for a live switch.
      mode = name;
      transitioning = false;
      computeDesired(mode, tmpDesiredPos, tmpDesiredTarget);
      currentPos.copy(tmpDesiredPos);
      currentTarget.copy(tmpDesiredTarget);
      camera.position.copy(currentPos);
      camera.lookAt(currentTarget);
      return true;
    }
    if (name !== mode || transitioning) {
      beginTransition(name, opts.transition);
    }
    return true;
  }

  function getMode() {
    return mode;
  }

  // Pick the best mode for a Piece 4 activity / sequence name. This also
  // clears any manual override (manual hold ends when autoSelect is called
  // again, or after manualHoldSeconds — see update()).
  function autoSelect(activityName) {
    const selected = mapActivityToMode(activityName);
    lastAutoMode = selected;
    manual = false;
    manualTimer = 0;
    if (selected !== mode) beginTransition(selected, tuning.transitionSeconds);
    return selected;
  }

  // Call every frame from the render loop, AFTER Piece 4 has moved ENZO.
  // dt is seconds (clamped to [0, 0.1] so a tab-switch hitch can't jump us).
  function update(dt) {
    if (dt == null || !isNum(dt)) dt = 1 / 60;
    if (dt < 0) dt = 0;
    if (dt > 0.1) dt = 0.1;
    elapsed += dt;

    // Manual hold expiry: gently return to the last auto-selected mode.
    if (manual) {
      manualTimer -= dt;
      if (manualTimer <= 0) {
        manual = false;
        manualTimer = 0;
        if (mode !== lastAutoMode) beginTransition(lastAutoMode, tuning.transitionSeconds);
      }
    }

    computeDesired(mode, tmpDesiredPos, tmpDesiredTarget);

    prevPos.copy(currentPos);
    prevTarget.copy(currentTarget);

    if (transitioning) {
      transitionT += dt / transitionDuration;
      const e = smoothstep(transitionT);
      tmpBlendPos.lerpVectors(transitionFromPos, tmpDesiredPos, e);
      tmpBlendTarget.lerpVectors(transitionFromTarget, tmpDesiredTarget, e);
      currentPos.copy(tmpBlendPos);
      currentTarget.copy(tmpBlendTarget);
      if (transitionT >= 1) transitioning = false;
    } else {
      // Follow modes track a moving target; static modes just settle.
      // Exponential damp gives walkingCamera its ~0.3s tracking lag.
      const tau = mode === 'walkingCamera' ? tuning.walkLagTau : tuning.settleTau;
      const alpha = dt > 0 ? 1 - Math.exp(-dt / tau) : 0;
      currentPos.lerp(tmpDesiredPos, alpha);
      currentTarget.lerp(tmpDesiredTarget, alpha);
    }

    // Hard guarantee: no single-frame move larger than maxStepPerFrame.
    limitStep(currentPos, prevPos, tuning.maxStepPerFrame);
    limitStep(currentTarget, prevTarget, tuning.maxStepPerFrame);

    // If the camera starts (or ever ends up) outside the room, ease it back
    // inside using whatever is left of this frame's step budget — never a snap.
    const moved = currentPos.distanceTo(prevPos);
    tmpClamped.copy(currentPos);
    clampCameraPosition(tmpClamped, bounds);
    const dClamp = tmpClamped.distanceTo(currentPos);
    if (dClamp > 1e-9) {
      const budget = Math.max(0, tuning.maxStepPerFrame - moved);
      const s = Math.min(1, budget / dClamp);
      currentPos.lerp(tmpClamped, s);
    }

    camera.position.copy(currentPos);
    camera.lookAt(currentTarget);
    return mode;
  }

  return {
    setMode,
    getMode,
    update,
    autoSelect,
    availableModes: CAMERA_MODES.slice(),
    // Small helpers for the app / other pieces:
    clampPosition(v) {
      return clampCameraPosition(v, bounds);
    },
    getTarget() {
      return currentTarget.clone();
    },
    // Desired framing for a mode (fresh clones) — handy for assembly checks.
    getDesired(modeName) {
      const m = CAMERA_MODES.indexOf(modeName) === -1 ? mode : modeName;
      computeDesired(m, tmpDesiredPos, tmpDesiredTarget);
      return {
        position: tmpDesiredPos.clone(),
        target: tmpDesiredTarget.clone(),
      };
    },
    // Read-only view of the resolved tuning (what this instance is using).
    tuning,
    get elapsed() {
      return elapsed;
    },
  };
}



  return createCameraSystem;
})();
  window.EnzoRoom.createCameraSystem=createCameraSystem;
})();
