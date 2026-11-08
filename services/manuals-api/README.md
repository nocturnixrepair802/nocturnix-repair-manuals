# Nocturnix offline guide API

This local FastAPI service exposes searchable metadata from an existing iFixit
SQLite catalog. It opens the catalog with SQLite `mode=ro`, enables
`PRAGMA query_only=ON`, and never serves or copies guide content. Guide pages
continue to come from the existing Kiwix ZIM archive.

Copy `.env.example` to `.env` and set `NOCTURNIX_CATALOG_PATH` to the local
catalog. `.env` is ignored by Git. The Kiwix URL must remain an HTTP loopback
address. Start the API from this directory:

```powershell
uv run manuals-api
```

The API binds to `127.0.0.1:8765` by default. It is intended only for the same
Windows computer that runs Kiwix. A browser on an iPad or another computer has
its own localhost and cannot use this bridge.

Available endpoints:

- `GET /api/offline-guides/status`
- `GET /api/offline-guides/facets`
- `GET /api/offline-guides`

Run backend tests with `uv run pytest`.

For ordinary Windows use, the one-time initializer and lifecycle supervisor in
[`scripts/windows/README.md`](../../scripts/windows/README.md) configure and
start this API. The same Python environment also serves the prebuilt frontend;
daily startup does not run `uv`, Node, npm, or Vite.
