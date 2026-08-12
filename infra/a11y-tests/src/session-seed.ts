import type { Page } from "@playwright/test";
import type { Session } from "./auth.js";

// Matches apps/media-app/src/auth.ts's STORAGE_KEY exactly — the app reads
// this synchronously on mount (App.tsx's loadSession()) and skips the Login
// screen entirely if it's present and parses as valid JSON. Seeding it via
// addInitScript (runs before any page script, including the app's own)
// means we never touch the live OTP UI at all.
const STORAGE_KEY = "swordthain_session";

/** Seeds a session into localStorage before the app's own scripts run, so it loads already signed in. */
export async function seedSession(page: Page, session: Session): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key, value);
    },
    [STORAGE_KEY, JSON.stringify(session)]
  );
}
