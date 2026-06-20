import json
import logging
from typing import AsyncGenerator, Optional

import httpx

from ..config import get_settings

logger = logging.getLogger(__name__)


class LLMClient:
    """Async client for OpenAI-compatible LLM APIs."""

    def __init__(self):
        settings = get_settings()
        self.base_url = settings.LLM_BASE_URL.rstrip("/")
        self.api_key = settings.LLM_API_KEY
        self.model = settings.LLM_MODEL
        self._client: Optional[httpx.AsyncClient] = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=120.0)
        return self._client

    @staticmethod
    def _build_messages(prompt: str, system: str = "") -> list[dict]:
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})
        return messages

    async def generate(
        self,
        prompt: str,
        system: str = "",
        temperature: float = 0.3,
        max_tokens: int = 4096,
    ) -> str:
        client = await self._get_client()
        messages = self._build_messages(prompt, system)

        resp = await client.post(
            f"{self.base_url}/chat/completions",
            headers={"Authorization": f"Bearer {self.api_key}"},
            json={
                "model": self.model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"]

    async def generate_stream(
        self,
        prompt: str,
        system: str = "",
        temperature: float = 0.3,
        max_tokens: int = 4096,
    ) -> AsyncGenerator[str, None]:
        """Stream text chunks from the LLM via SSE.

        Yields incremental text deltas. The caller is responsible for
        accumulating them into the final text.
        """
        client = await self._get_client()
        messages = self._build_messages(prompt, system)

        async with client.stream(
            "POST",
            f"{self.base_url}/chat/completions",
            headers={"Authorization": f"Bearer {self.api_key}"},
            json={
                "model": self.model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
                "stream": True,
            },
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line.startswith("data:"):
                    continue
                payload = line[len("data:"):].strip()
                if payload == "[DONE]":
                    break
                try:
                    chunk = json.loads(payload)
                    delta = chunk["choices"][0]["delta"].get("content", "")
                    if delta:
                        yield delta
                except (json.JSONDecodeError, KeyError, IndexError):
                    continue

    async def generate_json(
        self,
        prompt: str = "",
        system: str = "",
        system_prompt: str = "",
        user_prompt: str = "",
        temperature: float = 0.3,
        retries: int = 2,
    ) -> dict:
        """Generate and parse JSON response from LLM."""
        # Support both calling conventions
        p = user_prompt or prompt
        s = system_prompt or system
        raw = await self.generate(p, system=s, temperature=temperature)

        for attempt in range(retries + 1):
            try:
                # Try to extract JSON from markdown code blocks
                text = raw.strip()
                if "```json" in text:
                    text = text.split("```json", 1)[1].split("```", 1)[0]
                elif "```" in text:
                    text = text.split("```", 1)[1].split("```", 1)[0]

                result = json.loads(text.strip())
                return result
            except (json.JSONDecodeError, IndexError) as e:
                if attempt < retries:
                    logger.warning(f"JSON parse failed (attempt {attempt+1}), retrying: {e}")
                    raw = await self.generate(
                        f"上一次输出不是合法 JSON，请重新输出。错误信息：{e}\n\n原始输出：\n{raw}",
                        system=system,
                        temperature=temperature,
                    )
                else:
                    raise ValueError(f"Failed to parse LLM JSON after {retries+1} attempts: {e}\nRaw: {raw}")

    async def close(self):
        if self._client and not self._client.is_closed:
            await self._client.aclose()
