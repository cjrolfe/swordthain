# Graph Report - swordthain  (2026-10-17)

## Corpus Check
- 142 files · ~201,137 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1083 nodes · 1639 edges · 117 communities (73 shown, 44 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 75 edges (avg confidence: 0.86)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `9b779295`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Media App API Client
- AIProvider
- CI Workflows & Backlog Docs
- regression-tests/src/api.ts
- fixtures.ts
- TypeScript Config (Media App)
- Media App Dependencies
- API Testing Playground Pages
- CDK App Entry (infra.ts)
- A11y Tests Dependencies
- Regression Tests Dependencies
- FolderBrowser Event Handlers
- TypeScript Config (Regression)
- AIRequest
- CLI Package Config
- media-app/src/auth.ts
- App.tsx
- s3_utils.py
- TypeScript Config (A11y)
- jsonResponse
- media/playlists.ts
- Modal Dialog & Media Types
- TypeScript Config (CLI)
- TypeScript Config (Infra)
- media-app/src/api.ts
- Create Company Lambda
- Infra Build Tooling Deps
- Infra CDK Dependencies
- AnthropicProvider
- Folder Share Notifications
- upload-url.ts
- OpenAIProvider
- invites.ts
- Playground Hub Frontend JS
- isOwner
- Stats/Cost Dashboard Lambda
- Playlist Player Component
- Activity Log Lambda
- OTP Auth Challenge Lambda
- thumbnail.ts
- Test Suite READMEs
- CLI Tool & Auth Diagrams
- Playlists Frontend Handlers
- Permissions Tab & Sharing Model
- Permissions Matrix Component
- Company Template Frontend JS
- Infra Package Metadata
- CDK NPM Scripts
- CI/CD Deploy Topology
- Storage Tab Component
- Labs Stealth Gate Function
- A11y CI Flake Fix
- WCAG Conformance Work
- Generate Sites Registry
- Verify OTP Lambda
- Deploy Workflow Jobs
- CLI Upload Fix
- robots.txt Addition
- VHS Tape Brand Asset
- cognito:groups Bracket Bug
- Vite Env Types
- Salesforce Screenshot (Access Denied)
- ffmpeg Lambda Layer
- light-dark() CSS Fix
- No Glacier Tiering Decision
- Paris.mp4 Codec Issue
- Playlist Cascade Cleanup
- Shared-With-Me List Feature
- Activity Tab & Dashboard
- Owner vs Member Views
- Film Frame Decorative Asset
- Film Strip Background Theme
- BBC Homepage Screenshot
- Sword Favicon Branding
- CloudWatch SDK Dependency
- S3 SDK Dependency
- SES SDK Dependency
- Adaptive HLS Deferral
- Partial-Acceptance Validation Rationale
- ffmpeg/Sharp Build Notes
- Sharp Lambda Layer
- Cognito SDK Dependency
- Apple Photos Upload Settled
- CSP Upload Fix
- Delete Media Feature
- Fullscreen Button Fix
- Media Description Feature
- Move Folders Feature
- robots.txt Shipped
- CLI README
- Folder Matching Rule
- .env.local Override Gotcha
- A11y Test Suite (Shipped)
- CSP Upload Fix (Shipped)
- Delete Media (Shipped)
- Fullscreen Fix (Shipped)
- Media Description (Shipped)
- Move Folders (Shipped)
- Root CLAUDE.md
- Post-Deploy Verification Rule
- Native tvOS App Option
- New-Media Email Notification Design
- Synthetic Member Session
- System Overview Diagram
- Media App Domain
- Playground Domain
- stats.ts
- useIdleTimeout

## God Nodes (most connected - your core abstractions)
1. `jsonResponse()` - 51 edges
2. `FolderBrowser()` - 26 edges
3. `isOwner()` - 24 edges
4. `compilerOptions` - 21 edges
5. `AIProvider` - 18 edges
6. `compilerOptions` - 16 edges
7. `test` - 15 edges
8. `AIRequest` - 14 edges
9. `assert()` - 14 edges
10. `assertNoWcagViolations()` - 14 edges

## Surprising Connections (you probably didn't know these)
- `isOwner() Cross-Authorizer-Shape Compatibility` --rationale_for--> `isOwner()`  [EXTRACTED]
  apps/playground/CLAUDE.md → infra/lambda/media/authz.ts
- `Playlists tab` --conceptually_related_to--> `SwordthainMediaAppDataStack`  [INFERRED]
  apps/media-app/README.md → infra/README.md
- `Storage tab` --conceptually_related_to--> `Diagram: resource inventory table`  [INFERRED]
  apps/media-app/README.md → infra/docs/architecture-diagram.html
- `Region split into eu-west-1/us-east-1` --conceptually_related_to--> `Region split rationale (eu-west-1 data plane)`  [INFERRED]
  CHANGELOG.md → infra/README.md
- `Swordthain Architecture diagram page` --conceptually_related_to--> `Option A: AirPlay today, zero build`  [AMBIGUOUS]
  infra/docs/architecture-diagram.html → docs/apple-tv-discovery.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **AI Provider Factory Pattern** — apps_playground_lambda_ai_providers_base_aiprovider, apps_playground_lambda_ai_providers_openai_provider, apps_playground_lambda_ai_providers_anthropic_provider, apps_playground_lambda_ai_providers_init [EXTRACTED 1.00]
- **Shared Config-Driven Provider Page Pattern** — apps_playground_api_testing_weather_index, apps_playground_api_testing_police_index, apps_playground_api_testing_ticketmaster_index, apps_playground_api_testing_vehicle_apis_index, apps_playground_api_testing_assets_api_tester [EXTRACTED 1.00]
- **Settled/deferred backlog decisions with recorded rationale** — apps_media_app_backlog_adaptive_hls, apps_media_app_backlog_passkey_webauthn, apps_media_app_backlog_no_glacier_tiering, apps_media_app_backlog_direct_s3_mount_rejected, apps_media_app_backlog_apple_photos_upload [EXTRACTED 1.00]
- **Path-filtered deploy/validate + workflow_run test pipelines** — _github_workflows_deploy_workflow, _github_workflows_deploy_playground_workflow, _github_workflows_regression_test_workflow, _github_workflows_a11y_test_workflow, _github_workflows_validate_infra_workflow, _github_workflows_validate_media_app_workflow, _github_workflows_validate_playground_workflow [EXTRACTED 1.00]
- **cognito:groups bracket-string bug, documented across three files** — claude_cognito_groups_gotcha, infra_readme_cognito_groups_bug, apps_media_app_readme_cognito_groups_bug [EXTRACTED 1.00]
- **Company Demos CRUD Lambda Flow** — apps_playground_lambda_lambda_function, apps_playground_lambda_create_company, apps_playground_lambda_archive_company, apps_playground_lambda_create_project, apps_playground_lambda_delete_project, apps_playground_assets_sites [EXTRACTED 1.00]

## Communities (117 total, 44 thin omitted)

### Community 0 - "Media App API Client"
Cohesion: 0.07
Nodes (47): api, ApiError, Folder, request(), clearSession(), client, getValidIdToken(), loadSession() (+39 more)

### Community 1 - "AIProvider"
Cohesion: 0.16
Nodes (10): AIProvider, Any, Abstract base class for AI providers, Return provider's default model, Return provider's API endpoint, Build provider-specific request payload, Build provider-specific headers, Extract summary text from provider response (+2 more)

### Community 2 - "CI Workflows & Backlog Docs"
Cohesion: 0.05
Nodes (46): Deploy Playground workflow, Validate Infra workflow, Validate Media App workflow, Validate Playground workflow, Deferred: Adaptive HLS, Swordthain Media App Backlog, Deferred: Passkey/WebAuthn sign-in, WAF bot-control in front of MediaHttpApi (in progress) (+38 more)

### Community 3 - "regression-tests/src/api.ts"
Cohesion: 0.11
Nodes (35): Api, ApiError, Folder, makeApi(), MediaItem, request(), assert(), cognito (+27 more)

### Community 4 - "fixtures.ts"
Cohesion: 0.13
Nodes (21): base64UrlEncode(), buildSyntheticMemberSession(), cognito, getTestOtp(), Session, signInAsOwner(), ssm, assertNoWcagViolations() (+13 more)

### Community 5 - "TypeScript Config (Media App)"
Cohesion: 0.07
Nodes (29): compilerOptions, alwaysStrict, declaration, experimentalDecorators, inlineSourceMap, inlineSources, lib, module (+21 more)

### Community 6 - "Media App Dependencies"
Cohesion: 0.07
Nodes (28): dependencies, @aws-sdk/client-cognito-identity-provider, mermaid, react, react-dom, devDependencies, @types/react, @types/react-dom (+20 more)

### Community 7 - "API Testing Playground Pages"
Cohesion: 0.06
Nodes (48): currentEndpoint(), renderParamFields(), API Testing Hub Page, UK Police Data Page, Ticketmaster Discovery Page, Vehicle APIs Page, Weather API Page, Swordthain Playground Backlog (+40 more)

### Community 8 - "CDK App Entry (infra.ts)"
Cohesion: 0.08
Nodes (18): app, authStack, euWest1, mediaAppHostingStack, playgroundStack, usEast1, AuthStack, AuthStackProps (+10 more)

### Community 9 - "A11y Tests Dependencies"
Cohesion: 0.07
Nodes (27): @axe-core/playwright, dependencies, @aws-sdk/client-cognito-identity-provider, @aws-sdk/client-dynamodb, @aws-sdk/client-ssm, @aws-sdk/lib-dynamodb, devDependencies, @axe-core/playwright (+19 more)

### Community 10 - "Regression Tests Dependencies"
Cohesion: 0.08
Nodes (23): dependencies, @aws-sdk/client-cognito-identity-provider, @aws-sdk/client-dynamodb, @aws-sdk/client-ssm, @aws-sdk/lib-dynamodb, devDependencies, tsx, @types/node (+15 more)

### Community 11 - "FolderBrowser Event Handlers"
Cohesion: 0.10
Nodes (6): FolderBrowser(), handleMoveBreadcrumb(), handleMoveHome(), handleMoveNavigate(), handleStartMove(), loadMoveOptions()

### Community 12 - "TypeScript Config (Regression)"
Cohesion: 0.09
Nodes (21): compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib, module, moduleResolution, noEmit (+13 more)

### Community 13 - "AIRequest"
Cohesion: 0.19
Nodes (10): ABC, Anthropic Claude provider using Messages API., AIRequest, AIResponse, Abstract base class for AI providers with shared retry logic., Standardized request for all providers, Standardized response, Build the prompt (shared across all providers) (+2 more)

### Community 14 - "CLI Package Config"
Cohesion: 0.10
Nodes (19): bin, swordthain-upload, dependencies, @aws-sdk/client-cognito-identity-provider, devDependencies, tsx, @types/node, typescript (+11 more)

### Community 15 - "media-app/src/auth.ts"
Cohesion: 0.15
Nodes (19): request(), handleSignOut(), clearSession(), clearSessionCookie(), client, decodeJwtPayload(), getValidIdToken(), isOwner() (+11 more)

### Community 16 - "App.tsx"
Cohesion: 0.13
Nodes (16): App(), IntroDecision, Tab, TAB_LABELS, Architecture(), DiagramKey, DIAGRAMS, Settings() (+8 more)

### Community 17 - "s3_utils.py"
Cohesion: 0.05
Nodes (51): authHeaders(), clearErrors(), normalizeUrl(), render(), setOpen(), sites, updateArchivedCount(), validate() (+43 more)

### Community 18 - "TypeScript Config (A11y)"
Cohesion: 0.10
Nodes (19): compilerOptions, declaration, lib, module, moduleResolution, noFallthroughCasesInSwitch, noUnusedLocals, noUnusedParameters (+11 more)

### Community 19 - "jsonResponse"
Cohesion: 0.22
Nodes (18): PERMISSION_RANK, resolveAccess(), ResolvedAccess, ROOT, createFolder(), ddb, decodeCursor(), deleteFolder() (+10 more)

### Community 20 - "media/playlists.ts"
Cohesion: 0.23
Nodes (19): hasPermission(), deletePlaylistItemRow(), addPlaylistItem(), cognito, createPlaylist(), ddb, deletePlaylist(), denyResponse() (+11 more)

### Community 21 - "Modal Dialog & Media Types"
Cohesion: 0.16
Nodes (14): MediaItem, SharedFolder, Dialog(), effectiveContentType(), FigureOptions, handleUpload(), multipartStorageKey(), MultipartUploadState (+6 more)

### Community 22 - "TypeScript Config (CLI)"
Cohesion: 0.12
Nodes (16): compilerOptions, declaration, lib, module, moduleResolution, noFallthroughCasesInSwitch, noUnusedLocals, noUnusedParameters (+8 more)

### Community 23 - "TypeScript Config (Infra)"
Cohesion: 0.12
Nodes (16): compilerOptions, declaration, lib, module, moduleResolution, noFallthroughCasesInSwitch, noUnusedLocals, noUnusedParameters (+8 more)

### Community 24 - "media-app/src/api.ts"
Cohesion: 0.22
Nodes (11): ActivityEntry, api, AppSettings, Folder, Friend, Permission, PermissionsMatrix, Share (+3 more)

### Community 25 - "Create Company Lambda"
Cohesion: 0.18
Nodes (16): create_provider(), Factory function to create the appropriate AI provider. Returns None if no…, ai_summary(), CompanyRequest, fetch_site_text(), _get_ai_secrets(), handle_create(), Create a new company - S3-adapted for Lambda. Reads template from S3, generates… (+8 more)

### Community 26 - "Infra Build Tooling Deps"
Cohesion: 0.13
Nodes (15): aws-cdk, esbuild, devDependencies, aws-cdk, esbuild, sharp, ts-node, @types/aws-lambda (+7 more)

### Community 27 - "Infra CDK Dependencies"
Cohesion: 0.13
Nodes (15): aws-cdk-lib, @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, constructs, dependencies, aws-cdk-lib, @aws-sdk/client-dynamodb, @aws-sdk/client-s3 (+7 more)

### Community 28 - "AnthropicProvider"
Cohesion: 0.25
Nodes (3): AnthropicProvider, Any, Anthropic Claude provider using Messages API

### Community 29 - "Folder Share Notifications"
Cohesion: 0.26
Nodes (12): buildNewMediaEmailHtml(), cognito, ddb, escapeHtml(), getPermissionsMatrix(), handler(), notifyShares(), sendNewMediaEmail() (+4 more)

### Community 30 - "upload-url.ts"
Cohesion: 0.34
Nodes (13): abortMultipartUpload(), buildS3Key(), checkUploadPermission(), claims(), completeMultipartUpload(), ddb, getMultipartPartUrl(), getUploadUrl() (+5 more)

### Community 31 - "OpenAIProvider"
Cohesion: 0.25
Nodes (3): OpenAIProvider, Any, OpenAI provider using /v1/responses endpoint

### Community 32 - "invites.ts"
Cohesion: 0.26
Nodes (10): buildInviteEmailHtml(), cognito, ddb, escapeHtml(), handler(), previewInvite(), sendInvite(), sendInviteEmail() (+2 more)

### Community 33 - "Playground Hub Frontend JS"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Why does isOwner() connect Media Delete & Cleanup Lambda to Invite Email Lambda, Stats/Cost Dashboard Lambda, Activity Log Lambda, API Testing Proxy Lambda, Folder Access Resolution, Playlists Lambda Handler, Folder Share Notifications, Multipart Upload Lambda?, Source Nodes

### Community 34 - "isOwner"
Cohesion: 0.22
Nodes (13): isOwner(), cleanupPlaylistReferences(), ddb, deleteMedia(), handler(), s3, updateMedia(), AppSettings (+5 more)

### Community 35 - "Stats/Cost Dashboard Lambda"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Trace jsonResponse() - why is it the #1 god node with 47 edges?, Source Nodes

### Community 36 - "Playlist Player Component"
Cohesion: 0.28
Nodes (4): ApiError, Playlist, PlaylistItem, PlaylistPlayer()

### Community 37 - "Activity Log Lambda"
Cohesion: 0.39
Nodes (8): ActivityLogItem, cognito, ddb, definedValue(), handler(), resolveEmails(), resolveFileNames(), resolveFolderTitles()

### Community 38 - "OTP Auth Challenge Lambda"
Cohesion: 0.36
Nodes (7): ddb, generateCode(), getTestOtp(), handler(), hashCode(), ses, ssm

### Community 39 - "thumbnail.ts"
Cohesion: 0.26
Nodes (11): CA_BUNDLE_CANDIDATES, ddb, extractFrameWithFfmpeg(), extractVideoFrame(), FFMPEG_IMAGE_TYPES, grabFrame(), handler(), redactUrl() (+3 more)

### Community 40 - "Test Suite READMEs"
Cohesion: 0.29
Nodes (7): Shipped: Automated accessibility test suite, Shipped: Automated regression-test suite, Automated regression-test suite, Rule: run regression tests after every deploy, Swordthain Accessibility Tests README, Rationale: separate package from regression-tests, Swordthain Regression Tests README

### Community 41 - "CLI Tool & Auth Diagrams"
Cohesion: 0.33
Nodes (7): Settled: Direct S3 mount + auto-detect, rejected, swordthain-media-app-cli tool, Cached session (~/.swordthain-cli/session.json), Fixed-OTP sign-in (a11y-tests), Diagram: passwordless auth sequence, Fixed-OTP regression-test account mechanism, Fixed-OTP sign-in (regression-tests)

### Community 42 - "Playlists Frontend Handlers"
Cohesion: 0.38
Nodes (4): Playlists(), handleMoveItem(), handleRemoveItem(), loadItems()

### Community 43 - "Permissions Tab & Sharing Model"
Cohesion: 0.33
Nodes (6): Permissions tab, New-media email template (mirrors invite email), POST /admin/notify-shares route design, Diagram: media app request & data flow, Permission ladder (view/download/upload), Sharing model (FolderSharesTable, resolveAccess)

### Community 44 - "Permissions Matrix Component"
Cohesion: 0.40
Nodes (3): PermissionsMatrix(), clearPending(), handleSendNotify()

### Community 45 - "Company Template Frontend JS"
Cohesion: 0.47
Nodes (3): authHeader(), loadProjects(), renderProjects()

### Community 46 - "Infra Package Metadata"
Cohesion: 0.33
Nodes (5): bin, infra, name, private, version

### Community 47 - "CDK NPM Scripts"
Cohesion: 0.33
Nodes (6): scripts, build, deploy, diff, synth, watch

### Community 48 - "CI/CD Deploy Topology"
Cohesion: 0.40
Nodes (5): Accessibility Test workflow, Deploy workflow (infra + media-app), Regression Test workflow, Diagram: CI/CD deploy topology, Rationale: merging deploy-infra/deploy-media-app into deploy.yml

### Community 49 - "Storage Tab Component"
Cohesion: 0.50
Nodes (4): StorageStats, formatGb(), ITEM_COUNT_LABELS, Storage()

### Community 50 - "Labs Stealth Gate Function"
Cohesion: 0.60
Nodes (4): RFC-7515, decodeBase64Url(), handler(), notFound()

### Community 51 - "A11y CI Flake Fix"
Cohesion: 0.67
Nodes (4): Shipped: a11y-tests CI flake fix, a11y-tests CI flake fix, axe-core runPartial() timing variance, Self-healing cleanup sweep Locator.count() bug

### Community 52 - "WCAG Conformance Work"
Cohesion: 0.50
Nodes (4): Shipped: WCAG 2.1 AA conformance, WCAG 2.1 AA conformance work, Modal focus trap test (modal.spec.ts), "CI Test" folder scoping rule

### Community 53 - "Generate Sites Registry"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: What is the exact relationship between the architecture diagram page and Option A: AirPlay today, zero build?, Source Nodes

### Community 54 - "Verify OTP Lambda"
Cohesion: 0.67
Nodes (3): ddb, handler(), hashCode()

### Community 55 - "Deploy Workflow Jobs"
Cohesion: 0.67
Nodes (3): deploy.yml "changes" job (path-diff detection), deploy.yml "deploy-infra" job, deploy.yml "deploy-media-app" job

### Community 56 - "CLI Upload Fix"
Cohesion: 1.00
Nodes (3): Shipped: CLI upload fix, 1.9GB multipart-upload threshold, CLI upload fix (multipart threshold)

### Community 57 - "robots.txt Addition"
Cohesion: 1.00
Nodes (3): media-app index.html, media-app public/robots.txt, robots.txt added

### Community 58 - "VHS Tape Brand Asset"
Cohesion: 0.67
Nodes (3): media-app, VHS Tape with Swordthain Label, Swordthain Brand Mark

### Community 59 - "cognito:groups Bracket Bug"
Cohesion: 1.00
Nodes (3): cognito:groups bracket-string auth bug, cognito:groups bracket-string gotcha, cognito:groups bracket-string bug (authz.ts)

### Community 61 - "Salesforce Screenshot (Access Denied)"
Cohesion: 0.67
Nodes (3): Salesforce Access Denied Screenshot, Akamai Edge Access Denial (Bot/Scrape Block), Salesforce Integration Target

### Community 62 - "ffmpeg Lambda Layer"
Cohesion: 0.67
Nodes (3): ffmpeg Lambda layer README, FfmpegLayer, Synthetic MediaItems row fixture (playlists scenario)

### Community 115 - "stats.ts"
Cohesion: 0.25
Nodes (8): cloudwatch, cloudwatchUsEast1, ddb, handler(), LAMBDA_FUNCTIONS, RATE_PER_GB, ses, storageMetric()

### Community 117 - "useIdleTimeout"
Cohesion: 0.47
Nodes (5): ACTIVITY_EVENTS, useIdleTimeout(), handleActivity(), setWarning(), startCycle()

## Ambiguous Edges - Review These
- `Option A: AirPlay today, zero build` → `Swordthain Architecture diagram page`  [AMBIGUOUS]
  infra/docs/architecture-diagram.html · relation: conceptually_related_to
- `Sword Motif / Branding` → `Playground Favicon (Sword Icon)`  [AMBIGUOUS]
  apps/playground/favicon.svg · relation: rationale_for

## Knowledge Gaps
- **349 isolated node(s):** `AppSettings`, `SUPPORTED_CONTENT_TYPES`, `UploadStatus`, `MultipartUploadState`, `s3` (+344 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **44 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Work-memory lessons

**Known dead ends** — questions that led nowhere; don't re-derive.
- "What is the exact relationship between the architecture diagram page and Option A: AirPlay today, zero build?" -> `Swordthain Architecture diagram page`, `Option A: AirPlay today, zero build`

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Option A: AirPlay today, zero build` and `Swordthain Architecture diagram page`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Sword Motif / Branding` and `Playground Favicon (Sword Icon)`?**
  _Edge tagged AMBIGUOUS (relation: rationale_for) - confidence is low._
- **Why does `Cognito Owner-group Authorizer` connect `API Testing Playground Pages` to `s3_utils.py`?**
  _High betweenness centrality (0.042) - this node is a cross-community bridge._
- **Why does `isOwner()` connect `isOwner` to `invites.ts`, `Activity Log Lambda`, `API Testing Playground Pages`, `jsonResponse`, `media/playlists.ts`, `stats.ts`, `Folder Share Notifications`, `upload-url.ts`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Why does `Playground README` connect `API Testing Playground Pages` to `CDK App Entry (infra.ts)`?**
  _High betweenness centrality (0.017) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `FolderBrowser()` (e.g. with `handleCancelEditDescription()` and `handleDownload()`) actually correct?**
  _`FolderBrowser()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `AppSettings`, `SUPPORTED_CONTENT_TYPES`, `UploadStatus` to the rest of the system?**
  _349 weakly-connected nodes found - possible documentation gaps or missing edges._