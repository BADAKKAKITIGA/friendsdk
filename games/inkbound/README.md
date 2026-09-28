# Inkbound — a Rare Friends action platformer · FriendSDK v0.1.2

Inkbound is a hand-controlled action platformer. Your hardwired Generations NFT
is the hero: run, double jump, dash and slash through three zones of shadow
wisps and flyers, gather ember motes, and unseal the Ember Gate. Sealed sigils
bought with RF ignite mid-run for a surge that heals you and doubles your slash.

The SDK runtime supplies wallet connection, owned-Friend discovery, the fresh
hardwired Generations NFT (generation ≥ 1) eligibility check, the sandbox and
confirmations. Every playable prototype requires an eligible NFT, including this
simulated preview.

## Run it

```sh
npm ci
npm run build
npm run dev:game -- games/inkbound
```

Checks:

```sh
npx friendsdk check games/inkbound
node scripts/check-games.mjs
npx friendsdk test games/inkbound
npx playwright install --with-deps chromium
node games/inkbound/check.mjs ./artifacts
```

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Move | `A` `D` / `←` `→` | `◀` `▶` |
| Jump (double jump) | `Space` | **JUMP** |
| Slash | `J` / `K` / `F` | **SLASH** |
| Dash (18 Ember) | `Shift` | **DASH** |
| Ignite a sealed sigil | `E` | **IGNITE** |

## Objectives

Every zone is sealed until you do the work:

- Destroy **60%** of the zone's shadows (walkers take 2 hits, flyers take 1).
- Gather **40%** of the zone's ember motes. Motes also refill Ember.
- Then the **Ember Gate** unlocks (the bar turns green and the gate glows).
- Falling, spikes and contact cost 1 of 5 hearts, with 1.5s of invulnerability.

Three zones: Ember Shore, Ash Garden, Hollow Gate. Each has its own palette,
layout, platform set, hazards and enemy mix.

## Rules and economy

Every number below is simulated for the preview and resets on reload.

- **Sealed Ember Sigil** — the consumable. Price **1 RF**, reserves **10 RF** (the table's highest prize).
- The table has **8 outcomes, weights total 10,000 basis points**:

| Sigil | Chance | Redemption | Surge |
| --- | --: | --: | --: |
| Ash Wisp | 20.00% | 0 RF | 6.0s |
| Coal Fleck | 22.00% | 0.25 RF | 6.8s |
| Ember Bead | 18.00% | 0.5 RF | 7.2s |
| Copper Sigil | 15.00% | 0.75 RF | 7.6s |
| Silver Ink | 11.00% | 1.5 RF | 8.3s |
| Gold Rune | 9.00% | 2.5 RF | 9.1s |
| Prism Ember | 4.00% | 5 RF | 10.7s |
| First Flame | 1.00% | 10 RF | 13.4s |

- Expected return **0.9475 RF per sigil (~94.75%)**; the remaining ~5.25% is the community pool edge. The SDK check reports `expected reward 947500000000000000`.
- Igniting always heals (1 heart, or 2 for a Prism Ember / First Flame), refills Ember and starts a surge. Surge multiplies move speed ×1.35 and doubles slash damage.
- Kept sigils retain their fixed RF backing with **no redemption expiry**; pending ignitions and kept sigils cannot share backing.

## Files

| File | What it holds |
| --- | --- |
| `index.tsx` | React shell: phases, HUD, controls, menus, SDK economy calls, audio |
| `world.ts` | Engine: input, physics, enemies, motes, gate logic, procedural canvas renderer |
| `game.json` | Exact price, outcome weights, rewards and consumable rules |
| `style.css` | Ink-and-ember UI, motion, reduced-motion overrides |
| `host.css` | Trusted runtime layout (16/9, max width 1180px) |
| `check.mjs` | Browser check that drives the real sandboxed runtime |

## Artwork and audio

The hero sprite is the player's own Generations NFT, decoded from the on-chain
registry by `createFriendReader()`. The lobby portrait uses the same canonical
frames. Terrain, forest, reeds, particles and effects are drawn procedurally in
the sandbox. Sound uses the FriendSDK sound kit; sound starts muted and Settings
has a mute control and a **Reduce motion** switch.

## Known limitations

- Simulated preview only: no live contracts, transactions, trading or creator fees.
- FriendSDK v0.1.2 exposes one consumable and one weighted table, so sigils are a
  single type and progress is session-local; reloading resets the run.
- Each ignite needs a host confirmation, which pauses the game while the dialog is open.
- Portrait phones letterbox the 16/9 frame; landscape is recommended.

## Credits

Built with FriendSDK v0.1.2 (Apache-2.0). Uses the SDK runtime, the canonical
Friend sprite reader, the sound kit and the frame/menu components under
[NOTICE.md](https://github.com/spokesz/friendsdk/blob/main/NOTICE.md). All other
artwork is generated in code in this directory.
