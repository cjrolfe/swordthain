import { test, expect, seedSession } from "./fixtures.js";
import { assertNoWcagViolations } from "../src/axe.js";

test.describe("Permissions — Owner", () => {
  test.beforeEach(async ({ page, ownerSession }) => {
    await seedSession(page, ownerSession);
    await page.goto("/");
    await page.getByRole("button", { name: "Permissions" }).click();
  });

  test("default view", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Friends" })).toBeVisible();
    await assertNoWcagViolations(page, "Permissions — default view");
  });

  test("friend selected", async ({ page }) => {
    const firstFriend = page.locator(".permissions-friend-list button").first();
    const found = await firstFriend
      .waitFor({ state: "visible", timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (!found) test.skip(true, "No friends to select.");
    await firstFriend.click();
    await assertNoWcagViolations(page, "Permissions — friend selected");
  });
});
