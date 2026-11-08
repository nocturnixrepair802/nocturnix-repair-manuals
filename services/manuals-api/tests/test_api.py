import asyncio

import httpx

from manuals_api.app import create_app
from manuals_api.settings import Settings


async def available_probe(_base_url: str, _archive_id: str, _client: object) -> tuple[bool, str]:
    return True, "Archive available."


async def unavailable_probe(_base_url: str, _archive_id: str, _client: object) -> tuple[bool, str]:
    return False, "Kiwix is unavailable on this computer. Start the local Kiwix server and retry."


def get(app: object, path: str, *, params: dict[str, object] | None = None, headers: dict[str, str] | None = None) -> httpx.Response:
    async def request() -> httpx.Response:
        transport = httpx.ASGITransport(app=app)  # type: ignore[arg-type]
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            return await client.get(path, params=params, headers=headers)

    return asyncio.run(request())


def test_search_status_facets_and_explicit_cors(settings: Settings) -> None:
    app = create_app(settings, kiwix_probe=available_probe)
    response = get(
        app,
        "/api/offline-guides",
        params={"query": "iphone", "manufacturer": "Apple", "limit": 20},
        headers={"Origin": "http://127.0.0.1:5173"},
    )
    assert response.status_code == 200
    assert response.json()["total"] == 1
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:5173"
    assert get(app, "/api/offline-guides/facets").json()["classification_statuses"] == [
        {"value": "Auto-Classified", "label": "Auto-Classified", "count": 2},
        {"value": "Needs Review", "label": "Needs Review", "count": 1},
    ]
    status = get(app, "/api/offline-guides/status").json()
    assert status["catalog_available"] is True
    assert status["guide_count"] == 3
    assert status["kiwix_available"] is True


def test_unavailable_kiwix_is_reported_without_hiding_catalog(settings: Settings) -> None:
    app = create_app(settings, kiwix_probe=unavailable_probe)
    status = get(app, "/api/offline-guides/status")
    assert status.status_code == 200
    assert status.json()["catalog_available"] is True
    assert status.json()["kiwix_available"] is False
    assert "Start the local Kiwix server" in status.json()["kiwix_message"]
    assert get(app, "/api/offline-guides", params={"query": "Grand Prime"}).json()["total"] == 1


def test_query_parameters_are_validated_and_bounded(settings: Settings) -> None:
    app = create_app(settings, kiwix_probe=available_probe)
    assert get(app, "/api/offline-guides", params={"limit": 101}).status_code == 422
    assert get(app, "/api/offline-guides", params={"offset": -1}).status_code == 422
    assert get(app, "/api/offline-guides", params={"query": "x" * 201}).status_code == 422
    assert get(app, "/api/offline-guides", params={"query": "   "}).status_code == 422
    assert get(app, "/api/offline-guides", params={"manufacturer": "   "}).status_code == 422
    assert get(
        app,
        "/api/offline-guides", params={"classification_status": "Verified"}
    ).status_code == 422
    blocked = get(
        app,
        "/api/offline-guides",
        headers={"Origin": "https://unlisted.example"},
    )
    assert "access-control-allow-origin" not in blocked.headers
