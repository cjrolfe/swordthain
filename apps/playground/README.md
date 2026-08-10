# Swordthain Labs

Owner-only internal playgrounds hosted at `labs.swordthain.com` (S3 + CloudFront, gated by a CloudFront Function stealth check on the shared `swordthain_session` cookie — see `infra/README.md`'s `SwordthainPlaygroundStack` section). Root `index.html` is a small hub linking to two independent playgrounds:

- **Company Demos** (`demos/`) — a directory of company demo sites, each with one or more projects. Everything is managed through a UI backed by API Gateway + Lambda.
- **API Testing** (`api-testing/`) — send real requests to a set of third-party APIs by filling in a form, with real keys held server-side.

## Architecture

| Component | Technology |
|-----------|------------|
| Static site | S3 (`swordthain-demo-sites`) |
| CDN | CloudFront |
| DNS | Route 53 (`labs.swordthain.com`) |
| Company Demos API | API Gateway + Lambda (`swordthain-automation`, Python, manually deployed — see below) |
| API Testing proxy | Same API Gateway, `/api-testing` resource + a separate Lambda (`infra/lambda/playground/api-testing-proxy.ts`, TypeScript, CDK-managed) |
| Logos | S3 (`sfdcdemoimages`, eu-west-1) |

All endpoints on both Lambdas require a Cognito `Owner`-group Bearer token (see `infra/README.md`'s "Playground API auth retrofit"). There's no login UI here — `labs.swordthain.com`'s CloudFront Function already requires a valid Owner session cookie just to serve any page, and both `assets/app.js` and `api-testing/assets/api-tester.js` read that same cookie and attach it as the Bearer token automatically.

## Company Demos (`demos/`)

### Frontend

| File | Purpose |
|------|---------|
| `demos/index.html` | Company directory and "Create new company" modal |
| `demos/archived.html` | Archived companies (restore / delete) |
| `assets/app.js` | Fetches `sites.json`, renders cards, handles all API calls with in-memory updates |
| `assets/sites.json` | Source of truth for all companies, their metadata, and their projects |
| `company-template/index.html` | Template used by Lambda when creating a new company |
| `project-template/index.html` | Template used by Lambda when creating a new project |

All paths in these files are absolute (`/assets/...`), so moving the directory pages into `demos/` didn't require touching how they load shared assets.

### API endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/create` | POST | Create a company from `company-template/`, generate AI summary, update `sites.json` |
| `/archive` | POST | Archive, restore, or permanently delete a company |
| `/project/create` | POST | Create a project under a company from `project-template/`, update `sites.json` |
| `/project/delete` | POST | Permanently delete a project |

After each operation, Lambda updates `assets/sites.json` in S3 and invalidates the CloudFront cache. The frontend updates its card grid immediately in memory — no page reload required.

### Data structure (`sites.json`)

```json
{
  "updated": "2026-03-26",
  "sites": [
    {
      "id": "company-slug",
      "name": "Company Name",
      "path": "/company-slug/",
      "description": "AI-generated or custom description",
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
  ]
}
```

## Usage

### Create a company

1. Click **Create new company** on the landing page.
2. Fill in company name (required), website, description, and tone.
3. Click **Create**. Lambda creates `/{company-id}/index.html` in S3, generates an AI summary if no description was provided, and adds the company to `sites.json`.

### Archive / restore / delete a company

- **Archive** — click Archive on the landing page. The company is hidden from the landing page but remains in S3.
- **Restore** — click Restore on the archived page.
- **Delete** — click Delete on the archived page and confirm. Permanently removes the company folder from S3. Cannot be undone.

### Add / delete a project

Open a company page. The **Projects** section lists existing projects and has an **Add project** button.

- **Add project** — enter a name and optional description. Lambda creates `/{company-id}/{project-id}/index.html` and updates `sites.json`.
- **Delete project** — click Delete on a project card and confirm. Permanently removes the project from S3. Cannot be undone.

## AI provider setup

Create a secret `swordthain/ai-keys` in AWS Secrets Manager (eu-west-1):

```json
{
  "OPENAI_API_KEY": "sk-...",
  "ANTHROPIC_API_KEY": "sk-ant-..."
}
```

Set Lambda environment variables:

| Variable | Values | Default |
|----------|--------|---------|
| `AI_PROVIDER` | `openai`, `anthropic`, `none` | `openai` if key present |
| `OPENAI_MODEL` | e.g. `gpt-4.1-mini` | `gpt-4.1-mini` |
| `ANTHROPIC_MODEL` | e.g. `claude-3-5-haiku-20241022` | `claude-3-5-haiku-20241022` |
| `AI_TEMPERATURE` | float | `0.4` |
| `AI_MAX_TOKENS` | int | `150` |

If AI is unavailable the Lambda falls back to the website's meta description, or a generic placeholder. Creation never fails due to AI issues.

## API Testing (`api-testing/`)

A form-driven way to send real requests to a set of third-party APIs without ever putting a real key in the browser.

- `api-testing/index.html` — hub page linking to each provider.
- `api-testing/{provider}/index.html` + `config.js` — one pair per provider (`weather`, `police`, `ticketmaster`, `ves`). `config.js` declares the provider's endpoints as plain data: `{id, name, method, pathTemplate, pathParams, queryParams, bodyParams}` per endpoint — no per-provider HTML/JS.
- `api-testing/assets/api-tester.js` — one shared, generic renderer. Reads `window.API_TESTING_CONFIG` (set by the page's `config.js`), builds a form for whatever params that provider's endpoints declare, and POSTs `{provider, endpointId, params}` to `${SWORDTHAIN_API}/api-testing` on submit.

**Backend**: `infra/lambda/playground/api-testing-proxy.ts` (TypeScript, CDK-managed — a different Lambda and deploy path from the Python `swordthain-automation` above). A fixed, hardcoded allowlist of providers/endpoints/base-URLs lives in the Lambda itself; the client only ever sends `{provider, endpointId, params}`, never a URL — deliberately not an open proxy, since that would be an SSRF endpoint even behind Owner-only auth. Real third-party keys live in SSM `SecureString` parameters (`/swordthain/api-testing/{provider}-api-key`), populated out-of-band via `aws ssm put-parameter`, never committed to git, and cached in-Lambda across warm invocations. Wired into the same REST API as the demos endpoints above, behind the same Cognito Owner authorizer, as a new `/api-testing` resource (see `infra/lib/playground-stack.ts`).

Currently wired: **Weather** (WeatherAPI.com, needs a key), **UK Police** (no key needed), **Ticketmaster Discovery** (needs a key — see `apps/playground/BACKLOG.md`), **VES** (DVLA vehicle enquiry, UAT + Production environments, each its own SSM parameter — see `apps/playground/BACKLOG.md` for the dead UAT key). Adding a new provider means adding an entry to the `PROVIDERS` map in the Lambda, an SSM parameter if it needs a key, and a `{provider}/index.html` + `config.js` pair — no changes to `api-tester.js` itself.

## Deployment

### Deploy frontend to S3

Scoped per-directory, not a single top-level `sync --delete .` — the bucket also holds content the `create_company`/`create_project` Lambda writes straight to S3 at runtime (e.g. `<company-id>/index.html`), which never exists in this git checkout. A bucket-wide `--delete` sync would remove all of that (this exact thing happened once — see git history). `assets/sites.json` is excluded since it's Lambda-managed live state, not a static file.

```bash
cd apps/playground
aws s3 sync assets s3://swordthain-demo-sites/assets/ --delete --exclude "sites.json"
aws s3 sync api-testing s3://swordthain-demo-sites/api-testing/ --delete
aws s3 sync company-template s3://swordthain-demo-sites/company-template/ --delete
aws s3 sync demos s3://swordthain-demo-sites/demos/ --delete
aws s3 sync docs s3://swordthain-demo-sites/docs/ --delete
aws s3 sync project-template s3://swordthain-demo-sites/project-template/ --delete
aws s3 cp index.html s3://swordthain-demo-sites/index.html
aws s3 cp favicon.svg s3://swordthain-demo-sites/favicon.svg
aws s3 cp BACKLOG.md s3://swordthain-demo-sites/BACKLOG.md
aws s3 cp CLAUDE.md s3://swordthain-demo-sites/CLAUDE.md
aws s3 cp README.md s3://swordthain-demo-sites/README.md
```

### Deploy the Company Demos Lambda

```bash
cd apps/playground/lambda
python3 -m pip install -r requirements.txt -t .
zip -r ../lambda.zip . -x "*.pyc" -x "__pycache__/*" -x "README.md"
cd ..
aws lambda update-function-code --function-name swordthain-automation --zip-file fileb://lambda.zip --region us-east-1
```

### Invalidate CloudFront

```bash
aws cloudfront create-invalidation --distribution-id E1AUXZ6C0Z7J9P --paths "/*"
```

Lambda automatically invalidates the relevant CloudFront paths after each write if `CLOUDFRONT_DISTRIBUTION_ID` is set in its environment.

### Deploy the API Testing proxy Lambda

Not part of this app's manual deploy steps — it's CDK-managed, deployed the same way as any other infra change:

```bash
cd infra
npx cdk deploy SwordthainPlaygroundStack
```

## Local preview

```bash
cd apps/playground
python -m http.server 8000
# Open http://localhost:8000/
```

Create/archive/delete buttons call the live API. There is no local API server.

## File structure

```
.
├── index.html                  # Hub — links to demos/ and api-testing/
├── favicon.svg                 # Sword icon
├── demos/
│   ├── index.html              # Company directory
│   └── archived.html           # Archived companies view
├── api-testing/
│   ├── index.html              # API Testing hub
│   ├── assets/api-tester.js    # Shared generic form renderer
│   ├── weather/{index.html,config.js}
│   ├── police/{index.html,config.js}
│   ├── ticketmaster/{index.html,config.js}
│   └── ves/{index.html,config.js}
├── assets/
│   ├── app.js                  # Company Demos UI logic and API calls
│   ├── styles.css              # Global styles, shared by both playgrounds
│   └── sites.json              # Company + project registry
├── company-template/
│   └── index.html              # Template for new company pages
├── project-template/
│   └── index.html              # Template for new project pages
├── docs/
│   └── codebase-diagram.html   # Reference diagram
└── lambda/                     # Company Demos Lambda source (pip deps excluded from git)
    ├── lambda_function.py      # Request router
    ├── create_company.py       # Company creation handler
    ├── archive_company.py      # Archive / restore / delete handler
    ├── create_project.py       # Project creation handler
    ├── delete_project.py       # Project deletion handler
    ├── generate_sites.py       # Rebuild sites.json from S3 (recovery tool)
    ├── s3_utils.py             # S3 + CloudFront helpers
    ├── ai_providers/           # OpenAI and Anthropic provider modules
    └── requirements.txt
```

The API Testing proxy Lambda (`api-testing-proxy.ts`) lives in `infra/lambda/playground/`, not here — see "API Testing" above.
