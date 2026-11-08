# Nocturnix Repair Manuals v0.3 development handoff

## Working repository

- Git checkout: `D:\Development\nocturnix-repair-manuals-github`.
- Branch: `feature/offline-ifixit-integration`, based on merged `main`.
- Stable baseline: `694a1da`, annotated tag `v0.2.0`.
- `D:\Development\Nocturnix Repair Manuals` is a separate original workspace without Git metadata. Its original application and checkpoint are untouched.
- Offline iFixit integration is an uncommitted review milestone. Do not replace `v0.2.0` or commit private manuals, databases, ZIM archives, backup downloads, or secrets.

## Implemented scope

The browser-local React/TypeScript frontend supports immutable sequential display IDs (`NMR-MAN-000001`), manufacturer, device model, manufacturer DeviceModelID, document classification, metadata editing, confirmed deletion, and SHA-256 duplicate protection. It separates Repair Manuals from Policies, Procedures, & Operations, with eight policy subsections. A v3 database migration assigns existing records to Repair Manuals and preserves their PDFs and metadata.

DeviceModelID means a manufacturer model identifier such as `A2649` or `SM-S901B`, not a separately allocated model catalog key. Manufacturers remain Apple, Samsung, and Unassigned. Categories are Unassigned, Service Manual, Repair Guide, Schematic, Boardview, Parts Catalog, and Other. Model fields may be empty; classifications must use valid options; a trimmed title is required.

Selected import files are reviewed individually. Cancel skips the current file. Each file commits independently; duplicate files do not receive new IDs. Results identify imported, duplicate, failed, and skipped files. A filename or MIME declaration alone is insufficient: new imports must contain a PDF header within the first 1024 bytes. This is a format sanity check, not a complete PDF parser or security scanner.

The Python service exposes a localhost-only, read-only API for the existing iFixit SQLite catalog. It opens the database with SQLite `mode=ro` and `PRAGMA query_only=ON`, provides bounded search, facets, pagination, and Kiwix status, and never copies catalog or guide content into the repository or browser database. There is no server storage, native iPad feature, or synchronization. React Router and PDF.js remain installed, but navigation uses state and the PDF reader uses an iframe with a blob URL.

Offline Repair Guides is a separate navigation view. It does not add a Dexie table or schema version and does not treat `Auto-Classified` metadata as verified. Viewer URLs preserve the catalog's encoded `archive_path` exactly and use the configured archive identifier. The local API and Kiwix remain on Windows loopback addresses; GitHub Pages, iPads, and other computers may be unable to reach them and receive an explanatory message.

## Database and migration

Database: `NocturnixRepairManuals`. Preserve the existing `manuals` table and UUID `id` primary key. Retain the version 1 schema declaration.

Dexie version 2 adds `manualId`, `deviceModel`, `deviceModelId`, `documentCategory`, `updatedAt`, and optional `fileHash`. Version 3 adds `librarySection` and `policySection`, defaulting existing records to Repair Manuals. `manualId` has a unique index; `fileHash` has a non-unique index so legacy duplicate PDFs remain intact. A `counters` table keyed by `key` stores `manualId`'s last allocated integer.

Upgrade behavior:

1. Existing v1 libraries pause at a backup screen before Dexie opens the database for upgrade. Close all other library tabs before proceeding.
2. Download the JSON backup to a private location outside the repository and confirm that it was saved. The backup contains all original metadata and base64-encoded PDF blobs; creation verifies every PDF's SHA-256 hash after decoding.
3. The explicit Upgrade action runs the transactional v1-to-v3 metadata migration. Original keys, metadata, timestamps, duplicate records, and blobs remain unchanged.
4. Display IDs are assigned by original import timestamp, then UUID. Missing timestamps sort first; original missing metadata is not fabricated. New model fields are empty and classification is Unassigned.
5. Hashes are filled after the schema transaction, one PDF at a time. Imports remain disabled until preparation succeeds. Failure shows an error and Retry; completed hashes persist, so retries resume missing work.

The first schema upgrade reads the legacy records and updates metadata within a single upgrade transaction. Hashing uses Web Crypto outside IndexedDB transactions. Each import serializes the readiness check, hash lookup, counter increment, and insert in one read/write transaction over manuals and counters. Failed writes roll back the counter. Deletion never resets it. ID sequences belong to one browser library; IDs are not globally unique across devices or profiles.

Legacy duplicates are listed for review and never automatically removed. Live queries refresh cards and statistics after changes in this or another cooperating v0.3 tab. Edit and delete controls use native modal dialogs with keyboard cancellation and focus restoration.

