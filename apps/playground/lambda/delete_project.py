"""
Delete a project from a company.
Removes the S3 prefix and the entry from the company's projects array in sites.json.
"""
from __future__ import annotations

import json
import re
from datetime import datetime

import s3_utils


def handle_delete_project(body: dict) -> dict:
    """Handle delete project request.
    body: { companyId: str, projectId: str }
    """
    company_id = (body.get("companyId") or "").strip()
    project_id = (body.get("projectId") or "").strip()

    if not company_id:
        raise ValueError("companyId is required")
    if not project_id:
        raise ValueError("projectId is required")
    if not re.match(r"^[a-z0-9\-]+$", company_id):
        raise ValueError("Invalid companyId")
    if not re.match(r"^[a-z0-9\-]+$", project_id):
        raise ValueError("Invalid projectId")

    # Load sites.json
    sites_str = s3_utils.get_object_str("assets/sites.json")
    if not sites_str:
        raise FileNotFoundError("assets/sites.json not found")
    sites_data = json.loads(sites_str)
    sites = sites_data.get("sites", [])

    company_entry = next((s for s in sites if s.get("id") == company_id), None)
    if company_entry is None:
        raise ValueError(f"Company '{company_id}' not found")

    projects = company_entry.get("projects", [])
    project_entry = next((p for p in projects if p.get("id") == project_id), None)
    if project_entry is None:
        raise ValueError(f"Project '{project_id}' not found under '{company_id}'")

    # Remove from projects array
    company_entry["projects"] = [p for p in projects if p.get("id") != project_id]

    # Delete S3 prefix
    s3_utils.delete_prefix(f"{company_id}/{project_id}/")

    # Write updated sites.json
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

    return {"ok": True, "companyId": company_id, "projectId": project_id, "message": "Project deleted."}
