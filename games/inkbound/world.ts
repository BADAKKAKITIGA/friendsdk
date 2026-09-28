/**
 * Inkbound — action platformer engine.
 *
 * Real player agency: full movement, double jump, dash, an ember slash, enemies
 * that chase and spit, hazards, motes, three zones and a gate to clear.
 * Pure simulation + canvas drawing. No wallet, no SDK calls in here.
 */
import { spriteFrame, type GenerationSprites, type SpriteFacing } from "@rarefriends/friendsdk/sprites";

export type Input = Readonly<{ left: boolean; right: boolean; jump: boolean; attack: boolean; dash: boolean }>;
export type Rect = Readonly<{ x: number; y: number; w: number; h: number }>;
export type Particle = Readonly<{ x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; hue: number; grav: number; kind: number }>;

type EnemySeed = Readonly<{ x: number; y: number; kind: "walker" | "flyer"; range?: number }>;
type MoteSeed = Readonly<{ x: number; y: number }>;

export type ZoneDef = Readonly<{
  name: string;
  tag: string;
  width: number;
  sky: readonly [string, string];
  ridge: string;
  ridgeNear: string;
  land: string;
  landTop: string;
  platforms: readonly Rect[];
  hazards: readonly Rect[];
  enemies: readonly EnemySeed[];
  motes: readonly MoteSeed[];
  spawn: readonly [number, number];
  gate: readonly [number, number];
  need: Readonly<{ kills: number; motes: number }>;
}>;

const GRAVITY = 2450;
const MAX_FALL = 1350;
const RUN = 360;
const ACCEL = 2600;
const FRICTION = 2400;
const JUMP = 830;
const DASH = 780;

export type Enemy = {
  x: number; y: number; w: number; h: number; vx: number; vy: number;
  kind: "walker" | "flyer"; hp: number; maxHp: number; phase: number;
  homeX: number; homeY: number; range: number; hit: number; alive: boolean; dir: number;
};

export type Mote = { x: number; y: number; taken: boolean; phase: number };

export type Sim = {
  x: number; y: number; vx: number; vy: number; w: number; h: number;
  onGround: boolean; jumps: number; facing: SpriteFacing; coyote: number; jumpHeld: boolean;
  hp: number; maxHp: number; ember: number; invuln: number; dashTimer: number; dashCool: number;
  attack: number; attackCool: number; combo: number; comboTimer: number;
  zone: number; time: number; kills: number; motes: number; motesTotal: number;
  aim: number; facingLeft: boolean; dead: boolean; cleared: boolean; hurt: number; boost: number;
  enemies: Enemy[]; motesList: Mote[]; zoneTime: number;
};

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function ground(z: number, width: number): Rect[] {
  return [{ x: -40, y: 560, w: width + 80, h: 200 }];
}

/** Three hand-shaped zones: ground, ledges, floating steps, hazards, enemies. */
function buildZones(): ZoneDef[] {
  const r = mulberry(20260928);
  const zones: ZoneDef[] = [];
  const shapes = [
    { name: "Ember Shore", tag: "Zone 1 · the shore", sky: ["#060911", "#22304F"] as const, ridge: "#243055", ridgeNear: "#141D33", land: "#4A3520", landTop: "#8A6134", width: 5200 },
    { name: "Ash Garden", tag: "Zone 2 · the garden", sky: ["#0A0A16", "#33254A"] as const, ridge: "#3A2B52", ridgeNear: "#1B1428", land: "#3E2A44", landTop: "#7A4E7E", width: 5600 },
    { name: "Hollow Gate", tag: "Zone 3 · the gate", sky: ["#120612", "#4A1E22"] as const, ridge: "#4B2029", ridgeNear: "#240F16", land: "#4A2018", landTop: "#A4442C", width: 6200 },
  ];
  shapes.forEach((shape, index) => {
    const platforms: Rect[] = [...ground(index, shape.width)];
    let x = 420;
    while (x < shape.width - 420) {
      const count = 1 + Math.floor(r() * 3);
      const baseY = 300 + Math.floor(r() * 4) * 62;
      for (let step = 0; step < count; step += 1) {
        platforms.push({ x: x + step * 150, y: baseY + (step % 2) * 44, w: 130, h: 26 });
      }
      x += 380 + Math.floor(r() * 240);
    }
    const hazards: Rect[] = [];
    for (let hx = 780; hx < shape.width - 420; hx += 620 + Math.floor(r() * 200)) {
      hazards.push({ x: hx, y: 544, w: 86 + Math.floor(r() * 40), h: 22 });
    }
    const enemies: EnemySeed[] = [];
    for (let ex = 560; ex < shape.width - 260; ex += 300 + Math.floor(r() * 220)) {
      if (r() > 0.45) enemies.push({ x: ex, y: 560, kind: "walker", range: 110 + Math.floor(r() * 110) });
      else enemies.push({ x: ex + 60, y: 372 + Math.floor(r() * 92), kind: "flyer", range: 120 + Math.floor(r() * 120) });
    }
    const motes: MoteSeed[] = [];
    for (let mx = 300; mx < shape.width - 300; mx += 190) {
      const low = r() > 0.35;
      motes.push({ x: mx + Math.floor(r() * 90), y: low ? 470 + Math.floor(r() * 74) : 300 + Math.floor(r() * 110) });
    }
    zones.push({ ...shape, platforms, hazards, enemies, motes, spawn: [120, 470], gate: [shape.width - 90, 470],
      need: { kills: Math.ceil(enemies.length * 0.6), motes: Math.ceil(motes.length * 0.4) } });
  });
  return zones;
}

