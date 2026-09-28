"use client";

/**
 * Inkbound — a Rare Friends action platformer.
 *
 * Your hardwired Generations NFT is the hero: move, double jump, dash and slash
 * through three zones of shadow wisps and flyers, collecting ember motes and
 * clearing the gate. The SDK runtime supplies wallet connection, owned-Friend
 * discovery and the eligibility gate; RF buys sealed sigils that you ignite
 * mid-run for a power surge, using the SDK's simulated chance game.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameComponentProps } from "@rarefriends/friendsdk/runtime";
import { formatGameAmount } from "@rarefriends/friendsdk/ui";
import { maximumPrize, type GamePlay, type GameSnapshot } from "@rarefriends/friendsdk/game";
import { createFriendReader, type GenerationSprites } from "@rarefriends/friendsdk/sprites";
import { createFriendSoundKit, type FriendSoundKit, type FriendSoundCue } from "@rarefriends/friendsdk/sounds";
import { GameMenu } from "@rarefriends/friendsdk/frame";
import { ZONES, burst, clearParticles, createRenderer, createSim, gateOpen, loadZone, paintPortrait, update, type Input, type Sim } from "./world.js";
import "@rarefriends/friendsdk/frame.css";
import "./style.css";

const BURSTS = [0.2, 0.34, 0.48, 0.65, 0.95, 1.3, 1.95, 3.1] as const;
const rf = (value: bigint) => `${formatGameAmount(value, 18)} RF`;
const clock = (value: number) => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`;

type Phase = "title" | "play" | "cleared" | "dead" | "result";
type Menu = "shop" | "journal" | "odds" | "settings" | null;
type Verdict = Readonly<{ label: string; name: string; reward: bigint; tone: "perfect" | "good" | "miss" }>;

export default function Inkbound({ friendId, client, paused }: GameComponentProps) {
  const definition = client.definition;
  const canvas = useRef<HTMLCanvasElement>(null), portrait = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<ReturnType<typeof createRenderer> | null>(null);
  const sprites = useRef<GenerationSprites | null>(null), sound = useRef<FriendSoundKit | null>(null);
  const sim = useRef<Sim>(createSim()), input = useRef<Input>({ left: false, right: false, jump: false, attack: false, dash: false });
  const frameHandle = useRef(0), last = useRef(0), locked = useRef(false), epoch = useRef(0);
  const keys = useRef<Set<string>>(new Set());
  const shake = useRef(0), flash = useRef(0), ignition = useRef(false);
  const stats = useRef({ deaths: 0, startedAt: 0, totalMotes: 0, totalKills: 0 });

  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [phase, setPhase] = useState<Phase>("title");
  const [menu, setMenu] = useState<Menu>(null);
  const [busy, setBusy] = useState(false);
  const [igniting, setIgniting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [muted, setMuted] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [artReady, setArtReady] = useState(false);
  const [artError, setArtError] = useState("");
  const [tick, setTick] = useState(0);

  const maxPrize = useMemo(() => maximumPrize(definition), [definition]);
  const zone = ZONES[sim.current.zone];

  // --- SDK runtime wiring ---------------------------------------------------
  useEffect(() => {
    const version = ++epoch.current;
    sound.current = createFriendSoundKit({ muted: true });
    sprites.current = null;
    setArtReady(false); setArtError(""); setSnapshot(null); setError(""); setMessage("");
    setPhase("title"); setMenu(null); setVerdict(null); setBusy(false); setIgniting(false); setMuted(true);
    locked.current = false;
    sim.current = createSim(); loadZone(sim.current, 0);
    stats.current = { deaths: 0, startedAt: 0, totalMotes: 0, totalKills: 0 };
    clearParticles();

    void client.read()
      .then((value) => { if (version === epoch.current) setSnapshot(value); })
      .catch((cause) => { if (version === epoch.current) setError(cause instanceof Error ? cause.message : "Could not load the preview ledger."); });
    void createFriendReader().read(friendId)
      .then((value) => {
        if (version !== epoch.current) return;
        sprites.current = value;
        setArtReady(true);
        paintPortrait(portrait.current, value);
      })
      .catch((cause) => { if (version === epoch.current) setArtError(cause instanceof Error ? cause.message : "Canonical Friend artwork did not load."); });

    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(preference.matches);
    sync(); preference.addEventListener("change", sync);
    return () => {
      epoch.current++;
      sound.current?.dispose(); sound.current = null;
      preference.removeEventListener("change", sync);
      if (frameHandle.current) cancelAnimationFrame(frameHandle.current);
    };
  }, [client, friendId]);

  // --- canvas ---------------------------------------------------------------
  useEffect(() => {
    const node = canvas.current;
    if (!node) return;
    const instance = createRenderer(node);
    renderer.current = instance;
    instance.resize();
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(node);
    return () => { observer.disconnect(); instance.dispose(); renderer.current = null; };
  }, [Boolean(snapshot), phase]);

  useEffect(() => { if (phase === "title") paintPortrait(portrait.current, sprites.current); }, [phase, artReady]);

  // --- input ----------------------------------------------------------------
  useEffect(() => {
    const map = (code: string) => {
      if (["ArrowLeft", "KeyA"].includes(code)) return "left";
      if (["ArrowRight", "KeyD"].includes(code)) return "right";
      if (["Space", "ArrowUp", "KeyW"].includes(code)) return "jump";
      if (["KeyJ", "KeyK", "KeyF"].includes(code)) return "attack";
      if (["ShiftLeft", "ShiftRight"].includes(code)) return "dash";
      return null;
    };
    const down = (event: KeyboardEvent) => {
      if (paused) return;
      if (event.code === "KeyE") { event.preventDefault(); void ignite(); return; }
      const action = map(event.code);
      if (!action) return;
      event.preventDefault();
      keys.current.add(action);
    };
    const up = (event: KeyboardEvent) => { const action = map(event.code); if (action) keys.current.delete(action); };
    const blur = () => keys.current.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur); };
  });

  // --- main loop ------------------------------------------------------------
  useEffect(() => {
    let lastFrame = performance.now();
    const step = (now: number) => {
      frameHandle.current = requestAnimationFrame(step);
      const raw = Math.min(0.045, (now - lastFrame) / 1000);
      lastFrame = now;
      const state = sim.current;
      const instance = renderer.current;
      const blocked = paused || Boolean(menu) || igniting || busy;

      if (instance) {
        if (phase === "play" && !blocked) {
          const keyset = keys.current;
          input.current = { left: keyset.has("left"), right: keyset.has("right"), jump: keyset.has("jump"), attack: keyset.has("attack"), dash: keyset.has("dash") };
          const before = { kills: state.kills, motes: state.motes, hp: state.hp, zone: state.zone };
          update(state, input.current, raw);
          if (state.kills > before.kills) { sound.current?.play("impact"); shake.current = 7; }
          if (state.hp < before.hp) { sound.current?.play("impact"); shake.current = 13; flash.current = 0.3; burst(state, state.x, state.y - 24, 16, 1.2, 350); }
          if (state.motes > before.motes) { sound.current?.play("select"); burst(state, state.x, state.y - 24, 7, 0.7, 46); }
          if (state.dead) { stats.current.deaths += 1; setPhase("dead"); sound.current?.play("reveal-common"); }
          else if (state.cleared && phase === "play") {
            sound.current?.play("reveal-rare");
            shake.current = 10; flash.current = 0.35;
            for (let n = 0; n < 4; n += 1) burst(state, state.x + n * 8, state.y - 30 - n * 10, 22, 1.4, 40);
            setPhase("cleared");
          }
        }
        shake.current = Math.max(0, shake.current - raw * 34);
        flash.current = Math.max(0, flash.current - raw * 3.2);
        instance.draw(state, sprites.current, now / 1000, shake.current, flash.current, reducedMotion);
      }
    };
    frameHandle.current = requestAnimationFrame(step);
    return () => { if (frameHandle.current) cancelAnimationFrame(frameHandle.current); };
  }, [busy, igniting, menu, paused, phase, reducedMotion]);

  // Auto-advance a cleared zone, or finish the run.
  useEffect(() => {
    if (phase !== "cleared") return;
    const state = sim.current;
    const timer = window.setTimeout(() => {
      if (state.zone >= ZONES.length - 1) {
        stats.current.totalMotes += state.motes;
        stats.current.totalKills += state.kills;
        setPhase("result");
        return;
      }
      stats.current.totalMotes += state.motes;
      stats.current.totalKills += state.kills;
      state.motes = 0; state.kills = 0; state.time = 0;
      loadZone(state, state.zone + 1);
      setPhase("play");
    }, reducedMotion ? 700 : 1900);
    return () => window.clearTimeout(timer);
  }, [phase, reducedMotion]);

  useEffect(() => {
    const handle = window.setInterval(() => setTick((value) => value + 1), 70);
    return () => window.clearInterval(handle);
  }, []);

  // --- economy --------------------------------------------------------------
  const act = useCallback(async (work: () => Promise<void>, cue?: FriendSoundCue) => {
    if (locked.current || paused) return;
    const version = epoch.current;
    locked.current = true; setBusy(true); setError(""); setMessage("");
    void sound.current?.unlock();
    try {
      await work();
      const value = await client.read();
      if (version === epoch.current) { setSnapshot(value); if (cue) sound.current?.play(cue); }
    } catch (cause) {
      if (version === epoch.current) setError(cause instanceof Error ? cause.message : "The preview action failed.");
    } finally {
      if (version === epoch.current) { locked.current = false; setBusy(false); }
    }
  }, [client, paused]);

  const buy = (count: number) => void act(() => client.buy(BigInt(count)), "purchase");

  const ignite = useCallback(() => {
    const state = sim.current;
    if (locked.current || paused || igniting || phase !== "play") return;
    if (!snapshot) return;
    const pending = snapshot.plays.find((play) => play.outcomeId === null);
    if (!pending && snapshot.consumables === 0n) { setMessage("No sealed sigils — buy some in the Sigil shop."); sound.current?.play("action-ready"); return; }
    const version = epoch.current;
    locked.current = true; setIgniting(true); ignition.current = true; setError("");
    void sound.current?.unlock();
    sound.current?.play("anticipation");
    void (async () => {
      try {
        const play: GamePlay = pending ?? (await client.play(1n))[0];
        await new Promise((resolve) => window.setTimeout(resolve, reducedMotion ? 0 : 160));
        const settled = await client.settle(play.id);
        const value = await client.read();
        if (version !== epoch.current) return;
        const outcomeId = settled.outcomeId ?? 1;
        const outcome = definition.outcomes[outcomeId - 1];
        const power = BURSTS[outcomeId - 1] ?? 0.4;
        setSnapshot(value);
        const rare = outcome.reward >= 2500000000000000000n;
        const tier: Verdict["tone"] = rare ? "perfect" : outcome.reward >= 500000000000000000n ? "good" : "miss";
        setVerdict({ label: rare ? "PRISM SURGE" : tier === "good" ? "GOLD SURGE" : "EMBER SURGE", name: outcome.name, reward: outcome.reward, tone: tier });
        sound.current?.play(rare ? "reveal-legendary" : tier === "good" ? "reveal-rare" : "reveal-common");
        state.hp = Math.min(state.maxHp, state.hp + (rare ? 2 : 1));
        state.ember = 100;
        state.boost = 6 + power * 2.4;
        state.invuln = Math.max(state.invuln, 2.4);
        burst(state, state.x, state.y - 30, rare ? 60 : 26, 1.5 + power * 0.3, rare ? 46 : 24);
        if (rare && !reducedMotion) { flash.current = 0.7; shake.current = 18; }
        else { flash.current = 0.3; shake.current = 9; }
        window.setTimeout(() => setVerdict(null), 1600);
      } catch (cause) {
        if (version === epoch.current) setError(cause instanceof Error ? cause.message : "The ignite action failed.");
      } finally {
        if (version === epoch.current) { locked.current = false; setIgniting(false); ignition.current = false; }
      }
    })();
  }, [client, definition, igniting, paused, phase, reducedMotion, snapshot]);

  const startRun = useCallback(() => {
    const state = sim.current;
    state.hp = 5; state.maxHp = 5; state.ember = 100; state.motes = 0; state.kills = 0; state.time = 0; state.combo = 0;
    state.boost = 0; state.invuln = 0; state.dead = false;
    stats.current = { deaths: 0, startedAt: performance.now(), totalMotes: 0, totalKills: 0 };
    loadZone(state, 0);
    clearParticles();
    setMenu(null); setVerdict(null); setMessage("");
    setPhase("play");
    void sound.current?.unlock();
    sound.current?.play("action-start");
  }, []);

  const retry = useCallback(() => {
    const state = sim.current;
    state.hp = state.maxHp; state.dead = false; state.motes = 0; state.kills = 0; state.time = 0; state.boost = 0;
    loadZone(state, state.zone);
    clearParticles();
    setPhase("play");
    sound.current?.play("action-start");
  }, []);

  const touch = (action: keyof Input) => ({
    onPointerDown: (event: React.PointerEvent) => { event.preventDefault(); keys.current.add(action); },
    onPointerUp: (event: React.PointerEvent) => { event.preventDefault(); keys.current.delete(action); },
    onPointerLeave: () => keys.current.delete(action),
    onPointerCancel: () => keys.current.delete(action),
  });

  const loading = !snapshot;
  if (loading) {
    return (
      <div className="ink-gate" role={error ? "alert" : "status"}>
        <div className="ink-sigil" aria-hidden="true"><span /></div>
        <h1>Inkbound</h1>
        <p>{error || "Summoning your Friend…"}</p>
        {error && <button type="button" className="ink-btn" disabled={busy || paused} onClick={() => void act(async () => {})}>Retry</button>}
      </div>
    );
  }
  if (snapshot.friendId !== friendId) return <p role="alert" className="ink-error">This game session does not match the selected Friend.</p>;

  const state = sim.current;
  const sigils = snapshot.consumables;
  const kept = snapshot.inventory.reduce((total, amount) => total + amount, 0n);
  const family = sprites.current?.familyName ?? "—";
  const cleared = ZONES.filter((_, index) => index < state.zone).length;
  const heartRow = Array.from({ length: state.maxHp }, (_, index) => index < state.hp);
  void tick;

  return (
    <section className={`ink-game ${reducedMotion ? "ink-reduced" : ""}`} aria-label={definition.name}>
      <canvas ref={canvas} className="ink-canvas" aria-hidden="true" />

      {phase === "play" && (
        <>
          <div className="ink-hud">
            <div className="ink-hud-left">
              <span className="ink-zone">{zone.tag}</span>
              <strong className="ink-zone-name">{zone.name}</strong>
              <span className="ink-hearts" aria-label={`Health ${state.hp} of ${state.maxHp}`}>
                {heartRow.map((full, index) => <i key={index} className={full ? "on" : ""} />)}
              </span>
            </div>
            <div className="ink-hud-right">
              <span className="ink-stat"><b>{clock(state.time)}</b><small>run</small></span>
              <span className="ink-stat"><b>{state.motes}</b><small>motes</small></span>
              <span className="ink-stat"><b>{state.kills}</b><small>kills</small></span>
              {state.combo > 1 && <span className="ink-combo">×{state.combo} combo</span>}
              <span className="ink-stat ink-rf"><b>{rf(snapshot.rfBalance)}</b><small>simulated</small></span>
            </div>
          </div>
          <div className="ink-bars">
            <span className="ink-bar ink-bar-ember"><i style={{ width: `${state.ember}%` }} /><b>Ember</b></span>
            <span className="ink-bar ink-bar-zone"><i style={{ width: `${Math.min(100, (state.kills / zone.need.kills) * 100)}%` }} /><b>Shadows {state.kills}/{zone.need.kills}</b></span>
            <span className="ink-bar ink-bar-mote"><i style={{ width: `${Math.min(100, (state.motes / zone.need.motes) * 100)}%` }} /><b>Motes {state.motes}/{zone.need.motes}</b></span>
            <span className={`ink-bar ink-bar-gate ${gateOpen(state) ? "open" : ""}`}><i style={{ width: `${Math.min(100, (state.x / zone.gate[0]) * 100)}%` }} /><b>{gateOpen(state) ? "Gate open" : "Gate sealed"}</b></span>
          </div>
          {state.boost > 0 && <div className="ink-boost">SURGE {Math.ceil(state.boost)}s</div>}
          {verdict && (
            <div className={`ink-verdict ink-verdict-${verdict.tone}`} role="status">
              <b>{verdict.label}</b><span>{verdict.name} · {rf(verdict.reward)} · +HP · full Ember</span>
            </div>
          )}
          <div className="ink-controls">
            <button type="button" className="ink-pad" {...touch("left")} aria-label="Move left">◀</button>
            <button type="button" className="ink-pad" {...touch("right")} aria-label="Move right">▶</button>
            <button type="button" className="ink-pad ink-pad-jump" {...touch("jump")} aria-label="Jump">JUMP</button>
            <button type="button" className="ink-pad ink-pad-dash" {...touch("dash")} aria-label="Dash">DASH</button>
            <button type="button" className="ink-pad ink-pad-hit" {...touch("attack")} aria-label="Slash">SLASH</button>
            <button type="button" className="ink-pad ink-pad-fire" disabled={!sigils && !snapshot.plays.some((play) => play.outcomeId === null)} onClick={ignite} aria-label="Ignite a sealed sigil">
              IGNITE · {sigils.toString()}
            </button>
          </div>
          <button type="button" className="ink-corner" onClick={() => setMenu("settings")}>Settings</button>
        </>
      )}

      {phase === "title" && (
        <div className="ink-lobby">
          <div className="ink-lobby-art">
            <canvas ref={portrait} className="ink-portrait" aria-hidden="true" />
            <span className="ink-lobby-family">{family}</span>
            <span className="ink-lobby-gen">hardwired Generations NFT</span>
          </div>
          <div className="ink-lobby-main">
            <p className="ink-kicker">Rare Friends · action platformer</p>
            <h1>Inkbound</h1>
            <p className="ink-lede">
              Three zones of shadow. You are <strong>{family}</strong> — run, double jump, dash and slash your way to the Ember Gate.
              Ignite sealed sigils mid-run for a surge that heals you and doubles your slash.
            </p>
            <ul className="ink-how">
              <li><kbd>A</kbd> <kbd>D</kbd> or <kbd>←</kbd> <kbd>→</kbd> move</li>
              <li><kbd>Space</kbd> jump, twice for a double jump</li>
              <li><kbd>J</kbd> slash, <kbd>Shift</kbd> dash (costs Ember)</li>
              <li><kbd>E</kbd> ignite a sealed sigil for a surge</li>
            </ul>
            <dl className="ink-stats">
              <div><dt>Sealed sigils</dt><dd>{sigils.toString()}</dd></div>
              <div><dt>Sigil price</dt><dd>{rf(definition.price)}</dd></div>
              <div><dt>Reserve each</dt><dd>{rf(maxPrize)}</dd></div>
              <div><dt>Playing as</dt><dd>{family}</dd></div>
            </dl>
            <div className="ink-actions">
              <button type="button" className="ink-btn ink-btn-primary" disabled={busy || paused} onClick={startRun}>Enter the run</button>
              <button type="button" className="ink-btn" disabled={busy || paused} onClick={() => setMenu("shop")}>Sigil shop</button>
              <button type="button" className="ink-btn" disabled={busy || paused} onClick={() => setMenu("journal")}>Journal · {kept.toString()}</button>
              <button type="button" className="ink-btn" disabled={busy || paused} onClick={() => setMenu("odds")}>Odds</button>
            </div>
            {sigils === 0n && <p className="ink-warn">No sealed sigils — the shop sells them for {rf(definition.price)} each.</p>}
          </div>
        </div>
      )}

      {phase === "cleared" && (
        <div className="ink-banner" role="status">
          <b>GATE CLEARED</b>
          <span>{zone.name} — {clock(state.time)} · {state.motes} motes · {state.kills} kills</span>
          <em>{state.zone >= ZONES.length - 1 ? "Final gate" : `Next: ${ZONES[state.zone + 1].name}`}</em>
        </div>
      )}

      {phase === "dead" && (
        <div className="ink-panel">
          <p className="ink-verdict ink-verdict-miss">THE SHADOW TOOK YOU</p>
          <h1>{zone.name}</h1>
          <p className="ink-lede">Motes and kills from this attempt are lost. The zone restarts with full health.</p>
          <dl className="ink-stats">
            <div><dt>Attempts</dt><dd>{stats.current.deaths}</dd></div>
            <div><dt>Motes this run</dt><dd>{state.motes}</dd></div>
            <div><dt>Sigils</dt><dd>{sigils.toString()}</dd></div>
            <div><dt>RF</dt><dd>{rf(snapshot.rfBalance)}</dd></div>
          </dl>
          <div className="ink-actions">
            <button type="button" className="ink-btn ink-btn-primary" disabled={busy || paused} onClick={retry}>Retry this zone</button>
            <button type="button" className="ink-btn" disabled={busy || paused} onClick={startRun}>Restart the whole run</button>
            <button type="button" className="ink-btn" disabled={busy || paused} onClick={() => setMenu("shop")}>Sigil shop</button>
          </div>
        </div>
      )}

      {phase === "result" && (
        <div className="ink-panel">
          <p className="ink-verdict ink-verdict-perfect">THE EMBER GATE OPENS</p>
          <h1>{clock(stats.current.startedAt ? (performance.now() - stats.current.startedAt) / 1000 : state.time)}</h1>
          <p className="ink-lede">All three zones cleared. {stats.current.totalMotes + state.motes} motes gathered, {stats.current.totalKills + state.kills} shadows destroyed.</p>
          <dl className="ink-stats">
            <div><dt>Zones cleared</dt><dd>{ZONES.length}</dd></div>
            <div><dt>Deaths</dt><dd>{stats.current.deaths}</dd></div>
            <div><dt>Kept sigils</dt><dd>{kept.toString()}</dd></div>
            <div><dt>RF balance</dt><dd>{rf(snapshot.rfBalance)}</dd></div>
          </dl>
          <div className="ink-actions">
            <button type="button" className="ink-btn ink-btn-primary" disabled={busy || paused} onClick={startRun}>Run again</button>
            <button type="button" className="ink-btn" disabled={busy || paused} onClick={() => setMenu("journal")}>Redeem kept sigils</button>
            <button type="button" className="ink-btn" disabled={busy || paused} onClick={() => setMenu("shop")}>Sigil shop</button>
          </div>
          <p className="ink-fine">Balances, sigils and outcomes are simulated for this preview and reset on reload.</p>
        </div>
      )}

      {artError && <p className="ink-art-error" role="status">Canonical artwork unavailable ({artError}).</p>}
      {error && <p className="ink-error" role="alert">{error}</p>}
      {message && <p className="ink-message" role="status">{message}</p>}

      {menu && (
        <GameMenu title={menu === "shop" ? "Sigil shop" : menu === "journal" ? "Sigil journal" : menu === "odds" ? "Outcome table" : "Settings"}
          onClose={busy ? undefined : () => setMenu(null)}>
          {menu === "shop" ? <>
            <p>Each sealed sigil costs <strong>{rf(definition.price)}</strong> and reserves <strong>{rf(maxPrize)}</strong> of simulated backing.</p>
            <p>You hold {sigils.toString()} sealed sigils, {kept.toString()} kept sigils and {rf(snapshot.rfBalance)}.</p>
            <div className="ink-actions">
              <button type="button" className="ink-btn ink-btn-primary" disabled={busy || paused || snapshot.rfBalance < definition.price} onClick={() => buy(1)}>Buy one · {rf(definition.price)}</button>
              <button type="button" className="ink-btn" disabled={busy || paused || snapshot.rfBalance < definition.price} onClick={() => buy(5)}>Buy five</button>
            </div>
            {snapshot.freeStake < maxPrize && <p className="ink-warn">New purchases pause until free backing covers {rf(maxPrize)}. Redeem or settle pending ignitions.</p>}
          </> : menu === "journal" ? <>
            <p>Kept sigils hold their fixed RF value with no redemption expiry.</p>
            {definition.outcomes.map((outcome, index) => (
              <div className="ink-row" key={outcome.name}>
                <span><strong>{outcome.name}</strong><small>{snapshot.inventory[index].toString()} kept · {rf(outcome.reward)} · surge +{BURSTS[index] ?? 0}</small></span>
                <button type="button" className="ink-btn" disabled={busy || paused || snapshot.inventory[index] === 0n || outcome.reward === 0n}
                  onClick={() => void act(() => client.redeem(index + 1, snapshot.inventory[index]), "reward")}>Redeem all</button>
              </div>
            ))}
          </> : menu === "odds" ? <>
            <p>One weighted table, 10,000 basis points. Igniting a sigil always heals and fills Ember; rarer sigils heal more and surge longer.</p>
            <table className="ink-table"><thead><tr><th>Sigil</th><th>Chance</th><th>Value</th><th>Surge</th></tr></thead>
              <tbody>{definition.outcomes.map((outcome, index) => (
                <tr key={outcome.name}><td>{outcome.name}</td><td>{(outcome.chanceBps / 100).toFixed(2)}%</td><td>{rf(outcome.reward)}</td><td>+{BURSTS[index] ?? 0}</td></tr>
              ))}</tbody></table>
            <p className="ink-fine">Surge multiplies move speed ×1.35 and makes every slash deal double damage.</p>
          </> : <>
            <button type="button" className="ink-btn" aria-pressed={!muted} onClick={() => { const next = !muted; setMuted(next); sound.current?.setMuted(next); if (!next) void sound.current?.unlock(); }}>{muted ? "Sound off" : "Sound on"}</button>
            <label className="ink-check"><input type="checkbox" checked={reducedMotion} onChange={(event) => setReducedMotion(event.target.checked)} /> Reduce motion (no shake or flash)</label>
            <p className="ink-fine">Wallet connection, owned-Friend discovery and the hardwired Generations NFT eligibility check come from the SDK runtime. Everything in this preview is simulated.</p>
          </>}
          {error && <p className="ink-error" role="alert">{error}</p>}
          <p className="ink-fine" role="status">{busy ? "Waiting for preview confirmation…" : "Simulated RF and outcomes."}</p>
        </GameMenu>
      )}
    </section>
  );
}
