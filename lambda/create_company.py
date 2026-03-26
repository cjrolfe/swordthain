"""
Create a new company - S3-adapted for Lambda.
Reads template from S3, generates AI summary, writes company folder and sites.json.
Screenshots skipped (use og:image fallback).
"""
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Tuple

import requests
from bs4 import BeautifulSoup

import s3_utils

S3_BASE = "https://sfdcdemoimages.s3.eu-west-1.amazonaws.com"
EXCLUDE = {".github", "assets", "scripts"}


@dataclass
class CompanyRequest:
    name: str
    website: str = ""
    tone: str = "Professional"
    demo_description: str = ""


def slugify(s: str) -> str:
    s = s.strip().lower()
    s = s.replace("&", "and")
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = re.sub(r"(^-+|-+$)", "", s)
    return s or "company"


def _get_ai_secrets():
    """Load API keys from Secrets Manager."""
    import json as j
    import boto3
    client = boto3.client("secretsmanager")
    r = client.get_secret_value(SecretId="swordthain/ai-keys")
    return j.loads(r["SecretString"])


def fetch_site_text(url: str, max_chars: int = 12000) -> Tuple[str, str, str, str]:
    """Returns (title, meta_description, extracted_text, og_image)."""
    if not url:
        return ("", "", "", "")

    if not re.match(r"^https?://", url, flags=re.I):
        url = "https://" + url

    headers = {"User-Agent": "Mozilla/5.0 (compatible; SwordthainLambda/1.0)"}
    r = requests.get(url, headers=headers, timeout=20, allow_redirects=True)
    r.raise_for_status()

    soup = BeautifulSoup(r.text, "html.parser")
    title = (soup.title.get_text(" ", strip=True) if soup.title else "").strip()

    meta_desc = ""
    md = soup.find("meta", attrs={"name": re.compile(r"^description$", re.I)})
    if md and md.get("content"):
        meta_desc = str(md.get("content")).strip()

    og_image = ""
    og = soup.find("meta", attrs={"property": re.compile(r"^og:image$", re.I)})
    if og and og.get("content"):
        og_image = str(og.get("content")).strip()

    for tag in soup(["script", "style", "noscript", "svg"]):
        tag.decompose()

    main = soup.find(["main", "article"]) or soup.body or soup
    text = main.get_text("\n", strip=True)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    if len(text) > max_chars:
        text = text[:max_chars] + "…"

    return (title, meta_desc, text, og_image)


def ai_summary(company: CompanyRequest, title: str, meta_desc: str, page_text: str) -> str:
    """Generate AI summary; fallback if unavailable."""
    def fallback() -> str:
        if meta_desc and len(meta_desc.strip()) >= 40:
            return meta_desc.strip()
        if title:
            return f"{company.name} — demo environment based on publicly available information."
        return "Demo environment for this company."

    try:
        secrets = _get_ai_secrets()
        provider_name = os.environ.get("AI_PROVIDER", "openai").lower()

        if provider_name == "none":
            return fallback()

        api_key = None
        if provider_name == "anthropic":
            api_key = secrets.get("ANTHROPIC_API_KEY", "").strip()
        else:
            api_key = secrets.get("OPENAI_API_KEY", "").strip()

        if not api_key:
            return fallback()

        from ai_providers import create_provider, AIRequest

        os.environ["OPENAI_API_KEY"] = secrets.get("OPENAI_API_KEY", "")
        os.environ["ANTHROPIC_API_KEY"] = secrets.get("ANTHROPIC_API_KEY", "")

        provider = create_provider()
        if not provider:
            return fallback()

        page_text_small = page_text[:8000] if page_text else ""
        request = AIRequest(
            company_name=company.name,
            website=company.website or "",
            tone=company.tone,
            title=title,
            meta_description=meta_desc,
            page_text=page_text_small,
            temperature=float(os.environ.get("AI_TEMPERATURE", "0.4")),
            max_tokens=int(os.environ.get("AI_MAX_TOKENS", "150")),
        )
        response = provider.generate_summary(request)

        if response.summary:
            return response.summary
        return fallback()

    except Exception:
        return fallback()


