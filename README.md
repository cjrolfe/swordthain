# Swordthain

Monorepo for everything hosted under swordthain.com.

| App | Path | Domain | Purpose |
|---|---|---|---|
| Media app | `apps/media-app/` | `swordthain.com` | Private, invite-only photo/video sharing for friends. Live. |
| Playground | `apps/playground/` | `labs.swordthain.com` | Owner-only demo/testing site — directory of company demo pages, plus an API-testing playground. |

Each app is its own deployable unit with its own README/CLAUDE.md and, eventually, its own CDK stack — changes to one shouldn't require touching the other. Shared infra (Cognito user pool, WAF Web ACL, Route 53 hosted zone) lives in `infra/` and is provisioned separately, referenced by both apps.

See each app's own `README.md` for setup, architecture, and deployment details:
- [apps/playground/README.md](apps/playground/README.md)
- [apps/media-app/README.md](apps/media-app/README.md)
- [infra/README.md](infra/README.md) — shared CDK stacks (Cognito, etc.)
