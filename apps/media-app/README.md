# Swordthain Media App

Private, invite-only photo/video sharing for a closed group of friends. Serves `swordthain.com`.

Currently just the **admin UI** (React + Vite SPA) — folder management, the permissions matrix, friend invites, and a lightbox/player for viewing + downloading media. The full friend-facing browsing experience (its own app shell, not bolted onto the admin UI) isn't built yet.

## Stack

- React 18 + TypeScript, built with Vite. No router library — four views, plain `useState` navigation is simpler than adding a dependency for it.
- Auth: Cognito's passwordless custom-auth flow, called directly from the browser via `@aws-sdk/client-cognito-identity-provider` (`InitiateAuth` / `RespondToAuthChallenge` / refresh). No password, no Amplify — same flow the backend's Lambda triggers implement (see `infra/lib/auth-stack.ts`).
- Talks directly to the deployed HTTP API (`infra/lib/media-app-stack.ts`) — no server component of its own.

## Local development

```bash
npm install
npm run dev
# http://localhost:5173
```

`.env` has the real, non-secret config (Cognito client ID, API URL, region) — these are meant to ship in the client bundle, so it's committed rather than gitignored. `localhost:5173` is already an allowed CORS origin on the API (see `MediaAppStack`'s `allowedOrigins`).

Sign in with an email that belongs to a Cognito user in the `Owner` group — this admin UI refuses to load for `Member` accounts (checked client-side by decoding the ID token's `cognito:groups` claim, and enforced server-side on every Owner-only endpoint regardless).

## Pages

- **Folders** — browse (breadcrumb navigation, nested), create, rename, delete (blocked with a 409 if the folder still has sub-folders or media — has to be emptied first).
- **Permissions** — the friends × folders grid from the spec. Each cell is a `none / view / download / upload` select; changing it calls the grant/revoke share endpoint directly.
- **Friends** — invite form (email + optional immediate folder access + personal note) and the current friend list. SES is still in sandbox mode (see `infra/README.md`), so real invite emails won't deliver until production access is granted — verified this flow works via SES's mailbox simulator instead.
- Within Folders, clicking a thumbnail opens a **lightbox** — an `<img>` for photos, a native `<video controls>` player for videos (progressive streaming via a presigned URL; see `infra/README.md` for why this isn't adaptive HLS yet). A separate **Download** action fetches a short-lived download URL and triggers a browser download. Both call the backend's `resolveAccess`-gated `view-url`/`download-url` endpoints and get logged to `ActivityLog`.

## A bug this caught

Building and testing this UI against the *real* deployed API (not hand-crafted Lambda test events) surfaced a real authorization bug: API Gateway's HTTP API JWT authorizer serializes the `cognito:groups` claim as a bracket-wrapped string (`"[Owner]"`), not a JSON array — despite the `@types/aws-lambda` types allowing `string[]` and despite an earlier hand-crafted test (using a real array) appearing to "confirm" array behavior. Every Owner-only endpoint was silently 403'ing for real requests until this was fixed in `infra/lambda/media/authz.ts`. Worth remembering: a claims-parsing assumption isn't verified until it's been exercised through the actual authorizer, not a synthetic test payload.
