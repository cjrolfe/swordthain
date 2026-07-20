# Swordthain Infra (CDK)

Shared AWS infrastructure for swordthain.com, in TypeScript via AWS CDK. Deployed independently of `apps/media-app` and `apps/playground` — those apps' own CDK stacks (added in later phases) will reference this stack's outputs.

## Stacks

### `SwordthainCiStack`
GitHub Actions OIDC trust (`token.actions.githubusercontent.com`) plus two purpose-scoped deploy roles — no long-lived AWS keys stored in GitHub. Both roles' trust policy is restricted to `repo:cjrolfe/swordthain:ref:refs/heads/main`, so only a genuine push to `main` (never a PR, never a fork) can assume them.

- **`swordthain-playground-ci`** — scoped to exactly the playground's existing manual deploy: S3 read/write on `swordthain-demo-sites`, `lambda:UpdateFunctionCode` on `swordthain-automation`, `cloudfront:CreateInvalidation` on distribution `E1AUXZ6C0Z7J9P`. Nothing broader.
- **`swordthain-infra-ci`** — only `sts:AssumeRole`/`sts:TagSession` on the three CDK bootstrap roles (`deploy-role`, `file-publishing-role`, `lookup-role`). Those bootstrap roles already carry the permissions CDK needs (see "Prerequisites" above) — this role is a narrow bridge into them, not a second copy of `AdministratorAccess`.

See `.github/workflows/` at the repo root: `deploy-playground.yml` and `deploy-infra.yml` trigger on push to `main` scoped to their own path (`apps/playground/**` / `infra/**`), so a change to one app's code can't trigger or affect the other's deploy. `validate-infra.yml` and `validate-playground.yml` run on PRs with no AWS credentials at all (type-check + `cdk synth`, Python compile-check).

### `SwordthainMediaAppStack`
`apps/media-app`'s own resources.