export const ZONES = buildZones();

export function createSim(): Sim {
  return {
    x: 0, y: 0, vx: 0, vy: 0, w: 30, h: 46, onGround: false, jumps: 0, facing: "right", coyote: 0, jumpHeld: false,
    hp: 5, maxHp: 5, ember: 100, invuln: 0, dashTimer: 0, dashCool: 0,
    attack: 0, attackCool: 0, combo: 0, comboTimer: 0,
    zone: 0, time: 0, kills: 0, motes: 0, motesTotal: 0, aim: 0, facingLeft: false, dead: false, cleared: false, hurt: 0, boost: 0,
    enemies: [], motesList: [], zoneTime: 0,
  };
}

export function loadZone(sim: Sim, index: number) {
  const zone = ZONES[index];
  sim.zone = index;
  sim.enemies = zone.enemies.map(seed => ({
    x: seed.x, y: seed.y, w: seed.kind === "walker" ? 44 : 36, h: seed.kind === "walker" ? 42 : 36,
    vx: 0, vy: 0, kind: seed.kind, hp: seed.kind === "walker" ? 2 : 1, maxHp: seed.kind === "walker" ? 2 : 1,
    phase: seed.x, homeX: seed.x, homeY: seed.y, range: seed.range ?? 120, hit: 0, alive: true, dir: 1,
  }));
  sim.motesList = zone.motes.map(mote => ({ x: mote.x, y: mote.y, taken: false, phase: mote.x * 0.01 }));
  sim.x = zone.spawn[0];
  sim.y = zone.spawn[1];
  sim.vx = 0; sim.vy = 0; sim.onGround = false; sim.jumps = 0;
  sim.hp = Math.max(sim.hp, 3);
  sim.zoneTime = 0; sim.cleared = false; sim.hurt = 0; sim.dead = false;
}

