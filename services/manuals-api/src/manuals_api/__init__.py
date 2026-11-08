import uvicorn

from .app import create_app
from .settings import Settings


def main() -> None:
    settings = Settings()
    uvicorn.run(
        create_app(settings),
        host="127.0.0.1",
        port=settings.api_port,
        log_level="info",
    )
