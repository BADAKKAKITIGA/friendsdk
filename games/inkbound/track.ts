/**
 * Inkbound canvas renderer. Pure drawing only: the React component owns game
 * state, the SDK economy client and audio. No wallet or chain access here.
 */
import { spriteFrame, type GenerationSprites, type SpriteFacing } from "@rarefriends/friendsdk/sprites";

export type TrackView = Readonly<{
  progress: number;
  ghostProgress: number;
  speed: number;
  momentum: number;
  running: boolean;
  finished: boolean;
  shake: number;
  flash: number;
  heat: number;
  reducedMotion: boolean;
}>;

type P = Readonly<{ x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; hue: number; kind: number }>;
type Sprite = Readonly<{ frames: readonly HTMLCanvasElement[] }>;

const LOGICAL_WIDTH = 960;
const LOGICAL_HEIGHT = 640;
const GROUND_Y = 452;
const TRACK_LENGTH = 96;
const PX_PER_UNIT = 26;
const PLAYER_X = 268;
const SPRITE_PIXEL = 6;

const PALETTE = {
  skyTop: "#080B16",
  skyLow: "#1A2438",
  sun: "#FF6B35",
  ridgeFar: "#18213A",
  ridgeMid: "#141C31",
  ridgeNear: "#10182A",
  track: "#2A2118",
  trackEdge: "#3A2C1E",
  ember: "#FF6B35",
  gold: "#FFC857",
  cyan: "#4CC9F0",
  paper: "#F3E9D2",
} as const;

/** Deterministic PRNG so the scenery is identical on every device and reload. */
function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function ridge(seed: number, count: number, min: number, max: number) {
  const random = mulberry(seed);
  const points: number[] = [];
  let value = (min + max) / 2;
  for (let index = 0; index < count; index += 1) {
    value = Math.max(min, Math.min(max, value + (random() - 0.5) * (max - min) * 0.55));
    points.push(value);
  }
  return points;
}

function smooth(points: readonly number[], x: number) {
  const span = 120;
  const index = ((x % points.length) + points.length) % points.length;
  const a = points[Math.floor(index)];
  const b = points[Math.floor(index) + 1] ?? points[0];
  const t = index - Math.floor(index);
  const eased = t * t * (3 - 2 * t);
  return a + (b - a) * eased + Math.sin(x / span) * 6;
}

/** Paint one 16×16 chain bitmap into an offscreen canvas with halo + rounded pixels. */
function paintSprite(frame: Readonly<{ rows: readonly string[] }>, colour: string, halo: string, scale: number) {
  const pad = 2;
  const size = (16 + pad * 2) * scale;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const cell = scale;
  const round = (x: number, y: number, fill: string, inset: number) => {
    ctx.fillStyle = fill;
    const px = pad * scale + x * cell + inset;
    const py = pad * scale + y * cell + inset;
    const box = cell - inset * 2;
    const radius = Math.max(0, box * 0.32);
    ctx.beginPath();
    ctx.moveTo(px + radius, py);
    ctx.arcTo(px + box, py, px + box, py + box, radius);
    ctx.arcTo(px + box, py + box, px, py + box, radius);
    ctx.arcTo(px, py + box, px, py, radius);
    ctx.arcTo(px, py, px + box, py, radius);
    ctx.closePath();
    ctx.fill();
  };
  for (let y = 0; y < frame.rows.length; y += 1) {
    const row = frame.rows[y] ?? "";
    for (let x = 0; x < row.length; x += 1) {
      if (row[x] !== "#") continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (ny < 0 || ny > 15 || nx < 0 || nx > 15 || (frame.rows[ny] ?? "")[nx] === "#") continue;
        round(nx, ny, halo, cell * 0.22);
      }
    }
  }
  for (let y = 0; y < frame.rows.length; y += 1) {
    const row = frame.rows[y] ?? "";
    for (let x = 0; x < row.length; x += 1) {
      if (row[x] === "#") round(x, y, colour, 0);
    }
  }
  return canvas;
}

function buildSprite(sprites: GenerationSprites, colour: string, halo: string, facing: SpriteFacing = "right"): Sprite {
  const frames: HTMLCanvasElement[] = [];
  for (let frame = 0; frame < 8; frame += 1) {
    frames.push(paintSprite(spriteFrame(sprites, facing, true, frame).frame, colour, halo, SPRITE_PIXEL));
  }
  return { frames };
}

