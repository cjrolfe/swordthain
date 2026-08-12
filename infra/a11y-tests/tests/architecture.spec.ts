import { test, expect, seedSession } from "./fixtures.js";
import { assertNoWcagViolations } from "../src/axe.js";

test.describe("Architecture — Owner", () => {
  test("default view", async ({ page, ownerSession }) => {
    await seedSession(page, ownerSession);
    await page.goto("/");
    await page.getByRole("button", { name: "Architecture" }).click();
    // Mermaid renders the diagrams asynchronously (Architecture.tsx's
    // mermaid.render() in a useEffect) — wait for the first one before
    // scanning, otherwise axe would only ever see the "Rendering…" hint.
    await expect(page.locator(".diagram-frame").first()).toBeVisible();
    await assertNoWcagViolations(page, "Architecture — default view");
  });
});
