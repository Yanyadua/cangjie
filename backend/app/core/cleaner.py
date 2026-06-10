import re
import hashlib


def clean_text(raw: str) -> str:
    """Clean raw article text: remove ads, HTML, excess whitespace."""
    text = raw

    # Remove HTML tags
    text = re.sub(r"<[^>]+>", "", text)

    # Remove common ad patterns (微信广告等)
    text = re.sub(r"广告.*?(?:\n|$)", "", text, flags=re.IGNORECASE)
    text = re.sub(r"更多精彩.*?(?:\n|$)", "", text, flags=re.IGNORECASE)
    text = re.sub(r"扫码关注.*?(?:\n|$)", "", text, flags=re.IGNORECASE)
    text = re.sub(r"长按.*?二维码.*?(?:\n|$)", "", text, flags=re.IGNORECASE)

    # Normalize whitespace
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)

    # Remove duplicate title lines (first line appears again)
    lines = text.strip().split("\n")
    if len(lines) > 1 and lines[0].strip() == lines[1].strip():
        lines = lines[1:]

    return "\n".join(lines).strip()


def compute_content_hash(content: str) -> str:
    """Compute SHA-256 hash of content."""
    return hashlib.sha256(content.encode("utf-8")).hexdigest()