- **`MediaBucket`** (`swordthain-media-<account-id>`) — fully private (`BLOCK_ALL` public access, `BucketOwnerEnforced`), SSE-S3 encrypted, versioned, TLS-enforced via bucket policy.
- **Intelligent-Tiering from day one**: a lifecycle rule transitions every object to the `INTELLIGENT_TIERING` storage class immediately (day 0). This only activates the built-in Frequent/Infrequent/Archive-Instant-Access tiers, which have zero retrieval delay — the optional Archive Access / Deep Archive Access tiers are deliberately *not* opted into (that needs a separate bucket-level Intelligent-Tiering configuration), since both carry a multi-hour restore delay the spec rules out for casual browsing. True Glacier (Flexible Retrieval / Deep Archive) is applied per-folder by the app on demand — not a blanket bucket rule.
- **CORS** allows `PUT`/`POST`/`GET` from `swordthain.com` / `www.swordthain.com` for presigned multipart uploads.
- Incomplete multipart uploads are aborted after 7 days.
- **`MediaItemsTable`** (`swordthain-media-items`) — `mediaId` PK, GSI `byFolder` (`folderId` + `uploadedAt`) for chronological per-folder listing. `RemovalPolicy.RETAIN`.
- **`POST /media/upload-url`** (`UploadUrlFn`, fronted by `MediaHttpApi`, Cognito JWT-authorized via `HttpUserPoolAuthorizer`) — takes `{folderId, fileName, contentType}`, returns a presigned S3 PUT URL good for 1 hour. Object key: `originals/{folderId}/{mediaId}/{fileName}`. Single-PUT only (S3's 5GB hard limit) — true resumable multipart upload for very large files is a fast-follow, not built yet. Supported content types: JPEG, PNG, HEIC/HEIF, MP4, MOV.
- **Thumbnail generation** (`ThumbnailFn`, S3-triggered on `originals/*` `ObjectCreated`) — writes `thumbnails/{folderId}/{mediaId}.jpg` and the finalized `MediaItems` record (this is what actually creates the DB row — `UploadUrlFn` itself touches no DB, so an unused presigned URL just never produces a record). JPEG/PNG go through Sharp; HEIC/HEIF stills and video poster frames (1s in) go through ffmpeg, since Sharp's prebuilt Lambda binary excludes HEIF decode (libheif licensing).
  - **`SharpLayer`** — built at `cdk synth`/`deploy` time via `npm install --os=linux --cpu=x64 --libc=glibc sharp@0.33.5` (no Docker required; all three flags are required together, confirmed by testing — `--os`/`--cpu` alone silently skip the platform-specific `@img/sharp-*` optional dependency).
  - **`FfmpegLayer`** — `@ffmpeg-installer/ffmpeg@1.1.0` installed the same way as Sharp (npm's cross-platform flags, real per-platform `optionalDependencies`, npm registry only — no external website). Originally fetched a static build directly from johnvansickle.com at build time; switched after that caused a real (if transient) CI failure when GitHub Actions' runners couldn't reach it. See the layer's placeholder README for the trade-off (an older, 2021-vintage ffmpeg — fine for this project's actual poster-frame/HEIC-still needs).
  - Both layers and the full upload→thumbnail pipeline (photo and video) were verified end-to-end against the real deployed stack, not just unit-tested.
- **`FoldersTable`** (`swordthain-folders`) — `folderId` PK, GSI `byParent` (`parentFolderId` + `createdAt`). Top-level folders use the sentinel `parentFolderId: "ROOT"` rather than omitting the field, since a DynamoDB GSI skips items missing its indexed attribute — this keeps root and nested folders queryable through the same GSI.
- **Folder browsing** (`FoldersFn`):
  - `POST /folders` — `{title, parentFolderId?, date?, guestUploadEnabled?}` → creates a folder (validates `parentFolderId` exists if given, otherwise defaults to root). Owner-only — friends never create albums.
  - `GET /folders?parentId=...` — lists direct children (defaults to root-level folders if `parentId` omitted). Owner sees everything; a Member sees only children they (or an ancestor) have been granted access to.
  - `GET /folders/{folderId}` / `GET /folders/{folderId}/media` — same Owner-sees-all / Member-needs-access rule, enforced via `resolveAccess` (see below).
  - `PATCH /folders/{folderId}` — Owner-only, updates any of `{title, date, guestUploadEnabled, coverThumbnail}`.
  - `DELETE /folders/{folderId}` — Owner-only. Blocked with a 409 if the folder still has sub-folders or media (has to be emptied first) — no cascading delete. Cleans up any `FolderShares` entries pointing at it.
- `RemovalPolicy.RETAIN` — this holds real media/folder data, never destroyed by a stack teardown.

#### A real bug caught by testing against the deployed API, not just Lambda invokes
Every Owner-only endpoint (`POST /folders`, the shares/invites/permissions-matrix routes) silently 403'd for real requests until building the admin UI (`apps/media-app`) surfaced it. Cause: API Gateway's HTTP API JWT authorizer serializes `cognito:groups` as a bracket-wrapped **string** (`"[Owner]"`) in `event.requestContext.authorizer.jwt.claims`, not a real JSON array — despite `@types/aws-lambda` allowing `string[]` there. `lambda/media/authz.ts`'s `isOwner()` had originally been written and "verified" against a hand-crafted Lambda invoke event using a real array, which passed — but never exercised the actual API Gateway code path. Fixed now (strips the brackets, splits on comma); the lesson generalized into a note in the repo-root `CLAUDE.md` since it's the kind of assumption easy to re-introduce elsewhere.

#### Sharing model
- **`FolderSharesTable`** (`swordthain-folder-shares`) — `folderId` PK + `userId` SK (GSI `byUser`: `userId` + `folderId`). Each item: `{folderId, userId, email, permission: "view"|"download"|"upload", grantedAt}`. `userId` is always the Cognito `sub` — **not** `Username`, which is a common trap here: even with `UsernameAttributes: [email]` configured on the pool, Cognito auto-generates a UUID as the actual `Username` (confirmed empirically — email only works as an alias for sign-in and Admin-API lookups by name, never as the literal `Username` value). Every place in this codebase that needs a stable per-friend identifier uses `sub`, resolved from an owner-supplied email via `AdminGetUserCommand` when needed.
- **Cascading access** (`lambda/media/access.ts`, `resolveAccess`) — walks from the target folder up through `parentFolderId` ancestors to `ROOT`, returning the *closest* explicit share found. This means sharing a parent grants access to everything beneath it, but a more specific share on a descendant overrides it — and a friend can be granted just one specific sub-folder without ever seeing (or being able to list) its siblings, even when querying "children of the parent" directly. Shared by both `FoldersFn` (browsing) and `UploadUrlFn` (upload gating).
- **`POST /folders/{folderId}/shares`** (`SharesFn`, Owner-only) — `{action: "grant"|"revoke", email, permission?}`. Resolves `email` → `sub` via `AdminGetUser`.
- **`GET /admin/permissions-matrix`** (`SharesFn`, Owner-only) — `{folders, shares, friends}` — a full scan/list dump (folders + shares tables, `Member` group from Cognito) for building the admin UI's grid in a later phase.
- **`POST /admin/invites`** (`InvitesFn`, Owner-only) — `{email, folderId?, permission?, message?}`. Creates a Cognito user (`AdminCreateUser`, `MessageAction: SUPPRESS` — Cognito's own invite email is never used, since the app is passwordless-only), adds them to the `Member` group, optionally grants immediate folder access, and sends a custom SES invite email (fixed shell + optional personal message; the fully templated/variable-driven version from the spec's admin UI is a later phase). **The account is still in the SES sandbox** (flagged back in Phase 1, still unresolved) — real invites to arbitrary friend addresses won't deliver until production access is requested; testing here used SES's `success@simulator.amazonses.com` mailbox simulator, which works regardless of sandbox status.
- **Upload gating** (`UploadUrlFn`) now checks `resolveAccess` too: Owner can always upload (folder existence is still validated); a Member needs an explicit `permission: "upload"` share — `view`/`download` alone isn't enough. Guest-upload-per-album (the `guestUploadEnabled` folder flag) isn't wired to this yet — that's a distinct, separately-flagged Phase 8 feature.
- Verified end-to-end against the real deployed stack: invited a real Cognito user + sent a real SES email, granted/revoked shares, confirmed cascading (parent share ⇒ all children visible), confirmed override (revoke parent + share one child ⇒ only that child visible, sibling stays hidden even when listing the parent's children), confirmed upload denied without the `upload` permission and allowed after granting it, and confirmed the permissions matrix reflects it all correctly (including catching and fixing the `Username`-vs-`email` bug above before it shipped).

#### Streaming & download
- **Progressive, not adaptive HLS, for now** — a deliberate scope call. True adaptive-bitrate HLS needs the browser to fetch a manifest *and* many segment files; a single S3 presigned URL only signs one object, not a whole path. Serving private HLS properly needs CloudFront with signed cookies in front of the bucket — real additional infrastructure (distribution, Origin Access Control, a CloudFront key pair, a cookie-signing Lambda), not just an extension of what's here. Deferred until the app needs CloudFront anyway (the root-domain migration in the spec's hardening phase). Until then: presigned S3 GET URLs for both photos and videos, same mechanism thumbnails already use — browsers play MP4 directly with seeking via HTTP Range requests, which covers the "progressive" half of the spec's "progressive or HLS" wording.
- **`GET /media/{mediaId}/view-url`** / **`GET /media/{mediaId}/download-url`** (`MediaAccessFn`) — look up the `MediaItem`, resolve the requester's access via `resolveAccess` (Owner bypasses), and return a 5-minute presigned GET URL to the *original* object (not the thumbnail — thumbnails are for the grid, this is the full-res/full-stream asset). `download-url` additionally sets `ResponseContentDisposition: attachment` so the browser saves rather than navigates. Every call writes an `ActivityLog` entry.
- **Permission hierarchy** (`access.ts`, `hasPermission`) — the three share tiers aren't independent flags, they're a ladder: `upload` ⊇ `download` ⊇ `view`. A `view`-only friend can open the lightbox but gets a 403 attempting to download; `download` or `upload` permission allows both. (`upload-url`'s existing exact-match check on `"upload"` still happens to be correct under this ladder, since upload is the top tier — no change needed there.)
- **`ActivityLogTable`** (`swordthain-activity-log`) — `logId` PK, GSIs `byUser` and `byFolder` (both + `timestamp`). `MediaAccessFn` writes every view/download here, matching the spec's `GET /media/{id}/view-url` / `download-url` behavior exactly ("logs 'view'" / "logs 'download'"). The read/query side is `ActivityFn` — see below.
- Admin UI: clicking a thumbnail opens a lightbox (`<img>` for photos, `<video controls>` for videos, both backed by `view-url`); a separate Download action calls `download-url` and triggers a browser download. No upload UI exists yet in the admin app (out of scope for this pass) — test media was uploaded via the existing API directly.
- Verified end-to-end in a real browser against the real deployed stack: photo lightbox, video playback with native seek controls, download triggering and completing, activity log entries written for both actions, and the permission ladder (`view` share → 200 on view-url, 403 on download-url; `download`/`upload` → both succeed).

#### Activity dashboard
- **`GET /admin/activity?folderId=...&userId=...`** (`ActivityFn`, Owner-only) — at least one of `folderId`/`userId` required (400 otherwise), matching the two `ActivityLogTable` GSIs: `folderId` queries `byFolder` (all activity in an album, across every friend — optionally further filtered to one friend in-memory), `userId` alone queries `byUser` (everything one friend has done, across every album they've touched). Results are capped at 200, most recent first, and enriched server-side with the friend's email (Cognito `ListUsers` with a `sub =` filter — `userId` in `ActivityLog` is the sub, not an email, same reasoning as the sharing model), the media's `fileName`, and the folder's `title`, so the frontend never has to resolve raw IDs itself.
- Admin UI **Activity** tab: folder and friend dropdowns (populated from the same `permissionsMatrix()` call `Permissions`/`Friends` already use — its folder list is a full table scan, not just root-level, so nested folders show up too), a results table, and an **Export CSV** button that builds the CSV client-side from the already-fetched rows (no server-side export endpoint — nothing to justify one at this data volume).
- Verified end-to-end in a real browser: generated real view/download activity by using the lightbox/download actions, confirmed the folder-filtered view showed correct enriched rows, confirmed the friend-filtered (`byUser`) query path directly, confirmed CSV export runs with no console errors, and confirmed the 403 (non-Owner) and 400 (no filter given) cases.

#### Hardening (partial — see below for what's deferred)
- **`infra/lambda/media/http.ts`** — a shared `jsonResponse` helper, now used by all seven media Lambdas (previously each had its own copy). Adds baseline headers to every response: `X-Robots-Tag: noindex, nofollow`, `Strict-Transport-Security` (HSTS), `X-Content-Type-Options: nosniff`, and `Cache-Control: no-store` (responses carry presigned URLs and permission/activity data — never cache). These only appear on responses that reach Lambda code — a 401 from the JWT authorizer itself (rejected before any Lambda runs) won't carry them, but there's no indexable content on an auth-rejected response anyway.
- **Rate limiting**: API Gateway stage-level throttling (20 req/sec sustained, burst 40) on `MediaHttpApi`'s default stage, via the L1 `CfnStage.defaultRouteSettings` (no L2 construct exposes this for HTTP APIs). This is a global cap across the whole API, not per-IP.
- **WAF was attempted and reverted** — worth recording why. **AWS WAFv2 cannot be associated with API Gateway HTTP APIs (v2) at all**, only REST APIs (v1), ALB, AppSync, Cognito, App Runner, Amplify, or Verified Access. Confirmed against AWS's own `AssociateWebACL` API reference, whose `ResourceArn` format is explicitly `arn:aws:apigateway:region::/restapis/api-id/stages/stage-name` — note `/restapis/`, not `/apis/`. A first attempt using the natural-looking `/apis/{id}/stages/$default` ARN deployed the `CfnWebACL` successfully but failed on `CfnWebACLAssociation` with "The ARN isn't valid," and CloudFormation rolled back cleanly. Getting real WAF bot-control managed rule groups in front of this API means either migrating off HTTP API to REST API, or putting CloudFront in front of it — both bigger moves than this pass's "safe pieces only" scope. CloudFront is the more sensible path given the spec's own architecture already wants it there; bundle it with the deferred playground-migration/root-domain cutover rather than a narrower one-off REST API migration now.
- **Deferred to the cutover pass** (needs the domain/hosting work first, not safe to do standalone): WAF bot-control via CloudFront, `robots.txt` as an actual served file (nothing hosts static files for the media-app yet), and the playground's auth gating / `labs.swordthain.com` migration per spec section 9.
- MFA: already satisfied by the existing Cognito config from Phase 1 (`Mfa.OPTIONAL` with TOTP) — OTP-per-login is itself a second factor beyond just holding an account; nothing new needed here.
- Verified: response headers confirmed on a real Lambda invoke and (implicitly, via standard `AWS_PROXY` passthrough behavior already exercised throughout every prior phase) over the real HTTP path; throttle settings confirmed live via `aws apigatewayv2 get-stage`.

#### Static site hosting (the SPA itself — domain cutover, part 1 of several)
The frontend now has a real hosted origin, closing the gap flagged above ("nothing hosts static files for the media-app yet"). This is deliberately just the hosting — no domain aliasing yet, see below.

- **`SiteBucket`** (`swordthain-site-<account-id>`) — private (`BLOCK_ALL`, `BucketOwnerEnforced`), served only via CloudFront + Origin Access Control, same pattern as `MediaBucket`.
- **`SiteDistribution`** — a CloudFront distribution in front of `SiteBucket`, `index.html` as the default root object. No SPA-routing/custom-error-page config: `apps/media-app` has no client-side router, just one HTML page.
- **`SiteWebAcl`** — a CloudFront-scope WAFv2 Web ACL (`AWSManagedRulesCommonRuleSet`, `AWSManagedRulesKnownBadInputsRuleSet`, `AWSManagedRulesAmazonIpReputationList` — all free managed rule groups) attached directly to the distribution. This is the real WAF the API hardening section above couldn't get (HTTP API v2 can't take WAFv2 at all); a CloudFront distribution can.
- **No custom domain yet.** `swordthain.com`/`www.swordthain.com` are still aliased to playground's old distribution today — CloudFront refuses to let a second distribution claim an alias that's already live elsewhere in the account, so `SiteDistribution` is reachable only at its own `*.cloudfront.net` domain (`SiteDistributionDomainName` output) until the DNS cutover. `MediaAppStackProps.siteDomainNames`/`siteCertificateArn` exist for this (reusing playground's existing ACM cert, which already covers both names) but are left unset until then.
- **`MediaHttpApi`'s CORS `allowOrigins`** includes `https://${SiteDistributionDomainName}` alongside the real domain(s) and `localhost:5173`, specifically so the SPA can call the API while being verified at its pre-cutover `*.cloudfront.net` address.
- No CDK `BucketDeployment` — matching the pattern already established for playground, a build artifact sync belongs in CI (`apps/media-app`'s own deploy workflow, added next), not baked into the infra stack.
- Verified in a real browser: built `apps/media-app`, manually synced `dist/` to `SiteBucket`, invalidated the distribution, and completed a full Owner OTP sign-in at `SiteDistributionDomainName` — folders loaded, dashboard rendered, no CORS errors in the console.

### `SwordthainAuthStack`
The Cognito User Pool shared by both apps: friends sign in as `Member`, the owner as `Owner` (Cognito group, checked explicitly in app code — see the spec's section 9 on the playground's access control).

- **Passwordless email-OTP sign-in**, implemented as a Cognito custom authentication challenge (not Cognito's native "choice-based auth" — that mechanism requires password as an allowed factor, which doesn't fit a fully passwordless design):
  - `DefineAuthChallengeFn` — orchestrates the challenge, allows up to 3 attempts per sign-in session.
  - `CreateAuthChallengeFn` — generates a 6-digit code on the first attempt of a session, stores its hash in DynamoDB (`swordthain-otp-codes`, 5-minute TTL), and emails it via SES.
  - `VerifyAuthChallengeResponseFn` — checks the submitted code against the stored hash, single-use (deleted on success).
- **SES identity** for `swordthain.com` is provisioned and DNS-verified automatically (DKIM CNAMEs + MAIL FROM MX/TXT records added to the existing Route 53 hosted zone).
- **No password path**: the app client only allows `ALLOW_CUSTOM_AUTH` + `ALLOW_REFRESH_TOKEN_AUTH`. OAuth/Hosted UI is disabled — the app talks to Cognito directly.
- **Long-lived sessions**: refresh tokens valid 365 days (long-lived session per device, including smart TVs), access/ID tokens 1 hour.
- **MFA**: optional TOTP, on top of the inherent OTP-per-login factor.
- Owner/Member groups created; role checks should key off group membership, not a separate custom attribute.

**Not yet included — deliberately deferred:**
- Passkey/WebAuthn sign-in. Cognito's native passkey support lives in a different, newer auth-selection mechanism than the custom-Lambda OTP flow above, and forces `password` to remain an allowed factor — worth its own design pass rather than bolting on.
- Everything else in the spec (S3 media bucket, DynamoDB app tables, API Gateway, MediaConvert, WAF Bot Control, the two apps' own stacks) — later phases.

## Prerequisites

- Node.js 20+ (this repo was set up with Node 26 / npm 11).
- AWS credentials for account `584000479246` with permissions well beyond the read-only audit role — `cdk bootstrap` and `cdk deploy` create/modify CloudFormation stacks, IAM roles, Lambda functions, DynamoDB tables, Cognito resources, SES identities, and Route 53 records. A scoped policy or `AdministratorAccess`/`PowerUserAccess` + IAM role creation is realistically required.

## Commands

```bash
cd infra
npm install
npx tsc --noEmit      # type-check
npx cdk synth          # render CloudFormation locally, no AWS calls
npx cdk bootstrap       # one-time per account/region — creates CDK's asset bucket etc.
npx cdk diff            # compare against what's deployed
npx cdk deploy           # deploy SwordthainAuthStack
```

`cdk synth` has been run locally and produces a valid template (27 resources) — nothing has been deployed to AWS yet.
