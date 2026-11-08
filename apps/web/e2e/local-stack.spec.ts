import { expect, test } from '@playwright/test'

test.skip(process.env.NOCTURNIX_REAL_STACK !== '1', 'requires the isolated local production stack')

test('local production stack searches the real catalog and preserves the verified Kiwix URL', async ({ page }) => {
  const kiwixBaseUrl = process.env.NOCTURNIX_EXPECTED_KIWIX_BASE_URL ?? 'http://127.0.0.1:8080'
  const verifiedUrl = `${kiwixBaseUrl}/viewer#ifixit_en_all_2025-12/Guide/(New)+iPhone+15+Back+Glass+Installation/191628`

  await page.goto('/')
  await expect(page).toHaveTitle(/Nocturnix Manuals/)
  await page.getByRole('button', { name: 'Offline Repair Guides', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Offline Repair Guides' })).toBeVisible()
  await expect(page.getByText('56,536 indexed guides')).toBeVisible()

  await page.getByLabel('Search offline repair guides').fill('(New) iPhone 15 Back Glass Installation')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  const guide = page.getByRole('article').filter({ hasText: '(New) iPhone 15 Back Glass Installation' }).first()
  await expect(guide).toBeVisible()
  await expect(guide.getByText('Source: iFixit')).toBeVisible()
  await expect(guide.getByRole('link', { name: 'Open in Kiwix' })).toHaveAttribute('href', verifiedUrl)
})
