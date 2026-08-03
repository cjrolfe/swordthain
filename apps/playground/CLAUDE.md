# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This app lives at `apps/playground/` in the `swordthain` monorepo (see the repo-root `CLAUDE.md` for how it relates to `apps/media-app/`), hosted at `labs.swordthain.com`, owner-only. Root `index.html` is a small hub linking to two independent playgrounds:

1. **Company Demos** (`demos/`) — an AWS-hosted directory of company demo sites. Each company has its own folder at the **site root** (`/{company-id}/index.html`, not under `demos/` — only the directory/listing pages moved), and each company can have one or more **projects**, each with their own `index.html` page. The directory page displays company cards read from `assets/sites.json`. All CRUD operations (create, archive, restore, delete) are **API-driven** and automated via Python Lambda functions. The `company-template` entry is hidden from the directory UI but must remain in `sites.json` and S3 — it is the template Lambda uses to create new companies.
2. **API Testing** (`api-testing/`) — send real requests to a set of third-party APIs by filling in a generic, config-driven form, with real keys held server-side in SSM. See "API Testing Playground" below.

The rest of this file covers Company Demos in depth (it's the older, larger surface); API Testing gets its own section further down.

## Architecture

### Frontend (Static HTML/CSS/JS on AWS)
- **Hosting:** S3 + CloudFront CDN
- **Domain:** Route 53 (`labs.swordthain.com`)
- `index.html` - Root hub, links to `demos/` and `api-testing/` (not Company Demos itself — see Project Overview above)
- `demos/index.html` - Company directory and "Create new company" modal
- `demos/archived.html` - Shows archived companies (with restore/delete options)
- `favicon.svg` - Custom sword icon (SVG format for scalability), shared by both playgrounds
- `assets/app.js` - Renders cards from `sites.json`, handles search, and calls API endpoints. After each operation the in-memory `sites` array is mutated and the grid re-renders immediately — no `window.location.reload()`.
- `assets/sites.json` - **Source of truth** for all companies, their metadata, and their projects

All paths in these files are absolute (`/assets/...`), so moving the directory pages into `demos/` didn't require touching how they load shared assets or how `SWORDTHAIN_API` is configured.

### Backend (Lambda + API Gateway)
Four Lambda endpoints:
1. **POST /create** - Creates a new company folder from `company-template/`, fetches website content, generates an AI summary via configured provider (OpenAI or Anthropic), uses website's og:image for preview, and updates `sites.json`
2. **POST /archive** - Handles archive, restore, and delete actions based on `action` parameter
3. **POST /project/create** - Creates a new project under a company from `project-template/`, writes `{companyId}/{projectId}/index.html` to S3, and updates the company's `projects` array in `sites.json`
4. **POST /project/delete** - Removes a project entry from `sites.json` and deletes its S3 prefix

**Route ordering in `lambda_function.py` is critical:** `/project/create` and `/project/delete` must be checked **before** `/create` and `/archive`, because `"/create" in "/project/create"` is `True`.

Lambda function files (in `lambda/` folder):
- `lambda_function.py` - Routes requests to handlers (order matters — see above)
- `create_company.py` - Creates company folders in S3, generates AI summaries
- `archive_company.py` - Toggles archived flag or permanently deletes companies
- `create_project.py` - Creates project pages under a company
- `delete_project.py` - Deletes project pages and removes from `sites.json`
- `generate_sites.py` - Scans S3 folders and rebuilds `sites.json` (recovery tool)
- `s3_utils.py` - S3 + CloudFront utilities (read/write/delete/invalidate)
- `ai_providers/` - Modular AI provider system (OpenAI, Anthropic)

**Note:** Lambda pip dependencies are installed at build time (`pip install -r requirements.txt -t .`) and excluded from git via `.gitignore`. Only source `.py` files are committed.

**Note:** Screenshots are skipped in Lambda (uses og:image fallback from websites).

### AI Provider System
Located in `lambda/ai_providers/`:
- `base.py` - Abstract base class with shared retry logic
- `openai_provider.py` - OpenAI implementation
- `anthropic_provider.py` - Anthropic Claude implementation
- `__init__.py` - Factory function for provider selection

## Key Conventions

### Company and Project Identifiers
- IDs are **slugified**: lowercase with hyphens (e.g., "Acme Ltd" → "acme-ltd")
- Each company lives in `/<company-id>/index.html`
- Each project lives in `/<company-id>/<project-id>/index.html`

### Template System
Both `company-template/index.html` and `project-template/index.html` use a simple mustache-like syntax:
- `{{VARIABLE}}` - Replaced with actual values
- `{{#IF_CONDITION}}...{{/IF_CONDITION}}` - Conditional blocks

The regex in `create_company.py`'s `render_from_template` must use **double-brace** patterns (e.g., `\{\{#IF_WEBSITE\}\}`) to correctly match `{{#IF_WEBSITE}}`. Using single-brace patterns leaves stray `{` and `}` characters on the rendered page.

Variables replaced during company creation:
- `{{COMPANY_NAME}}`, `{{COMPANY_ID}}`, `{{COMPANY_WEBSITE}}`, `{{COMPANY_SUMMARY}}`, `{{COMPANY_TONE}}`
- `{{LOGO_URL}}`, `{{S3_BUCKET_HINT}}`, `{{S3_LOGO_HINT}}`
- `{{SCREENSHOT_PATH}}` (Lambda uses og:image instead)

Variables replaced during project creation:
- `{{PROJECT_NAME}}`, `{{PROJECT_DESCRIPTION}}`, `{{COMPANY_ID}}`, `{{COMPANY_NAME}}`, `{{CREATED_AT}}`

### S3 Assets
- **Website bucket:** `swordthain-demo-sites` (configurable via `S3_BUCKET` env var)
- **Logo bucket:** `https://sfdcdemoimages.s3.eu-west-1.amazonaws.com/<company-id>/logo.png`
- Screenshots: Not generated by Lambda; og:image used when available

### sites.json Structure
Each entry in `sites.json` contains:
```json
{
  "id": "company-slug",
  "name": "Company Name",
  "path": "/company-slug/",
  "description": "AI-generated or fallback description",
  "tag": "Demo",
  "logoUrl": "https://sfdcdemoimages.s3.eu-west-1.amazonaws.com/company-slug/logo.png",
  "archived": false,
  "projects": [
    {
      "id": "project-slug",
      "name": "Project Name",
      "description": "Project description",
      "createdAt": "2026-03-26"
    }
  ]
}
```

### Protected Folders
- `company-template` **must never be archived or deleted** — it is used by Lambda to create new companies. It is hidden from the landing page UI by a filter in `app.js` but must remain in `sites.json`.
- Excluded from `generate_sites.py`: `assets`, `lambda`

### Frontend In-Memory Updates
`app.js` exposes `sites` (array), `render()`, and `updateArchivedCount()` at module scope so both the list IIFE and the create-modal IIFE can mutate state without a page reload. After a successful API call the local array is updated and `render()` is called directly — this avoids showing stale data during the CloudFront invalidation propagation window.

### CloudFront Path Requirements
- CloudFront's `DefaultRootObject` (index.html) only works for the root path `/`, not subdirectories
- All links to company and project pages must include `index.html` explicitly (e.g., `/company-name/index.html`, `/company-name/project-name/index.html`)
- `app.js` appends `index.html` to company paths; project pages in `company-template/index.html` also use explicit `index.html` links

## AWS Deployment

### Deploy Frontend to S3
```bash
cd apps/playground
aws s3 sync . s3://swordthain-demo-sites/ \
  --exclude ".git/*" \
  --exclude ".github/*" \
  --exclude "lambda/*" \
  --exclude "lambda.zip" \
  --exclude "*.pyc" \
  --exclude "__pycache__/*"
```

### Deploy Lambda Function
```bash
cd apps/playground/lambda
python3 -m pip install -r requirements.txt -t .
zip -r ../lambda.zip . -x "*.pyc" -x "__pycache__/*" -x "README.md"
cd ..
aws lambda update-function-code --function-name swordthain-automation --zip-file fileb://lambda.zip --region us-east-1
```

### Invalidate CloudFront Cache
```bash
aws cloudfront create-invalidation --distribution-id E1AUXZ6C0Z7J9P --paths "/*"
```

**Note:** Lambda automatically invalidates CloudFront after updates if `CLOUDFRONT_DISTRIBUTION_ID` env var is set.

### API Gateway Configuration
The frontend needs the API base URL. Set in `demos/index.html`, `demos/archived.html`, `api-testing/**/index.html`, and rendered company pages:
```html
<script>window.SWORDTHAIN_API = "https://x7g9r0sdmc.execute-api.us-east-1.amazonaws.com/prod";</script>
```

**CORS Configuration:**
- Lambda returns CORS headers: `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Headers: Content-Type`, `Access-Control-Allow-Methods: POST, OPTIONS`
- API Gateway has OPTIONS + POST methods configured for: `/create`, `/archive`, `/project/create`, `/project/delete`, and `/api-testing` (the last one CDK-managed, Cognito-authorized — see "API Testing Playground" below, not the CORS/`AWS_PROXY` pattern this section otherwise describes)
- All 4 Company Demos POST methods use `AWS_PROXY` integration type
- When adding new Company Demos endpoints, grant Lambda invoke permission and redeploy the API stage manually (see `infra/README.md`'s "Playground API auth retrofit" for why this one API mixes a manually-managed part with a CDK-managed part)

## AI Provider Integration

### Configuration (AWS Secrets Manager)
Create secret `swordthain/ai-keys` in Secrets Manager (eu-west-1):
```json
{
  "OPENAI_API_KEY": "sk-...",
  "ANTHROPIC_API_KEY": "sk-ant-..."
}
```

Set Lambda environment variables:
- `AI_PROVIDER` - Values: `openai`, `anthropic`, `none` (default: `openai` if key exists)
- `OPENAI_MODEL` - Optional (default: `gpt-4.1-mini`)
- `ANTHROPIC_MODEL` - Optional (default: `claude-3-5-haiku-20241022`)
- `AI_TEMPERATURE` - Optional (default: `0.4`)
- `AI_MAX_TOKENS` - Optional (default: `150`)

### Fallback Behavior
If AI is unavailable: falls back to website meta description, then a generic placeholder. Creation never fails due to AI issues.

### Adding New Providers
Create `lambda/ai_providers/new_provider.py` extending `AIProvider` base class, implement 6 abstract methods, and add to factory.

## API-Driven Workflow

### Creating a Company
1. User fills in the "Create new company" modal and submits
2. `POST /create` → Lambda reads `company-template/index.html` from S3, fetches website og:image + text, generates AI summary, renders template, writes `/{slug}/index.html`, updates `sites.json`, invalidates CloudFront
3. Frontend adds the new entry to the local `sites` array and re-renders immediately

### Archiving / Restoring
1. `POST /archive` with `{"action": "archive|restore", "companyId": "..."}`
2. Lambda toggles `archived` flag in `sites.json`; company folder untouched
3. Frontend mutates the local `sites` entry and re-renders

### Deleting (Permanent)
1. Only available from archived page
2. `POST /archive` with `{"action": "delete", "companyId": "..."}`
3. Lambda removes entry from `sites.json` and deletes all objects under `/{companyId}/` in S3 (including any project pages)
4. Frontend removes the entry from local `sites` and re-renders

### Creating a Project
1. User fills in the "Add project" modal on a company page and submits
2. `POST /project/create` with `{"companyId", "name", "description"}`
3. Lambda reads `project-template/index.html` from S3, renders it, writes `/{companyId}/{projectId}/index.html`, appends to `sites.json` projects array, invalidates CloudFront
4. Company page JS re-fetches `sites.json` with cache-busting query string and re-renders project cards

### Deleting a Project
1. `POST /project/delete` with `{"companyId", "projectId"}`
2. Lambda removes project from `sites.json` and deletes `/{companyId}/{projectId}/` prefix in S3
3. Company page JS re-renders project cards

## API Testing Playground

A form-driven way to send real requests to a set of third-party APIs without ever putting a real key in the browser. Entirely independent of Company Demos above — separate frontend files, separate (CDK-managed, TypeScript) Lambda, same underlying REST API and Cognito authorizer.

### Frontend (`api-testing/`)
- `api-testing/index.html` — hub linking to each provider's page.
- `api-testing/{provider}/index.html` + `config.js` — one pair per provider (currently `weather`, `police`, `ticketmaster`, `ves`). `config.js` sets `window.API_TESTING_CONFIG = {provider, title, description, endpoints}`, where each endpoint is plain data: `{id, name, method, pathTemplate, pathParams, queryParams, bodyParams}`. Adding a provider means adding a new `{provider}/` folder with these two files — no changes to the shared renderer.
- `api-testing/assets/api-tester.js` — one shared, generic form renderer used by every provider page. Reads `window.API_TESTING_CONFIG`, builds inputs for whatever params the endpoints declare, and on submit POSTs `{provider, endpointId, params}` to `${window.SWORDTHAIN_API}/api-testing`.

### Backend (`infra/lambda/playground/api-testing-proxy.ts`)
CDK-managed (unlike the Python Company Demos Lambda), deployed via `infra`'s normal `cdk deploy`, not this app's manual Lambda deploy step. Key design points:
- A **fixed, hardcoded allowlist** of providers/endpoints/base-URLs (the `PROVIDERS` map in the Lambda) — the client only ever sends `{provider, endpointId, params}`, never a URL. Deliberate: an open "proxy anything the client asks for" design would be an SSRF endpoint even behind Owner-only auth.
- Real third-party keys live in SSM **`SecureString`** parameters, path `/swordthain/api-testing/{provider}-api-key`, populated out-of-band via `aws ssm put-parameter` — never in code or committed to git. Cached in-memory across warm Lambda invocations, keyed by parameter name.
- Auth: same Cognito authorizer as the 4 Company Demos endpoints, but reached through REST API v1's authorizer shape (`event.requestContext.authorizer.claims`, no `.jwt` nesting like HTTP API v2) rather than a manually-attached one — this endpoint was added at CDK-deploy time with the authorizer already wired in, unlike the retrofit the other 4 needed. Reuses `isOwner()` from `infra/lambda/media/authz.ts` — its bracket-stripping is a no-op on REST API v1's plain, unbracketed `cognito:groups` string, so the same function is safe across both authorizer shapes.
- Per-endpoint config supports injecting the secret as a query param (`secretQueryParam`, e.g. Ticketmaster's `apikey`) or a header (`secretHeaderName`, e.g. VES's `x-api-key`), and can JSON-encode remaining params into a POST body instead of a query string (`hasJsonBody`, used by VES) — see the `EndpointDef`/`ProviderDef` types for the full shape.
- Providers needing no key at all are supported (`ssmParameterName` omitted) — UK Police's ~25 endpoints are wired this way.

### Currently wired providers
- **Weather** (WeatherAPI.com) — needs a key.
- **UK Police** — no key required, ~25 endpoints under one `police` config.
- **Ticketmaster Discovery** — needs a key (Consumer Key only; see `apps/playground/BACKLOG.md`).
- **VES** (DVLA vehicle enquiry) — two separate provider IDs, `ves-uat` and `ves-production`, each its own SSM parameter and base URL, sharing one frontend page. See `apps/playground/BACKLOG.md` for the UAT key's current status.

Deferred providers (TfL, Animal Shelter/What3Words/ChipNDoodle, Charity Commission) are tracked in `apps/playground/BACKLOG.md`, not here.

## Local Development

### Preview the Site Locally
```bash
cd apps/playground
python -m http.server 8000
# Open http://localhost:8000/
```

**Note:** All buttons call the live API. There is no local API server.

## Important Notes

### Folder Detection
- `generate_sites.py` only detects folders with an `index.html` inside
- Folders in `EXCLUDE` set (`.github`, `assets`, `scripts`) are always skipped

### S3 Operations
- All S3 operations use `s3_utils.py` module
- Bucket name configurable via `S3_BUCKET` env var (default: `swordthain-demo-sites`)
- CloudFront invalidation automatic if `CLOUDFRONT_DISTRIBUTION_ID` is set
- Lambda IAM permissions needed: `s3:GetObject`, `s3:PutObject`, `s3:ListBucket`, `s3:DeleteObject`, `cloudfront:CreateInvalidation`, `secretsmanager:GetSecretValue`

### Updating Templates
- Edit `company-template/index.html` or `project-template/index.html` locally and deploy via `aws s3 sync`
- Changes only affect **newly created** companies/projects — existing pages are not automatically updated
- The `company-template/index.html` in S3 is what Lambda reads at runtime; the local copy is the source of truth

### Bulk Rebuild sites.json
Run `lambda/generate_sites.py` (adapted for S3) if `sites.json` gets out of sync. It preserves existing metadata (`name`, `description`, `tag`, `logoUrl`, `archived`) and only adds/removes companies based on S3 folder contents. Note: it does not currently preserve the `projects` array.
