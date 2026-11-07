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
