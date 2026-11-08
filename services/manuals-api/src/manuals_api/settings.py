from pathlib import Path
import re
from urllib.parse import urlsplit

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


DEFAULT_CORS_ORIGINS = ",".join(
    (
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://127.0.0.1:4175",
        "http://localhost:4175",
        "https://nocturnixrepair802.github.io",
    )
)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="NOCTURNIX_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    catalog_path: Path
    kiwix_base_url: str = "http://127.0.0.1:8080"
    kiwix_archive_id: str = "ifixit_en_all_2025-12"
    api_port: int = Field(default=8765, ge=1024, le=65535)
    cors_origins: str = DEFAULT_CORS_ORIGINS

    @field_validator("catalog_path")
    @classmethod
    def validate_catalog_path(cls, value: Path) -> Path:
        if not value.is_absolute():
            raise ValueError("Catalog path must be absolute.")
        return value

    @field_validator("kiwix_base_url")
    @classmethod
    def validate_kiwix_base_url(cls, value: str) -> str:
        parsed = urlsplit(value)
        if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
            raise ValueError("Kiwix must use an HTTP loopback address.")
        if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in {"", "/"}:
            raise ValueError("Kiwix base URL must contain only its loopback origin.")
        if parsed.port is None:
            raise ValueError("Kiwix base URL must include an explicit port.")
        return value.rstrip("/")

    @field_validator("kiwix_archive_id")
    @classmethod
    def validate_archive_id(cls, value: str) -> str:
        if not re.fullmatch(r"[A-Za-z0-9._-]{1,128}", value):
            raise ValueError("Kiwix archive identifier contains unsupported characters.")
        return value

    @field_validator("cors_origins")
    @classmethod
    def validate_cors_origins(cls, value: str) -> str:
        origins = [origin.strip() for origin in value.split(",") if origin.strip()]
        if not origins:
            raise ValueError("At least one CORS origin is required.")
        for origin in origins:
            parsed = urlsplit(origin)
            if origin == "*" or parsed.scheme not in {"http", "https"} or not parsed.hostname:
                raise ValueError("CORS origins must be explicit HTTP or HTTPS origins.")
            if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in {"", "/"}:
                raise ValueError("CORS entries must be origins without paths, credentials, queries, or fragments.")
        return ",".join(origins)

    @property
    def allowed_origins(self) -> list[str]:
        return self.cors_origins.split(",")
