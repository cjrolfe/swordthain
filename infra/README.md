# Swordthain Infra (CDK)

Shared AWS infrastructure for swordthain.com, in TypeScript via AWS CDK. Deployed independently of `apps/media-app` and `apps/playground` — those apps' own CDK stacks (added in later phases) will reference this stack's outputs.

## Stacks

### `SwordthainCiStack`
GitHub Actions OIDC trust (`token.actions.githubusercontent.com`) plus two purpose-scoped deploy roles — no long-lived AWS keys stored in GitHub. Both roles' trust policy is restricted to `repo:cjrolfe/swordthain:ref:refs/heads/main`, so only a genuine push to `main` (never a PR, never a fork) can assume them.

- **`swordthain-playground-ci`** — scoped to exactly the playground's existing manual deploy: S3 read/write on `swordthain-demo-sites`, `lambda:UpdateFunctionCode` on `swordthain-automation`, `cloudfront:CreateInvalidation` on distribution `E1AUXZ6C0Z7J9P`. Nothing broader.
- **`swordthain-infra-ci`** — only `sts:AssumeRole`/`sts:TagSession` on the three CDK bootstrap roles (`deploy-role`, `file-publishing-role`, `lookup-role`). Those bootstrap roles already carry the permissions CDK needs (see "Prerequisites" above) — this role is a narrow bridge into them, not a second copy of `AdministratorAccess`.

See `.github/workflows/` at the repo root: `deploy-playground.yml` and `deploy-infra.yml` trigger on push to `main` scoped to their own path (`apps/playground/**` / `infra/**`), so a change to one app's code can't trigger or affect the other's deploy. `validate-infra.yml` and `validate-playground.yml` run on PRs with no AWS credentials at all (type-check + `cdk synth`, Python compile-check).

### `SwordthainMediaAppStack`
`apps/media-app`'s own resources. Folder CRUD/browsing and per-folder sharing land in a later phase — `folderId` is currently just an opaque string in `MediaItems`, not yet validated against a `Folders`/`FolderShares` table.

- **`MediaBucket`** (`swordthain-media-<account-id>`) — fully private (`BLOCK_ALL` public access, `BucketOwnerEnforced`), SSE-S3 encrypted, versioned, TLS-enforced via bucket policy.
- **Intelligent-Tiering from day one**: a lifecycle rule transitions every object to the `INTELLIGENT_TIERING` storage class immediately (day 0). This only activates the built-in Frequent/Infrequent/Archive-Instant-Access tiers, which have zero retrieval delay — the optional Archive Access / Deep Archive Access tiers are deliberately *not* opted into (that needs a separate bucket-level Intelligent-Tiering configuration), since both carry a multi-hour restore delay the spec rules out for casual browsing. True Glacier (Flexible Retrieval / Deep Archive) is applied per-folder by the app on demand — not a blanket bucket rule.
- **CORS** allows `PUT`/`POST`/`GET` from `swordthain.com` / `www.swordthain.com` for presigned multipart uploads.
- Incomplete multipart uploads are aborted after 7 days.
- **`MediaItemsTable`** (`swordthain-media-items`) — `mediaId` PK, GSI `byFolder` (`folderId` + `uploadedAt`) for chronological per-folder listing. `RemovalPolicy.RETAIN`.
- **`POST /media/upload-url`** (`UploadUrlFn`, fronted by `MediaHttpApi`, Cognito JWT-authorized via `HttpUserPoolAuthorizer`) — takes `{folderId, fileName, contentType}`, returns a presigned S3 PUT URL good for 1 hour. Object key: `originals/{folderId}/{mediaId}/{fileName}`. Single-PUT only (S3's 5GB hard limit) — true resumable multipart upload for very large files is a fast-follow, not built yet. Supported content types: JPEG, PNG, HEIC/HEIF, MP4, MOV.
- **Thumbnail generation** (`ThumbnailFn`, S3-triggered on `originals/*` `ObjectCreated`) — writes `thumbnails/{folderId}/{mediaId}.jpg` and the finalized `MediaItems` record (this is what actually creates the DB row — `UploadUrlFn` itself touches no DB, so an unused presigned URL just never produces a record). JPEG/PNG go through Sharp; HEIC/HEIF stills and video poster frames (1s in) go through ffmpeg, since Sharp's prebuilt Lambda binary excludes HEIF decode (libheif licensing).
  - **`SharpLayer`** — built at `cdk synth`/`deploy` time via `npm install --os=linux --cpu=x64 --libc=glibc sharp@0.33.5` (no Docker required; all three flags are required together, confirmed by testing — `--os`/`--cpu` alone silently skip the platform-specific `@img/sharp-*` optional dependency).
  - **`FfmpegLayer`** — a static linux/amd64 ffmpeg build fetched from johnvansickle.com at build time (see the layer's placeholder README for the provenance trade-off this implies).
  - Both layers and the full upload→thumbnail pipeline (photo and video) were verified end-to-end against the real deployed stack, not just unit-tested.
- `RemovalPolicy.RETAIN` — this holds real media, never destroyed by a stack teardown.

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
