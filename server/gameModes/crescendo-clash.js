'use strict';
/**
 * Server-side authoritative simulation for Crescendo Clash.
 * No DOM, no canvas, no rendering — pure game logic.
 * Ported from games/crescendo-clash.html.
 */

const W = 900, H = 540;
const WIN_SCORE = 20;
const MATCH_TIME = 120;
const PLAYER_SIZE = 22;
const NOTE_RADIUS = 11;
const GOAL_ZONE = { w: 80, h: 130 };
const BOOST_SPEED = 6.5;
const NORMAL_SPEED = 3.2;
const BOOST_DURATION = 18;
const BOOST_COOLDOWN = 90;
const SHOOT_SPEED = 9;
const SHOOT_COOLDOWN = 60;
const STAGE_RADIUS = 52;
const STAGE_CHARGE_TIME = 180;    // 3 sec @ 60fps
const STAGE_ACTIVE_TIME = 420;
const STAGE_COOLDOWN_TIME = 360;
const stageX = W / 2, stageY = H / 2;

const goals = {
  p1: { x: 0,             y: H/2 - GOAL_ZONE.h/2, w: GOAL_ZONE.w, h: GOAL_ZONE.h, color: '#FF6B00' },
  p2: { x: W-GOAL_ZONE.w, y: H/2 - GOAL_ZONE.h/2, w: GOAL_ZONE.w, h: GOAL_ZONE.h, color: '#0066FF' },
};

const NOTE_SPAWN_ZONES = [
  {x:220,y:110},{x:450,y:85},{x:680,y:110},
  {x:220,y:430},{x:450,y:455},{x:680,y:430},
  {x:270,y:270},{x:630,y:270},
];

// ── FACTORIES ─────────────────────────────────────────────────────────────────

function makePlayer(id, x, y, color, accent) {
  return {
    id, x, y, color, accent,
    score: 0, carrying: null,
    boostTimer: 0, boostCooldown: 0,
    shootCooldown: 0,
    pickupImmunity: 0,
    bumpCooldown: 0,
    knockVx: 0, knockVy: 0,
    angle: id === 1 ? 0 : Math.PI,
    trail: [],
    amped: false,
    stageCharge: 0, onStage: false,
  };
}

function makeNote(x, y) {
  return { x, y, vx: 0, vy: 0, carried: null, bob: Math.random() * Math.PI * 2 };
}

// ── GAME CREATION ─────────────────────────────────────────────────────────────

