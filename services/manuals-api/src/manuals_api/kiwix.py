import httpx


async def check_kiwix_archive(
    base_url: str,
    archive_id: str,
    client: httpx.AsyncClient | None = None,
) -> tuple[bool, str]:
    owns_client = client is None
    active_client = client or httpx.AsyncClient(timeout=2.0, follow_redirects=True, trust_env=False)
    try:
        async with active_client.stream("GET", f"{base_url.rstrip('/')}/content/{archive_id}/") as response:
            if response.status_code == 200:
                return True, "Kiwix and the configured iFixit archive are available."
            return False, f"Kiwix responded, but the configured archive returned HTTP {response.status_code}."
    except httpx.HTTPError:
        return False, "Kiwix is unavailable on this computer. Start the local Kiwix server and retry."
    finally:
        if owns_client:
            await active_client.aclose()
