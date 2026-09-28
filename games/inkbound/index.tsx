"use client";

/**
 * Inkbound — a Rare Friends race.
 *
 * Your hardwired Generations NFT is the runner: its canonical on-chain artwork,
 * its family and its generation drive the game. You buy sealed Ember Sigils
 * (1 RF each), ignite them mid-race for a burst of speed, and race the Cyan
 * Echo to the Ember Gate. Wallet connection, owned-Friend discovery and the
 * eligibility gate are supplied by the SDK runtime; the economy is the SDK's
 * simulated chance game and every balance here is a simulation.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameComponentProps } from "@rarefriends/friendsdk/runtime";
import { formatGameAmount } from "@rarefriends/friendsdk/ui";
import { maximumPrize, type GamePlay, type GameSnapshot } from "@rarefriends/friendsdk/game";
import { createFriendReader, type GenerationSprites } from "@rarefriends/friendsdk/sprites";
import { createFriendSoundKit, type FriendSoundKit, type FriendSoundCue } from "@rarefriends/friendsdk/sounds";
import { GameMenu } from "@rarefriends/friendsdk/frame";
import { createTrackRenderer } from "./track.js";
import "@rarefriends/friendsdk/frame.css";
import "./style.css";

const TRACK_LENGTH = 96;
const RUNNER_SPEED = 4.4;
const GHOST_SPEED = 6.0;
const GHOST_TIME = TRACK_LENGTH / GHOST_SPEED;
const CHARGE_DECAY = 0.55;
const PERFECT = { perfect: [0.455, 0.545] as const, good: [0.375, 0.625] as const };
/** Ember burst granted by each outcome, in the order of game.json. */
const BURSTS = [0.2, 0.34, 0.48, 0.65, 0.95, 1.3, 1.95, 3.1] as const;

const rf = (value: bigint) => `${formatGameAmount(value, 18)} RF`;
const withCommas = (value: number, digits = 2) => value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

type Phase = "gate" | "race" | "result";
type Menu = "sigils" | "journal" | "settings" | "odds" | null;
type Verdict = "perfect" | "good" | "miss";

type Sim = {
  running: boolean; finished: boolean; distance: number; ghost: number;
  time: number; charge: number; momentum: number; heat: number;
  shake: number; flash: number; slowmo: number; marker: number; markerDir: number;
  ignites: number; perfects: number; streak: number;
};

const freshSim = (): Sim => ({
  running: false, finished: false, distance: 0, ghost: 0, time: 0, charge: 0, momentum: 0,
  heat: 0, shake: 0, flash: 0, slowmo: 0, marker: 0.5, markerDir: 1, ignites: 0, perfects: 0, streak: 0,
});

