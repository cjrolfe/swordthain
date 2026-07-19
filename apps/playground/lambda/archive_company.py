"""
Archive, restore, or delete company - S3-adapted for Lambda.
"""
import json
import os
import re
from datetime import datetime

import s3_utils


def handle_archive(body: dict) -> dict:
    """
    Handle archive/restore/delete request.
    body: { action: "archive"|"restore"|"delete", companyId: str }
    """
    action = (body.get("action") or "").strip().lower()
    company_id = (body.get("companyId") or body.get("company_id") or "").strip()

    if action not in ("archive", "restore", "delete"):
        raise ValueError("action must be 'archive', 'restore', or 'delete'")

    if not company_id:
        raise ValueError("companyId is required")

    if not re.match(r"^[a-z0-9\-]+$", company_id):
        raise ValueError("Invalid companyId")

    sites_str = s3_utils.get_object_str("assets/sites.json")
    if not sites_str:
        raise FileNotFoundError("assets/sites.json not found")

    data = json.loads(sites_str)
    sites = data.get("sites", [])
    if not isinstance(sites, list):
        raise ValueError("sites.json has invalid format")

    if action == "delete":
        if company_id == "company-template":
            raise ValueError("Cannot delete company-template")
        found = any(s.get("id") == company_id for s in sites)
        if not found:
            raise ValueError(f"Company '{company_id}' not found")
        sites = [s for s in sites if s.get("id") != company_id]
        s3_utils.delete_prefix(f"{company_id}/")
    else:
        found = False
        for s in sites:
            if s.get("id") == company_id:
                s["archived"] = action == "archive"
                found = True
                break
        if not found:
            raise ValueError(f"Company '{company_id}' not found")

    data["updated"] = datetime.utcnow().strftime("%Y-%m-%d")
    data["sites"] = sites
    s3_utils.put_object("assets/sites.json", json.dumps(data, indent=2, ensure_ascii=False), "application/json")

    paths = ["/assets/sites.json"]
    if action == "delete":
        paths.append(f"/{company_id}/*")

    s3_utils.invalidate_cloudfront(paths)

    return {"ok": True, "action": action, "companyId": company_id, "message": f"Company {action}d."}
