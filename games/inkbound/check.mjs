/**
 * Inkbound browser check — real sandboxed runtime, read-only fixtures, mock wallet.
 * Run: node games/inkbound/check.mjs
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
      await page.waitForTimeout(280);
    };
    const closeMenu = async () => { await game.locator(".rf-frame-menu button[aria-label^='Close']").first().click(); await page.waitForTimeout(200); };

    await frame.screenshot({ path: `${out}/inkbound-1-gate.png` });

    // Buy a hand of sigils: one SDK call, one host confirmation.
    await game.getByRole("button", { name: /Sigil shop/ }).click();
    await page.waitForTimeout(220);
    await game.getByRole("button", { name: /Buy five/ }).click();
    await confirm();
    const shop = await game.locator(".rf-frame-menu").innerText();
    assert.match(shop, /You hold 5 sealed sigils/, `expected five sigils, saw: ${shop}`);
    assert.match(shop, /15 RF/, "expected the simulated balance to drop by 5 RF");
    await closeMenu();

    // Run and ignite.
    await game.getByRole("button", { name: /Start the run/ }).click();
    await page.waitForTimeout(650);
    assert.equal(await game.locator(".ink-racebar").count(), 1, "the race bar should be visible during a run");
    for (let index = 0; index < 6; index += 1) {
      if (await game.locator(".ink-result-panel").count()) break;
      await page.keyboard.press("Space");
      await page.waitForTimeout(180);
      await confirm();
      await page.waitForTimeout(240);
      if (index === 1) await frame.screenshot({ path: `${out}/inkbound-2-race.png` });
    }
    const hud = await game.locator(".ink-hud").innerText();
    assert.match(hud, /RACE CLOCK/, "the race clock should be present");
    assert.match(hud, /VS CYAN ECHO/, "the Echo gap indicator should be present");

    // Finish the race.
    for (let index = 0; index < 90; index += 1) {
      if (await game.locator(".ink-result-panel").count()) break;
      await page.waitForTimeout(300);
    }
    assert.equal(await game.locator(".ink-result-panel").count(), 1, "the result panel should appear at the gate");
    const result = await game.locator(".ink-result-panel").innerText();
    assert.match(result, /GATE REACHED FIRST|THE ECHO WAS FASTER/, `unexpected verdict: ${result}`);
    assert.match(result, /PERFECT IGNITES/, "the result should report timing accuracy");
    await frame.screenshot({ path: `${out}/inkbound-3-result.png` });

    // The journal keeps what you burned, and redemption needs one confirmation.
    await game.getByRole("button", { name: /Sigil journal/ }).click();
    await page.waitForTimeout(250);
    const rows = await game.locator(".ink-row").count();
    assert.equal(rows, 8, `expected 8 journal rows, saw ${rows}`);
    const redeemable = game.locator(".ink-row button:not([disabled])").first();
    if (await redeemable.count()) { await redeemable.click(); await confirm(); }
    await closeMenu();

    // Reduced motion and mute stay reachable.
    await game.getByRole("button", { name: "Settings" }).click();
    await page.waitForTimeout(200);
    assert.equal(await game.getByLabel("Reduce motion").isChecked(), true, "the fixture requests reduced motion");
    await game.getByRole("button", { name: "Sound off" }).click();
    await game.getByRole("button", { name: "Sound on" }).waitFor();
    await closeMenu();
    console.log(`checked: ${shop.split("\n").filter(Boolean).length} shop lines, ${rows} journal rows`);
  },
});

console.log("Inkbound browser check passed.");
