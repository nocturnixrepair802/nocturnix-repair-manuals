import asyncio
from pathlib import Path

import httpx
import pytest

from manuals_api.web import FrontendConfigurationError, SERVICE_ID, create_web_app


def get(app: object, path: str) -> httpx.Response:
    async def request() -> httpx.Response:
        transport = httpx.ASGITransport(app=app)  # type: ignore[arg-type]
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            return await client.get(path)

    return asyncio.run(request())


@pytest.fixture
def dist_path(tmp_path: Path) -> Path:
    dist = tmp_path / "dist"
    assets = dist / "assets"
    assets.mkdir(parents=True)
    (dist / "index.html").write_text(
        '<!doctype html><html><head><title>Nocturnix Manuals</title></head><body><div id="root"></div></body></html>',
        encoding="utf-8",
    )
    (assets / "app.js").write_text("console.log('nocturnix')", encoding="utf-8")
    return dist


def test_health_identifies_the_local_frontend(dist_path: Path) -> None:
    response = get(create_web_app(dist_path), "/healthz")
    assert response.status_code == 200
    assert response.headers["x-nocturnix-service"] == SERVICE_ID
    assert response.headers["cache-control"] == "no-store"
    assert response.json() == {
        "service": SERVICE_ID,
        "version": "0.3.0",
        "origin": "http://127.0.0.1:5173",
    }


def test_serves_build_assets_and_spa_routes(dist_path: Path) -> None:
    app = create_web_app(dist_path)
    root = get(app, "/")
    recovery = get(app, "/recovery")
    asset = get(app, "/assets/app.js")
    assert root.status_code == recovery.status_code == asset.status_code == 200
    assert "Nocturnix Manuals" in root.text
    assert recovery.text == root.text
    assert root.headers["cache-control"] == "no-cache"
    assert asset.headers["cache-control"] == "public, max-age=31536000, immutable"
    assert asset.headers["x-content-type-options"] == "nosniff"


def test_rejects_missing_assets_and_path_traversal(dist_path: Path) -> None:
    app = create_web_app(dist_path)
    assert get(app, "/assets/missing.js").status_code == 404
    assert get(app, "/%2e%2e/private.txt").status_code == 404


def test_requires_an_initialized_frontend_build(tmp_path: Path) -> None:
    with pytest.raises(FrontendConfigurationError, match="initialization workflow"):
        create_web_app(tmp_path / "missing")
