import { test, expect, seedSession } from "./fixtures.js";
import { assertNoWcagViolations } from "../src/axe.js";

test.describe("Friends — Owner", () => {
  test("default view", async ({ page, ownerSession }) => {
    await seedSession(page, ownerSession);
    await page.goto("/");
    await page.getByRole("button", { name: "Friends" }).click();
    await expect(page.getByRole("heading", { name: "Invite a friend" })).toBeVisible();
    await assertNoWcagViolations(page, "Friends — default view");
  });
});
