"""
Factory function for AI provider creation with backward compatibility.
"""
from typing import Optional
import os
from .base import AIProvider, AIRequest, AIResponse
from .openai_provider import OpenAIProvider
from .anthropic_provider import AnthropicProvider


def create_provider() -> Optional[AIProvider]:
    """
    Factory function to create the appropriate AI provider.
    Returns None if no provider configured (will use fallback).
    """
    provider_name = os.environ.get("AI_PROVIDER", "").lower().strip()

    if provider_name == "none":
        return None

    if provider_name == "anthropic":
        api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
        if not api_key:
            return None
        model = os.environ.get("ANTHROPIC_MODEL", "").strip()
        return AnthropicProvider(api_key, model or None)

    if provider_name == "openai" or (not provider_name and os.environ.get("OPENAI_API_KEY")):
        api_key = os.environ.get("OPENAI_API_KEY", "").strip()
        if not api_key:
            return None
        model = os.environ.get("OPENAI_MODEL", "").strip()
        return OpenAIProvider(api_key, model or None)

    if provider_name:
        return None

    return None


__all__ = ["create_provider", "AIProvider", "AIRequest", "AIResponse"]
