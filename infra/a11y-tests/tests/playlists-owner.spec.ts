import { test, expect, seedSession } from "./fixtures.js";
import { assertNoWcagViolations } from "../src/axe.js";

test.describe("Playlists — Owner", () => {
  test.beforeEach(async ({ page, ownerSession }) => {
    await seedSession(page, ownerSession);
    await page.goto("/");
    await page.getByRole("button", { name: "Playlists" }).click();
    await expect(page.getByRole("heading", { name: "New playlist" })).toBeVisible();
  });

  test("default view", async ({ page }) => {
    await assertNoWcagViolations(page, "Playlists (Owner) — default view");
  });

  test("open a playlist", async ({ page }) => {
    // "Test" is a real, permanent playlist (not created/cleaned up by any
    // test suite) — used read-only here, same as infra/regression-tests
    // avoids mutating anything outside the CI Test folder.
    const playlistButton = page.getByRole("button", { name: /🎞️ Test/ });
    const found = await playlistButton
      .waitFor({ state: "visible", timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (!found) test.skip(true, 'No "Test" playlist exists to open.');
    await playlistButton.click();
    await expect(page.getByRole("heading", { name: '"Test"' })).toBeVisible();
    await assertNoWcagViolations(page, "Playlists (Owner) — playlist open");
  });
});
