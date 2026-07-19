"""
Anthropic Claude provider using Messages API.
"""
from typing import Dict, Any
from .base import AIProvider, AIRequest


class AnthropicProvider(AIProvider):
    """Anthropic Claude provider using Messages API"""

    def get_default_model(self) -> str:
        return "claude-3-5-haiku-20241022"

    def get_api_endpoint(self) -> str:
        return "https://api.anthropic.com/v1/messages"

    def build_request_headers(self) -> Dict[str, str]:
        return {
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        }

    def build_request_payload(self, request: AIRequest) -> Dict[str, Any]:
        prompt = self._build_prompt(request)
        return {
            "model": self.model,
            "max_tokens": request.max_tokens,
            "temperature": request.temperature,
            "system": "You write concise, factual company summaries for internal demo directories.",
            "messages": [
                {"role": "user", "content": prompt}
            ],
        }

    def extract_text_from_response(self, response_json: Dict[str, Any]) -> str:
        content = response_json.get("content", [])
        if content and len(content) > 0:
            return content[0].get("text", "")
        return ""

    def is_retryable_status(self, status_code: int) -> bool:
        return status_code in (429, 500, 502, 503, 529)
