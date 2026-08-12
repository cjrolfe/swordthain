import { test, expect, seedSession } from "./fixtures.js";
import { assertNoWcagViolations } from "../src/axe.js";

test.describe("Storage — Owner", () => {
  test("default view", async ({ page, ownerSession }) => {
    await seedSession(page, ownerSession);
    await page.goto("/");
    await page.getByRole("button", { name: "Storage" }).click();
    await expect(page.getByRole("heading", { name: "Total storage" })).toBeVisible();
    await assertNoWcagViolations(page, "Storage — default view");
  });
});
