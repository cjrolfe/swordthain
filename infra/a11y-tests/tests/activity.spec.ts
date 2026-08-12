import { test, expect, seedSession } from "./fixtures.js";
import { assertNoWcagViolations } from "../src/axe.js";

test.describe("Activity — Owner", () => {
  test("default view", async ({ page, ownerSession }) => {
    await seedSession(page, ownerSession);
    await page.goto("/");
    await page.getByRole("button", { name: "Activity" }).click();
    await expect(page.getByText("Pick a folder and/or a friend")).toBeVisible();
    await assertNoWcagViolations(page, "Activity — default view");
  });
});
