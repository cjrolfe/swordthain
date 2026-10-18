import { test, expect, seedSession } from "./fixtures.js";
import { assertNoWcagViolations } from "../src/axe.js";
import { createSyntheticItem, deleteSyntheticItem } from "../src/db.js";

/**
 * The Owner-only "Move" control on a media item opens the same destination
 * picker the folder Move uses. Needs a real item in the CI Test folder to
 * click on — creates its own disposable synthetic one (src/db.ts) and
 * removes it afterward regardless of pass/fail, same pattern as modal.spec.ts.
 * Only opens, scans, and cancels: actually moving is covered against the
 * real API by infra/regression-tests' move-media scenario.
 */
test.describe("Folders — Owner: move a media item", () => {
  let photoId: string;

  test.beforeEach(async ({ page, ownerSession }) => {
    photoId = await createSyntheticItem("photo");
    await seedSession(page, ownerSession);
    await page.goto("/");
    await page.getByRole("button", { name: "📁 CI Test" }).click();
    await expect(page.getByRole("button", { name: "Move a11y-test-photo.jpg" })).toBeVisible();
  });

  test.afterEach(async () => {
    await deleteSyntheticItem(photoId);
  });

  test("move picker: focus, disabled until a folder is chosen, no WCAG violations, Cancel closes it", async ({ page }) => {
    await page.getByRole("button", { name: "Move a11y-test-photo.jpg" }).click();

    const picker = page.getByRole("group", { name: "Move a11y-test-photo.jpg" });
    await expect(picker).toBeVisible();
    await expect(picker).toBeFocused();
    // Media always lives in a real folder, so nothing can be moved to the
    // top level — "Move here" stays disabled until a folder is opened.
    await expect(picker.getByRole("button", { name: "Move here" })).toBeDisabled();
    await assertNoWcagViolations(page, "Folders (Owner) — media move picker");

    await picker.getByRole("button", { name: "Cancel" }).click();
    await expect(picker).not.toBeVisible();
  });
});