function overlaps(a: Rect, b: Rect) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function update(sim: Sim, input: Input, dt: number) {
  const zone = ZONES[sim.zone];
  sim.time += dt; sim.zoneTime += dt;
  sim.invuln = Math.max(0, sim.invuln - dt);
  sim.dashCool = Math.max(0, sim.dashCool - dt);
  sim.dashTimer = Math.max(0, sim.dashTimer - dt);
  sim.attack = Math.max(0, sim.attack - dt);
  sim.attackCool = Math.max(0, sim.attackCool - dt);
  sim.comboTimer = Math.max(0, sim.comboTimer - dt);
  sim.hurt = Math.max(0, sim.hurt - dt);
  sim.boost = Math.max(0, sim.boost - dt);
  if (sim.comboTimer <= 0) sim.combo = 0;
  sim.ember = Math.min(100, sim.ember + dt * 6);
  if (sim.dead || sim.cleared) return;

  const boosted = sim.boost > 0 ? 1.35 : 1;
  const target = (input.right ? RUN * boosted : 0) - (input.left ? RUN * boosted : 0);
  if (sim.dashTimer > 0) {
    sim.vx = (sim.facingLeft ? -1 : 1) * DASH;
  } else {
    const rate = target === 0 ? FRICTION : ACCEL;
    sim.vx += Math.max(-rate * dt, Math.min(rate * dt, target - sim.vx));
  }
  if (input.right && !input.left) sim.facingLeft = false;
  if (input.left && !input.right) sim.facingLeft = true;
  sim.facing = sim.facingLeft ? "left" : "right";

  if (input.jump && !sim.jumpHeld && (sim.onGround || sim.coyote > 0 || sim.jumps > 0)) {
    if (sim.onGround || sim.coyote > 0) { sim.jumps = 1; sim.coyote = 0; } else { sim.jumps -= 1; }
    sim.vy = -JUMP;
    sim.onGround = false;
  }
  if (!input.jump && sim.vy < -180 && sim.jumpHeld) sim.vy *= 0.55;
  sim.jumpHeld = input.jump;

  if (input.dash && sim.dashCool <= 0 && sim.ember >= 18) {
    sim.dashTimer = 0.18; sim.dashCool = 0.55; sim.ember -= 18;
    sim.vx = (sim.facingLeft ? -1 : 1) * DASH;
  }
  if (input.attack && sim.attackCool <= 0 && sim.ember >= 8) {
    sim.attack = 0.16; sim.attackCool = 0.3; sim.ember -= 8;
  }

  sim.vy = Math.min(MAX_FALL, sim.vy + GRAVITY * dt);

  // Horizontal sweep, then resolve.
  sim.x += sim.vx * dt;
  const body = { x: sim.x - sim.w / 2, y: sim.y - sim.h, w: sim.w, h: sim.h };
  for (const platform of zone.platforms) {
    if (!overlaps(body, platform)) continue;
    if (sim.vx > 0) sim.x = platform.x - sim.w / 2;
    else if (sim.vx < 0) sim.x = platform.x + platform.w + sim.w / 2;
    sim.vx = 0;
    body.x = sim.x - sim.w / 2;
  }

  // Vertical sweep, then resolve.
  sim.y += sim.vy * dt;
  body.y = sim.y - sim.h;
  body.x = sim.x - sim.w / 2;
  const wasFalling = sim.vy >= 0;
  sim.onGround = false;
  for (const platform of zone.platforms) {
    if (!overlaps(body, platform)) continue;
    if (wasFalling && body.y + body.h - sim.vy * dt <= platform.y + 14) {
      sim.y = platform.y;
      sim.vy = 0;
      sim.onGround = true;
      sim.jumps = 1;
    } else if (!wasFalling) {
      sim.y = platform.y + platform.h + sim.h;
      sim.vy = 40;
    }
    body.y = sim.y - sim.h;
  }
  sim.coyote = sim.onGround ? 0.1 : Math.max(0, sim.coyote - dt);
  if (sim.y > zone.platforms[0].y + 260) hurt(sim, 1, true);

  // The slash hitbox rides just in front of the Friend.
  const slash: Rect | null = sim.attack > 0
    ? { x: sim.facingLeft ? sim.x - 30 - 54 : sim.x + 30, y: sim.y - 58, w: 54, h: 46 }
    : null;

  for (const enemy of sim.enemies) {
    if (!enemy.alive) continue;
    enemy.hit = Math.max(0, enemy.hit - dt);
    if (enemy.kind === "walker") {
      enemy.x += enemy.dir * 68 * dt;
      if (Math.abs(enemy.x - enemy.homeX) > enemy.range) enemy.dir *= -1;
      enemy.y = enemy.homeY;
    } else {
      enemy.phase += dt * 1.5;
      const chase = Math.max(-1, Math.min(1, (sim.x - enemy.x) / 260));
      enemy.x += (chase * 52 + Math.sin(enemy.phase) * 22) * dt * 2.2;
      enemy.y = enemy.homeY + Math.sin(enemy.phase) * 34;
      if (Math.abs(enemy.x - enemy.homeX) > enemy.range + 130) enemy.x -= Math.sign(enemy.x - enemy.homeX) * 40 * dt;
    }
    const box: Rect = { x: enemy.x - enemy.w / 2, y: enemy.y - enemy.h, w: enemy.w, h: enemy.h };
    if (slash && enemy.hit <= 0 && overlaps(slash, box)) {
      enemy.hp -= sim.boost > 0 ? 2 : 1;
      enemy.hit = 0.28;
      sim.vx = (enemy.x < sim.x ? 1 : -1) * 150;
      if (enemy.hp <= 0) {
        enemy.alive = false;
        sim.kills += 1;
        sim.combo += 1;
        sim.comboTimer = 2.4;
        sim.ember = Math.min(100, sim.ember + 14);
        burst(sim, enemy.x, enemy.y - 20, 18, 1, 24);
      }
    } else if (enemy.hit <= 0 && overlaps({ x: sim.x - sim.w / 2, y: sim.y - sim.h, w: sim.w, h: sim.h }, box)) {
      hurt(sim, 1, false);
      sim.vx = (enemy.x < sim.x ? 1 : -1) * 260;
    }
  }

  for (const hazard of zone.hazards) {
    if (overlaps({ x: sim.x - sim.w / 2 + 4, y: sim.y - 10, w: sim.w - 8, h: 12 }, hazard)) hurt(sim, 1, false);
  }
  for (const mote of sim.motesList) {
    if (mote.taken) continue;
    mote.phase += dt * 2;
    if (Math.hypot(mote.x - sim.x, mote.y - (sim.y - 24)) < 42) {
      mote.taken = true;
      sim.motes += 1;
      sim.ember = Math.min(100, sim.ember + 12);
    }
  }

  if (sim.x >= zone.gate[0] && gateOpen(sim)) sim.cleared = true;
  if (sim.x > zone.gate[0] + 40) sim.x = zone.gate[0] + 40;
  sim.x = Math.max(-20, Math.min(zone.width + 60, sim.x));
}