export default function Inkbound({ friendId, client, paused }: GameComponentProps) {
  const definition = client.definition;
  const canvas = useRef<HTMLCanvasElement>(null), renderer = useRef<ReturnType<typeof createTrackRenderer> | null>(null);
  const sprites = useRef<GenerationSprites | null>(null), sound = useRef<FriendSoundKit | null>(null);
  const sim = useRef<Sim>(freshSim()), frameHandle = useRef(0), lastTime = useRef(0);
  const locked = useRef(false), epoch = useRef(0);

  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [spritesReady, setSpritesReady] = useState(false);
  const [artError, setArtError] = useState("");
  const [phase, setPhase] = useState<Phase>("gate");
  const [menu, setMenu] = useState<Menu>(null);
  const [busy, setBusy] = useState(false);
  const [igniting, setIgniting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [muted, setMuted] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [verdict, setVerdict] = useState<{ verdict: Verdict; name: string; reward: bigint; burst: number } | null>(null);
  const [result, setResult] = useState<{ time: number; ghost: number; won: boolean; perfects: number; ignites: number } | null>(null);
  const [tick, setTick] = useState(0);

  const maxPrize = useMemo(() => maximumPrize(definition), [definition]);

  // --- SDK runtime wiring ---------------------------------------------------
  useEffect(() => {
    const version = ++epoch.current;
    sound.current = createFriendSoundKit({ muted: true });
    sprites.current = null;
    setSpritesReady(false); setArtError(""); setSnapshot(null); setError(""); setMessage("");
    setPhase("gate"); setMenu(null); setVerdict(null); setResult(null); setBusy(false); setIgniting(false);
    setMuted(true); locked.current = false; sim.current = freshSim();

    void client.read()
      .then((value) => { if (version === epoch.current) setSnapshot(value); })
      .catch((cause) => { if (version === epoch.current) setError(cause instanceof Error ? cause.message : "Could not load the preview ledger."); });

    void createFriendReader().read(friendId)
      .then((value) => { if (version === epoch.current) { sprites.current = value; setSpritesReady(true); } })
      .catch((cause) => { if (version === epoch.current) setArtError(cause instanceof Error ? cause.message : "Canonical Friend artwork did not load."); });

    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(preference.matches);
    update(); preference.addEventListener("change", update);
    return () => {
      epoch.current++;
      sound.current?.dispose(); sound.current = null;
      preference.removeEventListener("change", update);
      if (frameHandle.current) cancelAnimationFrame(frameHandle.current);
    };
  }, [client, friendId]);

  // --- canvas + animation loop ---------------------------------------------
  useEffect(() => {
    const node = canvas.current;
    if (!node) return;
    const instance = createTrackRenderer(node);
    renderer.current = instance;
    instance.resize();
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(node);
    return () => { observer.disconnect(); instance.dispose(); renderer.current = null; };
    // The canvas only mounts once the preview ledger is ready, so this must
    // re-run when the loading gate disappears.
  }, [Boolean(snapshot)]);

  useEffect(() => {
    let last = performance.now();
    const step = (now: number) => {
      frameHandle.current = requestAnimationFrame(step);
      const raw = Math.min(0.05, (now - last) / 1000);
      last = now;
      const state = sim.current;
      const instance = renderer.current;
      if (!instance) { lastTime.current = now; return; }
      const scale = state.slowmo > 0 ? 0.35 : 1;
      const dt = raw * scale;
      const halted = paused || Boolean(menu) || igniting || busy || !state.running || state.finished;

      if (!halted) {
        state.time += dt;
        const momentumTarget = state.distance > state.ghost ? 1 : state.distance > state.ghost - 4 ? 0.5 : 0;
        state.momentum += (momentumTarget - state.momentum) * Math.min(1, dt * 1.4);
        state.charge = Math.max(0, state.charge - state.charge * CHARGE_DECAY * dt - 0.02 * dt);
        const speed = RUNNER_SPEED * (1 + state.charge + state.momentum * 0.22);
        state.distance = Math.min(TRACK_LENGTH, state.distance + speed * dt);
        state.ghost = Math.min(TRACK_LENGTH, state.ghost + GHOST_SPEED * dt);
        state.marker += state.markerDir * dt * 1.55;
        if (state.marker >= 1) { state.marker = 1; state.markerDir = -1; }
        if (state.marker <= 0) { state.marker = 0; state.markerDir = 1; }
        if (state.distance >= TRACK_LENGTH) {
          state.finished = true; state.running = false;
          const won = state.time <= GHOST_TIME;
          setResult({ time: state.time, ghost: GHOST_TIME, won, perfects: state.perfects, ignites: state.ignites });
          setPhase("result");
          sound.current?.play(won ? "reveal-legendary" : "reveal-common");
        }
      }
      state.heat += ((state.charge * 0.7 + state.momentum * 0.4) - state.heat) * Math.min(1, raw * 2.4);
      state.shake = Math.max(0, state.shake - raw * 42);
      state.flash = Math.max(0, state.flash - raw * 3.4);
      state.slowmo = Math.max(0, state.slowmo - raw);
      instance.draw({
        progress: state.distance / TRACK_LENGTH,
        ghostProgress: state.ghost / TRACK_LENGTH,
        speed: 1 + state.charge,
        momentum: state.momentum,
        running: state.running && !halted,
        finished: state.finished,
        shake: reducedMotion ? 0 : state.shake,
        flash: reducedMotion ? 0 : state.flash,
        heat: state.heat,
        reducedMotion,
      }, sprites.current, now / 1000);
    };
    frameHandle.current = requestAnimationFrame(step);
    return () => { if (frameHandle.current) cancelAnimationFrame(frameHandle.current); };
  }, [busy, igniting, menu, paused, reducedMotion]);

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

  const buySigil = () => void act(() => client.buy(1n), "purchase");
  // One SDK call means one host confirmation instead of a queue of them.
  const buyMany = (count: number) => void act(() => client.buy(BigInt(count)), "purchase");

  const ignite = useCallback(() => {
    const state = sim.current;
    if (locked.current || paused || !state.running || state.finished || igniting) return;
    const current = snapshot;
    if (!current) return;
    const pending = current.plays.find((play) => play.outcomeId === null);
    if (!pending && current.consumables === 0n) { setMessage("No sealed sigils left — visit the Sigil shop to buy more."); sound.current?.play("action-ready"); return; }

    const marker = state.marker;
    const hit: Verdict = marker >= PERFECT.perfect[0] && marker <= PERFECT.perfect[1] ? "perfect"
      : marker >= PERFECT.good[0] && marker <= PERFECT.good[1] ? "good" : "miss";
    const multiplier = hit === "perfect" ? 1.3 : hit === "good" ? 1.15 : 1;
    const version = epoch.current;
    locked.current = true; setIgniting(true); setError("");
    void sound.current?.unlock();
    sound.current?.play("anticipation");

    void (async () => {
      try {
        const play: GamePlay = pending ?? (await client.play(1n))[0];
        await new Promise((resolve) => window.setTimeout(resolve, reducedMotion ? 0 : 180));
        const settled = await client.settle(play.id);
        const value = await client.read();
        if (version !== epoch.current) return;
        const outcomeId = settled.outcomeId ?? 1;
        const outcome = definition.outcomes[outcomeId - 1];
        const base = BURSTS[outcomeId - 1] ?? 0.4;
        const burst = base * multiplier;
        setSnapshot(value);
        if (hit === "miss") {
          sound.current?.play("impact");
          setVerdict({ verdict: hit, name: outcome.name, reward: outcome.reward, burst });
        } else {
          const rare = outcome.reward >= 2500000000000000000n;
          sound.current?.play(rare ? "reveal-legendary" : outcome.reward >= 500000000000000000n ? "reveal-rare" : "reveal-common");
          setVerdict({ verdict: hit, name: outcome.name, reward: outcome.reward, burst });
          if (rare && !reducedMotion) { state.slowmo = 0.5; state.flash = 0.55; state.shake = 15; }
          else { state.flash = hit === "perfect" ? 0.32 : 0.16; state.shake = hit === "perfect" ? 9 : 5; }
          renderer.current?.burst("embers", hit === "perfect" ? 26 : 15, 1 + burst * 0.4);
          if (rare) renderer.current?.burst("spark", 34, 1.6);
        }
        state.charge = Math.min(4.2, state.charge + burst);
        state.ignites += 1;
        state.perfects += hit === "perfect" ? 1 : 0;
        state.streak = hit === "perfect" ? state.streak + 1 : 0;
        renderer.current?.burst("dust", hit === "perfect" ? 18 : 10, 1 + burst * 0.5);
      } catch (cause) {
        if (version === epoch.current) setError(cause instanceof Error ? cause.message : "The ignite action failed.");
      } finally {
        if (version === epoch.current) { locked.current = false; setIgniting(false); }
      }
    })();
  }, [client, definition, igniting, paused, reducedMotion, snapshot]);

  const startRun = useCallback(() => {
    sim.current = { ...freshSim(), running: true };
    setResult(null); setVerdict(null); setMenu(null); setMessage("");
    setPhase("race");
    void sound.current?.unlock();
    sound.current?.play("select");
  }, []);

  // --- keyboard -------------------------------------------------------------
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (paused) return;
      if (event.code === "Space" || event.key === "e" || event.key === "E") {
        if (phase === "race" && !menu) { event.preventDefault(); ignite(); }
        else if (phase === "gate" && !menu) { event.preventDefault(); startRun(); }
        else if (phase === "result" && !menu) { event.preventDefault(); startRun(); }
      }
      if (event.key === "Escape" && menu) setMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ignite, menu, paused, phase, startRun]);

  // Light re-render for the HUD numbers.
  useEffect(() => {
    const handle = window.setInterval(() => setTick((value) => value + 1), 120);
    return () => window.clearInterval(handle);
  }, []);

  const loading = !snapshot;
  if (loading) {
    return (
      <div className="ink-gate" role={error ? "alert" : "status"}>
        <div className="ink-sigil" aria-hidden="true"><span /></div>
        <h1>Inkbound</h1>
        <p>{error || "Preparing the Ember Run…"}</p>
        {error && <button type="button" className="ink-btn" disabled={busy || paused} onClick={() => void act(async () => {})}>Retry</button>}
      </div>
    );
  }
  if (snapshot.friendId !== friendId) return <p role="alert" className="ink-error">This game session does not match the selected Friend.</p>;

  const state = sim.current;
  const progress = state.distance / TRACK_LENGTH;
  const ghostProgress = state.ghost / TRACK_LENGTH;
  const pending = snapshot.plays.find((play) => play.outcomeId === null);
  const sigils = snapshot.consumables;
  const kept = snapshot.inventory.reduce((total, amount) => total + amount, 0n);
  const ready = sigils > 0n || Boolean(pending);
  const canAfford = snapshot.rfBalance >= definition.price;
  const family = sprites.current?.familyName ?? "—";
  const gap = (state.distance - state.ghost) * 1;
  const verdictLabel = verdict?.verdict === "perfect" ? "PERFECT IGNITE" : verdict?.verdict === "good" ? "GOOD IGNITE" : "LOOSE IGNITE";
  void tick;

  return (
    <section className={`ink-game ${reducedMotion ? "ink-reduced" : ""}`} aria-label={definition.name}>
      <canvas ref={canvas} className="ink-canvas" aria-hidden="true" />

      {/* --- HUD --- */}
      <div className="ink-hud">
        <div className="ink-hud-top">
          <span className="ink-chip ink-time"><b>{withCommas(phase === "gate" ? 0 : state.time)}s</b><small>race clock</small></span>
          <span className={`ink-chip ink-gap ${gap >= 0 ? "ink-gap-ahead" : "ink-gap-behind"}`}><b>{gap >= 0 ? "+" : "−"}{withCommas(Math.abs(gap), 1)}m</b><small>vs Cyan Echo</small></span>
          <span className="ink-chip ink-rf"><b>{rf(snapshot.rfBalance)}</b><small>simulated</small></span>
          <button type="button" className="ink-chip ink-btn-chip" onClick={() => setMenu("settings")}>Settings</button>
        </div>

        <div className="ink-lane" aria-hidden="true">
          <div className="ink-lane-fill" style={{ width: `${progress * 100}%` }} />
          <div className="ink-lane-ghost" style={{ left: `${ghostProgress * 100}%` }} title="Cyan Echo" />
          <div className="ink-lane-you" style={{ left: `${progress * 100}%` }} title="Your Friend" />
        </div>
        <div className="ink-meters">
          <span className="ink-meter"><i style={{ width: `${Math.min(100, state.momentum * 100)}%` }} /><b>Momentum</b></span>
          <span className="ink-meter ink-meter-em"><i style={{ width: `${Math.min(100, (state.charge / 4) * 100)}%` }} /><b>Ember</b></span>
        </div>
      </div>

      {/* --- Gate / race / result --- */}
      {phase === "gate" && (
        <div className="ink-panel ink-gate-panel">
          <p className="ink-kicker">Rare Friends · race</p>
          <h1>Inkbound</h1>
          <p className="ink-lede">
            You are <strong>{family}</strong> — your hardwired Generations NFT, drawn with its own on-chain artwork.
            Beat the <strong className="ink-cyan">Cyan Echo</strong> to the Ember Gate with sealed sigils.
          </p>
          <dl className="ink-stats">
            <div><dt>Sealed sigils</dt><dd>{sigils.toString()}</dd></div>
            <div><dt>Sigil price</dt><dd>{rf(definition.price)}</dd></div>
            <div><dt>Reserve each</dt><dd>{rf(maxPrize)}</dd></div>
            <div><dt>Runs on</dt><dd>{family}</dd></div>
          </dl>
          <div className="ink-actions">
            <button type="button" className="ink-btn ink-btn-primary" disabled={busy || paused} onClick={startRun}>
              Start the run <kbd>Space</kbd>
            </button>
            <button type="button" className="ink-btn" disabled={busy || paused} onClick={() => setMenu("sigils")}>Sigil shop</button>
            <button type="button" className="ink-btn" disabled={busy || paused} onClick={() => setMenu("odds")}>Odds</button>
          </div>
          {!ready && <p className="ink-warn">No sealed sigils — buy at least one before you run.</p>}
        </div>
      )}

      {phase === "race" && (
        <div className="ink-racebar">
          <div className={`ink-timing ${verdict ? `ink-timing-${verdict.verdict}` : ""}`}>
            <span className="ink-timing-good" /><span className="ink-timing-perfect" />
            <span className="ink-timing-marker" style={{ left: `${state.marker * 100}%` }} />
          </div>
          <button type="button" className="ink-btn ink-btn-ignite" disabled={paused || igniting || !ready} onClick={ignite}>
            {igniting ? "Igniting…" : pending ? "Finish the burn" : "Ignite sigil"} <kbd>Space</kbd>
          </button>
          <span className="ink-left">{sigils.toString()} sealed</span>
        </div>
      )}

      {verdict && phase === "race" && (
        <div className={`ink-toast ink-toast-${verdict.verdict}`} role="status">
          <b>{verdictLabel}</b>
          <span>{verdict.name} · +{withCommas(verdict.burst)} burst · {rf(verdict.reward)}</span>
        </div>
      )}

      {phase === "result" && result && (
        <div className="ink-panel ink-result-panel">
          <p className={`ink-verdict ${result.won ? "ink-win" : "ink-lose"}`}>{result.won ? "GATE REACHED FIRST" : "THE ECHO WAS FASTER"}</p>
          <h1>{withCommas(result.time)}s</h1>
          <p className="ink-lede">Cyan Echo finished in {withCommas(result.ghost)}s. {result.won ? `You were ${withCommas(result.ghost - result.time)}s ahead.` : `You were ${withCommas(result.time - result.ghost)}s behind.`}</p>
          <dl className="ink-stats">
            <div><dt>Perfect ignites</dt><dd>{result.perfects}/{result.ignites}</dd></div>
            <div><dt>Kept sigils</dt><dd>{kept.toString()}</dd></div>
            <div><dt>RF balance</dt><dd>{rf(snapshot.rfBalance)}</dd></div>
            <div><dt>Friend</dt><dd>{family}</dd></div>
          </dl>
          <div className="ink-actions">
            <button type="button" className="ink-btn ink-btn-primary" disabled={busy || paused} onClick={startRun}>Run again</button>
            <button type="button" className="ink-btn" disabled={busy || paused} onClick={() => setMenu("sigils")}>Sigil shop</button>
            <button type="button" className="ink-btn" disabled={busy || paused || kept === 0n} onClick={() => setMenu("journal")}>Sigil journal · {kept.toString()}</button>
          </div>
          <p className="ink-fine">Balances, sigils and outcomes are simulated for this preview and reset on reload.</p>
        </div>
      )}

      {artError && <p className="ink-art-error" role="status">Canonical artwork unavailable ({artError}). Colours below are placeholders.</p>}
      {error && <p className="ink-error" role="alert">{error}</p>}
      {message && <p className="ink-message" role="status">{message}</p>}

      {menu && (
        <GameMenu title={menu === "sigils" ? "Sigil shop" : menu === "journal" ? "Sigil journal" : menu === "odds" ? "Outcome table" : "Settings"}
          onClose={busy ? undefined : () => setMenu(null)}>
          {menu === "sigils" ? <>
            <p>Each sealed sigil costs <strong>{rf(definition.price)}</strong> and reserves <strong>{rf(maxPrize)}</strong> of simulated backing.</p>
            <p>You hold {sigils.toString()} sealed sigils, {kept.toString()} kept sigils and {rf(snapshot.rfBalance)}.</p>
            <div className="ink-actions">
              <button type="button" className="ink-btn ink-btn-primary" disabled={busy || paused || !canAfford} onClick={buySigil}>Buy one · {rf(definition.price)}</button>
              <button type="button" className="ink-btn" disabled={busy || paused || !canAfford} onClick={() => buyMany(5)}>Buy five</button>
            </div>
            {!canAfford && <p className="ink-warn">Not enough simulated RF. Redeem kept sigils from the journal.</p>}
            {(snapshot.freeStake < maxPrize) && <p className="ink-warn">New purchases pause until free backing covers {rf(maxPrize)}. Redeem or settle pending burns.</p>}
          </> : menu === "journal" ? <>
            <p>Kept sigils hold their fixed RF value with no redemption expiry.</p>
            {definition.outcomes.map((outcome, index) => (
              <div className="ink-row" key={outcome.name}>
                <span><strong>{outcome.name}</strong><small>{snapshot.inventory[index].toString()} kept · {rf(outcome.reward)} · burst +{withCommas(BURSTS[index] ?? 0)}</small></span>
                <button type="button" className="ink-btn" disabled={busy || paused || snapshot.inventory[index] === 0n || outcome.reward === 0n}
                  onClick={() => void act(() => client.redeem(index + 1, snapshot.inventory[index]), "reward")}>Redeem all</button>
              </div>
            ))}
          </> : menu === "odds" ? <>
            <p>Twenty… one weighted table, 10,000 basis points. Igniting a sigil grants an Ember burst scaled to its reward.</p>
            <table className="ink-table"><thead><tr><th>Sigil</th><th>Chance</th><th>Value</th><th>Burst</th></tr></thead>
              <tbody>{definition.outcomes.map((outcome, index) => (
                <tr key={outcome.name}><td>{outcome.name}</td><td>{(outcome.chanceBps / 100).toFixed(2)}%</td><td>{rf(outcome.reward)}</td><td>+{withCommas(BURSTS[index] ?? 0)}</td></tr>
              ))}</tbody></table>
            <p className="ink-fine">Timing multiplies the burst: perfect ×1.30, good ×1.15, loose ×1.00.</p>
          </> : <>
            <button type="button" className="ink-btn" aria-pressed={!muted} onClick={() => { const next = !muted; setMuted(next); sound.current?.setMuted(next); if (!next) void sound.current?.unlock(); }}>{muted ? "Sound off" : "Sound on"}</button>
            <label className="ink-check"><input type="checkbox" checked={reducedMotion} onChange={(event) => setReducedMotion(event.target.checked)} /> Reduce motion (no shake, flash or slow-motion)</label>
            <p className="ink-fine">Wallet connection, owned-Friend discovery and the hardwired Generations NFT eligibility check are provided by the SDK runtime. Everything in this preview is simulated.</p>
          </>}
          {error && <p className="ink-error" role="alert">{error}</p>}
          <p className="ink-fine" role="status">{busy ? "Waiting for preview confirmation…" : "Simulated RF and outcomes."}</p>
        </GameMenu>
      )}
    </section>
  );
}
