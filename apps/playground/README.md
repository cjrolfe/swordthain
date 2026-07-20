# Swordthain Demo Sites

A directory of company demo sites hosted on AWS (S3 + CloudFront). Each company has its own page, and each company can have one or more projects. Everything is managed through a UI backed by API Gateway + Lambda.

## Architecture

| Component | Technology |
|-----------|------------|
| Static site | S3 (`swordthain-demo-sites`) |
| CDN | CloudFront |
| DNS | Route 53 (swordthain.com) |
| API | API Gateway + Lambda (`swordthain-automation`) |
| Logos | S3 (`sfdcdemoimages`, eu-west-1) |

## How it works

### Frontend

| File | Purpose |
|------|---------|
| `index.html` | Landing page — company directory and "Create new company" modal |
| `archived.html` | Archived companies (restore / delete) |
| `assets/app.js` | Fetches `sites.json`, renders cards, handles all API calls with in-memory updates |
| `assets/sites.json` | Source of truth for all companies, their metadata, and their projects |
| `company-template/index.html` | Template used by Lambda when creating a new company |
| `project-template/index.html` | Template used by Lambda when creating a new project |

### API endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/create` | POST | Create a company from `company-template/`, generate AI summary, update `sites.json` |
| `/archive` | POST | Archive, restore, or permanently delete a company |
| `/project/create` | POST | Create a project under a company from `project-template/`, update `sites.json` |
| `/project/delete` | POST | Permanently delete a project |

After each operation, Lambda updates `assets/sites.json` in S3 and invalidates the CloudFront cache. The frontend updates its card grid immediately in memory — no page reload required.

**All 4 endpoints require a Cognito `Owner`-group Bearer token** (see `infra/README.md`'s "Playground API auth retrofit" — this API had no auth at all before that). `assets/app.js` and `company-template/index.html` each read the `swordthain_session` cookie (set by `apps/media-app` on `.swordthain.com` after sign-in) and attach it automatically; there's no separate login UI here since `labs.swordthain.com`'s CloudFront Function already requires that same cookie just to serve any page.

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

## Deployment

### Deploy frontend to S3

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

### Deploy Lambda

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
├── index.html                  # Landing page
├── archived.html               # Archived companies view
├── favicon.svg                 # Sword icon
├── assets/
│   ├── app.js                  # UI logic and API calls
│   ├── styles.css              # Global styles
│   └── sites.json              # Company + project registry
├── company-template/
│   └── index.html              # Template for new company pages
├── project-template/
│   └── index.html              # Template for new project pages
└── lambda/                     # Lambda source (pip deps excluded from git)
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
