import { test, expect, seedSession } from "./fixtures.js";
import { assertNoWcagViolations } from "../src/axe.js";

test.describe("Folders — Owner", () => {
  test.beforeEach(async ({ page, ownerSession }) => {
    await seedSession(page, ownerSession);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Swordthain Admin" })).toBeVisible();
  });

  test("default view", async ({ page }) => {
    await assertNoWcagViolations(page, "Folders (Owner) — default view");
  });

  test("rename UI state", async ({ page }) => {
    const row = page.getByRole("button", { name: "📁 CI Test" }).locator("..");
    await row.getByRole("button", { name: "Rename" }).click();
    await expect(page.getByLabel('Rename "CI Test"')).toBeVisible();
    await assertNoWcagViolations(page, "Folders (Owner) — rename UI state");
    await page.getByRole("button", { name: "Cancel" }).click();
  });

  test("move picker", async ({ page }) => {
    const row = page.getByRole("button", { name: "📁 CI Test" }).locator("..");
    await row.getByRole("button", { name: "Move" }).click();
    await expect(page.getByText('Move "CI Test" to:')).toBeVisible();
    await assertNoWcagViolations(page, "Folders (Owner) — move picker");
    await page.getByRole("button", { name: "Cancel" }).click();
  });
});
