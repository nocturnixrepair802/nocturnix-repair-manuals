from hashlib import sha256
from pathlib import Path
import sqlite3

import pytest

from manuals_api.catalog import (
    MISSING_FACET_VALUE,
    CatalogRepository,
    GuideFilters,
    build_kiwix_viewer_url,
)


def repository(catalog_path: Path) -> CatalogRepository:
    return CatalogRepository(
        catalog_path,
        "http://127.0.0.1:8080",
        "ifixit_en_all_2025-12",
    )


def test_builds_exact_verified_kiwix_url_without_reencoding() -> None:
    assert build_kiwix_viewer_url(
        "http://127.0.0.1:8080",
        "ifixit_en_all_2025-12",
        "Guide/(New)+iPhone+15+Back+Glass+Installation/191628",
    ) == (
        "http://127.0.0.1:8080/viewer#ifixit_en_all_2025-12/"
        "Guide/(New)+iPhone+15+Back+Glass+Installation/191628"
    )
    assert build_kiwix_viewer_url(
        "http://127.0.0.1:8080/",
        "ifixit_en_all_2025-12",
        "Guide/Percent+encoded+%28test%29+(sample)/900000",
    ).endswith("Guide/Percent+encoded+%28test%29+(sample)/900000")
    assert build_kiwix_viewer_url(
        "http://127.0.0.1:8080",
        "ifixit_en_all_2025-12",
        "Guide/Installing+OpenCore+on+Mac+Guide+#3/168566",
    ).endswith("Guide/Installing+OpenCore+on+Mac+Guide+#3/168566")


def test_queries_and_filters_catalog_while_preserving_attribution(catalog_path: Path) -> None:
    store = repository(catalog_path)
    result = store.search(GuideFilters(query="back glass"), limit=50, offset=0)
    assert result.total == 1
    assert result.items[0].model_dump() == {
        "guide_id": "191628",
        "title": "(New) iPhone 15 Back Glass Installation",
        "archive_path": "Guide/(New)+iPhone+15+Back+Glass+Installation/191628",
        "manufacturer": "Apple",
        "device_family": "iPhone",
        "device_model": "iPhone 15",
        "repair_type": "Back Glass",
        "source": "iFixit",
        "archive_version": "2025-12",
        "classification_status": "Auto-Classified",
        "viewer_url": (
            "http://127.0.0.1:8080/viewer#ifixit_en_all_2025-12/"
            "Guide/(New)+iPhone+15+Back+Glass+Installation/191628"
        ),
    }
    assert store.search(
        GuideFilters(manufacturer="Samsung", device_model="Galaxy S24", repair_type="Screen"),
        limit=10,
        offset=0,
    ).total == 1
    assert store.search(
        GuideFilters(classification_status="Needs Review"), limit=10, offset=0
    ).items[0].manufacturer is None


def test_missing_metadata_remains_searchable_and_filterable(catalog_path: Path) -> None:
    store = repository(catalog_path)
    by_title = store.search(GuideFilters(query="Grand Prime"), limit=10, offset=0)
    assert by_title.total == 1
    assert by_title.items[0].classification_status == "Needs Review"
    assert store.search(
        GuideFilters(manufacturer=MISSING_FACET_VALUE), limit=10, offset=0
    ).total == 1
    facets = store.facets()
    assert any(
        facet.value == MISSING_FACET_VALUE and facet.count == 1
        for facet in facets.manufacturers
    )


def test_pagination_is_stable_and_bounded_by_the_caller(catalog_path: Path) -> None:
    store = repository(catalog_path)
    first = store.search(GuideFilters(), limit=2, offset=0)
    second = store.search(GuideFilters(), limit=2, offset=2)
    assert first.total == second.total == 3
    assert {item.guide_id for item in first.items}.isdisjoint(item.guide_id for item in second.items)


def test_catalog_connection_is_strictly_read_only_and_does_not_change_file(catalog_path: Path) -> None:
    before_hash = sha256(catalog_path.read_bytes()).hexdigest()
    before_stat = catalog_path.stat()
    store = repository(catalog_path)
    with store._connect() as connection:
        assert connection.execute("PRAGMA query_only").fetchone()[0] == 1
        with pytest.raises(sqlite3.OperationalError, match="readonly|read-only"):
            connection.execute("DELETE FROM guides")
    assert sha256(catalog_path.read_bytes()).hexdigest() == before_hash
    assert catalog_path.stat().st_size == before_stat.st_size
    assert catalog_path.stat().st_mtime_ns == before_stat.st_mtime_ns
