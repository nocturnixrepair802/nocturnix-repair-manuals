# nocturnix-repair-manuals

A cross-platform technical reference library for Nocturnix Mobile Repair. It
keeps imported PDFs in browser IndexedDB and can search an existing local iFixit
catalog through a read-only localhost API. The catalog database, ZIM archive,
PDFs, and licensed guide content are not stored in this repository.

For Windows 11 one-launch local operation, complete the one-time setup in
[`scripts/windows/README.md`](scripts/windows/README.md), then use the included
CMD startup and shutdown shortcuts. The supervisor keeps the existing
`http://127.0.0.1:5173` browser origin and serves a prebuilt frontend without
requiring Node or Vite during daily use.