## Backup and rollback

Browser storage belongs to the exact scheme, hostname, and port. `localhost` and `127.0.0.1` are different origins. Serving this checkout at a new origin will show an empty library; it will not transfer the original library.

Do not open a real library with v0.3 before saving its pre-upgrade backup. Tests only exercised generated data in isolated browser contexts; they did not migrate the user's actual library.

A failed schema upgrade rolls back to v1. A completed upgrade cannot be downgraded by switching application code. Prefer a compatible forward fix. If a v0.2 rollback is necessary:

1. Keep the existing upgraded library untouched. Keep the pre-upgrade backup private.
2. Serve this v0.3 application at an unused local origin or in an empty browser profile and visit `/recovery` directly. This route does not open the v0.3 library.
3. Select the downloaded v1 backup and click Restore backup. All hashes are checked before any restoration writes. Database creation and record restoration are atomic. Existing libraries are refused, never cleared or overwritten.
4. Confirm the restored count. Close the recovery tab and stop serving v0.3 at that origin. Do not follow Open v0.3 library when rolling back to v0.2.
5. Serve the unchanged v0.2 release from a separate checkout at that exact scheme, hostname, and port, using the same browser profile. The restored database remains Dexie v1 (native IndexedDB version 10), compatible with v0.2.

This backup represents the pre-upgrade library. Manuals added or changed after upgrading require a compatible forward fix or a separate recovery effort; they are not in that backup. There is no general v2 export/downgrade feature in this iteration. Backups use JSON/base64 in memory, so very large libraries need sufficient browser memory and disk space. Download initiation cannot prove that the browser saved the file; the screen requires the user's saved-file confirmation.

Backup download names are ignored by Git in addition to existing backup/storage protections. Do not rename private exports into tracked source paths.

## Code map

- `apps/web/src/database/manualDatabase.ts`: types, schema, upgrade, counters.
- `apps/web/src/database/manualLibrary.ts`: validation, hashing, preparation, transactional import, edit, delete, duplicate grouping.
- `apps/web/src/database/libraryBackup.ts`: non-upgrading v1 detection, checked backup, and non-overwriting restoration.
- `apps/web/src/App.tsx`: dashboard state, backup gate, live library query, filters, import queue, and operation dialogs.
- `apps/web/src/offlineGuides.ts`: localhost API client, types, filter query construction.
- `apps/web/src/components/OfflineGuides.tsx`: offline catalog search, filters, status, pagination, and availability messages.
- `apps/web/src/components`: manual cards/forms, shared modal, reader, and recovery screen.
- `services/manuals-api/src/manuals_api`: read-only catalog queries, local settings, API routes, and Kiwix health checks.

## Verification

Run from `apps/web` with Node/npm installed:

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run test:e2e
npm.cmd run lint
npm.cmd run build
```

Run from `services/manuals-api` with uv installed:

```powershell
uv run --frozen pytest
```

Playwright uses installed Microsoft Edge on Windows and bundled Chromium on other platforms. Override with `PLAYWRIGHT_CHANNEL` if needed. For bundled Chromium, install it using `npx playwright install chromium`. Browser checks start an isolated development server on `http://127.0.0.1:4175` and use temporary browser contexts; do not use that origin for a real library while running them. Test PDF files are generated in memory from original synthetic content, never loaded from private libraries. Generated reports and test artifacts are ignored.

Verified on 2026-11-08:

- Baseline v0.2 production build and ESLint passed before changes.
- 18 frontend unit/database tests, including v1/v2-to-v3 migration preservation, policy-section imports, localhost API queries, and exact Kiwix URL preservation.
- 10 FastAPI tests covering read-only SQLite behavior, bounded search/filtering, CORS, facets, URL construction, and unavailable Kiwix handling.
- 10 Edge browser scenarios, including the unchanged PDF/policy flows, offline guide search/filtering, unavailable Kiwix, and an unreachable localhost API.
- GitHub Pages production build and ESLint passed with the new code.
- Dependency installation reported 10 moderate advisories in the development dependency tree, also present at baseline. `npm audit --omit=dev` reported zero production dependency vulnerabilities. No forced dependency upgrades were applied.

The browser reader check verifies the iframe's PDF blob URL and MIME response. It does not assert native PDF viewer rendering across Safari/iPad browsers. Real storage exhaustion, multi-gigabyte libraries, and actual user data were not exercised.