/** The gate stays sealed until enough shadows are destroyed and motes gathered. */
export function gateOpen(sim: Sim) {
  const need = ZONES[sim.zone].need;
  return sim.kills >= need.kills && sim.motes >= need.motes;
}

function hurt(sim: Sim, amount: number, pit: boolean) {
  if (sim.invuln > 0 && !pit) return;
  sim.hp -= amount;
  sim.invuln = 1.5;
  sim.hurt = 0.5;
  sim.combo = 0;
  if (pit) { sim.y = ZONES[sim.zone].spawn[1]; sim.vy = 0; sim.x = Math.max(sim.x - 120, 60); }
  if (sim.hp <= 0) { sim.hp = 0; sim.dead = true; }
}

export function burst(sim: Sim, x: number, y: number, amount: number, power: number, hue: number) {
  const r = mulberry((Math.random() * 1e9) | 0);
  for (let index = 0; index < amount; index += 1) {
    particles.push({
      x: x + (r() - 0.5) * 26, y: y + (r() - 0.5) * 26,
      vx: (r() - 0.5) * 320 * power, vy: (r() - 0.8) * 300 * power,
      life: 0, max: 0.4 + r() * 0.7, size: 2 + r() * 3.4, hue: hue + r() * 26, grav: 640, kind: 1,
    });
  }
}

let particles: Particle[] = [];
export function clearParticles() { particles = []; }

/* ---------------------------------------------------------------- rendering */

const SPRITE_PIXEL = 6;
type Sprite = Readonly<{ idle: readonly HTMLCanvasElement[]; walk: readonly HTMLCanvasElement[] }>;

function paintFrame(frame: Readonly<{ rows: readonly string[] }>, colour: string, halo: string) {
  const pad = 2, scale = SPRITE_PIXEL;
  const size = (16 + pad * 2) * scale;
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const cell = scale;
  const round = (x: number, y: number, fill: string, inset: number) => {
    ctx.fillStyle = fill;
    const px = pad * scale + x * cell + inset, py = pad * scale + y * cell + inset;
    const box = cell - inset * 2, radius = Math.max(0, box * 0.32);
    ctx.beginPath();
    ctx.moveTo(px + radius, py);
    ctx.arcTo(px + box, py, px + box, py + box, radius);
    ctx.arcTo(px + box, py + box, px, py + box, radius);
    ctx.arcTo(px, py + box, px, py, radius);
    ctx.arcTo(px, py, px + box, py, radius);
    ctx.closePath(); ctx.fill();
  };
  for (let y = 0; y < 16; y += 1) {
    const row = frame.rows[y] ?? "";
    for (let x = 0; x < 16; x += 1) {
      if (row[x] !== "#") continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx, ny = y + dy;
        if (ny < 0 || ny > 15 || nx < 0 || nx > 15 || (frame.rows[ny] ?? "")[nx] === "#") continue;
        round(nx, ny, halo, cell * 0.22);
      }
    }
  }
  for (let y = 0; y < 16; y += 1) {
    const row = frame.rows[y] ?? "";
    for (let x = 0; x < 16; x += 1) if (row[x] === "#") round(x, y, colour, 0);
  }
  return canvas;
}

