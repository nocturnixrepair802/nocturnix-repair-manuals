from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
import sqlite3

from .models import FacetValue, GuideFacets, GuidePage, GuideRecord


MISSING_FACET_VALUE = "__missing__"
REQUIRED_COLUMNS = {
    "guide_id",
    "title",
    "archive_path",
    "manufacturer",
    "device_family",
    "device_model",
    "repair_type",
    "source",
    "archive_version",
    "classification_status",
}


class CatalogError(RuntimeError):
    pass


@dataclass(frozen=True)
class GuideFilters:
    query: str | None = None
    manufacturer: str | None = None
    device_model: str | None = None
    repair_type: str | None = None
    classification_status: str | None = None


def build_kiwix_viewer_url(base_url: str, archive_id: str, archive_path: str) -> str:
    if (
        not archive_path
        or archive_path.startswith("/")
        or "\\" in archive_path
        or any(ord(character) < 32 for character in archive_path)
    ):
        raise CatalogError("The guide has an invalid archive path.")
    # archive_path is already encoded for Kiwix. Do not decode or re-encode it.
    return f"{base_url.rstrip('/')}/viewer#{archive_id}/{archive_path}"


class CatalogRepository:
    def __init__(self, path: Path, kiwix_base_url: str, archive_id: str):
        self.path = path.resolve()
        self.kiwix_base_url = kiwix_base_url
        self.archive_id = archive_id

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        if not self.path.is_file():
            raise CatalogError("The offline guide catalog is not configured or cannot be found.")
        try:
            connection = sqlite3.connect(f"{self.path.as_uri()}?mode=ro", uri=True, timeout=2.0)
        except sqlite3.Error as error:
            raise CatalogError("The offline guide catalog could not be opened read-only.") from error
        try:
            connection.row_factory = sqlite3.Row
            connection.execute("PRAGMA query_only=ON")
            query_only = connection.execute("PRAGMA query_only").fetchone()[0]
            if query_only != 1:
                raise CatalogError("The offline guide catalog did not enter read-only query mode.")
            columns = {row[1] for row in connection.execute("PRAGMA table_info(guides)")}
            if not REQUIRED_COLUMNS.issubset(columns):
                raise CatalogError("The offline guide catalog schema is not supported.")
            yield connection
        except sqlite3.Error as error:
            raise CatalogError("The offline guide catalog query failed.") from error
        finally:
            connection.close()

    def count(self) -> int:
        with self._connect() as connection:
            return int(connection.execute("SELECT COUNT(*) FROM guides").fetchone()[0])

    def search(self, filters: GuideFilters, limit: int, offset: int) -> GuidePage:
        clauses, parameters = self._where(filters)
        where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
        with self._connect() as connection:
            total = int(connection.execute(f"SELECT COUNT(*) FROM guides{where}", parameters).fetchone()[0])
            rows = connection.execute(
                "SELECT guide_id, title, archive_path, manufacturer, device_family, device_model, "
                "repair_type, source, archive_version, classification_status "
                f"FROM guides{where} "
                "ORDER BY title COLLATE NOCASE, CAST(guide_id AS INTEGER), guide_id "
                "LIMIT :limit OFFSET :offset",
                {**parameters, "limit": limit, "offset": offset},
            ).fetchall()
        return GuidePage(
            items=[self._record(row) for row in rows],
            total=total,
            limit=limit,
            offset=offset,
        )

    def facets(self) -> GuideFacets:
        with self._connect() as connection:
            return GuideFacets(
                manufacturers=self._facet(connection, "manufacturer", include_missing=True),
                device_models=self._facet(connection, "device_model", include_missing=True),
                repair_types=self._facet(connection, "repair_type", include_missing=True),
                classification_statuses=self._facet(connection, "classification_status", include_missing=False),
            )

    @staticmethod
    def _where(filters: GuideFilters) -> tuple[list[str], dict[str, object]]:
        clauses: list[str] = []
        parameters: dict[str, object] = {}
        if filters.query:
            parameters["query"] = filters.query.casefold()
            searchable = ("title", "manufacturer", "device_model", "repair_type", "classification_status")
            clauses.append(
                "(" + " OR ".join(
                    f"instr(lower(coalesce({column}, '')), :query) > 0" for column in searchable
                ) + ")"
            )
        for column, value in (
            ("manufacturer", filters.manufacturer),
            ("device_model", filters.device_model),
            ("repair_type", filters.repair_type),
            ("classification_status", filters.classification_status),
        ):
            if value is None:
                continue
            if value == MISSING_FACET_VALUE:
                clauses.append(f"trim(coalesce({column}, '')) = ''")
            else:
                parameter = f"filter_{column}"
                clauses.append(f"lower(trim(coalesce({column}, ''))) = lower(:{parameter})")
                parameters[parameter] = value
        return clauses, parameters

    def _record(self, row: sqlite3.Row) -> GuideRecord:
        values = dict(row)
        return GuideRecord(
            **values,
            viewer_url=build_kiwix_viewer_url(
                self.kiwix_base_url,
                self.archive_id,
                values["archive_path"],
            ),
        )

    @staticmethod
    def _facet(connection: sqlite3.Connection, column: str, include_missing: bool) -> list[FacetValue]:
        if column not in {"manufacturer", "device_model", "repair_type", "classification_status"}:
            raise CatalogError("Unsupported catalog facet.")
        rows = connection.execute(
            f"SELECT nullif(trim({column}), '') AS value, COUNT(*) AS count "
            f"FROM guides GROUP BY nullif(trim({column}), '') "
            "ORDER BY value IS NULL, value COLLATE NOCASE"
        ).fetchall()
        facets: list[FacetValue] = []
        for row in rows:
            if row["value"] is None:
                if include_missing:
                    facets.append(FacetValue(value=MISSING_FACET_VALUE, label="Unassigned", count=row["count"]))
                continue
            facets.append(FacetValue(value=row["value"], label=row["value"], count=row["count"]))
        return facets
