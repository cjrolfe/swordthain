# Swordthain Accessibility Tests

Automated WCAG 2.1 AA checks against the real deployed `apps/media-app` — no OTP needed. Signs in as the same fixed-OTP Owner test account `infra/regression-tests` uses (`ci-test@swordthain.com`), seeds a signed-in session directly into the browser (skipping the live Login UI), and runs [axe-core](https://github.com/dequelabs/axe-core) against every tab and several interactive states, for both the Owner and (via a synthetic session) Member views.

## Running it

```bash
npm install
npx playwright install --with-deps chromium
npm test
```

Needs AWS credentials for `ssm:GetParameter` on `/swordthain/regression-test/otp-code` (same fixed sign-in code `infra/regression-tests` uses) and `dynamodb:PutItem`/`DeleteItem` on `swordthain-media-items` (`tests/modal.spec.ts`'s synthetic photo/video fixture — see `src/db.ts`). Locally, ambient credentials with broader access work fine. In CI, `swordthain-a11y-test-ci` (`infra/lib/ci-stack.ts`) is scoped to exactly those two things.

By default this targets the real deployed site (`https://swordthain.com`). Point it at a local dev server instead while iterating:

```bash
SWORDTHAIN_A11Y_BASE_URL=http://localhost:5173 npm test
```

## What it covers

- **Login** — the unauthenticated email/code screens, including the wrong-code error state.
- **Folders, Playlists** — default view for both Owner and a synthetic Member session, plus the folder rename/move-picker UI states (pure client-side toggles, no data mutation).
- **Permissions, Friends, Activity, Storage, Architecture** — Owner-only tabs, default view (Architecture waits for its Mermaid diagrams to actually render before scanning).
- **Modal focus trap** (`modal.spec.ts`) — opens both `Lightbox` and `PlaylistPlayer` against disposable synthetic media, and beyond the axe scan, explicitly drives `Tab`/`Escape` to confirm focus is trapped inside the dialog and restored to the trigger on close — axe only checks static ARIA attributes, not runtime focus behavior, so this needs real keyboard-event assertions.

Every check runs against `["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]` (`src/axe.ts`) — Level A and AA, WCAG 2.0 and the 2.1 additions. Fails the run (non-zero exit) on any violation.

**Not covered yet**: `apps/playground`/`labs.swordthain.com` — deferred to a later pass, same as `infra/regression-tests`. Video captioning (WCAG 1.2.2) is a deliberate accepted gap, not an oversight — this is a private family video archive with no realistic spoken-word/captioning need.

## Everything happens inside one folder (or a throwaway playlist)

Synthetic media created for `modal.spec.ts` lives only in the "CI Test" folder (`29b9e0e4-6440-4efd-813d-5f4281b77bd3`) and is deleted in `afterEach` regardless of pass/fail. The `PlaylistPlayer` case needs a real playlist too — rather than reusing the permanent "Test" playlist (shared with manual verification and real usage), it creates and deletes its own uniquely-named throwaway playlist per run inside a `try`/`finally`, plus a self-healing sweep at the start of the test that removes any `a11y-modal-test-*` playlist a previous crashed run left behind. Deleting a playlist removes its items too (`infra/lambda/media/playlists.ts`'s `deletePlaylist`), so no separate item-level cleanup is needed.

The self-healing sweep took two attempts to get right (13 Aug 2026) — worth recording since the same mistake is easy to repeat elsewhere in this suite: `Locator.count()` doesn't auto-wait the way `.click()`/`expect()` do, so checking it immediately after switching tabs races the playlist list's async load and silently concludes there's nothing to clean up. The fix waits (bounded, per iteration) for an actual stale-playlist match rather than checking a count, and re-queries fresh on every loop iteration rather than pre-resolving a `.all()` snapshot (which goes stale after the first delete re-renders the list).

## A known source of test-timing variance: axe-core itself

`tests/modal.spec.ts`'s `PlaylistPlayer` test occasionally takes 10-15s instead of its usual ~2-5s (and, once, the full 90s budget in real CI before the timeout was raised to 180s). Confirmed via Playwright trace inspection (`--trace on`, then diffing action timings) that the slow part is `axe-core`'s own `runPartial()` scan, not anything this test or the app does — it happens even when the scan runs well after the synthetic video's load-and-fail cycle has settled. Treat this as an accepted, bounded source of variance in this specific test rather than a bug to keep chasing; the generous timeout exists because of it.

## Member-view coverage

There's only one test account (`ci-test@swordthain.com`, Owner-privileged). Rather than provisioning a second real Cognito user, `src/auth.ts`'s `buildSyntheticMemberSession` takes a real Owner session and swaps its ID token's payload for one with no `cognito:groups` claim — not cryptographically valid, but sufficient, since `apps/media-app`'s frontend never verifies the JWT signature client-side (it only decodes the payload — see `apps/media-app/src/auth.ts`'s `isOwner()`). The real API *does* verify the signature and will reject this token, so Member-view specs only exercise the Member-only rendering branches and their error/empty states, not real data — the Owner-session specs already cover the shared component tree with real data.

## Adding a new page or state

Add a `*.spec.ts` file in `tests/`, using `tests/fixtures.ts`'s `ownerSession`/`memberSession` fixtures (both worker-scoped — one real Cognito sign-in per worker, not per test) and `src/axe.ts`'s `assertNoWcagViolations(page, context)`. Seed the session with `seedSession(page, session)` before `page.goto()`.

## Why a separate package from `infra/regression-tests`

Same self-contained-package pattern, kept separate so the functional and accessibility regression suites can be run and fail independently — this one needs Playwright + a real browser, that one doesn't.
