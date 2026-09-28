# Inkbound — The Ember Run · FriendSDK v0.1.2

Inkbound is a one-button race for Rare Friends. Your hardwired Generations NFT
is the runner — drawn with its own canonical on-chain artwork — and you race the
Cyan Echo to the Ember Gate by igniting sealed sigils for bursts of speed.

The SDK runtime supplies the 960 × 640-ish container, wallet connection, owned
Friend discovery, the fresh hardwired Generations NFT (generation ≥ 1) eligibility
check, the sandbox and confirmations. Every playable prototype requires an
eligible NFT, including this simulated preview.

## Run it

```sh
npm ci
npm run build
npm run dev:game -- games/inkbound
```

Checks:

```sh
node scripts/check-games.mjs
npm run typecheck
npx friendsdk check games/inkbound
npx playwright install --with-deps chromium
npx friendsdk test games/inkbound --screenshot ./artifacts/inkbound.png
```

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Start / restart a run | `Space` or `E` | tap **Start the run** |
| Ignite a sealed sigil | `Space` or `E` | tap **Ignite sigil** |
| Close a panel | `Esc` | tap the scrim |

The Friend runs automatically. The timing bar sweeps back and forth: igniting
inside the green window is a **perfect** ignite (×1.30 burst), the amber window is
**good** (×1.15), otherwise a **loose** ignite (×1.00). The burst still lands — the
timing only decides how hard.

## Rules and economy

Every number below is simulated for the preview and resets on reload.

- **Sealed Ember Sigil** — the consumable. Price **1 RF**.
- Each purchased sigil reserves **10 RF** (the highest prize in the table).
- The table has **8 outcomes, weights total 10,000 basis points**:

| Sigil | Chance | Redemption | Ember burst |
| --- | --: | --: | --: |
| Ash Wisp | 20.00% | 0 RF | +0.20 |
| Coal Fleck | 22.00% | 0.25 RF | +0.34 |
| Ember Bead | 18.00% | 0.5 RF | +0.48 |
| Copper Sigil | 15.00% | 0.75 RF | +0.65 |
| Silver Ink | 11.00% | 1.5 RF | +0.95 |
| Gold Rune | 9.00% | 2.5 RF | +1.30 |
| Prism Ember | 4.00% | 5 RF | +1.95 |
| First Flame | 1.00% | 10 RF | +3.10 |

- Expected return **0.9475 RF per sigil (~94.75%)**; the remaining ~5.25% is the
  community pool edge. The SDK check reports `expected reward 947500000000000000`.
- Kept sigils retain their fixed RF backing with **no redemption expiry**. Kept
  sigils and unsettled burns cannot share backing.
- Igniting books the sigil into your journal **and** grants its burst; the burst
  is a game effect, not extra RF.

## Race maths

- Track length **96 units**. Base runner speed **4.4 u/s**, Cyan Echo par speed
  **6.0 u/s (16.00 s)**. About seven well-timed ignites is a winning run.
- Ember charge decays at 0.55/s, so a burst is worth roughly 1–2 seconds of pace.
- Momentum builds while you lead the Echo and adds up to **+22%** speed; fall
  behind and it drains.
- Expected RF, maximum prize and the check output come from the SDK's own
  `parseChanceGame`/`expectedReward`, not from this document.

## Files

| File | What it holds |
| --- | --- |
| `index.tsx` | React game component: race state, SDK economy calls, HUD, menus, audio |
| `track.ts` | Custom canvas renderer: parallax scenery, canonical sprite atlas, particles, screen shake |
| `game.json` | Exact prices, outcome weights, rewards and consumable rules |
| `style.css` | Ink-and-ember art direction, motion and reduced-motion overrides |
| `host.css` | Trusted runtime layout (16/9, max width 1180px) |

## Artwork and audio

The runner sprite is the player's own Generations NFT, decoded from the on-chain
registry by `createFriendReader()` and admitted by the runtime's eligibility
check. Scenery, particles and effects are drawn procedurally inside the sandbox.
Sound cues come from the FriendSDK sound kit; sound starts muted and there is a
mute control in Settings. A **Reduce motion** switch removes shake, flash,
slow-motion and trails.

## Known limitations

- Simulated preview only: no live contracts, transactions, trading or creator fees.
- FriendSDK v0.1.2 exposes one consumable and one weighted table with no
  persistence or extra-currency APIs, so sigils are a single type, the journal is
  session-local and reloading resets progress.
- Portrait phones letterbox the 16/9 frame; landscape is recommended.
- If the chain artwork read fails, the game still runs and labels the placeholder.

## Credits

Built with FriendSDK v0.1.2 (Apache-2.0). Uses the SDK runtime, canonical Friend
sprite reader, sound kit and frame components. All other artwork is generated in
code in this directory.
