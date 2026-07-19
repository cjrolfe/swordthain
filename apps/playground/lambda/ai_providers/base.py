"""
Abstract base class for AI providers with shared retry logic.
"""
from abc import ABC, abstractmethod
from typing import Optional, Dict, Any
from dataclasses import dataclass
import requests
import time
import random


@dataclass
class AIRequest:
    """Standardized request for all providers"""
    company_name: str
    website: str
    tone: str
    title: str
    meta_description: str
    page_text: str
    temperature: float = 0.4
    max_tokens: int = 150


@dataclass
class AIResponse:
    """Standardized response"""
    summary: Optional[str]
    error: Optional[str] = None
    used_fallback: bool = False


class AIProvider(ABC):
    """Abstract base class for AI providers"""

    def __init__(self, api_key: str, model: Optional[str] = None):
        self.api_key = api_key
        self.model = model or self.get_default_model()

    @abstractmethod
    def get_default_model(self) -> str:
        """Return provider's default model"""
        pass

    @abstractmethod
    def get_api_endpoint(self) -> str:
        """Return provider's API endpoint"""
        pass

    @abstractmethod
    def build_request_payload(self, request: AIRequest) -> Dict[str, Any]:
        """Build provider-specific request payload"""
        pass

    @abstractmethod
    def build_request_headers(self) -> Dict[str, str]:
        """Build provider-specific headers"""
        pass

    @abstractmethod
    def extract_text_from_response(self, response_json: Dict[str, Any]) -> str:
        """Extract summary text from provider response"""
        pass

    @abstractmethod
    def is_retryable_status(self, status_code: int) -> bool:
        """Check if HTTP status should trigger retry"""
        pass

    def _build_prompt(self, req: AIRequest) -> str:
        """Build the prompt (shared across all providers)"""
        return f"""
You are generating short blurbs for an internal demo-site directory.

Company name: {req.company_name}
Website: {req.website or "(not provided)"}
Tone: {req.tone}

Use the information below from the company's website (it may be partial or messy).
Write a concise 1–2 sentence summary (max 45 words).
No hype, no markdown, no quotes. Don't mention that you're an AI.

Page title: {req.title}
Meta description: {req.meta_description}

Extracted text:
{req.page_text}
""".strip()

    def generate_summary(self, request: AIRequest) -> AIResponse:
        """Generate summary with retry logic."""
        url = self.get_api_endpoint()
        headers = self.build_request_headers()
        payload = self.build_request_payload(request)

        max_attempts = 5
        base_sleep = 1.5

        for attempt in range(1, max_attempts + 1):
            try:
                resp = requests.post(url, headers=headers, json=payload, timeout=60)

                if resp.status_code >= 200 and resp.status_code < 300:
                    data = resp.json()
                    summary = self.extract_text_from_response(data)
                    if summary:
                        return AIResponse(summary=summary)
                    return AIResponse(summary=None, error="Empty response from AI")

                if self.is_retryable_status(resp.status_code):
                    retry_after = resp.headers.get("retry-after")
                    sleep_s = float(retry_after) if retry_after else None

                    if attempt < max_attempts:
                        backoff = (base_sleep * (2 ** (attempt - 1))) + random.uniform(0, 0.75)
                        time.sleep(sleep_s if sleep_s is not None else backoff)
                        continue

                    return AIResponse(summary=None, error=f"Rate limited (status {resp.status_code})")

                return AIResponse(summary=None, error=f"API error (status {resp.status_code})")

            except requests.RequestException as e:
                if attempt < max_attempts:
                    backoff = (base_sleep * (2 ** (attempt - 1))) + random.uniform(0, 0.75)
                    time.sleep(backoff)
                    continue
                return AIResponse(summary=None, error=f"Request failed: {e}")

        return AIResponse(summary=None, error="Max retries exceeded")
