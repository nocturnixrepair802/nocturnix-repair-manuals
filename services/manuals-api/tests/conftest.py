from pathlib import Path
import sqlite3

import pytest

from manuals_api.settings import Settings


GUIDES = (
    (
        "191628",
        "(New) iPhone 15 Back Glass Installation",
        "Guide/(New)+iPhone+15+Back+Glass+Installation/191628",
        "Apple",
        "iPhone",
        "iPhone 15",
        "Back Glass",
        "iFixit",
        "2025-12",
        "Auto-Classified",
    ),
    (
        "100001",
        "Samsung Galaxy Grand Prime Charging Port Replacement",
        "Guide/Samsung+Galaxy+Grand+Prime+Charging+Port+Replacement/100001",
        None,
        None,
        None,
        "Charging Port",
        "iFixit",
        "2025-12",
        "Needs Review",
    ),
    (
        "900000",
        "Percent encoded %28test%29 guide",
        "Guide/Percent+encoded+%28test%29+(sample)/900000",
        "Samsung",
        "Galaxy S",
        "Galaxy S24",
        "Screen",
        "iFixit",
        "2025-12",
        "Auto-Classified",
    ),
)


@pytest.fixture
def catalog_path(tmp_path: Path) -> Path:
    path = tmp_path / "repair_guides.db"
    connection = sqlite3.connect(path)
    connection.execute(
        """
        CREATE TABLE guides (
            guide_id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            archive_path TEXT NOT NULL,
            manufacturer TEXT,
            device_family TEXT,
            device_model TEXT,
            repair_type TEXT,
            source TEXT,
            archive_version TEXT,
            classification_status TEXT
        )
        """
    )
    connection.executemany("INSERT INTO guides VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", GUIDES)
    connection.commit()
    connection.close()
    return path


@pytest.fixture
def settings(catalog_path: Path) -> Settings:
    return Settings(
        catalog_path=catalog_path,
        kiwix_base_url="http://127.0.0.1:8080",
        kiwix_archive_id="ifixit_en_all_2025-12",
        cors_origins="http://127.0.0.1:5173,https://nocturnixrepair802.github.io",
    )
