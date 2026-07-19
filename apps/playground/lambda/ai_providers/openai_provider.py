"""
OpenAI provider using /v1/responses endpoint.
"""
from typing import Dict, Any
from .base import AIProvider, AIRequest


class OpenAIProvider(AIProvider):
    """OpenAI provider using /v1/responses endpoint"""

    def get_default_model(self) -> str:
        return "gpt-4.1-mini"

    def get_api_endpoint(self) -> str:
        return "https://api.openai.com/v1/responses"

    def build_request_headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def build_request_payload(self, request: AIRequest) -> Dict[str, Any]:
        prompt = self._build_prompt(request)
        return {
            "model": self.model,
            "input": [
                {"role": "system", "content": "You write concise, factual company summaries for internal demo directories."},
                {"role": "user", "content": prompt},
            ],
            "temperature": request.temperature,
        }

    def extract_text_from_response(self, response_json: Dict[str, Any]) -> str:
        parts = []
        for item in response_json.get("output", []):
            if item.get("type") != "message":
                continue
            for c in item.get("content", []):
                if c.get("type") in ("output_text", "text"):
                    t = c.get("text") or c.get("value") or ""
                    if t:
                        parts.append(t)
        return " ".join(" ".join(parts).split()).strip()

    def is_retryable_status(self, status_code: int) -> bool:
        return status_code in (429, 500, 502, 503, 504)
