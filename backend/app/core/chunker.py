import re
from typing import List


class TextChunker:
    """Split text into semantically meaningful chunks."""

    def __init__(self, min_chars: int = 300, max_chars: int = 800):
        self.min_chars = min_chars
        self.max_chars = max_chars

    def chunk(self, text: str) -> List[str]:
        """Split text by headings -> paragraphs -> sentences, respecting boundaries."""
        sections = self._split_by_headings(text)

        chunks: List[str] = []
        buffer = ""

        for section in sections:
            paragraphs = [p.strip() for p in section.split("\n\n") if p.strip()]

            for para in paragraphs:
                if len(buffer) + len(para) > self.max_chars and buffer:
                    chunks.append(buffer.strip())
                    buffer = para
                else:
                    buffer = buffer + "\n\n" + para if buffer else para

                if len(buffer) >= self.max_chars:
                    chunks.extend(self._split_long_text(buffer.strip()))
                    buffer = ""

            if buffer and len(buffer) >= self.min_chars:
                chunks.append(buffer.strip())
                buffer = ""

        if buffer.strip():
            chunks.append(buffer.strip())

        return [c for c in chunks if len(c) >= self.min_chars * 0.5]

    def _split_by_headings(self, text: str) -> List[str]:
        """Split by Markdown headings."""
        parts = re.split(r"(?=^#{1,6}\s)", text, flags=re.MULTILINE)
        return [p for p in parts if p.strip()]

    def _split_long_text(self, text: str) -> List[str]:
        """Split text that exceeds max_chars by sentence boundaries."""
        sentences = re.split(r"(?<=[。！？.!?\n])", text)
        chunks: List[str] = []
        buffer = ""

        for s in sentences:
            if not s.strip():
                continue
            if len(buffer) + len(s) > self.max_chars and buffer:
                chunks.append(buffer.strip())
                buffer = s
            else:
                buffer += s

        if buffer.strip():
            chunks.append(buffer.strip())

        return chunks
