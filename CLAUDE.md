# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo structure

This is a monorepo with two independent apps under `apps/`:

- `apps/playground/` — the original swordthain.com app (a directory of company demo sites). Its own `CLAUDE.md` has full details. Slated to move to `labs.swordthain.com`, gated to the owner only, once the media app takes over the root domain.
- `apps/media-app/` — the new private, invite-only media-sharing app for friends, serving the root `swordthain.com` domain once fully built. Currently just the admin UI (React + Vite) — see its `README.md`. Talks to the backend in `infra/`; has no server component of its own.
- `infra/` — shared AWS CDK (TypeScript) app, deployed. Three stacks: `SwordthainAuthStack` (Cognito), `SwordthainMediaAppStack` (media-app's S3/DynamoDB/API/Lambda backend), `SwordthainCiStack` (GitHub OIDC deploy roles). See `infra/README.md` for what each contains.

Read the relevant app's docs before working inside it — conventions, deploy commands, and architecture are documented per-app, not here.

## Shared infra

Both apps share the same AWS account and some resources at the account level:
- Route 53 hosted zone: `swordthain.com` (zone ID `Z09793352H82VF3C9TII2`)
- ACM certificate(s) for the domain and its subdomains
- A CloudFront WAF Web ACL
- Cognito User Pool (`infra/lib/auth-stack.ts`) — Owner/Member groups, shared by both apps' auth

Each app deploys its own CDK stack independently; shared resources in `infra/` are provisioned separately so they don't couple the two apps' deploys together.

## A recurring gotcha worth knowing before touching auth code

API Gateway's HTTP API JWT authorizer serializes Cognito's `cognito:groups` claim as a bracket-wrapped **string** (`"[Owner]"`), not a real array — despite `@types/aws-lambda` allowing `string[]` for that field. This bit us once already (see `infra/lambda/media/authz.ts`'s comment and `apps/media-app/README.md`): a hand-crafted Lambda test event using a real array "confirmed" the wrong assumption, and every Owner-only endpoint silently 403'd for real requests until it was caught by testing against the actual deployed API. Don't trust a claims-parsing assumption that's only been tested via a synthetic invoke payload — verify it through the real authorizer.
