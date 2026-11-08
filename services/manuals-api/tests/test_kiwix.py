import asyncio

import httpx

from manuals_api.kiwix import check_kiwix_archive


def probe(handler: httpx.MockTransport) -> tuple[bool, str]:
    async def run() -> tuple[bool, str]:
        async with httpx.AsyncClient(transport=handler) as client:
            return await check_kiwix_archive(
                "http://127.0.0.1:8080",
                "ifixit_en_all_2025-12",
                client,
            )

    return asyncio.run(run())


def test_archive_health_check_uses_configured_content_root() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == "http://127.0.0.1:8080/content/ifixit_en_all_2025-12/"
        return httpx.Response(200, text="archive")

    assert probe(httpx.MockTransport(handler))[0] is True


def test_archive_health_check_handles_missing_archive_and_connection_failure() -> None:
    missing = probe(httpx.MockTransport(lambda _request: httpx.Response(404)))
    assert missing == (False, "Kiwix responded, but the configured archive returned HTTP 404.")

    def failure(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    unavailable = probe(httpx.MockTransport(failure))
    assert unavailable[0] is False
    assert "Kiwix is unavailable" in unavailable[1]
