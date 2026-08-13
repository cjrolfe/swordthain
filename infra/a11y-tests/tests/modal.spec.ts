import { test, expect, seedSession } from "./fixtures.js";
import { assertNoWcagViolations } from "../src/axe.js";
import { createSyntheticItem, deleteSyntheticItem } from "../src/db.js";

/**
 * Lightbox and PlaylistPlayer both need a real, openable media item — the
 * CI Test folder isn't guaranteed to have one at scan time (infra/
 * regression-tests cleans up after itself), so this creates its own
 * disposable synthetic photo + video (src/db.ts) and removes them in
 * afterEach regardless of pass/fail, same pattern as infra/regression-
 * tests/src/scenarios/playlists.ts.
 *
 * The PlaylistPlayer case also needs a real playlist to add the synthetic
 * video to — it creates and deletes its OWN throwaway playlist per test
 * run (try/finally, not just at the end of the happy path) rather than
 * reusing the permanent "Test" playlist other manual verification this
 * session used; a real playlist a real person might reference shouldn't
 * accumulate test pollution if an assertion throws mid-test. Deleting a
 * playlist removes its items too (infra/lambda/media/playlists.ts's
 * deletePlaylist queries and deletes every PlaylistItems row first), so
 * one cleanup step handles both.
 */
test.describe("Modal focus trap — Lightbox & PlaylistPlayer", () => {
  let photoId: string;
  let videoId: string;

  test.beforeEach(async () => {
    photoId = await createSyntheticItem("photo");
    videoId = await createSyntheticItem("video");
  });

  test.afterEach(async () => {
    await Promise.allSettled([deleteSyntheticItem(photoId), deleteSyntheticItem(videoId)]);
  });

  test("Lightbox: focus trap, ARIA, and Escape-restores-focus", async ({ page, ownerSession }) => {
    await seedSession(page, ownerSession);
    await page.goto("/");
    await page.getByRole("button", { name: "📁 CI Test" }).click();

    const thumbButton = page.locator(".media-grid .thumb-photo");
    await thumbButton.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(page.getByRole("button", { name: "Close" })).toBeFocused();
    await assertNoWcagViolations(page, "Lightbox — open");

    // Only the close button is focusable in this state — Tab should keep
    // focus trapped there rather than escaping to the page behind it.
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Close" })).toBeFocused();
    await expect(dialog).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(thumbButton).toBeFocused();
  });

  test("PlaylistPlayer: focus trap, ARIA, and Escape-restores-focus", async ({ page, ownerSession }) => {
    // Generous relative to the ~3s this normally takes. Confirmed via
    // Playwright trace inspection: axe-core's own runPartial() scan has
    // real runtime variance unrelated to anything this test controls —
    // observed 1-13s across ~35 local runs, and a full 90s once in real
    // CI. An early timeout here also leaves an orphaned throwaway
    // playlist since the finally block never gets to run (the self-
    // healing sweep above cleans that up on the next run either way).
    test.setTimeout(180_000);

    // Auto-accept the native confirm() the Delete button triggers in the
    // finally block below — must be registered before that click happens.
    page.on("dialog", (d) => d.accept());

    const playlistName = `a11y-modal-test-${Date.now()}`;

    await seedSession(page, ownerSession);
    await page.goto("/");
    await page.getByRole("button", { name: "Playlists" }).click();

    // Self-healing: remove any throwaway playlist a previous crashed run
    // left behind (e.g. hit the timeout before its own cleanup ran) so
    // debris doesn't accumulate indefinitely. Waits (bounded) for a stale
    // match on every iteration, not just a count() check — the playlist
    // list loads asynchronously, and count() doesn't auto-wait the way
    // .click()/expect() do, so a plain count()===0 check races the load
    // and wrongly concludes there's nothing to clean up. Confirmed by
    // testing (twice — an earlier fix that waited on the always-present
    // "New playlist" heading instead of the actual list data also failed
    // this same way): two real orphaned playlists survived several runs
    // with either the missing wait or the wrong one.
    const staleNamePattern = /🎞️ a11y-modal-test-/;
    while (true) {
      const stale = page.getByRole("button", { name: staleNamePattern }).first();
      const found = await stale
        .waitFor({ state: "visible", timeout: 3000 })
        .then(() => true)
        .catch(() => false);
      if (!found) break;
      await stale.locator("..").getByRole("button", { name: "Delete" }).click();
      await stale.waitFor({ state: "detached" }).catch(() => {});
    }

    await page.getByPlaceholder("Playlist name").fill(playlistName);
    await page.getByRole("button", { name: "Create" }).click();
    const playlistNamePattern = new RegExp(`🎞️ ${playlistName}`);
    await expect(page.getByRole("button", { name: playlistNamePattern })).toBeVisible();

    try {
      await page.getByRole("button", { name: "Folders" }).click();
      await page.getByRole("button", { name: "📁 CI Test" }).click();
      await page.getByLabel("Add a video to a playlist:").selectOption({ label: playlistName });
      await page
        .locator(".media-grid .thumb-video")
        .locator("..")
        .getByRole("button", { name: "+ Playlist" })
        .click();

      await page.getByRole("button", { name: "Playlists" }).click();
      await page.getByRole("button", { name: playlistNamePattern }).click();
      const playButton = page.getByRole("button", { name: "▶ Play" });
      await playButton.click();

      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAttribute("aria-modal", "true");
      await expect(page.getByRole("button", { name: "Close" })).toBeFocused();

      // Belt-and-suspenders: let the synthetic video's load-and-fail cycle
      // settle (.hint = skip notice, .empty = "nothing left to play")
      // before scanning. NOT confirmed to fix anything — trace inspection
      // showed axe-core's own runPartial() taking 10s+ even after this
      // already resolved, so its runtime variance is real and unrelated
      // to page/video state (see test.setTimeout's comment above). Kept
      // anyway since it's cheap and can't hurt.
      await page
        .locator(".hint, .empty")
        .first()
        .waitFor({ state: "visible", timeout: 10000 })
        .catch(() => {});
      await assertNoWcagViolations(page, "PlaylistPlayer — open");

      // Tab through every focusable control and confirm it never leaves
      // the dialog, however many enabled buttons happen to be present
      // (the video element itself is synthetic and will fail to load,
      // which can disable Skip mid-test — the trap must still hold).
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press("Tab");
        await expect(dialog).toBeVisible();
        const stillInside = await page.evaluate(() => {
          const dialogEl = document.querySelector('[role="dialog"]');
          return !!dialogEl && dialogEl.contains(document.activeElement);
        });
        expect(stillInside).toBe(true);
      }

      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
      await expect(playButton).toBeFocused();
    } finally {
      // Always runs, even if an assertion above threw — deleting the
      // playlist removes its item(s) too, so this is the only cleanup
      // this playlist needs.
      await page.getByRole("button", { name: "Playlists" }).click();
      const row = page.getByRole("button", { name: playlistNamePattern }).locator("..");
      await row.getByRole("button", { name: "Delete" }).click();
    }
  });
});
