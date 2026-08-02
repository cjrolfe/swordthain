# Discovery: bringing Swordthain to Apple TV

Status: discovery only — not scheduled, not approved for build.

## Context

Apple TV has no browser, so the existing React SPA (swordthain.com) can't run there as-is. This is a discovery pass mapping out what a real tvOS app would require, and flagging the one option that needs zero new work so it can be weighed against the bigger investment.

Grounded in what's actually in the codebase today:
- Auth is passwordless email-OTP through Cognito custom-auth Lambdas (`infra/lambda/auth/create-auth-challenge.ts` etc.), driving a web login form.
- Media playback is a plain `<video controls>` / `<img>` tag pointed at a 5-minute presigned S3 URL (`apps/media-app/src/components/Lightbox.tsx`), progressive MP4 only — no HLS. This is a **deliberate, already-documented** scope call (`infra/README.md:51`): real adaptive HLS would need CloudFront + signed cookies, deferred until the app needs CloudFront for other reasons anyway.
- The API is a plain HTTPS/JSON API Gateway HTTP API. CORS is a browser-only concept — a native client calling the same endpoints needs no backend change for that reason alone.
- Uploads are restricted to `video/mp4` and `video/quicktime` (`apps/media-app/src/components/FolderBrowser.tsx`), both H.264/HEVC in practice for family-shot iPhone footage — AVPlayer (tvOS's native player) plays both natively, no transcoding pipeline required for an MVP.

## Option A — AirPlay today, zero build

Safari's native `<video controls>` element (already what `Lightbox.tsx` renders) shows an AirPlay icon automatically and can cast the direct video URL to an Apple TV, not just mirror the screen. Since media is already served as direct HTTPS MP4 via presigned URL, this likely **already works with no code changes** — worth a five-minute real test (open a video in Safari on an iPhone/iPad on the same network as an Apple TV, tap AirPlay) before investing further. If the quality bar is "watch family videos on the big screen," this may be the entire answer.

## Option B — a native tvOS app

If Option A's UX isn't good enough (no on-TV browsing, family members always need their phone in hand), a real app is a separate client built from scratch — the backend's data model and API don't need to change, only be called from Swift instead of the browser.

### Dependencies
- A Mac with Xcode, and Swift/SwiftUI knowledge (or TVMLKit — JS-driven TV apps — but that's a legacy Apple technology, not recommended for a new project).
- An Apple Developer Program membership ($99/year) — required for any distribution path, including installing on family members' actual devices long-term.
- A distribution decision — this is as much a constraint on the plan as any technical piece, and is worth deciding early since it shapes how "finished" the app needs to be before anyone but you can use it:
  - **Ad Hoc** — register each family member's Apple TV (by UDID), install builds directly, no App Store review. Simplest for a private family app, but someone has to collect UDIDs and rebuild/reinstall periodically as provisioning profiles expire.
  - **TestFlight** — easier ongoing delivery, but builds expire after 90 days (recurring maintenance to keep it alive) and even TestFlight has a lightweight Beta App Review.
  - **Public App Store** — full review, needed only if this should be discoverable/installable by anyone, which doesn't fit a private family app.

### New backend work — the biggest unknown
Typing an email address and a 6-digit code with a Siri Remote is painful. Cognito User Pools don't support the OAuth Device Authorization Grant (the "enter this code on your phone" pattern Netflix/YouTube use on TVs) — that would need to be **built**, not configured:
- A new small "pairing session" table + endpoint: the TV app requests a pairing code and displays it, then polls.
- The family member completes the *existing* email-OTP login on their phone/web, entering the TV's code to link the session.
- On confirmation, the backend hands the polling TV client real Cognito tokens (reusing the existing custom-auth Lambda chain rather than replacing it).

This is genuinely new infrastructure, not a config change, and is the piece most likely to determine how big this project actually is.

### App shell and playback
- A SwiftUI project targeting tvOS, built around the Focus Engine (remote-based navigation) rather than tap/click — the current grid-of-thumbnails concept translates, but every view is rebuilt natively, not reused from the web CSS.
- Calls the existing `GET /folders`, `GET /folders/{id}/media`, `GET /media/{id}/view-url` endpoints directly — no new read APIs needed.
- AVPlayer for playback against the presigned URL, same mechanism the web app already uses.
- Permission tiers: `view`/`download`/`upload` exist for the web's upload and download-to-device use cases, neither of which is meaningful on a TV — the tvOS client is likely view-only regardless of a friend's granted tier, which simplifies this client relative to the web one.
- Nice-to-have, not required for MVP: revisit the deferred CloudFront + HLS work (already scoped in `infra/README.md`) if progressive MP4 seeking feels rough on a slow home connection.

### Polish items (expected by Apple, not core function)
App icon set, a Top Shelf image, and general tvOS HIG compliance if this ever goes past Ad Hoc distribution.

## Open decisions for later (not now)
1. Is Option A's AirPlay experience actually good enough once tested?
2. If not: Ad Hoc vs. TestFlight vs. App Store for distribution.
3. How much effort to sink into the pairing-code auth flow vs. simpler stopgaps (e.g. a single shared long-lived device token issued manually per TV).

## Verification (of this discovery, not of code)
- Test Option A for real: AirPlay a video from the existing Lightbox in Safari on iOS to an actual Apple TV, and judge whether that alone satisfies the ask.
- If pursuing Option B, the first real spike (before any SwiftUI work) should be the pairing-auth flow end-to-end against the real Cognito pool, since it's the one piece with no existing precedent in this codebase to copy from.
