import { test, expect, seedSession } from "./fixtures.js";
import { assertNoWcagViolations } from "../src/axe.js";

// The synthetic Member session (see src/auth.ts's buildSyntheticMemberSession)
// isn't signature-valid, so the real API rejects it — this exercises the
// Member-only rendering branches and their error/empty states, not real
// data. The Owner-session specs already cover the shared component tree
// with real data; this is specifically about markup unique to isOwner=false.
test.describe("Folders — Member (synthetic session)", () => {
  test("default view", async ({ page, memberSession }) => {
    await seedSession(page, memberSession);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Swordthain" })).toBeVisible();
    await assertNoWcagViolations(page, "Folders (Member) — default view");
  });
});