def render_from_template(template_html: str, company: CompanyRequest, slug: str, summary: str, screenshot_path: str) -> str:
    has_website = bool(company.website)
    has_screenshot = bool(screenshot_path)

    def strip_block(block_name: str, keep: bool) -> str:
        pattern = re.compile(rf"\{{\#IF_{block_name}\}}(.*?)\{{\/IF_{block_name}\}}", re.DOTALL)
        return lambda m: m.group(1) if keep else ""

    def repl(m):
        return m.group(1) if has_screenshot else ""  # for SCREENSHOT
    html = re.sub(r"\{\{#IF_SCREENSHOT\}\}(.*?)\{\{/IF_SCREENSHOT\}\}", lambda m: m.group(1) if has_screenshot else "", template_html, flags=re.DOTALL)
    html = re.sub(r"\{\{#IF_WEBSITE\}\}(.*?)\{\{/IF_WEBSITE\}\}", lambda m: m.group(1) if has_website else "", html, flags=re.DOTALL)

    logo_url = f"{S3_BASE}/{slug}/logo.png"
    s3_bucket_hint = f"s3://sfdcdemoimages/{slug}/"
    s3_logo_hint = f"{slug}/logo.png"

    replacements = {
        "{{COMPANY_NAME}}": company.name,
        "{{COMPANY_ID}}": slug,
        "{{COMPANY_WEBSITE}}": company.website,
        "{{COMPANY_SUMMARY}}": summary,
        "{{COMPANY_TONE}}": company.tone,
        "{{LOGO_URL}}": logo_url,
        "{{S3_BUCKET_HINT}}": s3_bucket_hint,
        "{{S3_LOGO_HINT}}": s3_logo_hint,
        "{{SCREENSHOT_PATH}}": screenshot_path or "",
    }
    for k, v in replacements.items():
        html = html.replace(k, v)
    return html


def handle_create(body: dict) -> dict:
    """Handle create company request. body: { name, website?, tone?, demoDescription? }"""
    name = (body.get("name") or "").strip()
    if not name:
        raise ValueError("Company name is required")

    website = (body.get("website") or "").strip()
    tone = (body.get("tone") or "Professional").strip()
    demo_description = (body.get("demoDescription") or "").strip()

    req = CompanyRequest(name=name, website=website, tone=tone, demo_description=demo_description)
    slug = slugify(name)

    # Check company doesn't already exist
    existing = s3_utils.get_object_str(f"{slug}/index.html")
    if existing:
        raise ValueError(f"Company '{slug}' already exists")

    # Get template
    template_html = s3_utils.get_object_str("company-template/index.html")
    if not template_html:
        raise FileNotFoundError("company-template/index.html not found in S3")

    # Summary
    if demo_description:
        final_summary = demo_description
        _, _, _, og_image = fetch_site_text(website) if website else ("", "", "", "")
    else:
        title, meta_desc, page_text, og_image = fetch_site_text(website)
        final_summary = ai_summary(req, title, meta_desc, page_text)

    # No Playwright in Lambda - use og:image URL as screenshot when available
    screenshot_path = og_image or ""

    # Render and write company index.html
    out_html = render_from_template(template_html, req, slug, final_summary, screenshot_path)
    s3_utils.put_object(f"{slug}/index.html", out_html, "text/html")

    # Update sites.json
    sites_data = {"updated": datetime.utcnow().strftime("%Y-%m-%d"), "sites": []}
    sites_str = s3_utils.get_object_str("assets/sites.json")
    if sites_str:
        try:
            sites_data = json.loads(sites_str)
        except json.JSONDecodeError:
            pass

    sites = sites_data.get("sites", [])
    if not isinstance(sites, list):
        sites = []

    existing_entry = next((s for s in sites if s.get("id") == slug), None)
    if existing_entry is None:
        existing_entry = {"id": slug, "path": f"/{slug}/"}
        sites.append(existing_entry)

    existing_entry["name"] = name
    existing_entry["description"] = final_summary
    existing_entry.setdefault("tag", "Demo")
    existing_entry.setdefault("logoUrl", f"{S3_BASE}/{slug}/logo.png")
    existing_entry.setdefault("archived", False)
    existing_entry.setdefault("projects", [])

    sites_data["updated"] = datetime.utcnow().strftime("%Y-%m-%d")
    sites_data["sites"] = sites
    s3_utils.put_object("assets/sites.json", json.dumps(sites_data, indent=2, ensure_ascii=False), "application/json")

    # Invalidate CloudFront
    s3_utils.invalidate_cloudfront(["/assets/sites.json", f"/{slug}/*"])

    return {"ok": True, "companyId": slug, "message": "Company site created."}