function createGame(p1Color, p1Accent, p2Color, p2Accent) {
  const gs = {
    p1: makePlayer(1, 140, H/2, p1Color || '#FF6B00', p1Accent || '#FFB347'),
    p2: makePlayer(2, W-140, H/2, p2Color || '#0066FF', p2Accent || '#44AAFF'),
    notes: [],
    // Per-tick buffers: new effects generated this tick, cleared after each broadcast
    newParticles: [],
    newFloats: [],
    noteSpawnTimer: 0,
    timeLeft: MATCH_TIME,
    frameCount: 0,
    stageState: 'active',
    stageTimer: STAGE_ACTIVE_TIME,
    stageFlash: 0,
    gameEnded: false,
    winner: null, // null | 0 (tie) | 1 | 2
  };
  for (let i = 0; i < 5; i++) spawnNote(gs);
  return gs;
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

function spawnNote(gs) {
  if (gs.notes.length >= 7) return;
  const z = NOTE_SPAWN_ZONES[Math.floor(Math.random() * NOTE_SPAWN_ZONES.length)];
  const x = Math.max(95, Math.min(W-95, z.x + (Math.random()-.5)*50));
  const y = Math.max(40, Math.min(H-40, z.y + (Math.random()-.5)*50));
  gs.notes.push(makeNote(x, y));
}

function addParticles(gs, x, y, color, count=12, spd=3) {
  for (let i = 0; i < count; i++) {
    const a = Math.PI*2*i/count + Math.random()*.5;
    const s = spd*(0.5+Math.random());
    gs.newParticles.push({ x, y, vx: Math.cos(a)*s, vy: Math.sin(a)*s,
      life: 1, decay: 0.02+Math.random()*.03, size: 3+Math.random()*5, color });
  }
}

function addFloat(gs, x, y, text, color, size=18) {
  gs.newFloats.push({ x, y, text, color, life: 1, vy: -1.5, size });
}

// ── UPDATE PLAYER ─────────────────────────────────────────────────────────────

function updatePlayer(gs, p, input) {
  const { up, down, left, right, boost, justShoot } = input;

  let dx = 0, dy = 0;
  if (up)    dy -= 1;
  if (down)  dy += 1;
  if (left)  dx -= 1;
  if (right) dx += 1;

  if (dx || dy) {
    const m = Math.hypot(dx, dy);
    dx /= m; dy /= m;
    p.angle = Math.atan2(dy, dx);
  }

  if (p.boostCooldown > 0) p.boostCooldown--;
  if (p.boostTimer > 0) p.boostTimer--;
  if (boost && p.boostCooldown === 0 && (dx||dy) && p.boostTimer === 0) {
    p.boostTimer = BOOST_DURATION;
    p.boostCooldown = BOOST_COOLDOWN;
  }

  const spd = p.boostTimer > 0 ? BOOST_SPEED : NORMAL_SPEED;
  p.x += dx * spd + p.knockVx;
  p.y += dy * spd + p.knockVy;
  p.knockVx *= 0.75;
  p.knockVy *= 0.75;
  if (Math.abs(p.knockVx) < 0.1) p.knockVx = 0;
  if (Math.abs(p.knockVy) < 0.1) p.knockVy = 0;
  p.x = Math.max(PLAYER_SIZE, Math.min(W-PLAYER_SIZE, p.x));
  p.y = Math.max(PLAYER_SIZE, Math.min(H-PLAYER_SIZE, p.y));

  // Trail (server tracks so clients receive authoritative trail data)
  if (p.boostTimer > 0 && (dx||dy)) {
    p.trail.push({x: p.x, y: p.y, life: 1});
    if (p.trail.length > 12) p.trail.shift();
  }
  p.trail.forEach(t => t.life -= 0.1);
  p.trail = p.trail.filter(t => t.life > 0);

  if (p.bumpCooldown > 0) p.bumpCooldown--;
  if (p.shootCooldown > 0) p.shootCooldown--;
  if (p.pickupImmunity > 0) p.pickupImmunity--;

  // Shoot
  if (justShoot && p.shootCooldown === 0 && p.carrying) {
    shootNote(gs, p);
  }

  // Stage charge
  if (gs.stageState === 'active') {
    const onS = Math.hypot(p.x - stageX, p.y - stageY) < STAGE_RADIUS - 8;
    p.onStage = onS;
    if (onS && p.carrying && !p.amped) {
      p.stageCharge++;
      if (p.stageCharge >= STAGE_CHARGE_TIME) {
        p.amped = true;
        p.stageCharge = 0;
        addParticles(gs, p.x, p.y, '#CC44FF', 24, 5);
        addFloat(gs, p.x, p.y - 40, '⚡ AMPED!', '#CC44FF', 22);
        gs.stageFlash = 40;
      }
    } else if (!onS) {
      p.stageCharge = Math.max(0, p.stageCharge - 1);
    }
  } else {
    p.onStage = false;
    p.stageCharge = Math.max(0, p.stageCharge - 1);
  }
}

function shootNote(gs, p) {
  const n = p.carrying;
  p.carrying = null;
  n.carried = null;
  n.x = p.x + Math.cos(p.angle) * (PLAYER_SIZE + NOTE_RADIUS + 4);
  n.y = p.y + Math.sin(p.angle) * (PLAYER_SIZE + NOTE_RADIUS + 4);
  n.vx = Math.cos(p.angle) * SHOOT_SPEED;
  n.vy = Math.sin(p.angle) * SHOOT_SPEED;
  p.shootCooldown = SHOOT_COOLDOWN;
  p.pickupImmunity = 30;
  addParticles(gs, p.x, p.y, '#FFD600', 8, 4);
}

// ── GOAL SCORE ────────────────────────────────────────────────────────────────

function checkGoalScore(gs, p, goalKey) {
  if (!p.carrying) return;
  const goal = goals[goalKey];
  if (p.x > goal.x && p.x < goal.x+goal.w && p.y > goal.y && p.y < goal.y+goal.h) {
    const pts = p.amped ? 4 : 1;
    p.score += pts;
    const lbl = p.amped ? '+4 ⚡ AMP!' : '+1';
    const col = p.amped ? '#CC44FF' : goal.color;
    addParticles(gs, p.x, p.y, col, p.amped ? 30 : 16, p.amped ? 5 : 3);
    addFloat(gs, p.x, p.y-35, lbl, col, p.amped ? 22 : 18);
    if (p.amped) { p.amped = false; gs.stageFlash = 20; }
    gs.notes = gs.notes.filter(n => n !== p.carrying);
    p.carrying = null;
    spawnNote(gs);
    if (p.score >= WIN_SCORE) endGame(gs);
  }
}

// ── PICKUP ────────────────────────────────────────────────────────────────────

function checkNotePickup(gs, p) {
  if (p.carrying || p.pickupImmunity > 0) return;
  for (const n of gs.notes) {
    if (n.carried) continue;
    if (Math.hypot(p.x - n.x, p.y - n.y) < PLAYER_SIZE + NOTE_RADIUS - 4) {
      n.carried = p; p.carrying = n;
      addParticles(gs, n.x, n.y, '#FFE066', 6, 2);
      break;
    }
  }
}

// ── BUMP ──────────────────────────────────────────────────────────────────────

function checkBump(gs, a, b) {
  if (a.bumpCooldown > 0 || b.bumpCooldown > 0) return;
  const dx = a.x-b.x, dy = a.y-b.y, dist = Math.hypot(dx, dy);
  if (dist > 0 && dist < PLAYER_SIZE * 2.2) {
    const nx = dx/dist, ny = dy/dist;
    const aB = a.boostTimer > 0, bB = b.boostTimer > 0;

    if (aB && b.carrying) {
      const n = b.carrying; b.carrying = null; n.carried = null;
      n.vx = nx*7; n.vy = ny*7;
      if (b.amped) { b.amped = false; addFloat(gs, b.x, b.y-50, '⚡ LOST!', '#FF4444'); }
      addParticles(gs, b.x, b.y, b.color, 16); addFloat(gs, b.x, b.y-30, 'STOLEN!', a.color);
    } else if (bB && a.carrying) {
      const n = a.carrying; a.carrying = null; n.carried = null;
      n.vx = -nx*7; n.vy = -ny*7;
      if (a.amped) { a.amped = false; addFloat(gs, a.x, a.y-50, '⚡ LOST!', '#FF4444'); }
      addParticles(gs, a.x, a.y, a.color, 16); addFloat(gs, a.x, a.y-30, 'STOLEN!', b.color);
    } else {
      if (a.carrying) { const n=a.carrying; a.carrying=null; n.carried=null; n.vx=nx*3; n.vy=ny*3; }
      if (b.carrying) { const n=b.carrying; b.carrying=null; n.carried=null; n.vx=-nx*3; n.vy=-ny*3; }
    }

    const aForce = aB ? 14 : 7;
    const bForce = bB ? 14 : 7;
    a.knockVx += nx * bForce;
    a.knockVy += ny * bForce;
    b.knockVx -= nx * aForce;
    b.knockVy -= ny * aForce;

    const overlap = PLAYER_SIZE * 2.2 - dist;
    a.x += nx * overlap * 0.5;
    a.y += ny * overlap * 0.5;
    b.x -= nx * overlap * 0.5;
    b.y -= ny * overlap * 0.5;

    a.bumpCooldown = 25; b.bumpCooldown = 25;
    addParticles(gs, (a.x+b.x)/2, (a.y+b.y)/2, '#ffffff', 6, 3);
  }
}

// ── NOTES ─────────────────────────────────────────────────────────────────────

function updateNotes(gs) {
  for (const n of gs.notes) {
    if (n.carried) { n.x = n.carried.x; n.y = n.carried.y - PLAYER_SIZE - 4; }
    else {
      n.x += n.vx; n.y += n.vy;
      n.vx *= 0.87; n.vy *= 0.87;
      if (n.x < 95)   { n.x = 95;   n.vx *= -0.6; }
      if (n.x > W-95) { n.x = W-95; n.vx *= -0.6; }
      if (n.y < 40)   { n.y = 40;   n.vy *= -0.6; }
      if (n.y > H-40) { n.y = H-40; n.vy *= -0.6; }
    }
    n.bob += 0.05;
  }
}

// ── STAGE ─────────────────────────────────────────────────────────────────────

function updateStage(gs) {
  const { p1, p2 } = gs;
  const anyoneOnStage = (gs.stageState === 'active') &&
    (Math.hypot(p1.x - stageX, p1.y - stageY) < STAGE_RADIUS ||
     Math.hypot(p2.x - stageX, p2.y - stageY) < STAGE_RADIUS);

  if (!anyoneOnStage) gs.stageTimer--;

  if (gs.stageTimer <= 0) {
    if (gs.stageState === 'active') {
      gs.stageState = 'cooldown'; gs.stageTimer = STAGE_COOLDOWN_TIME;
      p1.stageCharge = 0; p2.stageCharge = 0;
    } else {
      gs.stageState = 'active'; gs.stageTimer = STAGE_ACTIVE_TIME;
      addParticles(gs, stageX, stageY, '#CC44FF', 20, 4);
      gs.stageFlash = 40;
    }
  }
  if (gs.stageFlash > 0) gs.stageFlash--;
}

// ── END ───────────────────────────────────────────────────────────────────────

function endGame(gs) {
  if (gs.gameEnded) return;
  gs.gameEnded = true;
  if (gs.p1.score > gs.p2.score) gs.winner = 1;
  else if (gs.p2.score > gs.p1.score) gs.winner = 2;
  else gs.winner = 0;
}

// ── TICK (called once per server frame, ~60fps) ───────────────────────────────

function tick(gs, inputs) {
  if (gs.gameEnded) return;

  // Clear per-tick effect buffers before processing this frame
  gs.newParticles = [];
  gs.newFloats = [];

  const inp1 = inputs[1] || { up:false, down:false, left:false, right:false, boost:false, justShoot:false };
  const inp2 = inputs[2] || { up:false, down:false, left:false, right:false, boost:false, justShoot:false };

  updatePlayer(gs, gs.p1, inp1);
  updatePlayer(gs, gs.p2, inp2);
  checkBump(gs, gs.p1, gs.p2);
  checkNotePickup(gs, gs.p1);
  checkNotePickup(gs, gs.p2);
  checkGoalScore(gs, gs.p1, 'p1');
  checkGoalScore(gs, gs.p2, 'p2');
  updateNotes(gs);
  updateStage(gs);

  gs.frameCount++;
  gs.noteSpawnTimer++;
  if (gs.noteSpawnTimer > 200) { spawnNote(gs); gs.noteSpawnTimer = 0; }

  // Decrement match timer once per 60 frames (~1 second at 60fps tick rate)
  if (gs.frameCount % 60 === 0 && gs.timeLeft > 0) {
    gs.timeLeft--;
    if (gs.timeLeft <= 0) endGame(gs);
  }
}

// ── SERIALIZE (safe plain object for Socket.IO) ───────────────────────────────

function serialize(gs) {
  const serP = (p) => ({
    x: p.x, y: p.y, angle: p.angle, score: p.score,
    carryingIdx: gs.notes.indexOf(p.carrying),
    amped: p.amped, boostTimer: p.boostTimer, boostCooldown: p.boostCooldown,
    shootCooldown: p.shootCooldown, bumpCooldown: p.bumpCooldown,
    stageCharge: p.stageCharge, onStage: p.onStage,
    pickupImmunity: p.pickupImmunity,
    knockVx: p.knockVx, knockVy: p.knockVy,
    trail: p.trail.slice(-6),
  });
  return {
    p1: serP(gs.p1),
    p2: serP(gs.p2),
    notes: gs.notes.map(n => ({
      x: n.x, y: n.y, vx: n.vx, vy: n.vy,
      carriedBy: n.carried ? n.carried.id : 0,
      bob: n.bob,
    })),
    timeLeft: gs.timeLeft,
    stageState: gs.stageState,
    stageTimer: gs.stageTimer,
    stageFlash: gs.stageFlash,
    // Only send effects generated THIS tick — clients accumulate and animate locally
    particles: gs.newParticles,
    floatingTexts: gs.newFloats,
    gameEnded: gs.gameEnded,
    winner: gs.winner,
  };
}

module.exports = { createGame, tick, serialize };
