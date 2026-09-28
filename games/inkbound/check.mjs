/**
 * Inkbound browser check — real sandboxed runtime, read-only fixtures, mock wallet.
 * Run: node games/inkbound/check.mjs ./artifacts
 */
import { testGame } from "../../scripts/testing.mjs";
import assert from "node:assert/strict";

const out = process.argv[2] ?? "./artifacts";

await testGame("games/inkbound", {
  width: 1180,
  height: 760,
  check: async ({ game, page }) => {
    const frame = page.locator(".rf-game-frame");
    const confirm = async () => {
      const button = page.getByRole("button", { name: "Confirm preview", exact: true });
      try { await button.waitFor({ state: "visible", timeout: 6_000 }); } catch { return; }
      await button.click();
      await page.waitForTimeout(260);
    };
    const closeMenu = async () => { await game.locator(".rf-frame-menu button[aria-label^='Close']").first().click(); await page.waitForTimeout(200); };
    const panelShown = async () => (await game.locator(".ink-banner, .ink-panel").count()) > 0;

    // Lobby
    await game.locator(".ink-lobby").waitFor({ state: "visible" });
    assert.equal(await game.locator(".ink-portrait").count(), 1, "the lobby should show the Friend portrait canvas");
    await frame.screenshot({ path: `${out}/inkbound-1-lobby.png` });

    // Buy a hand of sigils: one SDK call, one host confirmation.
    await game.getByRole("button", { name: /Sigil shop/ }).click();
    await page.waitForTimeout(220);
    await game.getByRole("button", { name: /Buy five/ }).click();
    await confirm();
    const shop = await game.locator(".rf-frame-menu").innerText();
    assert.match(shop, /You hold 5 sealed sigils/, `expected five sigils, saw: ${shop}`);
    await closeMenu();

    // Play: run right, jump, slash, on a loop.
    await game.getByRole("button", { name: "Enter the run" }).click();
    await page.waitForTimeout(400);
    assert.equal(await game.locator(".ink-hearts").count(), 1, "the health row should be visible in play");
    await game.locator(".ink-bars").waitFor({ state: "visible" });

    let shot = false;
    await page.keyboard.down("ArrowRight");
    for (let index = 0; index < 70; index += 1) {
      if (await panelShown()) break;
      await page.keyboard.press("Space");
      await page.waitForTimeout(90);
      await page.keyboard.press("KeyJ");
      await page.waitForTimeout(110);
      if (!shot && index === 8) { await frame.screenshot({ path: `${out}/inkbound-2-play.png` }); shot = true; }
    }

    // Ignite a sigil mid-play if we are still live.
    if (!(await panelShown())) {
      await page.keyboard.press("KeyE");
      await confirm();
      await page.waitForTimeout(420);
      await frame.screenshot({ path: `${out}/inkbound-3-surge.png` });
    }
    await page.keyboard.up("ArrowRight");

    const live = await game.locator(".ink-hud").count();
    if (live) {
      const hud = await game.locator(".ink-hud").innerText();
      const bars = await game.locator(".ink-bars").innerText();
      assert.match(hud, /ZONE \d/, `zone tag should be present, saw: ${hud}`);
      assert.match(bars, /SHADOWS \d+\/\d+/, `shadow objective missing, saw: ${bars}`);
      assert.match(bars, /MOTES \d+\/\d+/, `mote objective missing, saw: ${bars}`);
      const engaged = Number((hud.match(/(\d+)\nKILLS/) ?? [])[1] ?? 0) + Number((hud.match(/(\d+)\nMOTES/) ?? [])[1] ?? 0);
      console.log("HUD:", hud.replace(/\n+/g, " | "), "||", bars.replace(/\n+/g, " | "));
      assert(engaged > 0, "the player must be able to fight and collect while playing");
    } else {
      const text = await game.locator(".ink-banner, .ink-panel").first().innerText();
      console.log("panel:", text.replace(/\n+/g, " | "));
    }

    // Keep going; a clear banner, a retry panel, or a live run are all valid.
    if (!(await panelShown())) {
      await page.keyboard.down("ArrowRight");
      for (let index = 0; index < 60 && !(await panelShown()); index += 1) {
        await page.keyboard.press("Space");
        await page.waitForTimeout(100);
        await page.keyboard.press("KeyJ");
        await page.waitForTimeout(120);
      }
      await page.keyboard.up("ArrowRight");
    }
    await page.waitForTimeout(400);
    await frame.screenshot({ path: `${out}/inkbound-4-outcome.png` });
    const banner = await game.locator(".ink-banner, .ink-panel").count();
    const playing = await game.locator(".ink-hearts").count();
    assert(banner + playing >= 1, "the run should still be live or show a clear/retry panel");
    console.log("outcome panels:", banner, "| still playing:", playing);
  },
});

console.log("Inkbound browser check passed.");