function buildSprite(sprites: GenerationSprites, colour: string, halo: string): Sprite {
  const clip = (walking: boolean, facing: SpriteFacing) => {
    const frames: HTMLCanvasElement[] = [];
    for (let frame = 0; frame < 8; frame += 1) frames.push(paintFrame(spriteFrame(sprites, facing, walking, frame).frame, colour, halo));
    return frames;
  };
  return { idle: clip(false, "right"), walk: clip(true, "right") };
}

export function paintPortrait(canvas: HTMLCanvasElement | null, sprites: GenerationSprites | null) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const box = Math.min(canvas.clientWidth || 150, 240);
  canvas.width = Math.round(box * ratio); canvas.height = Math.round(box * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, box, box);
  if (!sprites) return;
  const rows = spriteFrame(sprites, "down", false, 0).frame.rows;
  const scale = Math.max(1, Math.floor((box - 30) / 16));
  const left = (box - 16 * scale) / 2, top = (box - 16 * scale) / 2;
  ctx.shadowColor = "rgba(255,107,53,0.5)"; ctx.shadowBlur = 20;
  for (let y = 0; y < 16; y += 1) for (let x = 0; x < 16; x += 1) {
    if ((rows[y] ?? "")[x] !== "#") continue;
    ctx.fillStyle = "#F3E9D2";
    ctx.fillRect(left + x * scale, top + y * scale, scale - 1, scale - 1);
  }
  ctx.shadowBlur = 0;
}

export type Camera = { x: number; y: number };

export type Renderer = Readonly<{
  resize(): void;
  draw(sim: Sim, sprites: GenerationSprites | null, elapsed: number, shake: number, flash: number, reduced: boolean): void;
  dispose(): void;
}>;

