from pydantic import BaseModel, Field


class GuideRecord(BaseModel):
    guide_id: str
    title: str
    archive_path: str
    manufacturer: str | None
    device_family: str | None
    device_model: str | None
    repair_type: str | None
    source: str
    archive_version: str
    classification_status: str
    viewer_url: str


class GuidePage(BaseModel):
    items: list[GuideRecord]
    total: int = Field(ge=0)
    limit: int = Field(ge=1, le=100)
    offset: int = Field(ge=0)


class FacetValue(BaseModel):
    value: str
    label: str
    count: int = Field(ge=0)


class GuideFacets(BaseModel):
    manufacturers: list[FacetValue]
    device_models: list[FacetValue]
    repair_types: list[FacetValue]
    classification_statuses: list[FacetValue]


class ServiceStatus(BaseModel):
    catalog_available: bool
    catalog_message: str
    guide_count: int | None
    kiwix_available: bool
    kiwix_message: str
    kiwix_base_url: str
    archive_id: str
