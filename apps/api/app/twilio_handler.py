"""Twilio webhook utilities — TwiML builder and signature validator."""
from __future__ import annotations

import hashlib
import hmac
import logging
from xml.sax.saxutils import escape

logger = logging.getLogger(__name__)

# Indian-accented voices available on all Twilio plans
_VOICE_EN = "Polly.Aditi"   # Indian English
_VOICE_HI = "Polly.Kajal"   # Hindi neural voice


def _voice(lang: str) -> tuple[str, str]:
    """Returns (twiml_voice, twiml_language) for the given language."""
    if lang == "Hindi":
        return _VOICE_HI, "hi-IN"
    return _VOICE_EN, "en-IN"


def say_gather(text: str, lang: str, gather_url: str) -> str:
    """Speak text then open mic — the main call-turn TwiML."""
    voice, twiml_lang = _voice(lang)
    sep = "&amp;" if "?" in gather_url else "?"
    silence_url = f"{escape(gather_url)}{sep}silence=1"
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        "<Response>"
        f'<Say voice="{voice}" language="{twiml_lang}">{escape(text)}</Say>'
        f'<Gather input="speech" action="{escape(gather_url)}" method="POST"'
        f' speechTimeout="auto" language="{twiml_lang}" enhanced="true">'
        "</Gather>"
        # If customer says nothing, Redirect fires so we can prompt again
        f'<Redirect method="POST">{silence_url}</Redirect>'
        "</Response>"
    )


def connect_stream(stream_url: str, action_url: str, custom_parameters: dict[str, str] | None = None) -> str:
    """Open a bidirectional Twilio Media Stream and continue at action_url when it closes."""
    params_xml = ""
    for name, value in (custom_parameters or {}).items():
        params_xml += f'<Parameter name="{escape(name)}" value="{escape(value)}"/>'
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        "<Response>"
        f'<Connect action="{escape(action_url)}" method="POST">'
        f'<Stream url="{escape(stream_url)}">{params_xml}</Stream>'
        "</Connect>"
        "</Response>"
    )


def say_dial(text: str, lang: str, dial_number: str) -> str:
    """Speak transfer message then bridge to human agent's number."""
    voice, twiml_lang = _voice(lang)
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        "<Response>"
        f'<Say voice="{voice}" language="{twiml_lang}">{escape(text)}</Say>'
        f"<Dial>{escape(dial_number)}</Dial>"
        "</Response>"
    )


def dial_only(dial_number: str, action_url: str | None = None) -> str:
    """Bridge directly to a human without replaying the transfer message."""
    action_attr = f' action="{escape(action_url)}" method="POST"' if action_url else ""
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        "<Response>"
        f"<Dial{action_attr}>{escape(dial_number)}</Dial>"
        "</Response>"
    )


def say_hangup(text: str, lang: str) -> str:
    """Speak closing message then hang up."""
    voice, twiml_lang = _voice(lang)
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        "<Response>"
        f'<Say voice="{voice}" language="{twiml_lang}">{escape(text)}</Say>'
        "<Hangup/>"
        "</Response>"
    )


def hangup_only() -> str:
    """End the call without speaking another prompt."""
    return '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>'


def validate_signature(
    auth_token: str,
    twilio_signature: str,
    url: str,
    post_params: dict[str, str],
) -> bool:
    """Verify that a request genuinely came from Twilio."""
    # Build the string Twilio signs: URL + sorted POST params concatenated
    s = url
    for k in sorted(post_params.keys()):
        s += k + post_params[k]
    expected = hmac.new(
        auth_token.encode("utf-8"), s.encode("utf-8"), hashlib.sha1
    ).digest()
    import base64
    expected_b64 = base64.b64encode(expected).decode("utf-8")
    return hmac.compare_digest(expected_b64, twilio_signature)
