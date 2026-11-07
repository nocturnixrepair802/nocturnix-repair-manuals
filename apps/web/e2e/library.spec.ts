import { expect, test, type Page } from '@playwright/test'

// Original synthetic single-page PDF; never read PDFs from the user's library.
function fixture(label: string) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(`BT /F1 12 Tf 20 150 Td (${label}) Tj ET`)} >>\nstream\nBT /F1 12 Tf 20 150 Td (${label}) Tj ET\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let text = '%PDF-1.4\n'
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(text))
    text += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = Buffer.byteLength(text)
  text += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return { name: `${label}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(text) }
}

async function importPdf(page: Page, label: string, type = 'Phone', maker = 'Apple') {
  await page.getByLabel('Import PDF', { exact: true }).setInputFiles(fixture(label))
  const dialog = page.getByRole('dialog', { name: 'Import manual', exact: true })
  await dialog.getByLabel('Manufacturer', { exact: true }).selectOption(maker)
  await dialog.getByLabel('Device type', { exact: true }).selectOption(type)
  await dialog.getByLabel('Device model', { exact: true }).fill(`${label} model`)
  await dialog.getByLabel('DeviceModelID', { exact: true }).fill(`${label}-ID`)
  await dialog.getByLabel('Document category', { exact: true }).selectOption('Repair Guide')
  await dialog.getByRole('button', { name: 'Import manual', exact: true }).click()
  await expect(dialog).not.toBeVisible()
}

async function seedV1(page: Page) {
  await page.goto('/recovery') // This route never opens or upgrades the library.
  const buffer = [...fixture('legacy').buffer]
  await page.evaluate(async (bytes) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('NocturnixRepairManuals', 10)
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore('manuals', { keyPath: 'id' })
        for (const index of ['title', 'manufacturer', 'deviceType', 'importedAt']) store.createIndex(index, index)
        for (const id of ['legacy-1', 'legacy-2']) store.add({
          id, title: `Legacy ${id}`, manufacturer: 'Samsung', deviceType: 'Tablet',
          file: new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }),
          fileName: 'legacy.pdf', fileSize: bytes.length, importedAt: '2026-01-01T00:00:00Z',
        })
      }
      request.onerror = () => reject(request.error)
      request.onsuccess = () => { request.result.close(); resolve() }
    })
  }, buffer)
}

test('dashboard, navigation, filtering, metadata search, reader, and reopening preserve the baseline', async ({ page, context }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'No manuals found' })).toBeVisible()
  await importPdf(page, 'phone')
  await importPdf(page, 'tablet', 'Tablet', 'Samsung')
  await importPdf(page, 'watch', 'Watch')
  await expect(page.getByRole('article')).toHaveCount(3)
  await expect(page.locator('.stat-card').first()).toContainText('3')

  for (const label of ['Phones', 'Tablets', 'Watches']) {
    await page.getByRole('button', { name: label, exact: true }).click()
    await expect(page.getByRole('article')).toHaveCount(1)
  }
  await page.getByRole('button', { name: 'All Manuals', exact: true }).click()
  await page.getByLabel('Filter by manufacturer', { exact: true }).selectOption('Samsung')
  await expect(page.getByRole('article')).toHaveCount(1)
  await page.getByLabel('Filter by manufacturer', { exact: true }).selectOption('All')
  await page.getByLabel('Filter by device type', { exact: true }).selectOption('Phone')
  await expect(page.getByRole('article')).toHaveCount(1)
  await page.getByLabel('Filter by device type', { exact: true }).selectOption('All')
  for (const query of ['NMR-MAN-000001', 'phone model', 'phone-ID', 'phone.pdf']) {
    await page.getByRole('searchbox').fill(query)
    await expect(page.getByRole('article')).toHaveCount(1)
    await expect(page.getByRole('article')).toContainText('phone')
  }
  await page.getByRole('searchbox').fill('')
  await page.getByLabel('Filter by document category', { exact: true }).selectOption('Schematic')
  await expect(page.getByRole('article')).toHaveCount(0)
  await page.getByLabel('Filter by document category', { exact: true }).selectOption('All')
  await page.getByRole('button', { name: 'Open phone', exact: true }).click()
  const reader = page.getByRole('dialog', { name: 'PDF reader: phone', exact: true })
  await expect(reader.locator('iframe')).toHaveAttribute('src', /^blob:/)
  const blobUrl = await reader.locator('iframe').getAttribute('src')
  expect(await page.evaluate(async (url) => (await fetch(url!)).headers.get('content-type'), blobUrl)).toBe('application/pdf')
  await page.getByRole('button', { name: 'Close Reader' }).click()
  await expect(reader).not.toBeVisible()
  await page.reload()
  await expect(page.getByRole('article')).toHaveCount(3)
  const reopened = await context.newPage()
  await reopened.goto('/')
  await expect(reopened.getByRole('article')).toHaveCount(3)
  await page.close()
  await reopened.getByRole('button', { name: 'Open phone', exact: true }).click()
  await expect(reopened.getByRole('dialog').locator('iframe')).toHaveAttribute('src', /^blob:/)
})

test('metadata editing, cancellation, confirmed deletion and non-reused IDs', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'No manuals found' })).toBeVisible()
  await importPdf(page, 'editable')
  await page.getByRole('button', { name: 'Edit editable', exact: true }).click()
  let dialog = page.getByRole('dialog')
  await dialog.getByLabel('Title', { exact: true }).fill('Cancelled title')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('article')).toContainText('editable')
  await page.getByRole('button', { name: 'Edit editable', exact: true }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByLabel('Title', { exact: true }).fill('Revised guide')
  await dialog.getByLabel('Device type', { exact: true }).selectOption('Tablet')
  await dialog.getByLabel('Document category', { exact: true }).selectOption('Schematic')
  await dialog.getByRole('button', { name: 'Save changes' }).click()
  await expect(dialog).not.toBeVisible()
  await page.reload()
  await expect(page.getByRole('article')).toContainText('Revised guide')
  await expect(page.getByRole('article')).toContainText('Schematic')
  await page.getByRole('button', { name: 'Delete Revised guide', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('article')).toHaveCount(1)
  await page.getByRole('button', { name: 'Delete Revised guide', exact: true }).click()
  await page.getByRole('button', { name: 'Delete permanently' }).click()
  await expect(page.getByRole('article')).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'No manuals found' })).toBeVisible()
  await importPdf(page, 'replacement')
  await expect(page.getByRole('article')).toContainText('NMR-MAN-000002')
})

test('batch duplicates are reported and invalid files can be skipped', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'No manuals found' })).toBeVisible()
  await page.getByLabel('Import PDF', { exact: true }).setInputFiles([
    fixture('same'), { ...fixture('same'), name: 'renamed.pdf' },
    { name: 'fake.pdf', mimeType: 'application/pdf', buffer: Buffer.from('plain text') },
  ])
  for (let index = 0; index < 2; index++) {
    await page.getByRole('dialog').getByRole('button', { name: 'Import manual', exact: true }).click()
  }
  await expect(page.getByRole('status')).toContainText('duplicate of NMR-MAN-000001')
  await page.getByRole('dialog').getByRole('button', { name: 'Import manual', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('PDF header')
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('article')).toHaveCount(1)
  await expect(page.getByRole('status')).toContainText('fake.pdf: skipped')
})

test('v1 backup gate, migration, legacy duplicate preservation and recovery', async ({ page, browser }) => {
  await seedV1(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Back up your library before upgrading' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Upgrade library' })).toBeDisabled()
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download v1 backup' }).click()
  const download = await downloadEvent
  const backupPath = await download.path()
  expect(backupPath).toBeTruthy()
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Upgrade library' }).click()
  await expect(page.getByRole('article')).toHaveCount(2)
  await expect(page.locator('.duplicate-notice')).toContainText('1 duplicate PDF group')
  await expect(page.getByRole('article').first()).toContainText('NMR-MAN-000001')
  await expect(page.getByRole('article').last()).toContainText('NMR-MAN-000002')
  await page.reload()
  await expect(page.getByRole('article')).toHaveCount(2)
  await expect(page.getByRole('heading', { name: 'Back up your library before upgrading' })).not.toBeVisible()

  const recoveryContext = await browser.newContext()
  const recovery = await recoveryContext.newPage()
  await recovery.goto('/recovery')
  await recovery.getByLabel('Backup file').setInputFiles(backupPath!)
  await recovery.getByRole('button', { name: 'Restore backup' }).click()
  await expect(recovery.getByRole('status')).toContainText('Restored 2 manuals with verified PDF hashes')
  // Native IndexedDB inspection verifies restoration stayed at v1, before any v0.3 upgrade.
  expect(await recovery.evaluate(async () => {
    return new Promise<number>((resolve) => {
      const request = indexedDB.open('NocturnixRepairManuals')
      request.onsuccess = () => { const version = request.result.version; request.result.close(); resolve(version) }
    })
  })).toBe(10)
  await recovery.getByRole('button', { name: 'Restore backup' }).click()
  await expect(recovery.getByRole('status')).toContainText('already exists')
  await recoveryContext.close()
})

test('independent tabs receive live updates and share duplicate protection', async ({ page, context }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'No manuals found' })).toBeVisible()
  const second = await context.newPage()
  await second.goto('/')
  await expect(second.getByRole('heading', { name: 'No manuals found' })).toBeVisible()
  await importPdf(page, 'shared')
  await expect(second.getByRole('article')).toHaveCount(1)
  await importPdf(second, 'shared')
  await expect(second.getByRole('status')).toContainText('duplicate of NMR-MAN-000001')
  await expect(page.getByRole('article')).toHaveCount(1)
})

test('phone viewport and keyboard dialog cancellation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'No manuals found' })).toBeVisible()
  await importPdf(page, 'mobile')
  await page.getByRole('button', { name: 'Edit mobile', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'Edit mobile', exact: true })).toBeFocused()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
