# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo structure

This is a monorepo with two independent apps under `apps/`:

- `apps/playground/` — the original swordthain.com app (a directory of company demo sites). Its own `CLAUDE.md` has full details. Slated to move to `labs.swordthain.com`, gated to the owner only, once the media app takes over the root domain.
- `apps/media-app/` — the new private, invite-only media-sharing app for friends, being built to serve on the root `swordthain.com` domain. Its own `CLAUDE.md` will have details as it's built out.

Read the relevant app's `CLAUDE.md` before working inside it — conventions, deploy commands, and architecture are documented per-app, not here.

## Shared infra

Both apps share the same AWS account and some resources at the account level:
- Route 53 hosted zone: `swordthain.com` (zone ID `Z09793352H82VF3C9TII2`)
- ACM certificate(s) for the domain and its subdomains
- A CloudFront WAF Web ACL

Each app deploys its own CDK stack independently; shared resources should be provisioned in a way that doesn't couple the two apps' deploys together.