export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  const ctx = canvas.getContext("2d");
  let atlas: Sprite | null = null, atlasKey = "";
  let width = 960, height = 600;
  const stars = Array.from({ length: 90 }, (_, i) => { const r = mulberry(400 + i); return { x: r() * 1600, y: r() * 320, r: r() * 1.4 + 0.3, p: r() * 6.3 }; });
  const hills = Array.from({ length: 60 }, (_, i) => 40 + Math.sin(i * 0.7) * 30 + mulberry(70 + i)() * 40);
  const reeds = Array.from({ length: 150 }, (_, i) => { const r = mulberry(2600 + i); return { x: r() * 3600, h: 40 + r() * 90, lean: r() * 16 - 8, warm: r() > 0.5 }; });
  const trees = Array.from({ length: 90 }, (_, i) => { const r = mulberry(1300 + i); return { x: r() * 4200, h: 130 + r() * 190, w: 30 + r() * 26, sway: r() * 6.3 }; });
  const camera: Camera = { x: 0, y: 0 };

  function ensureAtlas(sprites: GenerationSprites) {
    if (atlasKey === sprites.cacheKey) return;
    atlas = buildSprite(sprites, "#F3E9D2", "rgba(8,10,20,0.95)");
    atlasKey = sprites.cacheKey;
  }

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    width = Math.max(320, Math.round(rect.width || 960));
    height = Math.max(220, Math.round(rect.height || 600));
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    ctx?.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function draw(sim: Sim, sprites: GenerationSprites | null, elapsed: number, shake: number, flash: number, reduced: boolean) {
    if (!ctx) return;
    if (sprites) ensureAtlas(sprites);
    const zone = ZONES[sim.zone];
    const targetX = sim.x - width * 0.38;
    const targetY = sim.y - height * 0.62;
    camera.x += (targetX - camera.x) * 0.11;
    camera.y += (Math.max(-40, Math.min(120, targetY)) - camera.y) * 0.07;
    const camX = Math.round(camera.x), camY = Math.round(camera.y);

    ctx.save();
    if (!reduced && shake > 0) ctx.translate((Math.random() - 0.5) * shake * 2, (Math.random() - 0.5) * shake * 2);

    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, zone.sky[0]); sky.addColorStop(1, zone.sky[1]);
    ctx.fillStyle = sky; ctx.fillRect(0, 0, width, height);

    for (const star of stars) {
      const x = star.x - camX * 0.06 % 1600;
      const sx = ((x % 1600) + 1600) % 1600 - 200;
      ctx.globalAlpha = 0.35 + Math.abs(Math.sin(elapsed * 0.8 + star.p)) * 0.5;
      ctx.fillStyle = "#DCE6FF";
      ctx.beginPath(); ctx.arc(sx, star.y - camY * 0.05, star.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    const moonX = width * 0.78 - camX * 0.03, moonY = 130 - camY * 0.04;
    const halo = ctx.createRadialGradient(moonX, moonY, 8, moonX, moonY, 210);
    halo.addColorStop(0, "rgba(255,255,255,0.42)"); halo.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = halo; ctx.fillRect(moonX - 260, moonY - 260, 520, 520);
    ctx.fillStyle = "#F6EFE0";
    ctx.beginPath(); ctx.arc(moonX, moonY, 42, 0, Math.PI * 2); ctx.fill();

    const ridge = (factor: number, baseY: number, colour: string, scale: number) => {
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.moveTo(-60, height);
      for (let x = -60; x <= width + 60; x += 56) {
        const world = ((x + camX * factor) / 56) % hills.length;
        const h = hills[(Math.floor(world) + hills.length) % hills.length];
        ctx.lineTo(x, baseY - camY * factor * 0.5 - h * scale);
      }
      ctx.lineTo(width + 60, height); ctx.closePath(); ctx.fill();
    };
    ridge(0.14, 430, zone.ridge, 1.5);
    ridge(0.32, 486, zone.ridgeNear, 1.0);

    // Backdrop trees give the air some depth behind the ledges.
    for (const tree of trees) {
      const x = ((tree.x - camX * 0.5) % 4200 + 4200) % 4200 - 140;
      const baseY = 560 - camY * 0.5;
      const sway = Math.sin(elapsed * 0.6 + tree.sway) * 5;
      ctx.fillStyle = "rgba(8,10,20,0.72)";
      ctx.beginPath();
      ctx.moveTo(x - tree.w / 2, baseY);
      ctx.lineTo(x - tree.w / 2 + 6, baseY - tree.h * 0.5);
      ctx.lineTo(x + sway, baseY - tree.h);
      ctx.lineTo(x + tree.w / 2 - 6, baseY - tree.h * 0.5);
      ctx.lineTo(x + tree.w / 2, baseY);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "rgba(255,140,70,0.12)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + tree.w / 2 - 6, baseY - tree.h * 0.5);
      ctx.lineTo(x + sway, baseY - tree.h);
      ctx.stroke();
    }
    // Platforms
    for (const platform of zone.platforms) {
      const x = platform.x - camX, y = platform.y - camY;
      if (x + platform.w < -40 || x > width + 40) continue;
      const grad = ctx.createLinearGradient(0, y, 0, y + Math.min(platform.h, 120));
      grad.addColorStop(0, zone.landTop); grad.addColorStop(0.22, zone.land); grad.addColorStop(1, "#0C0A10");
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, platform.w, platform.h);
      ctx.fillStyle = "rgba(255,220,170,0.5)";
      ctx.fillRect(x, y, platform.w, 3);
      ctx.fillStyle = "rgba(0,0,0,0.28)";
      for (let n = x + 14; n < x + platform.w - 8; n += 34) ctx.fillRect(n, y + 12, 20, 3);
    }
    // Hazards
    for (const hazard of zone.hazards) {
      const x = hazard.x - camX, y = hazard.y - camY;
      if (x + hazard.w < -40 || x > width + 40) continue;
      for (let n = 0; n < hazard.w; n += 14) {
        ctx.fillStyle = "#E23E57";
        ctx.beginPath();
        ctx.moveTo(x + n, y + hazard.h + 18);
        ctx.lineTo(x + n + 7, y - 4);
        ctx.lineTo(x + n + 14, y + hazard.h + 18);
        ctx.closePath(); ctx.fill();
      }
      const glow = ctx.createLinearGradient(0, y - 20, 0, y + 30);
      glow.addColorStop(0, "rgba(226,62,87,0.4)"); glow.addColorStop(1, "rgba(226,62,87,0)");
      ctx.fillStyle = glow; ctx.fillRect(x, y - 20, hazard.w, 50);
    }
    // Motes
    for (const mote of sim.motesList) {
      if (mote.taken) continue;
      const x = mote.x - camX, y = mote.y - camY + Math.sin(mote.phase) * 6;
      if (x < -40 || x > width + 40) continue;
      const g = ctx.createRadialGradient(x, y, 1, x, y, 26);
      g.addColorStop(0, "rgba(255,200,87,0.95)"); g.addColorStop(1, "rgba(255,200,87,0)");
      ctx.fillStyle = g; ctx.fillRect(x - 28, y - 28, 56, 56);
      ctx.fillStyle = "#FFF0C2";
      ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
    }
    // Enemies
    for (const enemy of sim.enemies) {
      if (!enemy.alive) continue;
      const x = enemy.x - camX, y = enemy.y - camY;
      if (x < -80 || x > width + 80) continue;
      const flash = enemy.hit > 0;
      if (enemy.kind === "walker") {
        ctx.fillStyle = flash ? "#FFFFFF" : "#1B1030";
        ctx.beginPath();
        ctx.moveTo(x - 22, y);
        ctx.lineTo(x - 12, y - 38);
        ctx.lineTo(x + 12, y - 38);
        ctx.lineTo(x + 22, y);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = "#E23E57";
        ctx.beginPath(); ctx.arc(x - 8, y - 26, 4.4, 0, Math.PI * 2); ctx.arc(x + 8, y - 26, 4.4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(226,62,87,0.25)";
        ctx.fillRect(x - 16, y - 46 - (enemy.hp - 1) * 8, 32, 3);
      } else {
        const g = ctx.createRadialGradient(x, y - 14, 2, x, y - 14, 34);
        g.addColorStop(0, flash ? "rgba(255,255,255,0.95)" : "rgba(76,201,240,0.9)");
        g.addColorStop(1, "rgba(76,201,240,0)");
        ctx.fillStyle = g; ctx.fillRect(x - 44, y - 60, 88, 88);
        ctx.fillStyle = flash ? "#FFFFFF" : "#4CC9F0";
        ctx.beginPath(); ctx.arc(x, y - 16, 13, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#08202E";
        ctx.beginPath(); ctx.arc(x - 4, y - 18, 2.6, 0, Math.PI * 2); ctx.arc(x + 4, y - 18, 2.6, 0, Math.PI * 2); ctx.fill();
      }
    }
    // Foreground reeds so the bottom of the frame is never empty
    for (const reed of reeds) {
      const x = ((reed.x - camX * 1.16) % 3600 + 3600) % 3600 - 120;
      const baseY = height + 10;
      ctx.strokeStyle = reed.warm ? "rgba(20,14,10,0.95)" : "rgba(14,12,20,0.95)";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(x, baseY);
      ctx.quadraticCurveTo(x + reed.lean, baseY - reed.h * 0.6, x + reed.lean * 2.4 + Math.sin(elapsed * 0.8 + reed.x) * 4, baseY - reed.h);
      ctx.stroke();
      ctx.strokeStyle = reed.warm ? "rgba(255,140,70,0.18)" : "rgba(120,160,210,0.14)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(x + reed.lean, baseY - reed.h * 0.6);
      ctx.lineTo(x + reed.lean * 2.4, baseY - reed.h);
      ctx.stroke();
    }

    // Ground haze
    const haze = ctx.createLinearGradient(0, 470 - camY, 0, 620 - camY);
    haze.addColorStop(0, "rgba(255,140,70,0)");
    haze.addColorStop(1, "rgba(255,140,70,0.14)");
    ctx.fillStyle = haze;
    ctx.fillRect(0, 470 - camY, width, 160);

    // Exit gate
    const gx = zone.gate[0] - camX, gy = zone.gate[1] - camY;
    if (gx > -120 && gx < width + 200) {
      const open = gateOpen(sim);
      const pulse = open ? 0.6 + Math.abs(Math.sin(elapsed * 2.4)) * 0.4 : 0.18;
      const tint = open ? "255,200,87" : "150,160,190";
      const col = ctx.createLinearGradient(gx, gy - 300, gx, gy + 20);
      col.addColorStop(0, `rgba(${tint},0)`);
      col.addColorStop(1, `rgba(${tint},${0.55 * pulse})`);
      ctx.fillStyle = col; ctx.fillRect(gx - 58, gy - 300, 116, 320);
      ctx.fillStyle = "#241A2E";
      ctx.fillRect(gx - 62, gy - 236, 18, 236); ctx.fillRect(gx + 44, gy - 236, 18, 236);
      ctx.fillStyle = `rgba(${tint},${0.95 * pulse})`;
      ctx.fillRect(gx - 66, gy - 256, 132, 20);
      if (!open) {
        ctx.fillStyle = "rgba(200,210,235,0.85)";
        ctx.font = "bold 13px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.fillText("SEALED", gx, gy - 268);
        ctx.textAlign = "left";
      }
    }
    // Particles
    particles = particles.filter(p => {
      const life = p.life + 0.016;
      if (life >= p.max) return false;
      const next = { ...p, x: p.x + p.vx * 0.016, y: p.y + p.vy * 0.016, vy: p.vy + p.grav * 0.016, life };
      Object.assign(p, next);
      const t = 1 - life / p.max;
      ctx.globalAlpha = t * 0.92;
      ctx.fillStyle = `hsl(${p.hue} 95% ${54 + t * 24}%)`;
      ctx.beginPath(); ctx.arc(p.x - camX, p.y - camY, p.size * (0.5 + t * 0.7), 0, Math.PI * 2); ctx.fill();
      return true;
    });
    ctx.globalAlpha = 1;

    // Player
    if (atlas) {
      const feetX = sim.x - camX, feetY = sim.y - camY;
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = "#000";
      ctx.beginPath(); ctx.ellipse(feetX, feetY + 3, 18, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      const moving = Math.abs(sim.vx) > 40 && sim.onGround;
      const set = moving ? atlas.walk : atlas.idle;
      const frameIndex = Math.floor(elapsed * (moving ? 12 : 3.4)) % 8;
      const blink = sim.invuln > 0 && Math.floor(elapsed * 18) % 2 === 0 ? 0.4 : 1;
      const beat = Math.sin(elapsed * (moving ? 14 : 3));
      const sy = 1 + beat * 0.035, sx = 2 - sy;
      ctx.save();
      ctx.globalAlpha = blink;
      ctx.translate(feetX, feetY);
      ctx.scale(sim.facingLeft ? -sx : sx, sy);
      const node = set[frameIndex];
      ctx.drawImage(node, -node.width / 2, -node.height + 6);
      ctx.restore();
      // Slash arc
      if (sim.attack > 0) {
        const dir = sim.facingLeft ? -1 : 1;
        ctx.save();
        ctx.translate(feetX, feetY - 30);
        ctx.globalCompositeOperation = "lighter";
        const arc = ctx.createRadialGradient(0, 0, 10, 0, 0, 66);
        arc.addColorStop(0, "rgba(255,231,196,0.85)");
        arc.addColorStop(0.5, "rgba(255,107,53,0.5)");
        arc.addColorStop(1, "rgba(255,107,53,0)");
        ctx.fillStyle = arc;
        ctx.beginPath();
        ctx.arc(0, 0, 66, dir > 0 ? -1.15 : Math.PI - 1.15, dir > 0 ? 1.15 : Math.PI + 1.15);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      if (sim.boost > 0) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        const aura = ctx.createRadialGradient(feetX, feetY - 30, 6, feetX, feetY - 30, 86);
        aura.addColorStop(0, "rgba(255,107,53,0.4)"); aura.addColorStop(1, "rgba(255,107,53,0)");
        ctx.fillStyle = aura; ctx.fillRect(feetX - 100, feetY - 130, 200, 170);
        ctx.restore();
      }
    }

    const grade = ctx.createLinearGradient(0, 0, 0, height);
    grade.addColorStop(0, "rgba(255,107,53,0.05)");
    grade.addColorStop(1, "rgba(4,5,12,0.4)");
    ctx.fillStyle = grade; ctx.fillRect(0, 0, width, height);
    const vig = ctx.createRadialGradient(width / 2, height / 2, height * 0.36, width / 2, height / 2, height * 1.05);
    vig.addColorStop(0, "rgba(0,0,0,0)"); vig.addColorStop(1, "rgba(0,0,0,0.6)");
    ctx.fillStyle = vig; ctx.fillRect(0, 0, width, height);
    if (sim.hurt > 0) { ctx.fillStyle = `rgba(226,62,87,${sim.hurt * 0.5})`; ctx.fillRect(0, 0, width, height); }
    if (flash > 0.01) { ctx.fillStyle = `rgba(255,231,196,${Math.min(0.85, flash)})`; ctx.fillRect(0, 0, width, height); }
    ctx.restore();
  }

  return { resize, draw, dispose() { particles = []; atlas = null; atlasKey = ""; } };
}
