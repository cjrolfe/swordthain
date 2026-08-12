import { test, expect, seedSession } from "./fixtures.js";
import { assertNoWcagViolations } from "../src/axe.js";

test.describe("Playlists — Member (synthetic session)", () => {
  test("default view", async ({ page, memberSession }) => {
    await seedSession(page, memberSession);
    await page.goto("/");
    await page.getByRole("button", { name: "Playlists" }).click();
    await expect(page.getByRole("heading", { name: "Create a playlist" })).toBeVisible();
    await assertNoWcagViolations(page, "Playlists (Member) — default view");
  });
});
