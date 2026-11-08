from pathlib import Path
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
import uvicorn


SERVICE_ID = "nocturnix-manuals-web"
SERVICE_VERSION = "0.3.0"


class FrontendConfigurationError(RuntimeError):
    pass


class WebSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="NOCTURNIX_WEB_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    dist_path: Path
    port: int = Field(default=5173, ge=1024, le=65535)
    origin: str = "http://127.0.0.1:5173"

    @field_validator("dist_path")
    @classmethod
    def validate_dist_path(cls, value: Path) -> Path:
        if not value.is_absolute():
            raise ValueError("Frontend build path must be absolute.")
        return value.resolve()

    @field_validator("origin")
    @classmethod
    def validate_origin(cls, value: str) -> str:
        parsed = urlsplit(value)
        if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
            raise ValueError("Frontend origin must use an HTTP loopback address.")
        if parsed.port is None or parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
            raise ValueError("Frontend origin must contain only an explicit loopback origin.")
        return value.rstrip("/")


def create_web_app(dist_path: Path, origin: str = "http://127.0.0.1:5173") -> FastAPI:
    root = dist_path.resolve()
    index = root / "index.html"
    if not index.is_file():
        raise FrontendConfigurationError(
            "The local frontend build is missing index.html. Run the initialization workflow first."
        )

    app = FastAPI(
        title="Nocturnix Manuals Web",
        version=SERVICE_VERSION,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )

    @app.get("/healthz")
    def health() -> JSONResponse:
        return JSONResponse(
            {
                "service": SERVICE_ID,
                "version": SERVICE_VERSION,
                "origin": origin,
            },
            headers={"X-Nocturnix-Service": SERVICE_ID, "Cache-Control": "no-store"},
        )

    @app.get("/{requested_path:path}")
    def frontend(requested_path: str) -> FileResponse:
        candidate = (root / requested_path).resolve()
        if not candidate.is_relative_to(root):
            raise HTTPException(status_code=404, detail="Not found")
        if candidate.is_file():
            response = FileResponse(candidate)
            response.headers["Cache-Control"] = (
                "no-cache" if candidate.name == "index.html" else "public, max-age=31536000, immutable"
            )
            response.headers["X-Content-Type-Options"] = "nosniff"
            return response
        if Path(requested_path).suffix:
            raise HTTPException(status_code=404, detail="Not found")
        response = FileResponse(index, media_type="text/html")
        response.headers["Cache-Control"] = "no-cache"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    return app


def main() -> None:
    settings = WebSettings()
    uvicorn.run(
        create_web_app(settings.dist_path, settings.origin),
        host="127.0.0.1",
        port=settings.port,
        log_level="info",
    )


if __name__ == "__main__":
    main()
