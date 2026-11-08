from collections.abc import Awaitable, Callable
from typing import Annotated, Literal

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .catalog import CatalogError, CatalogRepository, GuideFilters
from .kiwix import check_kiwix_archive
from .models import GuideFacets, GuidePage, ServiceStatus
from .settings import Settings


KiwixProbe = Callable[[str, str, httpx.AsyncClient | None], Awaitable[tuple[bool, str]]]


def nonblank(value: str | None, field: str) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    if not cleaned:
        raise HTTPException(status_code=422, detail=f"{field} cannot be blank.")
    return cleaned


def create_app(
    settings: Settings | None = None,
    kiwix_probe: KiwixProbe = check_kiwix_archive,
) -> FastAPI:
    active_settings = settings or Settings()
    catalog = CatalogRepository(
        active_settings.catalog_path,
        active_settings.kiwix_base_url,
        active_settings.kiwix_archive_id,
    )
    app = FastAPI(title="Nocturnix Offline Guide API", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=active_settings.allowed_origins,
        allow_credentials=False,
        allow_methods=["GET"],
        allow_headers=["Accept", "Content-Type"],
    )

    @app.get("/api/offline-guides/status", response_model=ServiceStatus)
    async def status() -> ServiceStatus:
        try:
            guide_count = catalog.count()
            catalog_available = True
            catalog_message = f"The read-only catalog contains {guide_count:,} guides."
        except CatalogError as error:
            guide_count = None
            catalog_available = False
            catalog_message = str(error)
        kiwix_available, kiwix_message = await kiwix_probe(
            active_settings.kiwix_base_url,
            active_settings.kiwix_archive_id,
            None,
        )
        return ServiceStatus(
            catalog_available=catalog_available,
            catalog_message=catalog_message,
            guide_count=guide_count,
            kiwix_available=kiwix_available,
            kiwix_message=kiwix_message,
            kiwix_base_url=active_settings.kiwix_base_url,
            archive_id=active_settings.kiwix_archive_id,
        )

    @app.get("/api/offline-guides/facets", response_model=GuideFacets)
    def facets() -> GuideFacets:
        try:
            return catalog.facets()
        except CatalogError as error:
            raise HTTPException(status_code=503, detail=str(error)) from error

    @app.get("/api/offline-guides", response_model=GuidePage)
    def guides(
        query: Annotated[str | None, Query(min_length=1, max_length=200)] = None,
        manufacturer: Annotated[str | None, Query(min_length=1, max_length=120)] = None,
        device_model: Annotated[str | None, Query(min_length=1, max_length=160)] = None,
        repair_type: Annotated[str | None, Query(min_length=1, max_length=120)] = None,
        classification_status: Annotated[
            Literal["Needs Review", "Auto-Classified"] | None,
            Query(),
        ] = None,
        limit: Annotated[int, Query(ge=1, le=100)] = 50,
        offset: Annotated[int, Query(ge=0, le=1_000_000)] = 0,
    ) -> GuidePage:
        try:
            return catalog.search(
                GuideFilters(
                    query=nonblank(query, "query"),
                    manufacturer=nonblank(manufacturer, "manufacturer"),
                    device_model=nonblank(device_model, "device_model"),
                    repair_type=nonblank(repair_type, "repair_type"),
                    classification_status=classification_status,
                ),
                limit,
                offset,
            )
        except CatalogError as error:
            raise HTTPException(status_code=503, detail=str(error)) from error

    return app
