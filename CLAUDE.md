# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo structure

This is a monorepo with two independent apps under `apps/`:

- `apps/playground/` — the original swordthain.com app (a directory of company demo sites). Its own `CLAUDE.md` has full details. Now hosted at `labs.swordthain.com`, gated to the owner only.
- `apps/media-app/` — the private, invite-only media-sharing app for friends, serving the root `swordthain.com` domain. React + Vite admin UI plus a friend-facing view — see its `README.md`. Talks to the backend in `infra/`; has no server component of its own.
- `infra/` — shared AWS CDK (TypeScript) app, deployed. Five stacks: `SwordthainAuthStack` (Cognito), `SwordthainMediaAppDataStack` (media-app's S3/DynamoDB/API/Lambda backend, eu-west-1), `SwordthainMediaAppHostingStack` (media-app's CloudFront/WAF hosting, us-east-1), `SwordthainPlaygroundStack` (playground's `labs.swordthain.com` hosting + API auth), `SwordthainCiStack` (GitHub OIDC deploy roles). See `infra/README.md` for what each contains.

Read the relevant app's docs before working inside it — conventions, deploy commands, and architecture are documented per-app, not here.

## Shared infra

Both apps share the same AWS account and some resources at the account level:
- Route 53 hosted zone: `swordthain.com` (zone ID `Z09793352H82VF3C9TII2`)
- ACM certificate(s) for the domain and its subdomains
- A CloudFront WAF Web ACL
- Cognito User Pool (`infra/lib/auth-stack.ts`) — Owner/Member groups, shared by both apps' auth

Each app deploys its own CDK stack independently; shared resources in `infra/` are provisioned separately so they don't couple the two apps' deploys together.

## Verify everything after any deployment

Both apps share the same account-level resources (Cognito pool, the cross-subdomain `swordthain_session` cookie, Route 53, CloudFront), so a change to one can silently break the other. After deploying anything — even a change that looks scoped to one app — re-check end to end rather than just the piece that changed:

- `swordthain.com` — sign in and confirm the app itself works, not just that the page loads.
- `labs.swordthain.com` — confirm it loads for a signed-in Owner. Its stealth gate depends on that same shared session cookie, so signing out of `swordthain.com` (e.g. after test cleanup) also locks you out here — a 404 here doesn't necessarily mean something broke, check the session first.
- playground's create → open → delete cycle — a demo site can have a valid `sites.json` catalog entry with no real content behind it (this happened for real: two entries sat in the catalog for a while with no S3 object ever uploaded, 403ing the moment anyone opened them). Loading the directory page proves nothing about whether *creating* a site actually produces a working one. Create a throwaway test company, open it to confirm real content rendered, then delete it via the `/archive` API's `{action:"delete"}` (not just the UI's "Archive" button, which only hides it) so no test data is left behind.

## A recurring gotcha worth knowing before touching auth code

API Gateway's HTTP API JWT authorizer serializes Cognito's `cognito:groups` claim as a bracket-wrapped **string** (`"[Owner]"`), not a real array — despite `@types/aws-lambda` allowing `string[]` for that field. This bit us once already (see `infra/lambda/media/authz.ts`'s comment and `apps/media-app/README.md`): a hand-crafted Lambda test event using a real array "confirmed" the wrong assumption, and every Owner-only endpoint silently 403'd for real requests until it was caught by testing against the actual deployed API. Don't trust a claims-parsing assumption that's only been tested via a synthetic invoke payload — verify it through the real authorizer.
