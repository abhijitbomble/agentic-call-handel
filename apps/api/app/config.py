from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

API_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = API_DIR.parent.parent


class Settings(BaseSettings):
    app_name: str = "VoiceOps Control API"
    environment: str = "development"
    secret_key: str = "voiceops-local-secret-key-2026-demo"
    access_token_expire_minutes: int = 12 * 60
    database_url: str = Field(
        default="sqlite:///./voiceops_control.db",
        validation_alias=AliasChoices("VOICEOPS_DATABASE_URL", "DATABASE_URL"),
    )
    cors_origins: list[str] = [
        "http://127.0.0.1:4000", "http://localhost:4000",
        "http://127.0.0.1:3000", "http://localhost:3000",
    ]
    cors_origin_regex: str = r"https://.*\.vercel\.app$"
    # Set VOICEOPS_ANTHROPIC_API_KEY in environment or .env to enable real AI responses
    anthropic_api_key: str = ""
    deepgram_api_key: str = ""
    deepgram_stt_model: str = "nova-3"
    deepgram_tts_model: str = "aura-2-thalia-en"

    # Twilio (real phone calls and browser softphone)
    # Sign up at https://twilio.com, get a phone number, then fill these in .env
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_phone_number: str = ""       # Your Twilio number e.g. +14155551234
    twilio_escalation_number: str = ""  # Human agent number to transfer to
    twilio_api_key_sid: str = ""        # Needed for Twilio browser Voice SDK tokens
    twilio_api_key_secret: str = ""     # Needed for Twilio browser Voice SDK tokens
    twilio_twiml_app_sid: str = ""      # TwiML App pointing to /twilio/browser/voice
    # Set to your ngrok/server URL so Twilio can reach your webhooks
    public_base_url: str = "http://localhost:8020"
    # Set False during local dev to skip signature validation
    twilio_validate_signatures: bool = False

    model_config = SettingsConfigDict(
        env_prefix="VOICEOPS_",
        env_file=(API_DIR / ".env", REPO_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
