# Swordthain Media App

Private, invite-only photo/video sharing for a closed group of friends. Serves `swordthain.com`.

React + Vite SPA with two views sharing one app shell, branched on the signed-in user's Cognito group: the **admin UI** (Owner) — folder management, the permissions matrix, friend invites, and a lightbox/player for viewing + downloading media — and a **friend view** (Member) — the same folder browser and lightbox/player, minus anything mutating (no add/rename/delete folder, no tabs beyond Folders). The friend view doesn't add any new components; it reuses `FolderBrowser` with an `isOwner={false}` prop that hides the owner-only controls. Server-side authorization (`resolveAccess`, `MediaAccessFn`) was already correct for Members since Phase 3/5 — this was purely a client-side gating change.

## Stack

- React 18 + TypeScript, built with Vite. No router library — five views, plain `useState` navigation is simpler than adding a dependency for it.
- Auth: Cognito's passwordless custom-auth flow, called directly from the browser via `@aws-sdk/client-cognito-identity-provider` (`InitiateAuth` / `RespondToAuthChallenge` / refresh). No password, no Amplify — same flow the backend's Lambda triggers implement (see `infra/lib/auth-stack.ts`).
- Talks directly to the deployed HTTP API (`infra/lib/media-app-stack.ts`) — no server component of its own.

## Local development

```bash
npm install
npm run dev
# http://localhost:5173
```

`.env` has the real, non-secret config (Cognito client ID, API URL, region) — these are meant to ship in the client bundle, so it's committed rather than gitignored. `localhost:5173` is already an allowed CORS origin on the API (see `MediaAppStack`'s `allowedOrigins`).

Sign in with any Cognito user's email. `Owner` accounts land in the admin UI; `Member` accounts land in the friend view. The client-side branch (`isOwner()` in `auth.ts`, decoding the ID token's `cognito:groups` claim) is a UI convenience only — every Owner-only endpoint enforces it server-side regardless, and every Member-visible endpoint is gated by `resolveAccess` walking the folder-share tree, so a Member can never see or act on a folder that isn't explicitly shared with them (or a descendant of one that is) no matter what the client renders.

Signing in also writes a copy of the ID token to a `swordthain_session` cookie scoped to `.swordthain.com` (see `setSessionCookie` in `auth.ts`). This exists solely so `labs.swordthain.com` (playground, see `infra/lib/playground-stack.ts`) can tell at the edge whether *someone* is signed in before deciding whether to serve real content or a static 404 — it's a stealth/obscurity layer, not a security boundary, and isn't read by anything in this app itself. It's a no-op outside `*.swordthain.com` hostnames (e.g. local dev on `localhost`).

## Production hosting & deploys

Served from a private S3 bucket behind CloudFront (`SiteBucket`/`SiteDistribution` in `infra/lib/media-app-stack.ts`), with a CloudFront-scope WAF in front of it. A push to `main` touching `apps/media-app/**` runs `.github/workflows/deploy-media-app.yml`: `npm ci && npm run build`, sync `dist/` to the bucket, invalidate the distribution — via a GitHub Actions OIDC role (`swordthain-media-app-ci`, `infra/lib/ci-stack.ts`) scoped to just that bucket and distribution, no static AWS keys involved. `swordthain.com`/`www.swordthain.com` aren't aliased to this distribution yet (see `infra/README.md`'s "Static site hosting" section for why); until the DNS cutover, it's reachable only at its own `*.cloudfront.net` domain.

## Pages

Owner sees all four tabs below. Member sees only Folders, with no tab nav at all (just the browser) and no "Add folder"/Rename/Delete controls within it.

- **Folders** — browse (breadcrumb navigation, nested), create, rename, delete (blocked with a 409 if the folder still has sub-folders or media — has to be emptied first). Members get a read-only version: browse only, folders outside what's shared with them (directly or via an ancestor) simply don't appear.
- **Permissions** — the friends × folders grid from the spec. Each cell is a `none / view / download / upload` select; changing it calls the grant/revoke share endpoint directly.
- **Friends** — invite form (email + optional immediate folder access + personal note) and the current friend list. SES is still in sandbox mode (see `infra/README.md`), so real invite emails won't deliver until production access is granted — verified this flow works via SES's mailbox simulator instead.
- Within Folders, clicking a thumbnail opens a **lightbox** — an `<img>` for photos, a native `<video controls>` player for videos (progressive streaming via a presigned URL; see `infra/README.md` for why this isn't adaptive HLS yet). A separate **Download** action fetches a short-lived download URL and triggers a browser download. Both call the backend's `resolveAccess`-gated `view-url`/`download-url` endpoints and get logged to `ActivityLog`, and both work identically for Members with `view`/`download` permission on the folder.
- **Activity** — filter by folder and/or friend (at least one required — matches the backend's two GSIs), see a table of who viewed/downloaded what and when, export the current view as CSV. Folder/friend options come from the same `permissionsMatrix()` call the Permissions and Friends tabs already use. Owner-only.

## A bug this caught

Building and testing this UI against the *real* deployed API (not hand-crafted Lambda test events) surfaced a real authorization bug: API Gateway's HTTP API JWT authorizer serializes the `cognito:groups` claim as a bracket-wrapped string (`"[Owner]"`), not a JSON array — despite the `@types/aws-lambda` types allowing `string[]` and despite an earlier hand-crafted test (using a real array) appearing to "confirm" array behavior. Every Owner-only endpoint was silently 403'ing for real requests until this was fixed in `infra/lambda/media/authz.ts`. Worth remembering: a claims-parsing assumption isn't verified until it's been exercised through the actual authorizer, not a synthetic test payload.