export type TrackRenderer = Readonly<{
  resize(): void;
  draw(view: TrackView, sprites: GenerationSprites | null, elapsed: number): void;
  burst(kind: "dust" | "embers" | "spark", amount: number, power: number): void;
  dispose(): void;
}>;

export function createTrackRenderer(canvas: HTMLCanvasElement): TrackRenderer {
  const ctx = canvas.getContext("2d");
  const far = ridge(11, 40, 90, 210);
  const mid = ridge(29, 34, 40, 150);
  const near = ridge(53, 28, 10, 90);
  const tufts = Array.from({ length: 90 }, (_, index) => {
    const random = mulberry(100 + index);
    return { x: random() * 1400, h: 10 + random() * 26, lean: random() * 8 - 4, warm: random() > 0.62 };
  });
  const stars = Array.from({ length: 70 }, (_, index) => {
    const random = mulberry(700 + index);
    return { x: random() * LOGICAL_WIDTH, y: random() * 300, r: random() * 1.1 + 0.35, phase: random() * 6.28 };
  });
  const clouds = Array.from({ length: 9 }, (_, index) => {
    const random = mulberry(1400 + index);
    return { x: random() * 2200, y: 96 + random() * 210, w: 190 + random() * 260, h: 20 + random() * 26, a: 0.1 + random() * 0.14, depth: 0.04 + random() * 0.07 };
  });
  const torii = Array.from({ length: 4 }, (_, index) => {
    const random = mulberry(2200 + index);
    return { x: 260 + index * 620 + random() * 180, h: 92 + random() * 46, scale: 0.85 + random() * 0.4 };
  });
  let particles: P[] = [];
  let trail: Readonly<{ x: number; y: number; life: number }>[] = [];
  let atlas: Sprite | null = null;
  let echo: Sprite | null = null;
  let atlasKey = "";
  let width = LOGICAL_WIDTH;
  let height = LOGICAL_HEIGHT;

  function spawn(kind: P["kind"], amount: number, power: number, originX: number, originY: number) {
    if (particles.length > 620) return;
    const random = mulberry((Math.random() * 1e9) | 0);
    for (let index = 0; index < amount; index += 1) {
      const spread = kind === 2 ? 1 : 0.5;
      particles.push({
        x: originX + (random() - 0.5) * 26,
        y: originY + (random() - 0.5) * 20,
        vx: (random() - 0.5) * 190 * spread - (kind === 0 ? 90 : 0) * power,
        vy: (kind === 0 ? -40 - random() * 70 : -90 - random() * 210) * (kind === 1 ? 1 : 0.6) * Math.max(0.4, power),
        life: 0,
        max: kind === 0 ? 0.42 + random() * 0.3 : 0.6 + random() * 0.9,
        size: kind === 0 ? 2 + random() * 2.4 : 1.6 + random() * 2.6,
        hue: kind === 1 ? 20 + random() * 26 : kind === 2 ? 40 + random() * 16 : 30 + random() * 16,
        kind,
      });
    }
  }

  function ensureAtlas(sprites: GenerationSprites) {
    if (atlasKey === sprites.cacheKey) return;
    atlas = buildSprite(sprites, PALETTE.paper, "rgba(9,12,22,0.9)");
    echo = buildSprite(sprites, PALETTE.cyan, "rgba(6,20,30,0.7)");
    atlasKey = sprites.cacheKey;
  }

  /** A pre-tinted atlas keeps the Echo silhouette clean — no compositing over the scenery. */
  function renderSpriteAt(node: HTMLCanvasElement, x: number, y: number, scaleX: number, scaleY: number, alpha: number) {
    ctx!.save();
    ctx!.globalAlpha = alpha;
    ctx!.translate(x, y);
    ctx!.scale(scaleX, scaleY);
    ctx!.drawImage(node, -node.width / 2, -node.height + 7);
    ctx!.restore();
  }

  function drawRidge(points: readonly number[], scroll: number, baseY: number, amplitude: number, colour: string, step = 56) {
    ctx!.fillStyle = colour;
    ctx!.beginPath();
    ctx!.moveTo(-80, height);
    for (let x = -80; x <= width + 80; x += step) {
      const worldX = (x + scroll) / step;
      ctx!.lineTo(x, baseY - smooth(points, worldX) * amplitude * 0.01);
    }
    ctx!.lineTo(width + 80, height);
    ctx!.closePath();
    ctx!.fill();
  }

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(320, Math.round(rect.width || LOGICAL_WIDTH));
    const h = Math.max(200, Math.round(rect.height || LOGICAL_HEIGHT));
    canvas.width = Math.round(w * ratio);
    canvas.height = Math.round(h * ratio);
    width = w;
    height = h;
    ctx?.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function draw(view: TrackView, sprites: GenerationSprites | null, elapsed: number) {
    if (!ctx) return;
    if (sprites) ensureAtlas(sprites);
    const ground = height * (GROUND_Y / LOGICAL_HEIGHT);
    const scroll = view.progress * TRACK_LENGTH * PX_PER_UNIT;
    const reduced = view.reducedMotion;

    ctx.save();
    if (!reduced && view.shake > 0) {
      ctx.translate((Math.random() - 0.5) * view.shake * 2, (Math.random() - 0.5) * view.shake * 2);
    }

    // Sky
    const sky = ctx.createLinearGradient(0, 0, 0, ground);
    sky.addColorStop(0, PALETTE.skyTop);
    sky.addColorStop(1, PALETTE.skyLow);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    // Stars + ember sun
    for (const star of stars) {
      const twinkle = reduced ? 0.6 : 0.35 + Math.abs(Math.sin(elapsed * 0.9 + star.phase)) * 0.65;
      ctx.globalAlpha = twinkle * 0.7;
      ctx.fillStyle = "#DCE6FF";
      ctx.beginPath();
      ctx.arc(star.x * (width / LOGICAL_WIDTH), star.y, star.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    const sunX = width * 0.74;
    const sunY = ground * 0.34;
    const glow = ctx.createRadialGradient(sunX, sunY, 8, sunX, sunY, 220 + view.heat * 90);
    glow.addColorStop(0, `rgba(255,107,53,${0.5 + view.heat * 0.35})`);
    glow.addColorStop(0.35, "rgba(255,107,53,0.16)");
    glow.addColorStop(1, "rgba(255,107,53,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(sunX - 320, sunY - 320, 640, 640);
    ctx.fillStyle = "#FFB37A";
    ctx.beginPath();
    ctx.arc(sunX, sunY, 46, 0, Math.PI * 2);
    ctx.fill();

    // Slow ink-wash cloud bands keep the sky alive without raising its contrast
    for (const cloud of clouds) {
      const drift = cloud.x - scroll * cloud.depth;
      const x = ((drift % 2400) + 2400) % 2400 - 240;
      const band = ctx.createLinearGradient(x, cloud.y, x + cloud.w, cloud.y);
      band.addColorStop(0, "rgba(243,233,210,0)");
      band.addColorStop(0.4, `rgba(243,233,210,${cloud.a})`);
      band.addColorStop(1, "rgba(243,233,210,0)");
      ctx.fillStyle = band;
      ctx.beginPath();
      ctx.ellipse(x + cloud.w / 2, cloud.y, cloud.w / 2, cloud.h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Parallax ridges
    drawRidge(far, scroll * 0.14, ground - 60, 1.0, PALETTE.ridgeFar, 64);
    drawRidge(mid, scroll * 0.32, ground - 18, 0.72, PALETTE.ridgeMid, 52);
    drawRidge(near, scroll * 0.58, ground + 6, 0.42, PALETTE.ridgeNear, 44);

    // Distant gate posts give the world an identity and a sense of travel
    for (const post of torii) {
      const x = ((post.x - scroll * 0.44) % 2480 + 2480) % 2480 - 160;
      const top = ground - post.h * post.scale;
      const spread = 34 * post.scale;
      ctx.strokeStyle = "#1E2740";
      ctx.lineWidth = 5 * post.scale;
      ctx.lineCap = "butt";
      ctx.beginPath();
      ctx.moveTo(x - spread, top);
      ctx.lineTo(x - spread, ground);
      ctx.moveTo(x + spread, top);
      ctx.lineTo(x + spread, ground);
      ctx.moveTo(x - spread - 12, top + 9 * post.scale);
      ctx.lineTo(x + spread + 12, top + 9 * post.scale);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,140,70,0.26)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(x - spread - 12, top + 9 * post.scale - 2);
      ctx.lineTo(x + spread + 12, top + 9 * post.scale - 2);
      ctx.stroke();
    }

    // Warm horizon haze so the midground reads as depth, not a flat wall
    const haze = ctx.createLinearGradient(0, ground - 130, 0, ground + 6);
    haze.addColorStop(0, "rgba(255,107,53,0)");
    haze.addColorStop(1, `rgba(255,120,60,${0.14 + view.heat * 0.1})`);
    ctx.fillStyle = haze;
    ctx.fillRect(0, ground - 130, width, 136);

    // Track band
    const track = ctx.createLinearGradient(0, ground, 0, height);
    track.addColorStop(0, PALETTE.trackEdge);
    track.addColorStop(0.35, PALETTE.track);
    track.addColorStop(1, "#140F0A");
    ctx.fillStyle = track;
    ctx.fillRect(0, ground, width, height - ground + 4);
    ctx.fillStyle = PALETTE.trackEdge;
    ctx.fillRect(0, ground, width, 4);
    const dashOffset = -(scroll % 96);
    ctx.strokeStyle = "rgba(255,200,87,0.34)";
    ctx.lineWidth = 3;
    ctx.setLineDash([34, 62]);
    ctx.lineDashOffset = dashOffset;
    ctx.beginPath();
    ctx.moveTo(0, ground + 26);
    ctx.lineTo(width, ground + 26);
    ctx.stroke();
    ctx.setLineDash([18, 46]);
    ctx.lineDashOffset = -dashOffset * 1.6;
    ctx.strokeStyle = "rgba(255,107,53,0.22)";
    ctx.beginPath();
    ctx.moveTo(0, ground + 72);
    ctx.lineTo(width, ground + 72);
    ctx.stroke();
    ctx.setLineDash([]);

    // Foreground verge
    const verge = ctx.createLinearGradient(0, ground + 92, 0, height);
    verge.addColorStop(0, "rgba(8,11,22,0)");
    verge.addColorStop(1, "rgba(5,7,14,0.85)");
    ctx.fillStyle = verge;
    ctx.fillRect(0, ground + 92, width, height - ground - 92);
    for (const tuft of tufts) {
      const x = ((tuft.x - (scroll * 1.35) % 1400) + 1400) % 1400 - 60;
      const y = ground + 116 + tuft.h * 0.18;
      ctx.strokeStyle = tuft.warm ? "rgba(255,140,70,0.5)" : "rgba(120,160,210,0.26)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + tuft.lean, y - tuft.h * 0.6, x + tuft.lean * 2.1, y - tuft.h);
      ctx.stroke();
    }

    // Ghost rival
    const gap = (view.progress - view.ghostProgress) * TRACK_LENGTH * PX_PER_UNIT;
    // Keep a readable separation even when the two are neck and neck; the lane bar
    // above carries the exact margin.
    const shownGap = Math.sign(gap || -1) * Math.max(96, Math.abs(gap));
    const ghostX = Math.max(30, Math.min(width - 30, PLAYER_X - shownGap));
    if (echo && !view.reducedMotion) {
      const trailLength = 5;
      for (let index = trailLength; index > 0; index -= 1) {
        renderSpriteAt(echo.frames[Math.floor(elapsed * 14 + index) % 8], ghostX - index * 11, ground + 7, 1 + index * 0.012, 1, 0.05 * (trailLength - index + 1));
      }
    }
    if (echo) {
      const bob = view.momentum > 0 ? Math.sin(elapsed * 16) * 2 : Math.sin(elapsed * 3) * 1.2;
      renderSpriteAt(echo.frames[Math.floor(elapsed * 15) % 8], ghostX, ground + 7 + bob, 1, 1, 0.78);
    }

    // Player
    if (atlas) {
      const frameRate = view.running ? 7 + view.speed * 5 : 3.4;
      const frame = atlas.frames[Math.floor(elapsed * frameRate) % 8];
      const beat = Math.sin(elapsed * (view.running ? 13 : 3));
      const squashY = 1 + beat * 0.035 * (view.running ? 1.6 : 0.6);
      const squashX = 2 - squashY;
      for (const ember of trail) {
        ctx.globalAlpha = ember.life * 0.4;
        ctx.fillStyle = PALETTE.ember;
        ctx.beginPath();
        ctx.arc(ember.x, ember.y, 5 * ember.life + 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      const bob = Math.abs(Math.sin(elapsed * (view.running ? 13 : 3))) * 3;
      ctx.globalAlpha = 0.42;
      ctx.fillStyle = "#05070E";
      ctx.beginPath();
      ctx.ellipse(PLAYER_X, ground + 8, 30 - bob, 6.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      renderSpriteAt(frame, PLAYER_X, ground + 7 - bob, squashX, squashY, 1);
      // Warm rim
      ctx.globalCompositeOperation = "lighter";
      const rim = ctx.createRadialGradient(PLAYER_X, ground - 20, 6, PLAYER_X, ground - 20, 96);
      rim.addColorStop(0, `rgba(255,140,70,${0.18 + view.momentum * 0.3})`);
      rim.addColorStop(1, "rgba(255,140,70,0)");
      ctx.fillStyle = rim;
      ctx.fillRect(PLAYER_X - 110, ground - 110, 220, 200);
      ctx.globalCompositeOperation = "source-over";
    }

    // Particles
    particles = particles.filter((particle) => {
      const nextX = particle.x + particle.vx * 0.016;
      const nextY = particle.y + particle.vy * 0.016;
      const life = particle.life + 0.016;
      if (life >= particle.max) return false;
      particle = { ...particle, x: nextX, y: nextY, vy: particle.vy + 260 * 0.016, life };
      const t = 1 - life / particle.max;
      ctx.globalAlpha = t * 0.9;
      ctx.fillStyle = `hsl(${particle.hue} ${particle.kind === 0 ? 22 : 96}% ${52 + t * 26}%)`;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size * (0.5 + t * 0.7), 0, Math.PI * 2);
      ctx.fill();
      return true;
    });
    ctx.globalAlpha = 1;

    // The Ember Gate comes into view on the final stretch
    const remaining = (1 - view.progress) * TRACK_LENGTH * PX_PER_UNIT;
    if (remaining < 420) {
      const gateX = PLAYER_X + remaining;
      const pulse = 0.6 + Math.abs(Math.sin(elapsed * 2.6)) * 0.4;
      const column = ctx.createLinearGradient(gateX, ground - 250, gateX, ground + 10);
      column.addColorStop(0, "rgba(255,200,87,0)");
      column.addColorStop(1, `rgba(255,200,87,${0.5 * pulse})`);
      ctx.fillStyle = column;
      ctx.fillRect(gateX - 34, ground - 250, 68, 260);
      ctx.fillStyle = `rgba(255,240,200,${0.85 * pulse})`;
      ctx.fillRect(gateX - 3, ground - 250, 6, 260);
      ctx.fillStyle = "rgba(255,200,87,0.85)";
      ctx.fillRect(gateX - 40, ground - 6, 80, 7);
    }

    // Speed lines
    if (!reduced && view.speed > 1.05) {
      ctx.strokeStyle = `rgba(255,220,170,${Math.min(0.5, (view.speed - 1) * 0.5)})`;
      ctx.lineWidth = 1.6;
      for (let index = 0; index < 14; index += 1) {
        const y = ground - 150 + ((index * 53 + elapsed * 900) % 300);
        const len = 40 + (index % 5) * 30;
        const x = ((index * 197 + elapsed * 1400) % (width + 200)) - 100;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - len, y);
        ctx.stroke();
      }
    }

    // Ember grade + vignette + flash
    const grade = ctx.createLinearGradient(0, 0, 0, height);
    grade.addColorStop(0, `rgba(255,107,53,${0.05 + view.heat * 0.12})`);
    grade.addColorStop(1, "rgba(9,12,22,0.32)");
    ctx.fillStyle = grade;
    ctx.fillRect(0, 0, width, height);
    const vignette = ctx.createRadialGradient(width / 2, height / 2, height * 0.3, width / 2, height / 2, height * 1.05);
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(1, "rgba(0,0,0,0.62)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
    if (view.flash > 0.01) {
      ctx.fillStyle = `rgba(255,231,196,${Math.min(0.85, view.flash)})`;
      ctx.fillRect(0, 0, width, height);
    }
    ctx.restore();
  }

  return {
    resize,
    draw(view, sprites, elapsed) {
      if (sprites) ensureAtlas(sprites);
      if (view.running) {
        trail = [{ x: PLAYER_X - 14 - Math.random() * 12, y: height * (GROUND_Y / LOGICAL_HEIGHT) - 14 - Math.random() * 16, life: 1 },
          ...trail.map((ember) => ({ ...ember, life: ember.life - 0.06, x: ember.x - 2.5 }))].slice(0, 12);
        spawn(0, 1, 1, PLAYER_X - 10, height * (GROUND_Y / LOGICAL_HEIGHT) - 2);
      }
      draw(view, sprites, elapsed);
    },
    burst(kind, amount, power) {
      spawn(kind === "dust" ? 0 : kind === "embers" ? 1 : 2, amount, power, PLAYER_X + 6, height * (GROUND_Y / LOGICAL_HEIGHT) - 34);
    },
    dispose() {
      particles = [];
      trail = [];
      atlas = null;
      echo = null;
      atlasKey = "";
    },
  };
}
