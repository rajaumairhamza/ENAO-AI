(function(){
  'use strict';
  if(!window.EnzoRoom||!window.EnzoRoom.threeOK){ return; }

/* ---- PIECE 6 — RULES ENFORCER ---- */
var createRuleEnforcer=(function(){
/**
 * PIECE 6 — Interaction Rules Enforcement (ENZO 3D room rebuild)
 * Artifact slug: enao-ai
 *
 * Pure logic, no THREE dependency at load, no rendering, no chat/call/UI
 * logic. Works against the handles documented by the other pieces:
 *   - Piece 3 (enzo): enzo.group, enzo.legL/legR {hip, knee, ankle, foot},
 *     enzo.armL/armR {shoulder, elbow, wrist, hand, fingers[5]},
 *     enzo.clampJoints(), enzo.seated.
 *   - Piece 4 (animation): sequences move enzo and attach/detach objects
 *     to hands; they mark foot contact (leg/foot `.contact`) and set
 *     `enzo.seated` / `enzo.seatType` ('chair' | 'sofa').
 *
 * Room (defaults below, overridable through the `room` argument):
 *   bounds x [-3.2, +3.2], z [-2.6, +2.6], floor y = 0.
 *   Supports: desk top y=0.78, coffee table top y=0.42, sofa seat y=0.45,
 *   bookshelf shelves y=0.5/1.0/1.5/1.95, chair seat y=0.48.
 *   Furniture colliders (approx boxes): desk x[-2.95,-2.15] z[-1.9,0.7];
 *   bookshelf x[-1.7,-0.1] z[-2.6,-2.3]; sofa x[1.7,2.7] z[-1.4,0.6];
 *   coffee table x[0.7,1.7] z[-0.8,0.0]; floor lamp point (2.9,-2.2).
 *
 * DESIGN AUTHORITIES & MODULARITY (22 Nov 2026): the room reference
 * image is ONLY a reference — more room detail is coming from Raja and
 * will be folded in later. Nothing here is final and no assembly step
 * is assumed. Every room number lives in buildRoomConfig() defaults and
 * can be overridden through the `room` argument (bounds, surfaces,
 * colliders, lamp, chair), and every character constant lives in the
 * constants block below — so later detail changes data, not logic.
 * Second authority: the Master Character Design Sheet — ENZO is
 * 1.35 m (4.5 ft), head ~40% / torso ~30% / legs ~20% of that height;
 * face/eyes are a glossy black screen whose base positions never move
 * across expressions (only eye/mouth shape changes).
 *
 * ------------------------------------------------------------------
 * INTEGRATION NOTE
 * ------------------------------------------------------------------
 *   const rules = createRuleEnforcer(enzo, room, props);
 *
 *   // In the render loop, AFTER the animation update, BEFORE render:
 *   function tick(dt) {
 *     animation.update(dt);   // Piece 4 — moves enzo, attaches props
 *     rules.enforce(dt);      // Piece 6 — clamps/eases violations
 *     renderer.render(scene, camera);
 *   }
 *
 *   `enforce(dt)` never snaps: every correction clamps or eases toward the
 *   legal value, and every correction is logged as a short string into
 *   `rules.violations` (kept to the last 50 entries).
 *
 *   Surfacing violations (DEV ONLY — never in production):
 *     if (import.meta.env.DEV || location.search.includes('debug-rules')) {
 *       if (rules.violations.length) console.warn('[enzo-rules]', rules.violations);
 *       window.__ENZO_RULE_VIOLATIONS = rules.violations; // dev overlay reads this
 *     }
 *   `validatePose()` / `validateScene()` are check-only: they report
 *   issues without mutating enzo or props, so they are safe to call from
 *   a dev panel, a test, or a scene-load sanity check.
 *
 *   `selfTest()` builds its own stub enzo/props and runs a fresh
 *   enforcer against them, so calling it never disturbs the live scene
 *   or the live `violations` log.
 */

'use strict';

// ------------------------------------------------------------------
// Constants (all limits are per-frame at 60 fps unless stated)
// ------------------------------------------------------------------
var DEG_TO_RAD = Math.PI / 180;
var RAD_TO_DEG = 180 / Math.PI;
var MAX_SPEED = 3.6;            // m/s  -> 0.06 m per frame at 60 fps
var MAX_ACCEL_PER_FRAME = 0.02; // m/s of velocity change per frame at 60 fps
var MAX_JOINT_DELTA_DEG = 8;    // degrees of joint rotation per frame at 60 fps
var FOOT_TOLERANCE = 0.005;     // m — foot world y must be 0 +/- this
var SUPPORT_TOLERANCE = 0.01;   // m — prop base y must match a support height
var GRIP_MAX_DISTANCE = 0.12;   // m — attached prop must be within this of palm
var GRIP_MIN_CURL = 0.5;        // finger curl must exceed this while holding
var BODY_RADIUS = 0.35;         // m — enzo root collision radius
var MAX_VIOLATIONS = 50;
// Canonical character (Master Character Design Sheet, 22 Nov 2026):
// ENZO is 1.35 m (4.5 ft), NOT 1.50 m. Segment shares of that height:
var CANONICAL_HEIGHT = 1.35;    // m
var CANONICAL_HEAD = 0.40;      // head  ~40% of 1.35 m = 0.54 m
var CANONICAL_TORSO = 0.30;     // torso ~30% of 1.35 m = 0.405 m
var CANONICAL_LEGS = 0.20;      // legs  ~20% of 1.35 m = 0.27 m
var FACE_ANCHOR_TOLERANCE = 0.005; // m — eye/face/mouth base positions never move

// ------------------------------------------------------------------
// Tiny vector / numeric helpers (plain objects, no THREE)
// ------------------------------------------------------------------
function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function isNum(v) { return typeof v === 'number' && isFinite(v); }
function dist3(ax, ay, az, bx, by, bz) {
  var dx = ax - bx, dy = ay - by, dz = az - bz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// ------------------------------------------------------------------
// Room config (defaults from the rebuild spec, overridable via `room`)
// ------------------------------------------------------------------
function normaliseBox(b) {
  if (!b || typeof b !== 'object') return null;
  var minX, maxX, minZ, maxZ;
  if (Array.isArray(b.x)) { minX = b.x[0]; maxX = b.x[1]; }
  else { minX = b.minX; maxX = b.maxX; }
  if (Array.isArray(b.z)) { minZ = b.z[0]; maxZ = b.z[1]; }
  else { minZ = b.minZ; maxZ = b.maxZ; }
  if (!isNum(minX) || !isNum(maxX) || !isNum(minZ) || !isNum(maxZ)) return null;
  return {
    minX: minX, maxX: maxX, minZ: minZ, maxZ: maxZ,
    y: isNum(b.y) ? b.y : null,
    name: b.name || 'surface'
  };
}

function buildRoomConfig(room) {
  var cfg = {
    minX: -3.2, maxX: 3.2, minZ: -2.6, maxZ: 2.6, floorY: 0, radius: BODY_RADIUS,
    surfaces: [
      { minX: -2.95, maxX: -2.15, minZ: -1.9, maxZ: 0.7, y: 0.78, name: 'desk' },
      { minX: -1.7, maxX: -0.1, minZ: -2.6, maxZ: -2.3, y: 0.5, name: 'bookshelf shelf 1' },
      { minX: -1.7, maxX: -0.1, minZ: -2.6, maxZ: -2.3, y: 1.0, name: 'bookshelf shelf 2' },
      { minX: -1.7, maxX: -0.1, minZ: -2.6, maxZ: -2.3, y: 1.5, name: 'bookshelf shelf 3' },
      { minX: -1.7, maxX: -0.1, minZ: -2.6, maxZ: -2.3, y: 1.95, name: 'bookshelf shelf 4' },
      { minX: 1.7, maxX: 2.7, minZ: -1.4, maxZ: 0.6, y: 0.45, name: 'sofa seat' },
      { minX: 0.7, maxX: 1.7, minZ: -0.8, maxZ: 0.0, y: 0.42, name: 'coffee table' }
    ],
    colliders: [
      { minX: -2.95, maxX: -2.15, minZ: -1.9, maxZ: 0.7, name: 'desk' },
      { minX: -1.7, maxX: -0.1, minZ: -2.6, maxZ: -2.3, name: 'bookshelf' },
      { minX: 1.7, maxX: 2.7, minZ: -1.4, maxZ: 0.6, name: 'sofa' },
      { minX: 0.7, maxX: 1.7, minZ: -0.8, maxZ: 0.0, name: 'coffee table' }
    ],
    lamp: { x: 2.9, z: -2.2, r: 0.25 }
  };
  if (!room || typeof room !== 'object') return cfg;

  var b = room.bounds || room.roomBounds || null;
  if (b && typeof b === 'object') {
    if (Array.isArray(b.x)) { cfg.minX = b.x[0]; cfg.maxX = b.x[1]; }
    if (Array.isArray(b.z)) { cfg.minZ = b.z[0]; cfg.maxZ = b.z[1]; }
    if (isNum(b.minX)) cfg.minX = b.minX;
    if (isNum(b.maxX)) cfg.maxX = b.maxX;
    if (isNum(b.minZ)) cfg.minZ = b.minZ;
    if (isNum(b.maxZ)) cfg.maxZ = b.maxZ;
  }
  if (isNum(room.minX)) cfg.minX = room.minX;
  if (isNum(room.maxX)) cfg.maxX = room.maxX;
  if (isNum(room.minZ)) cfg.minZ = room.minZ;
  if (isNum(room.maxZ)) cfg.maxZ = room.maxZ;
  if (isNum(room.radius)) cfg.radius = room.radius;
  if (isNum(room.floorY)) cfg.floorY = room.floorY;

  var extra = room.surfaces || room.supports || null;
  if (Array.isArray(extra)) {
    extra.forEach(function (s) {
      var nb = normaliseBox(s);
      if (nb && isNum(nb.y)) cfg.surfaces.push(nb);
    });
  }
  if (Array.isArray(room.colliders)) {
    var cs = [];
    room.colliders.forEach(function (c) {
      var nb = normaliseBox(c);
      if (nb) cs.push(nb);
    });
    if (cs.length) cfg.colliders = cs;
  }
  var lampSrc = room.lamp || room.floorLamp || null;
  if (lampSrc && isNum(lampSrc.x) && isNum(lampSrc.z)) {
    cfg.lamp = { x: lampSrc.x, z: lampSrc.z, r: isNum(lampSrc.r) ? lampSrc.r : 0.25 };
  }
  // Chair seat position is not fixed by the spec; if the app knows it,
  // pass room.chair = {x, z, seatY} and it becomes a support surface.
  // It is deliberately NOT a collider: enzo sits on it.
  if (room.chair && isNum(room.chair.x) && isNum(room.chair.z)) {
    var sy = isNum(room.chair.seatY) ? room.chair.seatY
      : (isNum(room.chair.y) ? room.chair.y : 0.48);
    cfg.surfaces.push({
      minX: room.chair.x - 0.25, maxX: room.chair.x + 0.25,
      minZ: room.chair.z - 0.25, maxZ: room.chair.z + 0.25,
      y: sy, name: 'chair seat'
    });
  }
  return cfg;
}

// ------------------------------------------------------------------
// Enzo accessors (tolerant of the shapes Pieces 3/4 use)
// ------------------------------------------------------------------
function getRootPos(enzo) {
  if (!enzo || typeof enzo !== 'object') return null;
  var cands = [enzo.group, enzo.root, enzo.body, enzo];
  for (var i = 0; i < cands.length; i++) {
    var c = cands[i];
    if (c && c.position && isNum(c.position.x) && isNum(c.position.y) && isNum(c.position.z)) {
      return c.position;
    }
  }
  return null;
}

function getScaleObj(enzo) {
  if (!enzo || typeof enzo !== 'object') return null;
  var cands = [enzo.group, enzo.root, enzo];
  for (var i = 0; i < cands.length; i++) {
    var c = cands[i];
    if (c && c.scale && isNum(c.scale.x) && isNum(c.scale.y) && isNum(c.scale.z)) {
      return c.scale;
    }
  }
  return null;
}

function captureBaseline(enzo) {
  var base = { scale: null, head: null, torso: null, totalHeight: null, segments: {}, faceAnchors: [] };
  var s = getScaleObj(enzo);
  if (s) base.scale = { x: s.x, y: s.y, z: s.z };
  ['head', 'torso'].forEach(function (part) {
    var o = enzo[part];
    if (!o || typeof o !== 'object') return;
    var rec = {};
    if (o.scale && isNum(o.scale.x) && isNum(o.scale.y) && isNum(o.scale.z)) {
      rec.scale = { x: o.scale.x, y: o.scale.y, z: o.scale.z };
    }
    ['height', 'width', 'depth', 'radius'].forEach(function (f) {
      if (isNum(o[f])) rec[f] = o[f];
    });
    base[part] = rec;
  });
  ['headHeight', 'torsoHeight', 'legHeight', 'legLength', 'headSize', 'torsoSize'].forEach(function (f) {
    if (isNum(enzo[f])) base[f] = enzo[f];
  });
  var th = totalHeightAccessor(enzo);
  if (th && isNum(th.get())) base.totalHeight = th.get();
  segmentHeightAccessors(enzo).forEach(function (seg) {
    if (isNum(seg.get())) base.segments[seg.label] = seg.get();
  });
  base.faceAnchors = collectFaceAnchors(enzo).map(function (a) {
    return { label: a.label, pos: { x: a.pos.x, y: a.pos.y, z: a.pos.z } };
  });
  return base;
}

// Canonical height (character sheet): ENZO is 1.35 m (4.5 ft), not 1.50 m.
// Total-height accessor: {get(), set(v)} or null.
function totalHeightAccessor(enzo) {
  if (!enzo || typeof enzo !== 'object') return null;
  var fields = ['height', 'totalHeight', 'characterHeight', 'stature'];
  for (var i = 0; i < fields.length; i++) {
    if (isNum(enzo[fields[i]])) {
      return (function (f) {
        return {
          get: function () { return enzo[f]; },
          set: function (v) { enzo[f] = v; }
        };
      })(fields[i]);
    }
  }
  if (enzo.dimensions && isNum(enzo.dimensions.height)) {
    return {
      get: function () { return enzo.dimensions.height; },
      set: function (v) { enzo.dimensions.height = v; }
    };
  }
  return null;
}

// Segment heights against the character-sheet proportions of 1.35 m:
// head ~40% (0.54 m), torso ~30% (0.405 m), legs ~20% (0.27 m).
function segmentHeightAccessors(enzo) {
  var out = [];
  if (!enzo || typeof enzo !== 'object') return out;
  function push(label, fraction, holder, field) {
    if (holder && isNum(holder[field])) {
      out.push({
        label: label, fraction: fraction,
        get: function () { return holder[field]; },
        set: function (v) { holder[field] = v; }
      });
    }
  }
  if (isNum(enzo.headHeight)) push('head', CANONICAL_HEAD, enzo, 'headHeight');
  else if (enzo.head) push('head', CANONICAL_HEAD, enzo.head, 'height');
  if (isNum(enzo.torsoHeight)) push('torso', CANONICAL_TORSO, enzo, 'torsoHeight');
  else if (enzo.torso) push('torso', CANONICAL_TORSO, enzo.torso, 'height');
  if (isNum(enzo.legHeight)) push('legs', CANONICAL_LEGS, enzo, 'legHeight');
  else if (isNum(enzo.legLength)) push('legs', CANONICAL_LEGS, enzo, 'legLength');
  else if (enzo.legs && isNum(enzo.legs.height)) push('legs', CANONICAL_LEGS, enzo.legs, 'height');
  else if (enzo.legs && isNum(enzo.legs.length)) push('legs', CANONICAL_LEGS, enzo.legs, 'length');
  else if (enzo.legL && isNum(enzo.legL.length)) push('legs', CANONICAL_LEGS, enzo.legL, 'length');
  else if (enzo.legL && isNum(enzo.legL.height)) push('legs', CANONICAL_LEGS, enzo.legL, 'height');
  return out;
}

// Face/eye/mouth base positions (local/head-space). Expressions may
// change eye/mouth SHAPE only — these positions must never move.
function collectFaceAnchors(enzo) {
  var anchors = [];
  var seenPos = [];
  function add(label, obj) {
    if (!obj || typeof obj !== 'object') return;
    if (obj.position && isNum(obj.position.x) && isNum(obj.position.y) &&
        isNum(obj.position.z) && seenPos.indexOf(obj.position) === -1) {
      seenPos.push(obj.position);
      anchors.push({ label: label, pos: obj.position });
    }
  }
  if (!enzo || typeof enzo !== 'object') return anchors;
  add('face', enzo.face);
  add('face', enzo.head && enzo.head.face);
  add('eyeL', enzo.eyeL);
  add('eyeL', enzo.face && enzo.face.eyeL);
  add('eyeL', enzo.head && enzo.head.eyeL);
  add('eyeL', enzo.eyes && enzo.eyes.left);
  add('eyeL', enzo.face && enzo.face.eyes && enzo.face.eyes.left);
  add('eyeL', enzo.head && enzo.head.eyes && enzo.head.eyes.left);
  if (Array.isArray(enzo.eyes)) add('eyeL', enzo.eyes[0]);
  add('eyeR', enzo.eyeR);
  add('eyeR', enzo.face && enzo.face.eyeR);
  add('eyeR', enzo.head && enzo.head.eyeR);
  add('eyeR', enzo.eyes && enzo.eyes.right);
  add('eyeR', enzo.face && enzo.face.eyes && enzo.face.eyes.right);
  add('eyeR', enzo.head && enzo.head.eyes && enzo.head.eyes.right);
  if (Array.isArray(enzo.eyes)) add('eyeR', enzo.eyes[1]);
  add('mouth', enzo.mouth);
  add('mouth', enzo.face && enzo.face.mouth);
  add('mouth', enzo.head && enzo.head.mouth);
  return anchors;
}

// Joint entries: {key, get(), set(v)} — one per rotation axis (radians)
// or per angle-like numeric field, so damping works whatever shape the
// joint uses. Fingers are included; curl values are not angles.
function collectJointEntries(enzo) {
  var entries = [];
  var seen = [];
  function addJoint(obj, label) {
    if (!obj || typeof obj !== 'object' || seen.indexOf(obj) !== -1) return;
    seen.push(obj);
    if (obj.rotation && typeof obj.rotation === 'object') {
      ['x', 'y', 'z'].forEach(function (axis) {
        if (isNum(obj.rotation[axis])) {
          entries.push({
            key: label + '.rotation.' + axis,
            get: function () { return obj.rotation[axis]; },
            set: function (v) { obj.rotation[axis] = v; }
          });
        }
      });
    } else {
      ['angle', 'flexion', 'bend', 'value'].forEach(function (f) {
        if (isNum(obj[f])) {
          entries.push({
            key: label + '.' + f,
            get: function () { return obj[f]; },
            set: function (v) { obj[f] = v; }
          });
        }
      });
    }
    if (Array.isArray(obj.fingers)) {
      obj.fingers.forEach(function (f, i) { addJoint(f, label + '.finger' + i); });
    }
  }
  if (enzo && typeof enzo === 'object') {
    [['legL', enzo.legL], ['legR', enzo.legR],
     ['armL', enzo.armL], ['armR', enzo.armR]].forEach(function (pair) {
      var gname = pair[0], g = pair[1];
      if (!g || typeof g !== 'object') return;
      ['hip', 'knee', 'ankle', 'shoulder', 'elbow', 'wrist', 'hand'].forEach(function (part) {
        if (g[part] === undefined) return;
        if (typeof g[part] === 'number') {
          entries.push({
            key: gname + '.' + part,
            get: function () { return g[part]; },
            set: function (v) { g[part] = v; }
          });
        } else {
          addJoint(g[part], gname + '.' + part);
        }
      });
      if (Array.isArray(g.fingers)) {
        g.fingers.forEach(function (f, i) { addJoint(f, gname + '.finger' + i); });
      }
    });
    ['torso', 'spine', 'chest', 'neck', 'head', 'pelvis', 'hips'].forEach(function (part) {
      if (enzo[part]) addJoint(enzo[part], part);
    });
  }
  return entries;
}

// ------------------------------------------------------------------
// Feet
// ------------------------------------------------------------------
function getFootPos(leg) {
  if (!leg || typeof leg !== 'object') return null;
  var f = leg.foot || leg.footObj || null;
  if (f) {
    if (f.position && isNum(f.position.y)) return f.position;
    if (f.worldPosition && isNum(f.worldPosition.y)) return f.worldPosition;
    if (isNum(f.x) && isNum(f.y) && isNum(f.z)) return f;
  }
  if (leg.footPosition && isNum(leg.footPosition.y)) return leg.footPosition;
  return null;
}

// Contact phase: the animation system marks it (leg/foot `.contact`);
// otherwise default to contact when walking, else when the foot is
// already near the floor (standing still).
function isFootContact(enzo, leg) {
  if (leg && typeof leg.contact === 'boolean') return leg.contact;
  var f = leg ? (leg.foot || null) : null;
  if (f && typeof f.contact === 'boolean') return f.contact;
  if (f && typeof f.planted === 'boolean') return f.planted;
  if (enzo && (enzo.walking === true || enzo.moving === true || enzo.isWalking === true)) return true;
  var p = getFootPos(leg);
  if (p && isNum(p.y) && p.y <= 0.05) return true;
  return false;
}

// Knee bend in degrees, tolerant of radian rotation, radian angle and
// degree fields. Returns null when the knee carries no readable angle.
function kneeBendDeg(leg) {
  if (!leg || !leg.knee) return null;
  var k = leg.knee;
  if (isNum(k.bendDegrees)) return Math.abs(k.bendDegrees);
  if (isNum(k.bend)) return Math.abs(k.bend) > Math.PI ? Math.abs(k.bend) : Math.abs(k.bend) * RAD_TO_DEG;
  if (isNum(k.flexion)) return Math.abs(k.flexion) > Math.PI ? Math.abs(k.flexion) : Math.abs(k.flexion) * RAD_TO_DEG;
  if (isNum(k.angle)) return Math.abs(k.angle) > Math.PI ? Math.abs(k.angle) : Math.abs(k.angle) * RAD_TO_DEG;
  if (k.rotation && isNum(k.rotation.x)) return Math.abs(k.rotation.x) * RAD_TO_DEG;
  if (k.rotation && isNum(k.rotation.z)) return Math.abs(k.rotation.z) * RAD_TO_DEG;
  return null;
}

function setKneeBendDeg(leg, deg) {
  if (!leg || !leg.knee) return;
  var k = leg.knee;
  var rad = deg * DEG_TO_RAD;
  if (isNum(k.bendDegrees)) { k.bendDegrees = deg; return; }
  if (isNum(k.bend)) { k.bend = Math.abs(k.bend) > Math.PI ? deg : (k.bend < 0 ? -rad : rad); return; }
  if (isNum(k.flexion)) { k.flexion = Math.abs(k.flexion) > Math.PI ? deg : rad; return; }
  if (isNum(k.angle)) { k.angle = Math.abs(k.angle) > Math.PI ? deg : (k.angle < 0 ? -rad : rad); return; }
  if (k.rotation && isNum(k.rotation.x)) {
    k.rotation.x = (k.rotation.x < 0 ? -1 : 1) * rad;
    return;
  }
  if (k.rotation && isNum(k.rotation.z)) {
    k.rotation.z = (k.rotation.z < 0 ? -1 : 1) * rad;
  }
}

// ------------------------------------------------------------------
// Hands / grip
// ------------------------------------------------------------------
function getHand(arm) {
  if (!arm || typeof arm !== 'object') return null;
  return arm.hand || arm.palm || null;
}
function getHandPos(arm) {
  var h = getHand(arm);
  if (!h) return null;
  if (h.position && (isNum(h.position.x) || isNum(h.position.y))) return h.position;
  if (h.worldPosition && isNum(h.worldPosition.y)) return h.worldPosition;
  if (isNum(h.x) && isNum(h.y) && isNum(h.z)) return h;
  return null;
}
function getFingers(arm) {
  var h = getHand(arm);
  if (h && Array.isArray(h.fingers)) return h.fingers;
  if (arm && Array.isArray(arm.fingers)) return arm.fingers;
  return [];
}
// Curl 0 (open) .. 1 (fully curled). Falls back to rotation magnitude.
function fingerCurl(f) {
  if (!f || typeof f !== 'object') return null;
  if (isNum(f.curl)) return f.curl;
  if (isNum(f.flex)) return f.flex;
  if (isNum(f.flexion)) return f.flexion;
  if (f.rotation && isNum(f.rotation.x)) return clamp(Math.abs(f.rotation.x) / 1.2, 0, 1);
  if (f.rotation && isNum(f.rotation.z)) return clamp(Math.abs(f.rotation.z) / 1.2, 0, 1);
  return null;
}
function setFingerCurl(f, v) {
  if (!f || typeof f !== 'object') return;
  if (isNum(f.curl)) { f.curl = v; return; }
  if (isNum(f.flex)) { f.flex = v; return; }
  if (isNum(f.flexion)) { f.flexion = v; return; }
  if (f.rotation && isNum(f.rotation.x)) { f.rotation.x = (f.rotation.x < 0 ? -1 : 1) * v * 1.2; return; }
  if (f.rotation && isNum(f.rotation.z)) { f.rotation.z = (f.rotation.z < 0 ? -1 : 1) * v * 1.2; return; }
  f.curl = v;
}

// ------------------------------------------------------------------
// Props
// ------------------------------------------------------------------
function normalizeProps(props, room) {
  var list = [];
  if (Array.isArray(props)) list = props.slice();
  else if (props && Array.isArray(props.props)) list = props.props.slice();
  else if (props && Array.isArray(props.items)) list = props.items.slice();
  else if (props && typeof props === 'object') {
    list = Object.keys(props).map(function (k) { return props[k]; });
  }
  if (room && Array.isArray(room.props)) list = list.concat(room.props);
  var out = [];
  list.forEach(function (p) {
    if (p && typeof p === 'object' && out.indexOf(p) === -1) out.push(p);
  });
  return out;
}
function propName(prop) {
  return prop.name || prop.id || prop.label || prop.type || 'prop';
}
function propPosition(prop) {
  if (prop.position && isNum(prop.position.y)) return prop.position;
  if (prop.pos && isNum(prop.pos.y)) return prop.pos;
  if (isNum(prop.x) && isNum(prop.y) && isNum(prop.z)) return prop;
  return null;
}
// Base y: `position.y` is treated as the base unless the prop says its
// position is its centre (anchor === 'center' / centered === true).
function propBaseY(prop) {
  if (isNum(prop.baseY)) return prop.baseY;
  if (isNum(prop.y)) return prop.y;
  var p = propPosition(prop);
  if (!p || !isNum(p.y)) return null;
  if (prop.anchor === 'center' || prop.centered === true) {
    var h = isNum(prop.height) ? prop.height
      : (prop.size && isNum(prop.size.y) ? prop.size.y : 0);
    return p.y - h / 2;
  }
  return p.y;
}
function setPropBaseY(prop, y) {
  if (isNum(prop.baseY)) { prop.baseY = y; return; }
  if (isNum(prop.y)) { prop.y = y; return; }
  var p = propPosition(prop);
  if (!p || !isNum(p.y)) return;
  if (prop.anchor === 'center' || prop.centered === true) {
    var h = isNum(prop.height) ? prop.height
      : (prop.size && isNum(prop.size.y) ? prop.size.y : 0);
    p.y = y + h / 2;
  } else {
    p.y = y;
  }
}
function isAttached(prop) {
  return prop.attached === true || !!prop.attachedTo || prop.held === true ||
    !!prop.heldBy || prop.inHand === true;
}
function findHandForProp(prop, enzo) {
  var t = prop.attachedTo || prop.heldBy || prop.hand || prop.side || null;
  if (t === enzo.armL || t === enzo.armR) return t;
  if (typeof t === 'string') {
    var s = t.toLowerCase();
    if (s.indexOf('left') !== -1 || s === 'l' || s.indexOf('arml') !== -1) return enzo.armL;
    if (s.indexOf('right') !== -1 || s === 'r' || s.indexOf('armr') !== -1) return enzo.armR;
  }
  if (t && typeof t === 'object' && (t.fingers || t.hand)) return t;
  var pp = propPosition(prop);
  var lp = getHandPos(enzo.armL), rp = getHandPos(enzo.armR);
  if (pp && lp && rp && isNum(pp.x) && isNum(lp.x) && isNum(rp.x)) {
    var dl = dist3(pp.x, pp.y, pp.z, lp.x, lp.y, lp.z);
    var dr = dist3(pp.x, pp.y, pp.z, rp.x, rp.y, rp.z);
    return dl <= dr ? enzo.armL : enzo.armR;
  }
  return enzo.armR || enzo.armL || null;
}

// ------------------------------------------------------------------
// Sitting
// ------------------------------------------------------------------
function seatHeightFor(enzo) {
  if (isNum(enzo.seatHeight)) return enzo.seatHeight;
  var s = enzo.seatType || enzo.seat || enzo.seatedOn;
  if (typeof s === 'string') {
    var t = s.toLowerCase();
    if (t.indexOf('sofa') !== -1 || t.indexOf('couch') !== -1) return 0.45;
    return 0.48; // chair (default)
  }
  if (s && typeof s === 'object') {
    if (isNum(s.seatY)) return s.seatY;
    if (isNum(s.y)) return s.y;
  }
  return 0.48;
}
function getHipAccessor(enzo) {
  if (enzo.hips && enzo.hips.position && isNum(enzo.hips.position.y)) {
    return {
      get: function () { return enzo.hips.position.y; },
      set: function (v) { enzo.hips.position.y = v; }
    };
  }
  if (enzo.hip && enzo.hip.position && isNum(enzo.hip.position.y)) {
    return {
      get: function () { return enzo.hip.position.y; },
      set: function (v) { enzo.hip.position.y = v; }
    };
  }
  if (isNum(enzo.hipY)) {
    return {
      get: function () { return enzo.hipY; },
      set: function (v) { enzo.hipY = v; }
    };
  }
  var root = getRootPos(enzo);
  if (root) {
    return {
      get: function () { return root.y; },
      set: function (v) { root.y = v; }
    };
  }
  return null;
}

// ------------------------------------------------------------------
// Stub enzo for selfTest (module scope so selfTest can use it)
// ------------------------------------------------------------------
function makeStubEnzo() {
  function joint() { return { rotation: { x: 0, y: 0, z: 0 } }; }
  function finger() { return { curl: 0.8 }; }
  function hand(px, py, pz) {
    return {
      position: { x: px, y: py, z: pz },
      fingers: [finger(), finger(), finger(), finger(), finger()]
    };
  }
  function arm(px, py, pz) {
    return { shoulder: joint(), elbow: joint(), wrist: joint(), hand: hand(px, py, pz) };
  }
  function leg() {
    return {
      hip: joint(), knee: joint(), ankle: joint(),
      foot: { position: { x: 0, y: 0, z: 0 }, contact: true }
    };
  }
  return {
    group: { position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    // Canonical character (sheet): 1.35 m total; head 0.54 / torso 0.405 / legs 0.27.
    height: 1.35, headHeight: 0.54, torsoHeight: 0.405, legHeight: 0.27,
    face: { position: { x: 0, y: 1.28, z: 0.12 } },
    eyeL: { position: { x: -0.05, y: 1.3, z: 0.14 } },
    eyeR: { position: { x: 0.05, y: 1.3, z: 0.14 } },
    mouth: { position: { x: 0, y: 1.22, z: 0.14 } },
    legL: leg(), legR: leg(),
    armL: arm(-0.3, 1.0, 0.2), armR: arm(0.3, 1.0, 0.2),
    torso: { rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    head: { rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    seated: false,
    clampJoints: function () {}
  };
}

// ------------------------------------------------------------------
// Factory
// ------------------------------------------------------------------
function createRuleEnforcer(enzo, room, props) {
  var cfg = buildRoomConfig(room);
  var propList = normalizeProps(props, room);
  var violations = [];
  var state = {
    prevPos: null,            // {x,y,z} root position last frame (post-correction)
    prevVel: { x: 0, y: 0, z: 0 },
    prevJoints: null,         // {key: angle} snapshot last frame
    planted: { L: null, R: null }, // {x,z} where each planted foot stands
    baseline: captureBaseline(enzo || {}),
    canonicalWarned: {}          // segment labels already warned once
  };

  // Canonical conformance of the rig as built (character sheet): warn
  // once at creation if the baseline itself is off-spec. Runtime drift
  // is caught per-frame by checkScale below.
  (function warnCanonicalBaseline() {
    if (isNum(state.baseline.totalHeight) &&
        Math.abs(state.baseline.totalHeight - CANONICAL_HEIGHT) > 0.01 * CANONICAL_HEIGHT) {
      violations.push('canonical height: ENZO baseline height is ' +
        state.baseline.totalHeight.toFixed(2) + ' m, character sheet says 1.35 m (4.5 ft)');
    }
    segmentHeightAccessors(enzo || {}).forEach(function (seg) {
      var baseVal = state.baseline.segments[seg.label];
      var expected = seg.fraction * CANONICAL_HEIGHT;
      if (isNum(baseVal) && Math.abs(baseVal - expected) / expected > 0.05) {
        violations.push('canonical proportion: baseline ' + seg.label + ' height is ' +
          baseVal.toFixed(3) + ' m, character sheet expects ~' + expected.toFixed(2) +
          ' m (' + Math.round(seg.fraction * 100) + '% of 1.35 m)');
        state.canonicalWarned[seg.label] = true;
      }
    });
  })();

  function log(issues) {
    for (var i = 0; i < issues.length; i++) {
      violations.push(issues[i]);
      while (violations.length > MAX_VIOLATIONS) violations.shift();
    }
  }

  function snapshotJoints(entries) {
    entries = entries || collectJointEntries(enzo);
    var snap = {};
    entries.forEach(function (e) {
      var v = e.get();
      if (isNum(v)) snap[e.key] = v;
    });
    state.prevJoints = snap;
  }

  // --- Rule 1 (teleport) + Rule 2 (acceleration) on the root --------
  // Returns {issues, vel}. Does NOT advance state.prevPos/prevVel;
  // enforce() snapshots state at the end, after clipping/sitting have
  // also had their (small, legal) say over the root position.
  function checkRootMotion(dt, fix, includeTeleport) {
    var issues = [];
    var pos = getRootPos(enzo);
    if (!pos) return { issues: issues, vel: null };
    if (!state.prevPos) return { issues: issues, vel: { x: 0, y: 0, z: 0 } };

    var dx = pos.x - state.prevPos.x;
    var dy = pos.y - state.prevPos.y;
    var dz = pos.z - state.prevPos.z;
    var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    var maxStep = MAX_SPEED * dt;
    if (includeTeleport !== false && dist > maxStep) {
      issues.push('teleport: root moved ' + dist.toFixed(3) +
        ' m in one frame (max ' + maxStep.toFixed(3) + ' m)');
      if (fix && dist > 0) {
        var s = maxStep / dist;
        pos.x = state.prevPos.x + dx * s;
        pos.y = state.prevPos.y + dy * s;
        pos.z = state.prevPos.z + dz * s;
        dx = pos.x - state.prevPos.x;
        dy = pos.y - state.prevPos.y;
        dz = pos.z - state.prevPos.z;
      }
    }

    var vel = { x: dx / dt, y: dy / dt, z: dz / dt };
    var dvx = vel.x - state.prevVel.x;
    var dvy = vel.y - state.prevVel.y;
    var dvz = vel.z - state.prevVel.z;
    var dv = Math.sqrt(dvx * dvx + dvy * dvy + dvz * dvz);
    var maxDv = (MAX_ACCEL_PER_FRAME / (1 / 60)) * dt; // 1.2 * dt
    if (dv > maxDv) {
      issues.push('sudden acceleration: velocity changed ' + dv.toFixed(3) +
        ' m/s in one frame (max ' + maxDv.toFixed(3) + ' m/s)');
      if (fix && dv > 0) {
        var k = maxDv / dv;
        vel.x = state.prevVel.x + dvx * k;
        vel.y = state.prevVel.y + dvy * k;
        vel.z = state.prevVel.z + dvz * k;
        pos.x = state.prevPos.x + vel.x * dt;
        pos.y = state.prevPos.y + vel.y * dt;
        pos.z = state.prevPos.z + vel.z * dt;
      }
    }
    return { issues: issues, vel: vel };
  }

  // --- Rule 2 (smooth motion) on joints -----------------------------
  function checkJoints(fix, dt) {
    var issues = [];
    var entries = collectJointEntries(enzo);
    if (!state.prevJoints) { snapshotJoints(entries); return issues; }
    var frameScale = clamp(dt * 60, 0.5, 3);
    var maxDelta = MAX_JOINT_DELTA_DEG * DEG_TO_RAD * frameScale;
    entries.forEach(function (e) {
      if (!(e.key in state.prevJoints)) return;
      var prev = state.prevJoints[e.key];
      var cur = e.get();
      if (!isNum(cur) || !isNum(prev)) return;
      var d = cur - prev;
      if (Math.abs(d) > maxDelta) {
        issues.push('joint snap: ' + e.key + ' rotated ' +
          (Math.abs(d) * RAD_TO_DEG).toFixed(1) + '° in one frame (max ' +
          (MAX_JOINT_DELTA_DEG * frameScale).toFixed(1) + '°)');
        if (fix) e.set(prev + (d < 0 ? -maxDelta : maxDelta));
      }
    });
    return issues;
  }

  // --- Rule 3 (feet on floor, no sliding while planted) -------------
  function checkFeet(fix) {
    var issues = [];
    [['L', enzo.legL], ['R', enzo.legR]].forEach(function (pair) {
      var side = pair[0], leg = pair[1];
      if (!leg) return;
      var pos = getFootPos(leg);
      if (!pos || !isNum(pos.y)) return;
      if (!isFootContact(enzo, leg)) {
        if (fix) state.planted[side] = null; // foot lifted: forget plant
        return;
      }
      if (Math.abs(pos.y) > FOOT_TOLERANCE) {
        issues.push('foot off floor: foot ' + side + ' y=' + pos.y.toFixed(3) +
          ' m while in contact (must be 0 ± ' + FOOT_TOLERANCE + ' m)');
        if (fix) pos.y = 0;
      }
      if (isNum(pos.x) && isNum(pos.z)) {
        var planted = state.planted[side];
        if (!planted) {
          if (fix) state.planted[side] = { x: pos.x, z: pos.z };
        } else {
          var slide = Math.sqrt(
            Math.pow(pos.x - planted.x, 2) + Math.pow(pos.z - planted.z, 2));
          if (slide > FOOT_TOLERANCE) {
            issues.push('foot sliding: foot ' + side + ' slid ' + slide.toFixed(3) +
              ' m while planted');
            if (fix) { pos.x = planted.x; pos.z = planted.z; }
          }
        }
      }
    });
    return issues;
  }

  // --- Rule 4 (no floating objects) ---------------------------------
  function supportHeightsAt(x, z) {
    var heights = [cfg.floorY];
    cfg.surfaces.forEach(function (s) {
      if (x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ && isNum(s.y)) {
        heights.push(s.y);
      }
    });
    return heights;
  }
  function checkFloating(fix) {
    var issues = [];
    propList.forEach(function (prop) {
      if (!prop || typeof prop !== 'object') return;
      if (isAttached(prop)) return; // held props are governed by Rule 5
      var name = propName(prop);
      var p = propPosition(prop);
      if (!p || !isNum(p.y)) return; // nothing verifiable
      var baseY = propBaseY(prop);
      if (!isNum(baseY)) return;
      var heights = (isNum(p.x) && isNum(p.z))
        ? supportHeightsAt(p.x, p.z) : [cfg.floorY];
      if (typeof prop.support === 'string') {
        cfg.surfaces.forEach(function (s) {
          if (s.name && s.name.toLowerCase().indexOf(prop.support.toLowerCase()) === 0) {
            heights.push(s.y);
          }
        });
      }
      var resting = heights.some(function (h) {
        return Math.abs(baseY - h) <= SUPPORT_TOLERANCE;
      });
      if (resting) return;
      var below = heights.filter(function (h) { return h <= baseY + SUPPORT_TOLERANCE; });
      var target = below.length ? Math.max.apply(null, below) : cfg.floorY;
      issues.push('floating prop: ' + name + ' base y=' + baseY.toFixed(3) +
        ' m has no support (nearest support below: ' + target.toFixed(2) + ' m)');
      if (fix) setPropBaseY(prop, target);
    });
    return issues;
  }

  // --- Rule 5 (proper grips) ----------------------------------------
  function checkGrips(fix) {
    var issues = [];
    propList.forEach(function (prop) {
      if (!isAttached(prop)) return;
      var name = propName(prop);
      var arm = findHandForProp(prop, enzo);
      if (!arm) return;
      var fingers = getFingers(arm);
      var curls = fingers.map(fingerCurl).filter(isNum);
      if (curls.length) {
        var avg = curls.reduce(function (a, b) { return a + b; }, 0) / curls.length;
        if (avg <= GRIP_MIN_CURL) {
          issues.push('loose grip: ' + name + ' held with finger curl ' +
            avg.toFixed(2) + ' (must be > ' + GRIP_MIN_CURL + ')');
          if (fix) fingers.forEach(function (f) { setFingerCurl(f, 0.7); });
        }
      }
      var handPos = getHandPos(arm);
      var pp = propPosition(prop);
      if (handPos && pp && isNum(handPos.x) && isNum(pp.x) &&
          isNum(handPos.y) && isNum(pp.y) && isNum(handPos.z) && isNum(pp.z)) {
        var d = dist3(pp.x, pp.y, pp.z, handPos.x, handPos.y, handPos.z);
        if (d > GRIP_MAX_DISTANCE) {
          issues.push('loose grip: ' + name + ' is ' + d.toFixed(3) +
            ' m from palm (max ' + GRIP_MAX_DISTANCE + ' m)');
        }
      }
    });
    return issues;
  }

  // --- Rule 6 (correct sitting pose) --------------------------------
  function checkSitting(fix) {
    var issues = [];
    if (!enzo || enzo.seated !== true) return issues;
    var seatH = seatHeightFor(enzo);
    var hip = getHipAccessor(enzo);
    if (hip) {
      var y = hip.get();
      if (isNum(y) && Math.abs(y - seatH) > 0.03) {
        issues.push('sitting: hips y=' + y.toFixed(3) + ' m, seat is ' +
          seatH.toFixed(2) + ' m ± 0.03 m');
        if (fix) hip.set(clamp(y, seatH - 0.03, seatH + 0.03));
      }
    }
    [['L', enzo.legL], ['R', enzo.legR]].forEach(function (pair) {
      var side = pair[0], leg = pair[1];
      if (!leg) return;
      var bend = kneeBendDeg(leg);
      if (isNum(bend) && (bend < 80 || bend > 100)) {
        issues.push('sitting: knee ' + side + ' bent ' + bend.toFixed(0) +
          '° (must be 80–100°)');
        if (fix) setKneeBendDeg(leg, clamp(bend, 80, 100));
      }
      var fp = getFootPos(leg);
      if (fp && isNum(fp.y) && Math.abs(fp.y) > FOOT_TOLERANCE) {
        issues.push('sitting: foot ' + side + ' not flat on floor (y=' +
          fp.y.toFixed(3) + ' m)');
        if (fix) fp.y = 0;
      }
    });
    // Torso must not intersect the chair back. Lean direction is
    // rig-dependent, so this only fires on a clear backward lean
    // (> 25°) or against an explicit chair-back plane if the app
    // provides enzo.chairBackZ.
    var torso = enzo.torso || enzo.spine || enzo.chest || null;
    if (torso && torso.rotation && isNum(torso.rotation.x)) {
      var leanDeg = Math.abs(torso.rotation.x) * RAD_TO_DEG;
      if (leanDeg > 25) {
        issues.push('sitting: torso leaning ' + leanDeg.toFixed(0) +
          '° (max 25° — would intersect chair back)');
        if (fix) {
          torso.rotation.x = (torso.rotation.x < 0 ? -1 : 1) * 25 * DEG_TO_RAD;
        }
      }
    }
    if (torso && torso.position && isNum(torso.position.z) && isNum(enzo.chairBackZ)) {
      if (torso.position.z < enzo.chairBackZ) {
        issues.push('sitting: torso intersects chair back (z=' +
          torso.position.z.toFixed(2) + ' m)');
        if (fix) torso.position.z = enzo.chairBackZ;
      }
    }
    return issues;
  }

  // --- Rule 7 (no wall / furniture clipping) ------------------------
  function checkClipping(fix) {
    var issues = [];
    var pos = getRootPos(enzo);
    if (!pos) return issues;
    var r = cfg.radius;
    var loX = cfg.minX + r, hiX = cfg.maxX - r;
    var loZ = cfg.minZ + r, hiZ = cfg.maxZ - r;
    if (isNum(pos.y) && pos.y < 0) {
      issues.push('clipping: root below floor (y=' + pos.y.toFixed(3) + ' m)');
      if (fix) pos.y = 0;
    }
    // Wall bounds are clamped LAST (below), after furniture/lamp
    // push-outs, so a push-out can never leave the root outside the
    // room (the room bound is absolute; collider keep-outs overlap it
    // near the sofa's east edge, where no position satisfies both).
    // Sitting on a seat is not clipping that seat: skip the collider
    // whose support height matches the seat height.
    var seatH = (enzo.seated === true) ? seatHeightFor(enzo) : null;
    cfg.colliders.forEach(function (box) {
      if (seatH !== null) {
        var isSeat = cfg.surfaces.some(function (s) {
          return s.name && box.name &&
            s.name.toLowerCase().indexOf(box.name.toLowerCase()) === 0 &&
            isNum(s.y) && Math.abs(s.y - seatH) <= 0.01;
        });
        if (isSeat) return;
      }
      var ex0 = box.minX - r, ex1 = box.maxX + r;
      var ez0 = box.minZ - r, ez1 = box.maxZ + r;
      if (pos.x >= ex0 && pos.x <= ex1 && pos.z >= ez0 && pos.z <= ez1) {
        var dWest = pos.x - ex0, dEast = ex1 - pos.x;
        var dNorth = pos.z - ez0, dSouth = ez1 - pos.z;
        var m = Math.min(dWest, dEast, dNorth, dSouth);
        var edge = (m === dWest) ? 'west' : (m === dEast) ? 'east'
          : (m === dNorth) ? 'north' : 'south';
        issues.push('furniture clipping: root inside ' + box.name +
          ' collider, pushed out ' + edge);
        if (fix) {
          if (edge === 'west') pos.x = ex0;
          else if (edge === 'east') pos.x = ex1;
          else if (edge === 'north') pos.z = ez0;
          else pos.z = ez1;
        }
      }
    });
    if (cfg.lamp) {
      var dx = pos.x - cfg.lamp.x, dz = pos.z - cfg.lamp.z;
      var d = Math.sqrt(dx * dx + dz * dz);
      var minD = r + cfg.lamp.r;
      if (d < minD) {
        issues.push('furniture clipping: root inside floor lamp keep-out (dist ' +
          d.toFixed(2) + ' m, min ' + minD.toFixed(2) + ' m)');
        if (fix) {
          if (d < 1e-6) { pos.x = cfg.lamp.x + minD; }
          else {
            var s2 = minD / d;
            pos.x = cfg.lamp.x + dx * s2;
            pos.z = cfg.lamp.z + dz * s2;
          }
        }
      }
    }
    // Final wall clamp (see note above): room bounds win over colliders.
    if (pos.x < loX) {
      issues.push('wall clipping: root x=' + pos.x.toFixed(2) +
        ' m past west wall (min ' + loX.toFixed(2) + ' m)');
      if (fix) pos.x = loX;
    } else if (pos.x > hiX) {
      issues.push('wall clipping: root x=' + pos.x.toFixed(2) +
        ' m past east wall (max ' + hiX.toFixed(2) + ' m)');
      if (fix) pos.x = hiX;
    }
    if (pos.z < loZ) {
      issues.push('wall clipping: root z=' + pos.z.toFixed(2) +
        ' m past north wall (min ' + loZ.toFixed(2) + ' m)');
      if (fix) pos.z = loZ;
    } else if (pos.z > hiZ) {
      issues.push('wall clipping: root z=' + pos.z.toFixed(2) +
        ' m past south wall (max ' + hiZ.toFixed(2) + ' m)');
      if (fix) pos.z = hiZ;
    }
    return issues;
  }

  // --- Rule 8 (face / body unchanged) -------------------------------
  function checkScale(fix) {
    var issues = [];
    var scale = getScaleObj(enzo);
    if (scale) {
      ['x', 'y', 'z'].forEach(function (a) {
        if (isNum(scale[a]) && Math.abs(scale[a] - 1) > 0.01) {
          issues.push('scale changed: enzo scale.' + a + ' = ' +
            scale[a].toFixed(3) + ' (must be 1)');
          if (fix) scale[a] = 1;
        }
      });
    }
    // Canonical height (character sheet): 1.35 m (4.5 ft), never 1.50 m.
    var th = totalHeightAccessor(enzo);
    if (th && isNum(th.get()) &&
        Math.abs(th.get() - CANONICAL_HEIGHT) > 0.01 * CANONICAL_HEIGHT) {
      issues.push('height changed: ENZO is ' + th.get().toFixed(2) +
        ' m, canonical height is 1.35 m (4.5 ft)');
      if (fix) th.set(CANONICAL_HEIGHT);
    }
    // Segment proportions: runtime drift vs baseline is corrected;
    // a rig built off-spec is flagged once (never silently resized).
    segmentHeightAccessors(enzo).forEach(function (seg) {
      var cur = seg.get();
      var baseSeg = state.baseline.segments ? state.baseline.segments[seg.label] : null;
      var expected = seg.fraction * CANONICAL_HEIGHT;
      if (isNum(cur) && isNum(baseSeg) &&
          Math.abs(cur - baseSeg) / Math.max(Math.abs(baseSeg), 1e-6) > 0.01) {
        issues.push('proportion changed: ' + seg.label + ' height = ' +
          cur.toFixed(3) + ' m (baseline ' + baseSeg.toFixed(3) + ' m)');
        if (fix) seg.set(baseSeg);
      } else if (isNum(cur) && Math.abs(cur - expected) / expected > 0.05 &&
          !state.canonicalWarned[seg.label]) {
        state.canonicalWarned[seg.label] = true;
        issues.push('canonical proportion: ' + seg.label + ' height = ' +
          cur.toFixed(3) + ' m, character sheet expects ~' + expected.toFixed(2) +
          ' m (' + Math.round(seg.fraction * 100) + '% of 1.35 m)');
      }
    });
    // Face/eye/mouth base positions: identical across expressions —
    // only eye/mouth SHAPE may change, never the base position.
    var baseAnchors = {};
    (state.baseline.faceAnchors || []).forEach(function (b) {
      if (!baseAnchors[b.label]) baseAnchors[b.label] = [];
      baseAnchors[b.label].push(b.pos);
    });
    collectFaceAnchors(enzo).forEach(function (a) {
      var queue = baseAnchors[a.label];
      if (!queue || !queue.length) return;
      var basePos = queue.shift();
      var moved = Math.max(
        Math.abs(a.pos.x - basePos.x),
        Math.abs(a.pos.y - basePos.y),
        Math.abs(a.pos.z - basePos.z));
      if (moved > FACE_ANCHOR_TOLERANCE) {
        issues.push('face anchor moved: ' + a.label + ' base position shifted ' +
          moved.toFixed(3) + ' m (expressions may change eye/mouth shape only, never base position)');
        if (fix) { a.pos.x = basePos.x; a.pos.y = basePos.y; a.pos.z = basePos.z; }
      }
    });
    ['head', 'torso'].forEach(function (part) {
      var o = enzo[part];
      var b = state.baseline[part];
      if (!o || !b) return;
      if (o.scale && b.scale) {
        ['x', 'y', 'z'].forEach(function (a) {
          if (isNum(o.scale[a]) && isNum(b.scale[a]) &&
              Math.abs(o.scale[a] - b.scale[a]) / Math.max(Math.abs(b.scale[a]), 1e-6) > 0.01) {
            issues.push('proportion changed: ' + part + ' scale.' + a + ' = ' +
              o.scale[a].toFixed(3) + ' (baseline ' + b.scale[a].toFixed(3) + ')');
            if (fix) o.scale[a] = b.scale[a];
          }
        });
      }
      ['height', 'width', 'depth', 'radius'].forEach(function (f) {
        if (isNum(o[f]) && isNum(b[f]) &&
            Math.abs(o[f] - b[f]) / Math.max(Math.abs(b[f]), 1e-6) > 0.01) {
          issues.push('proportion changed: ' + part + ' ' + f + ' = ' +
            o[f] + ' (baseline ' + b[f] + ')');
          if (fix) o[f] = b[f];
        }
      });
    });
    ['headHeight', 'torsoHeight', 'headSize', 'torsoSize'].forEach(function (f) {
      if (isNum(enzo[f]) && isNum(state.baseline[f]) &&
          Math.abs(enzo[f] - state.baseline[f]) / Math.max(Math.abs(state.baseline[f]), 1e-6) > 0.01) {
        issues.push('proportion changed: ' + f + ' = ' + enzo[f] +
          ' (baseline ' + state.baseline[f] + ')');
        if (fix) enzo[f] = state.baseline[f];
      }
    });
    return issues;
  }

  // --- Public API ----------------------------------------------------
  function enforce(dt) {
    var dtEff = (isNum(dt) && dt > 0) ? clamp(dt, 1 / 240, 0.25) : 1 / 60;
    var issues = [];
    var motion = checkRootMotion(dtEff, true, true);
    issues.push.apply(issues, motion.issues);
    issues.push.apply(issues, checkJoints(true, dtEff));
    issues.push.apply(issues, checkClipping(true));
    issues.push.apply(issues, checkSitting(true));
    issues.push.apply(issues, checkFeet(true));
    issues.push.apply(issues, checkFloating(true));
    issues.push.apply(issues, checkGrips(true));
    issues.push.apply(issues, checkScale(true));
    if (enzo && typeof enzo.clampJoints === 'function') {
      try {
        enzo.clampJoints();
      } catch (err) {
        issues.push('clampJoints failed: ' + (err && err.message ? err.message : String(err)));
      }
    }
    // Snapshot state AFTER all corrections, so the next frame measures
    // from the corrected pose (no self-inflicted teleport/joint flags).
    var pos = getRootPos(enzo);
    if (pos) {
      state.prevPos = { x: pos.x, y: pos.y, z: pos.z };
      if (motion.vel) state.prevVel = motion.vel;
    }
    snapshotJoints();
    log(issues);
    return issues;
  }

  function validatePose() {
    var issues = [];
    var motion = checkRootMotion(1 / 60, false, false); // accel only (Rule 2)
    issues.push.apply(issues, motion.issues);
    issues.push.apply(issues, checkJoints(false, 1 / 60));
    issues.push.apply(issues, checkFeet(false));
    issues.push.apply(issues, checkGrips(false));
    issues.push.apply(issues, checkSitting(false));
    issues.push.apply(issues, checkClipping(false));
    return { ok: issues.length === 0, issues: issues };
  }

  function validateScene() {
    var issues = checkFloating(false);
    return { ok: issues.length === 0, issues: issues };
  }

  function selfTest() {
    var details = [];
    function record(name, pass, detail) {
      details.push({ name: name, passed: !!pass, detail: detail || '' });
    }
    function runOne(name, fn) {
      try {
        var r = fn();
        record(name, r.pass, r.detail);
      } catch (err) {
        record(name, false, 'threw: ' + (err && err.message ? err.message : String(err)));
      }
    }

    // 1. Teleport attempt: root jumps 5 m in one frame.
    runOne('teleport attempt is clamped', function () {
      var e = makeStubEnzo();
      var r = createRuleEnforcer(e, {}, []);
      r.enforce(1 / 60);
      e.group.position.x = 5;
      r.enforce(1 / 60);
      var flagged = r.violations.some(function (v) { return /teleport/i.test(v); });
      return {
        pass: e.group.position.x <= 0.061 && flagged,
        detail: 'root x after jump: ' + e.group.position.x.toFixed(4) +
          ' m (jump target was 5 m); violations: ' + r.violations.join(' | ')
      };
    });

    // 2. Floating mug: 1.2 m up over open floor, nothing under it.
    runOne('floating mug snaps to floor', function () {
      var mug = { name: 'mug', position: { x: 0, y: 1.2, z: 0 }, attached: false };
      var e = makeStubEnzo();
      var r = createRuleEnforcer(e, {}, [mug]);
      r.enforce(1 / 60);
      var flagged = r.violations.some(function (v) { return /floating prop/i.test(v); });
      return {
        pass: Math.abs(mug.position.y - 0) < 1e-9 && flagged,
        detail: 'mug y after enforce: ' + mug.position.y.toFixed(3) +
          ' m (was 1.2 m); violations: ' + r.violations.join(' | ')
      };
    });

    // 3. Foot below the floor while in contact.
    runOne('foot below floor is raised to 0', function () {
      var e = makeStubEnzo();
      var r = createRuleEnforcer(e, {}, []);
      r.enforce(1 / 60);
      e.legL.foot.position.y = -0.05;
      r.enforce(1 / 60);
      var flagged = r.violations.some(function (v) { return /foot/i.test(v); });
      return {
        pass: Math.abs(e.legL.foot.position.y) <= 0.005 && flagged,
        detail: 'foot L y after enforce: ' + e.legL.foot.position.y.toFixed(3) +
          ' m (was -0.05 m); violations: ' + r.violations.join(' | ')
      };
    });

    // 4. Loose grip: glass attached to right hand, fingers open.
    runOne('loose grip is flagged and fingers curled', function () {
      var glass = {
        name: 'glass',
        position: { x: 0.3, y: 1.0, z: 0.2 },
        attached: true, attachedTo: 'right'
      };
      var e = makeStubEnzo();
      var r = createRuleEnforcer(e, {}, [glass]);
      r.enforce(1 / 60);
      e.armR.hand.fingers.forEach(function (f) { f.curl = 0.1; });
      r.enforce(1 / 60);
      var curls = e.armR.hand.fingers.map(function (f) { return f.curl; });
      var avg = curls.reduce(function (a, b) { return a + b; }, 0) / curls.length;
      var flagged = r.violations.some(function (v) { return /loose grip/i.test(v); });
      return {
        pass: avg > 0.5 && flagged,
        detail: 'avg finger curl after enforce: ' + avg.toFixed(2) +
          ' (was 0.1); violations: ' + r.violations.join(' | ')
      };
    });

    // 5. Sitting with straight knees.
    runOne('sitting with straight knees is corrected to 80-100 deg', function () {
      var e = makeStubEnzo();
      e.seated = true;
      e.seatType = 'chair';
      e.group.position.y = 0.48;
      var r = createRuleEnforcer(e, {}, []);
      r.enforce(1 / 60);
      var bendL = kneeBendDeg(e.legL);
      var bendR = kneeBendDeg(e.legR);
      var flagged = r.violations.some(function (v) { return /sitting/i.test(v); });
      return {
        pass: isNum(bendL) && bendL >= 80 && bendL <= 100 &&
          isNum(bendR) && bendR >= 80 && bendR <= 100 &&
          Math.abs(e.group.position.y - 0.48) <= 0.03 && flagged,
        detail: 'knee bend L/R after enforce: ' + bendL.toFixed(0) + '°/' +
          bendR.toFixed(0) + '° (was 0°); hips y: ' +
          e.group.position.y.toFixed(3) + ' m; violations: ' + r.violations.join(' | ')
      };
    });

    // 6. Wall clipping: root pushed past the east wall.
    runOne('wall clipping pushes root back inside bounds', function () {
      var e = makeStubEnzo();
      e.group.position.x = 3.1; // max legal centre is 3.2 - 0.35 = 2.85
      var r = createRuleEnforcer(e, {}, []);
      r.enforce(1 / 60);
      var flagged = r.violations.some(function (v) { return /wall clipping/i.test(v); });
      return {
        pass: e.group.position.x <= 2.85 + 1e-9 && flagged,
        detail: 'root x after enforce: ' + e.group.position.x.toFixed(3) +
          ' m (was 3.1 m); violations: ' + r.violations.join(' | ')
      };
    });

    // 7. Scale changed: enzo stretched on x.
    runOne('scale deviation is flagged and reset to 1', function () {
      var e = makeStubEnzo();
      e.group.scale.x = 1.5;
      var r = createRuleEnforcer(e, {}, []);
      r.enforce(1 / 60);
      var flagged = r.violations.some(function (v) { return /scale/i.test(v); });
      return {
        pass: e.group.scale.x === 1 && flagged,
        detail: 'scale.x after enforce: ' + e.group.scale.x +
          ' (was 1.5); violations: ' + r.violations.join(' | ')
      };
    });

    // 8. Joint snap: shoulder whips 28.6 deg in one frame.
    runOne('joint rotating >8 deg in one frame is eased', function () {
      var e = makeStubEnzo();
      var r = createRuleEnforcer(e, {}, []);
      r.enforce(1 / 60);
      e.armR.shoulder.rotation.x = 0.5; // ~28.6 deg
      r.enforce(1 / 60);
      var flagged = r.violations.some(function (v) { return /joint snap/i.test(v); });
      return {
        pass: e.armR.shoulder.rotation.x <= 8 * DEG_TO_RAD + 1e-9 && flagged,
        detail: 'shoulder rotation.x after enforce: ' +
          (e.armR.shoulder.rotation.x * RAD_TO_DEG).toFixed(1) +
          '° (was 28.6°); violations: ' + r.violations.join(' | ')
      };
    });

    // 9. Canonical height: ENZO stretched to 1.50 m.
    runOne('canonical height 1.35 m is enforced (not 1.50 m)', function () {
      var e = makeStubEnzo();
      var r = createRuleEnforcer(e, {}, []);
      r.enforce(1 / 60);
      e.height = 1.5;
      r.enforce(1 / 60);
      var flagged = r.violations.some(function (v) { return /1\.35 m/.test(v); });
      return {
        pass: Math.abs(e.height - 1.35) < 1e-9 && flagged,
        detail: 'height after enforce: ' + e.height.toFixed(2) +
          ' m (was 1.50 m); violations: ' + r.violations.join(' | ')
      };
    });

    // 10. Eye base position must not move across expressions.
    runOne('eye base position is restored (shape may change, position may not)', function () {
      var e = makeStubEnzo();
      var r = createRuleEnforcer(e, {}, []);
      r.enforce(1 / 60);
      e.eyeL.position.x = 0.0; // shifted 0.05 m from baseline -0.05
      r.enforce(1 / 60);
      var flagged = r.violations.some(function (v) { return /face anchor/i.test(v); });
      return {
        pass: Math.abs(e.eyeL.position.x - (-0.05)) < 1e-9 && flagged,
        detail: 'eyeL x after enforce: ' + e.eyeL.position.x.toFixed(3) +
          ' m (was shifted to 0.0 m); violations: ' + r.violations.join(' | ')
      };
    });

    var passed = details.filter(function (d) { return d.passed; }).length;
    return { passed: passed, failed: details.length - passed, details: details };
  }

  return {
    enforce: enforce,
    validatePose: validatePose,
    validateScene: validateScene,
    selfTest: selfTest,
    violations: violations
  };
}

// ------------------------------------------------------------------
// Exports (UMD-style: CommonJS for node/tests, global for the browser)
// ------------------------------------------------------------------
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createRuleEnforcer: createRuleEnforcer };
  module.exports.createRuleEnforcer = createRuleEnforcer;
}
if (typeof window !== 'undefined') {
  window.createRuleEnforcer = createRuleEnforcer;
}

  return createRuleEnforcer;
})();
  window.EnzoRoom.createRuleEnforcer=createRuleEnforcer;


  function makeScene(mount){
    var renderer;
    try{
      renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
    }catch(e){ return null; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
    if('outputColorSpace' in renderer && THREE.SRGBColorSpace) renderer.outputColorSpace=THREE.SRGBColorSpace;
    else if('outputEncoding' in renderer && THREE.sRGBEncoding) renderer.outputEncoding=THREE.sRGBEncoding;
    if(THREE.ACESFilmicToneMapping) renderer.toneMapping=THREE.ACESFilmicToneMapping;
    /* REAL shadows — every solid in the room casts and receives. */
    renderer.shadowMap.enabled=true;
    renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    var scene=new THREE.Scene();
    var camera=new THREE.PerspectiveCamera(50,1,0.1,100);
    camera.position.set(0,1.7,4.6); camera.lookAt(0,1.0,0);
    /* Build order (locked): room → enzo → workstation. */
    var buildRoomHere=window.EnzoRoom.createRoomBuilder();
    var room=buildRoomHere(scene, THREE);
    var enzo=window.EnzoRoom.buildEnzo(THREE);
    scene.add(enzo.group);
    var ws=window.EnzoRoom.buildWorkstation(scene, THREE);
    var props=ws.props;
    /* Piece 4 reads plain {x,z} anchors: Piece 1's anchors plus the desk /
       chair positions Piece 2 defines (chair seat centre (-1.9, 0.48, -0.6)). */
    var animRoom={};
    var ra=room.anchors||{};
    for(var rk in ra) animRoom[rk]=ra[rk];
    animRoom.deskPos={x:-1.9,z:-0.6};
    animRoom.chairPos={x:-1.9,z:-0.6};
    var anim=window.EnzoRoom.createAnimationSystem(enzo, animRoom, props, THREE);
    try{ anim.setStartPosition(0.3,0.4,0); }catch(e){ enzo.group.position.set(0.3,0,0.4); }
    var rules=window.EnzoRoom.createRuleEnforcer(enzo, ra, props);
    var cams=window.EnzoRoom.createCameraSystem(camera, enzo, ra, props, THREE);
    mount.appendChild(renderer.domElement);
    mount.classList.add('live');
    var inst={ mount:mount, renderer:renderer, scene:scene, camera:camera, enzo:enzo, room:room,
               props:props, anim:anim, rules:rules, cams:cams, w:0, h:0, appliedState:null, nextRoam:0, roaming:false };
    window.EnzoRoom.sizeInstance(inst);
    window.EnzoRoom.applyStateToInstance(inst);
    return inst;
  }
  window.EnzoRoom.sizeInstance=function(inst){
    var w=inst.mount.clientWidth, h=inst.mount.clientHeight;
    if(!w||!h||(w===inst.w&&h===inst.h)) return;
    inst.w=w; inst.h=h;
    inst.renderer.setSize(w,h,false);
    inst.camera.aspect=w/h;
    inst.camera.updateProjectionMatrix();
  }
  window.EnzoRoom.requestEnzoResize=function(){ window.EnzoRoom.instances.forEach(window.EnzoRoom.sizeInstance); }
  window.requestEnzoResize=window.EnzoRoom.requestEnzoResize;

  if(window.EnzoRoom.heroMount){ var a=makeScene(window.EnzoRoom.heroMount); if(a) window.EnzoRoom.instances.push(a); }
  if(window.EnzoRoom.panelMount){ var b=makeScene(window.EnzoRoom.panelMount); if(b) window.EnzoRoom.instances.push(b); }
  if(!window.EnzoRoom.instances.length){ return; }
  window.setEnzoQuality(window.EnzoRoom.enzoQuality); /* apply the saved quality (pixel ratio) */
  window.addEventListener('resize',window.EnzoRoom.requestEnzoResize);

  /* ---- Playful mouse teasing + buddy anger (v50 behaviour, preserved) ----
     One click on ENZO: annoyed — a grumpy line in the user's own language.
     Keep clicking: he RUNS to another spot in the room — a steady visible
     run the whole way across (constant-speed offset applied on top of the
     animation system, inside the rules enforcer's per-frame travel cap),
     never a teleport and never a jump cut. Poke him again while he is away,
     or keep interrupting him while he works, and he gets properly ANGRY for
     a few seconds, then calms down by himself and goes straight back to
     work. Never an error, never a refusal: a buddy's feelings. */
  var teaseCur={x:0,z:0}, teaseTarget={x:0,z:0}, teaseFast=false;
  var tease={count:0,lastAt:0,escaped:false,busyPokes:0,angryUntil:0,prevState:'idle',timers:[],awayX:1,awayZ:-0.4};
  function teaseLang(){ try{ if(typeof window.__enzoUserLang==='function') return window.__enzoUserLang()||'en'; }catch(e){} return 'en'; }
  var TEASE_LINES={
    annoyed:{en:'Hey — that tickles. I am right here, you know.', roman:'Oye — gudgudi hoti hai. Main yahin khara hoon, pata hai na.', urdu:'اوئے — گدگدی ہوتی ہے۔ میں یہیں کھڑا ہوں، پتہ ہے نا۔'},
    runaway:{en:'Okay, that is enough poking — I am moving over here.', roman:'Bas, bohat ho gaya tang karna — main udhar ja raha hoon.', urdu:'بس، بہت ہو گیا تنگ کرنا — میں اُدھر جا رہا ہوں۔'},
    angry:{en:'Enough! I am trying to be your buddy here — give me a second.', roman:'Bas karo, tang mat karo! Main yahan aap ka dost ban kar khara hoon — aik minute do.', urdu:'بس کرو، تنگ مت کرو! میں یہاں آپ کا دوست بن کر کھڑا ہوں — ایک منٹ دو۔'}
  };
  function teaseLine(kind){ var g=TEASE_LINES[kind]; var l=teaseLang(); return (g&&(g[l]||g.en))||''; }
  function teaseLater(fn, ms){ tease.timers.push(setTimeout(fn, ms)); }
  function showTeaseBubble(text, ms){
    ['enzoPanelMount','enzoHeroMount'].forEach(function(id){
      var mount=document.getElementById(id); if(!mount) return;
      var b=mount.querySelector('.enzo-bubble');
      if(!b){
        b=document.createElement('div'); b.className='enzo-bubble'; mount.appendChild(b);
        var st=document.createElement('style');
        st.textContent='.enzo-mount{position:relative}.enzo-bubble{position:absolute;left:50%;bottom:12px;transform:translateX(-50%);max-width:88%;background:#0B1B33;border:1px solid rgba(0,217,255,.55);color:#E0F2FE;font-size:12.5px;font-weight:600;line-height:1.45;border-radius:11px;padding:8px 11px;text-align:center;opacity:0;pointer-events:none;transition:opacity .25s;z-index:5}.enzo-bubble.show{opacity:1}';
        document.head.appendChild(st);
      }
      b.textContent=text; b.classList.add('show');
      clearTimeout(b._hideT);
      b._hideT=setTimeout(function(){ b.classList.remove('show'); }, ms||2600);
    });
  }
  function teaseRestore(ms){
    teaseLater(function(){
      if(window.EnzoRoom.enzoState==='annoyed' || window.EnzoRoom.enzoState==='angry'){
        var st=window.state||{};
        window.setEnzoState(st.isGenerating ? 'researching' : (tease.prevState && tease.prevState!=='annoyed' && tease.prevState!=='angry' ? tease.prevState : 'idle'));
      }
    }, ms);
  }
  function doAngry(now){
    tease.angryUntil=now+5200;
    if(window.EnzoRoom.enzoState!=='angry') tease.prevState=window.EnzoRoom.enzoState;
    window.setEnzoState('angry');
    showTeaseBubble(teaseLine('angry'), 3400);
    teaseRestore(5400);
  }
  function runAway(now){
    tease.escaped=true;
    teaseFast=true;
    /* He runs AWAY from the poke: whichever side of him was touched, he
       bolts to the OPPOSITE side of the room — a steady visible run the
       whole way across, never a teleport and never a jump cut. */
    teaseTarget.x=tease.awayX*1.35;
    teaseTarget.z=tease.awayZ;
    if(window.EnzoRoom.enzoState!=='annoyed') tease.prevState=window.EnzoRoom.enzoState;
    window.setEnzoState('annoyed');
    showTeaseBubble(teaseLine('runaway'), 2800);
    teaseLater(function checkBack(){
      if(!tease.escaped) return;
      if(Date.now()-tease.lastAt>3500){
        tease.escaped=false; tease.count=0; teaseFast=true;
        teaseTarget.x=0; teaseTarget.z=0;
        teaseRestore(1200);
      } else teaseLater(checkBack, 900);
    }, 1200);
  }
  function pokeEnzo(e, mount){
    var now=Date.now();
    /* Where on ENZO the touch landed decides where he flees: touched on
       his left, he runs right; touched on his right, he runs left;
       touched low/near, he also backs deeper into the room. */
    var relX=0.5, relY=0.5;
    if(e && mount && typeof e.clientX==='number'){ var rct=mount.getBoundingClientRect(); if(rct.width>0){ relX=(e.clientX-rct.left)/rct.width; relY=(e.clientY-rct.top)/rct.height; } }
    tease.awayX = relX<0.45 ? 1 : (relX>0.55 ? -1 : (teaseCur.x>=0 ? -1 : 1));
    tease.awayZ = relY>0.55 ? -0.45 : -0.05;
    if(now-tease.lastAt>7000){ tease.count=0; tease.busyPokes=0; }
    tease.lastAt=now;
    if(now<tease.angryUntil) return;
    var st=window.state||{};
    var busy=!!(st.isGenerating || st.isSpeaking);
    if(busy){
      /* Busy: a quick annoyed flash only — work is never blocked. Repeated
         interruption while he works is what makes him angry. */
      tease.busyPokes++;
      if(tease.busyPokes>=3){ tease.busyPokes=0; doAngry(now); }
      else if(window.EnzoRoom.enzoState!=='annoyed'){ tease.prevState=window.EnzoRoom.enzoState; window.setEnzoState('annoyed'); showTeaseBubble(teaseLine('annoyed'), 1500); teaseRestore(1300); }
      return;
    }
    if(tease.escaped){ doAngry(now); return; }
    tease.count++;
    if(tease.count>=3){ runAway(now); return; }
    if(window.EnzoRoom.enzoState!=='annoyed') tease.prevState=window.EnzoRoom.enzoState;
    window.setEnzoState('annoyed');
    showTeaseBubble(teaseLine('annoyed'), 2200);
    teaseTarget.x=Math.max(-0.7, Math.min(0.7, teaseCur.x + tease.awayX*0.35));
    teaseTarget.z=-0.22;
    teaseLater(function(){ if(!tease.escaped){ teaseTarget.z=0; teaseTarget.x=0; } }, 1500);
    teaseRestore(2100);
  }
  ['enzoPanelMount','enzoHeroMount'].forEach(function(id){
    var mount=document.getElementById(id);
    if(mount){ mount.style.cursor='pointer'; mount.addEventListener('pointerdown', function(e){ pokeEnzo(e, mount); }); }
  });

  /* ---- Frame loop — ONE shared RAF for both canvases; it pauses while the
     tab is hidden. Locked per-frame order: room life → animations.update
     → tease offset (constant speed, inside the travel cap) → rules.enforce
     → cameras.update → render. Free roaming: while ENZO is idle he ambles
     through the room on Piece 4 movement sequences of his own — never
     frozen standing in one place. ---- */
  var rafId=null, lastTs=0;
  var ROAM_SEQS=['walkForward','strafeLeft','strafeRight','visitPlants','goToSofa','gestureHands','wave'];
  function frame(ts){
    rafId=requestAnimationFrame(frame);
    if(!lastTs) lastTs=ts;
    var dt=Math.min((ts-lastTs)/1000,0.05); lastTs=ts;
    var t=ts/1000;
    /* Tease travel — CONSTANT-SPEED along the real path, never an
       exponential ease: an ease covers most of the distance in the first
       few frames and reads as a teleport / jump cut. */
    var mvx=teaseTarget.x-teaseCur.x, mvz=teaseTarget.z-teaseCur.z;
    var mDist=Math.sqrt(mvx*mvx+mvz*mvz);
    var mSpd=window.__enzoRM?0.8:(teaseFast?1.9:0.8);
    if(mDist>0.001){
      var mStep=mSpd*dt;
      if(mStep>=mDist){ teaseCur.x=teaseTarget.x; teaseCur.z=teaseTarget.z; }
      else { teaseCur.x+=mvx/mDist*mStep; teaseCur.z+=mvz/mDist*mStep; }
    }
    if(mDist<0.03) teaseFast=false;
    for(var i=0;i<window.EnzoRoom.instances.length;i++){
      var inst=window.EnzoRoom.instances[i];
      try{
        if(inst.mount.clientWidth&&(inst.mount.clientWidth!==inst.w||inst.mount.clientHeight!==inst.h)) window.EnzoRoom.sizeInstance(inst);
        if(inst.room && typeof inst.room.updateRoom==='function'){ try{ inst.room.updateRoom(dt,t); }catch(e){} }
        inst.anim.update(dt);
        if(teaseCur.x||teaseCur.z){ inst.enzo.group.position.x+=teaseCur.x; inst.enzo.group.position.z+=teaseCur.z; }
        try{ inst.rules.enforce(dt); }catch(e){}
        /* Free roaming — idle only, never while teased away, never under
           Reduced Motion; the walking camera follows movement sequences. */
        if(!inst.nextRoam) inst.nextRoam=t+9+Math.random()*8;
        var cur=null; try{ cur=inst.anim.current(); }catch(e){}
        if(!cur && inst.roaming){ inst.roaming=false; try{ inst.cams.autoSelect('idle'); }catch(e){} }
        if(window.EnzoRoom.enzoState==='idle' && !tease.escaped && !window.__enzoRM && !cur && t>inst.nextRoam){
          inst.nextRoam=t+16+Math.random()*14;
          var s=ROAM_SEQS[Math.floor(Math.random()*ROAM_SEQS.length)];
          try{ inst.anim.play(s); inst.roaming=true; inst.cams.autoSelect(s); }catch(e){}
        }
        inst.cams.update(dt);
        inst.renderer.render(inst.scene, inst.camera);
      }catch(frameErr){ /* one bad instance must never freeze the other canvas */ }
    }
  }
  rafId=requestAnimationFrame(frame);
  document.addEventListener('visibilitychange',function(){
    if(document.hidden){ if(rafId) cancelAnimationFrame(rafId); rafId=null; lastTs=0; }
    else if(!rafId){ rafId=requestAnimationFrame(frame); }
  });
})();
