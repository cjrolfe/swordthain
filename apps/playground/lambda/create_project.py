"""
Create a new project under a company.
Reads project-template from S3, renders it, writes
{companyId}/{projectSlug}/index.html, and updates sites.json.
"""
from __future__ import annotations

import json
import re
from datetime import datetime

import s3_utils


def slugify(s: str) -> str:
    s = s.strip().lower()
    s = s.replace("&", "and")
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = re.sub(r"(^-+|-+$)", "", s)
    return s or "project"


def render_project_template(
    template_html: str,
    project_name: str,
    project_description: str,
    company_id: str,
    company_name: str,
    created_at: str,
) -> str:
    has_description = bool(project_description.strip())
    html = re.sub(
        r"\{\{#IF_DESCRIPTION\}\}(.*?)\{\{/IF_DESCRIPTION\}\}",
        lambda m: m.group(1) if has_description else "",
        template_html,
        flags=re.DOTALL,
    )
    replacements = {
        "{{PROJECT_NAME}}": project_name,
        "{{PROJECT_DESCRIPTION}}": project_description,
        "{{COMPANY_ID}}": company_id,
        "{{COMPANY_NAME}}": company_name,
        "{{CREATED_AT}}": created_at,
    }
    for k, v in replacements.items():
        html = html.replace(k, v)
    return html


def handle_create_project(body: dict) -> dict:
    """Handle create project request.
    body: { companyId: str, name: str, description?: str }
    """
    company_id = (body.get("companyId") or "").strip()
    name = (body.get("name") or "").strip()
    description = (body.get("description") or "").strip()

    if not company_id:
        raise ValueError("companyId is required")
    if not re.match(r"^[a-z0-9\-]+$", company_id):
        raise ValueError("Invalid companyId")
    if not name:
        raise ValueError("Project name is required")

    project_id = slugify(name)

    # Guard against duplicate
    existing = s3_utils.get_object_str(f"{company_id}/{project_id}/index.html")
    if existing:
        raise ValueError(f"Project '{project_id}' already exists under '{company_id}'")

    # Load project template
    template_html = s3_utils.get_object_str("project-template/index.html")
    if not template_html:
        raise FileNotFoundError("project-template/index.html not found in S3")

    # Load and validate sites.json
    sites_str = s3_utils.get_object_str("assets/sites.json")
    if not sites_str:
        raise FileNotFoundError("assets/sites.json not found")
    sites_data = json.loads(sites_str)
    sites = sites_data.get("sites", [])

    company_entry = next((s for s in sites if s.get("id") == company_id), None)
    if company_entry is None:
        raise ValueError(f"Company '{company_id}' not found")

    company_name = company_entry.get("name", company_id)
    created_at = datetime.utcnow().strftime("%Y-%m-%d")

    # Render and write project page
    out_html = render_project_template(
        template_html, name, description, company_id, company_name, created_at
    )
    s3_utils.put_object(f"{company_id}/{project_id}/index.html", out_html, "text/html")

    # Update sites.json
    projects = company_entry.setdefault("projects", [])
    projects.append({
        "id": project_id,
        "name": name,
        "description": description,
        "createdAt": created_at,
    })
    sites_data["updated"] = datetime.utcnow().strftime("%Y-%m-%d")
    s3_utils.put_object(
        "assets/sites.json",
        json.dumps(sites_data, indent=2, ensure_ascii=False),
        "application/json",
    )

    # Invalidate CloudFront
    s3_utils.invalidate_cloudfront([
        "/assets/sites.json",
        f"/{company_id}/{project_id}/*",
    ])

    return {"ok": True, "companyId": company_id, "projectId": project_id, "message": "Project created."}
