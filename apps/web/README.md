# Nocturnix Repair Manuals

Personal browser-based repair manual library built with React, TypeScript, and
Vite. The library stores manuals in browser IndexedDB.

## Run locally

```powershell
npm install
npm run dev
```

The development server is for local use. To test the installable app, build and
preview the production version:

```powershell
npm run build
npm run preview
```

## Publish to GitHub Pages

The workflow at `.github/workflows/deploy-pages.yml` builds and deploys this PWA
when changes are pushed to `development/manual-library-v0.3`. In the repository
on GitHub, set **Settings → Pages → Build and deployment → Source** to **GitHub
Actions**. After a successful workflow run, the app is available at:

`https://nocturnixrepair802.github.io/nocturnix-repair-manuals/`

On a Galaxy phone, open the HTTPS address in Chrome and choose **Install app**
from Chrome's menu. The PWA shell is cached for offline use. The library itself
is local to each browser/device and does not sync. Use the app's backup and
restore features to transfer a library between devices.

Never commit repair PDFs, private library backups, or secrets to the repository.

## Pull request checks and deployment troubleshooting

Pull requests into `main` run lint, database/migration tests, and a production
build. They do not publish a preview site. Pushes to
`development/manual-library-v0.3` run the same checks and then deploy. A manual
workflow run deploys only when that development branch is selected. Pull request
checks and branch deployments have separate concurrency groups.

If the build passes but deployment fails with `Failed to create deployment
(status: 404)`, check repository Settings > Pages. Enable Pages and select
**GitHub Actions** as its source, then rerun the failed deployment job. Creating
a `github-pages` environment alone does not enable a Pages site. This is a
hosting configuration failure; a pull request can still have no merge conflicts.
The workflow checks Pages configuration before attempting deployment and does
not enable or publish a new site automatically during pull request validation.

The expected public app address is:
`https://nocturnixrepair802.github.io/nocturnix-repair-manuals/`.
Only the built application shell is uploaded. Do not include private PDFs,
IndexedDB exports, or library backups in `public`, source control, or build output.

Before pushing workflow changes, run these commands from `apps/web`:

```powershell
npm.cmd run lint
npm.cmd test
$env:VITE_BASE_PATH = '/nocturnix-repair-manuals/'
npm.cmd run build
Remove-Item Env:VITE_BASE_PATH
```

The workflow uses Node 24 actions and pins Ubuntu 24.04 to avoid an unrelated
`ubuntu-latest` image migration while diagnosing deployment failures. A warning
about an action's internal Node version is separate from the application's Node
version selected by `setup-node`.
