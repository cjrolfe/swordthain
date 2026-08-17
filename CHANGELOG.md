# Changelog

All notable changes to this project, by release date. Each entry corresponds to an annotated git tag (`vYYYY.MM.DD`) — see `git tag -l` or the [Releases page](https://github.com/cjrolfe/swordthain/releases).

This history was reconstructed retroactively (12 Aug 2026) from git log and `apps/media-app/BACKLOG.md`. The 10–12 Aug entries are detailed and cross-checked against BACKLOG.md's own dated entries; earlier entries are concise summaries derived from commit messages, not a full diff-by-diff account — honest about being reconstructed, not live-tracked from day one.

## [2026.08.17]

- **Playlist orphaned-item cascade cleanup** — deleting a media item now removes any `PlaylistItems` rows referencing it, across every playlist that has it (new `byMedia` GSI on `PlaylistItemsTable`, queried by `deleteMedia`), and decrements each affected playlist's `itemCount` correctly. Previously the row was only ever tolerated as an advisory `available: false` at read time, accumulating forever. Going forward only — any orphans from the 11–17 Aug window weren't backfilled, since they're already tolerated the same way today.

## [2026.08.14]

- **`light-dark()` fallback for older browsers** — found live on an LG WebOS smart-TV browser: unreadable text/missing backgrounds app-wide. `apps/media-app/src/styles.css` uses the CSS `light-dark()` function extensively; TV browsers often run an older engine that doesn't support it, and an unsupported CSS value drops the entire declaration, leaving color/background at inherited/initial defaults. Fixed by declaring a plain fallback value immediately before every `light-dark(...)` declaration — the standard progressive-enhancement pattern for this function. Re-verified the full WCAG 2.1 AA suite afterward — zero violations.

## [2026.08.13]

- **`infra/a11y-tests` CI flake fix** — `PlaylistPlayer`'s WCAG scan test occasionally took 10-15s instead of ~2-5s, once hitting the full 90s CI budget. Root-caused via Playwright trace inspection to `axe-core`'s own `runPartial()` scan having real, externally-caused runtime variance — mitigated with a generous, evidence-based 180s timeout plus CI failure-artifact capture (trace/screenshot/video on failure). Along the way, found and fixed a real bug in the test's own self-healing cleanup sweep (`Locator.count()` doesn't auto-wait, so it raced the playlist list's async load and left orphaned test playlists behind).

## [2026.08.12]

- **"Shared with me" list** — a folder nested under an unshared parent (e.g. moved under a new year-folder via Move) was real but unreachable for the Member it was shared with: access cascades downward from a shared ancestor, never upward to reveal the path to a deeper share. New `GET /folders/shared-with-me` lists every folder explicitly shared with the caller, with ancestor titles for display context only. Caught live against a real share that had gone quietly unreachable.
- **Automated regression-test suite** — `infra/regression-tests`, no OTP required (a dedicated, Owner-privileged test account with a fixed code, narrowly special-cased in `create-auth-challenge.ts`). Runs automatically after every deploy via `.github/workflows/regression-test.yml`; catches real gaps — its first live CI run correctly failed on a missing IAM grant the suite needed for its own test fixture, fixed the same day.
- **Friend-view clarity fixes** — clearer "add to playlist" picker wording for non-technical invitees, a larger/bolder media caption (was 12px at every screen width below 1600px), and a `visibilitychange`/`focus` listener so an already-open folder view picks up an Owner's description edit without a manual reload.
- **WCAG 2.1 AA conformance for `apps/media-app`** — heading hierarchy, table row headers, `aria-current` on tab nav, labels/`aria-label`s on previously-unlabeled inputs and icon-only controls, `role="status"`/`role="alert"` live regions, and color-contrast fixes across the app (base buttons, links, error/success text, the idle-warning banner, the Architecture legend, and the Lightbox/PlaylistPlayer dialogs' near-invisible text on their dark backdrop). `Lightbox`/`PlaylistPlayer` also gained a real modal focus trap (`components/Dialog.tsx`): `role="dialog"`, focus-on-open, Tab trapped inside, focus restored to the trigger on Escape/close.
- **Automated accessibility test suite** — `infra/a11y-tests`, Playwright + axe-core against every Owner/Member tab and several interactive states, including an explicit keyboard Tab-cycling check for the modal focus trap. Same fixed-OTP sign-in as the regression suite; runs automatically after every deploy via `.github/workflows/a11y-test.yml`.
- **`Paris.mp4` codec issue found and documented** — encoded with the old MPEG-4 Part 2 codec, which no browser can decode (audio plays, picture never renders). Confirmed via `ffprobe` and scanned the rest of the library (28 other videos, all `h264`) — a one-off, not systemic. Needs a re-export/re-upload at the file level.
- **Fix: fullscreen video button greyed out** — the CloudFront `Permissions-Policy` header set `fullscreen=()` alongside the camera/microphone/geolocation lockdown, disabling the Fullscreen API for the site itself, not just third parties. Scoped to `fullscreen=(self)`.

## [2026.08.11]

- **Delete media** — single-item delete for any photo/video, plus select-and-bulk-delete for photos. Removes both S3 objects (original + thumbnail) and the DB row.
- **Media description** — short (140 char) Owner-set text shown instead of the filename on every viewing surface (grid, Lightbox, playlist list/player); Activity log, CSV export, and downloads still use the real filename.
- **CLI upload fix** — files between ~2GB and 5GB were failing outright (Node's `fetch()` can't reliably send a single in-memory buffer body over ~2GiB). Lowered the CLI's multipart threshold to 1.9GiB so they route through the existing chunked upload instead.
- **CSP fix for browser uploads** — `connect-src` was missing the media S3 bucket, silently breaking every browser-initiated upload with a CSP-blocked "network error".
- **Folder sorting** — folders now sort alphabetically/numerically for both Owner and Member views.
- Added the standing documentation-sync rule to `CLAUDE.md` and caught up docs for the session.

## [2026.08.10]

- **Move folders** — `PATCH /folders/{id}` with `parentFolderId`, reparent anywhere in the tree via a breadcrumb-style destination picker. Rejects self-move (400) and move-into-own-descendant (409).
- Fixed a stale upload-status message persisting across folder switches, added a real upload progress percentage, and added `.m4v` video upload support.
- Added the CLI bulk-upload tool (`apps/media-app-cli`) with setup instructions in the admin console's Upload Tool tab.
- Addressed an external security assessment: DNS + CloudFront security headers, escalated DMARC to `p=reject`.
- Migrated `apps/playground`'s inline scripts to external files and enforced CSP there; fixed a couple of resulting CSP gaps (inline `style` attributes on labs.swordthain.com, Mermaid's rendered SVGs on swordthain.com).
- Fixed `deploy-playground.yml` deleting runtime-generated company pages on every deploy.
- Added the infrastructure architecture diagram (`infra/docs/architecture-diagram.html`) and an Architecture tab in the admin console, both generated from the real CDK stack definitions.
- Fixed `ThumbnailFn` running out of disk space (`ENOSPC`) on large video uploads.

## [2026.08.08]

- Shipped five backlog items in one push: guest upload, playlist reordering, new-share email notifications, invite-email live preview, and resumable multipart upload.
- Drafted the new-media-shared email notification design (backlog entry only, built out the same day).

## [2026.08.04]

- Renamed the VES page to "Vehicle APIs" and added MOT History (DVSA) alongside it, with friendlier labels — first API-testing provider needing OAuth2 client-credentials auth plus a separate API key.
- Fixed missing back-navigation on Company Demos pages.

## [2026.08.03]

- Added the "API Testing" playground to labs.swordthain.com (Weather, Police, then VES/DVLA), and playlists — editable, playback-only video queues for invitees.
- Fixed API-testing param defaults and a stale template link.
- Wrote per-app `BACKLOG.md` files and fixed stale docs; documented the playground's hub page and the `/demos/` reorganization.
- Recorded the Apple Photos upload finding in the backlog.
- Fixed low-contrast tab labels in the invitee theme.

## [2026.08.02]

- Added an admin Storage tab with WAF/API security alerting.
- Added Apple TV discovery notes as a reference doc.

## [2026.07.29]

- Improved invitee readability on TV-sized screens.
- Added a branded HTML version of the invite email.

## [2026.07.28]

- Fixed the video thumbnail Lambda's OOM failures, a folder-delete IAM gap, and enabled folder table point-in-time recovery.
- Replaced the login screen's background with a cinematic film-strip image and a serif heading font; brought the same theme to the invitee post-login view.
- Segregated media by type (photos/videos), scoped the film-frame decoration to videos, and added pagination.
- Fixed rotated thumbnails and hid the Download action for view-only invitees.

## [2026.07.27]

- Fixed an error-message leak and account-enumeration gap in sign-in for nonexistent accounts.
- Added the upload UI, fixed the Friends tab's title, and reworked Permissions into a friend-centric view.
- Documented a post-deployment verification checklist across both apps.
- Added idle-timeout auto sign-out with a 2-minute warning.

## [2026.07.21]

- Fixed a base64url-padding bug in the labs.swordthain.com stealth gate.
- Recorded and fixed a labs.swordthain.com cache-invalidation gap; repointed the playground CI role at its real CloudFront distribution.
- Added a VCR/VHS illustration to the login screen, then swapped it for a real tape photo.

## [2026.07.20]

- Added streaming/download (progressive playback, not adaptive HLS yet) and an activity dashboard.
- Hardened the media API (headers, rate limiting — the safe pieces only).
- Sourced ffmpeg from npm instead of a third-party binary host.
- Added the friend-facing browsing view to `apps/media-app`, production hosting, and its own CI/CD.
- Added `labs.swordthain.com` hosting for `apps/playground` and retrofitted Cognito auth onto its API.
- Split media-app into a `eu-west-1` data plane and `us-east-1` hosting stack.
- Cut `swordthain.com` over to `apps/media-app`.

## [2026.07.19]

- Restructured the repo as a monorepo (`apps/playground`, `apps/media-app`) — the project's real starting point as "Swordthain": CDK skeleton, shared Cognito auth stack, S3 media bucket, GitHub OIDC-based CI/CD for both apps.
- Added the presigned-upload + thumbnail-generation Lambda, nested folder browsing API, the sharing model (`FolderShares`, cascading access, invites), and the admin React SPA (folders, permissions, friends).

## [2026.03.26]

- Added a project layer under companies in the (then still `cjrolfe.github.io`-hosted) demo-site directory, with instant in-memory updates after create/archive/delete.
- Assorted fixes (a `{{#IF_X}}` template regex, hiding the company template from the landing page) and a `.gitignore`/README/CLAUDE.md cleanup pass.

## [2026.03.10]

- Switched hosting to AWS; fixed CORS, a sword favicon (working around a browser 403), and 403s on company links (missing `index.html` suffix); removed deprecated Lambda automation files; updated docs to match.

## [2026.03.06]

- Added an optional demo-description field to company creation, documented it, added a `.gitignore`, and added a multi-provider AI system with Anthropic Claude support.

## [2026.03.05]

- Early demo-chat work, a stray-curly-brace template fix, and several archive/restore/delete company workflow iterations (issues #4–#6). Added the project's first `CLAUDE.md`.

## [2026.03.04]

- Company site creation from an issue-driven workflow, with several `index.html` iterations.

## [2026.03.02]

- Added `codebase-diagram.html`, the project's earliest architecture documentation.

## [2026.02.27]

- Landing-page and catalog (`sites.json`) updates.

## [2026.02.25]

- Added delete functionality to the archive workflow, and another archive/restore/delete iteration (issue #2).

## [2026.02.24]

- Archive/restore-company workflow (issue #1) and an early UI fix.

## [2026.02.23]

- **Initial commit.** The project's start — an early modal fix and a `sites.json` catalog update the same day.
