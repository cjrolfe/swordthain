"""
Generate sites.json from S3 folder structure - S3-adapted for Lambda.
"""
import json
from datetime import datetime

import s3_utils

S3_BASE = "https://sfdcdemoimages.s3.eu-west-1.amazonaws.com"
EXCLUDE = {".github", "assets", "scripts"}


def handle_generate() -> dict:
    """Rebuild sites.json from S3 prefixes that have index.html."""
    dirs = []
    for name in s3_utils.list_prefixes():
        if name in EXCLUDE:
            continue
        if s3_utils.get_object(f"{name}/index.html"):
            dirs.append(name)
    dirs = sorted(dirs)

    # Load existing for metadata
    existing = {}
    sites_str = s3_utils.get_object_str("assets/sites.json")
    if sites_str:
        try:
            data = json.loads(sites_str)
            for s in data.get("sites", []):
                _id = s.get("id")
                if _id:
                    existing[_id] = s
        except json.JSONDecodeError:
            pass

    sites = []
    for d in dirs:
        old = existing.get(d, {})
        sites.append({
            "id": d,
            "name": old.get("name") or d.replace("-", " ").title(),
            "path": f"/{d}/",
            "description": old.get("description", ""),
            "tag": old.get("tag") or "Demo",
            "logoUrl": old.get("logoUrl") or f"{S3_BASE}/{d}/logo.png",
            "archived": bool(old.get("archived", False)),
        })

    out = {"updated": datetime.utcnow().strftime("%Y-%m-%d"), "sites": sites}
    s3_utils.put_object("assets/sites.json", json.dumps(out, indent=2, ensure_ascii=False), "application/json")
    s3_utils.invalidate_cloudfront(["/assets/sites.json"])
    return {"ok": True, "count": len(sites)}
