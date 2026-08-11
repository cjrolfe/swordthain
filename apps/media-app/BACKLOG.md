# Swordthain Media App — Backlog

Deferred features, known limitations, and settled decisions that don't need re-litigating. Not a roadmap — just a place to look before assuming something is unbuilt, half-built, or still open.

## Deferred features

- **Adaptive HLS** — currently progressive-only (presigned S3 GET, HTTP Range seeking). True adaptive-bitrate HLS needs CloudFront with signed cookies in front of the *media bucket* specifically. CloudFront now fronts the static site (`SwordthainMediaAppHostingStack`), but not the media bucket — the original precondition for this feature isn't actually met yet, worth a quick revisit if this becomes a priority.
- **Playlist orphaned-item cascade cleanup** — deferred pending a future `byMedia` GSI. Folder delete is still blocked (409) while it still contains media, but individual media delete (shipped 11 Aug 2026) is a real, more common path to an orphaned `PlaylistItem` now — already tolerated gracefully (`available: false`, greys out in the UI), just not proactively cleaned up.
- **Passkey/WebAuthn sign-in** — deferred, needs its own design pass; Cognito's native passkey support lives in a different auth-selection mechanism than the custom-Lambda OTP flow this app uses, and forces `password` to remain an allowed factor.
- **Direct S3 mount + auto-detect** (drag files into a mounted bucket instead of using the CLI or web upload) — investigated and deferred, genuinely blocked today: `folderId`/`mediaId` are opaque server-minted UUIDs with no relationship to folder titles or filenames, so a mounted bucket would show UUID soup and a raw file drop wouldn't get a `mediaId` at all (the thumbnail Lambda's key-pattern check would silently skip it — no DB record ever created). There's also no IAM credential mechanism today — the whole security model is short-lived presigned URLs behind Cognito login, and mounting S3 would mean a real long-lived AWS access key sitting on a home machine. Would need a redesigned key scheme, a reconciliation Lambda, and a new credential story. The CLI upload tool (`apps/media-app-cli`) covers the actual bulk-import need without any of this.

## Infra hardening still deferred

- **WAF bot-control in front of `MediaHttpApi`** — AWS WAFv2 cannot attach to API Gateway HTTP APIs (v2) at all, only REST APIs (v1), CloudFront, ALB, etc. Needs either a REST API migration or CloudFront in front of the API — bigger moves than a standalone fix.
- **`robots.txt`** as an actually-served static file for `swordthain.com`.

## Settled decisions (recorded, not open questions)

- **No Glacier/Deep Archive tiering.** Evaluated at ~2TB scale; the extra saving over what Intelligent-Tiering's automatic tiers already capture is small (~$15–18/month) relative to the multi-hour restore delay and new product surface it would need (restore-initiate endpoint, "warming up" UI state). Revisit only if the library grows into the tens of TB.
- **Apple Photos upload** — already works on iPhone/iPad: the existing upload input's native OS picker (Safari's file input) browses the real Photos library, including iCloud Photos, with multi-select. No code change needed. Mac browser uploads can't reach the Photos library directly (Finder's Open panel doesn't browse it) — closing that gap would need an iCloud Shared Album import (unofficial public endpoint) or a Shortcuts-based share flow; not pursued since iPhone/iPad covers the actual need.

## Recently shipped

- **Move folders** (11 Aug 2026) — `PATCH /folders/{id}` with `parentFolderId`, reparent anywhere in the tree via a breadcrumb-style destination picker in `FolderBrowser.tsx`. Rejects self-move (400) and move-into-own-descendant (409).
- **Delete media** (11 Aug 2026) — single-item delete for any photo/video, plus select-and-bulk-delete for photos. Removes both S3 objects (original + thumbnail) and the DB row.
- **Media description** (11 Aug 2026) — short (140 char) Owner-set text shown instead of the filename on every viewing surface (grid, Lightbox, playlist list/player); Activity log, CSV export, and downloads still use the real filename.
- **CLI upload fix** (11 Aug 2026) — files between ~2GB and 5GB were failing outright (Node's `fetch()` can't reliably send a single in-memory buffer body over ~2GiB). Lowered the CLI's multipart threshold to 1.9GiB so they route through the existing chunked upload instead.
- **CSP fix for browser uploads** (11 Aug 2026) — `connect-src` was missing the media S3 bucket, silently breaking every browser-initiated upload (any size) with a CSP-blocked "network error" — `img-src`/`media-src` covered viewing but not the XHR/fetch PUT calls uploads make directly to S3.

## Documentation debt

- Docs have gone stale within the same session that produced a feature more than once (e.g. the Storage tab went undocumented in this README for a while). Worth a quick doc sweep whenever a feature lands, not just at the end of a big push.
