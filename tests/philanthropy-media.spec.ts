import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', (route) => route.fulfill({
    status: 401,
    contentType: 'application/json',
    body: '{"error":"unauthorized"}',
  }))
  await page.route('**/media/community-literacy-poster.webp', (route) => route.fulfill({
    contentType: 'image/webp',
    path: 'public/media/closer-poster.webp',
  }))
})

for (const failure of ['decode', 'network'] as const) {
  test(`the philanthropy banner restores its still fallback after a ${failure} failure`, async ({ page }) => {
    let requestedFilm = false
    await page.route('**/media/community-literacy.mp4', async (route) => {
      if (route.request().method() === 'HEAD') {
        await route.fulfill({ status: 200, contentType: 'video/mp4', body: '' })
        return
      }
      requestedFilm = true
      if (failure === 'network') await route.abort('failed')
      else await route.fulfill({ status: 200, contentType: 'video/mp4', body: 'invalid-video' })
    })
    await page.goto('/#/philanthropy')
    const banner = page.getByRole('region', { name: 'XpressTend Financial Literacy', exact: true })
    await expect(banner.getByRole('heading', { level: 1 })).toBeVisible()
    await expect.poll(() => requestedFilm).toBe(true)
    await expect(banner.locator('video')).toHaveCount(0)
    await expect(banner.getByRole('button', { name: /the film/ })).toHaveCount(0)
    await expect(banner.locator('div[aria-hidden="true"]').first()).toHaveCSS('background-image', /radial-gradient/)
    await expect(page.getByRole('link', { name: 'Contact XpressTend Financial Literacy', exact: true })).toBeVisible()
  })
}

test('an available banner film plays silently and stops when reduced motion is enabled', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.route('**/media/community-literacy.mp4', async (route) => {
    if (route.request().method() === 'HEAD') {
      await route.fulfill({ status: 200, contentType: 'video/mp4', body: '' })
    } else {
      await route.fulfill({ contentType: 'video/mp4', path: 'public/media/closer.mp4' })
    }
  })
  await page.goto('/#/philanthropy')
  const film = page.locator('video')
  await expect.poll(() => film.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0)
  await expect(film).toHaveJSProperty('muted', true)
  await expect(page.getByRole('button', { name: 'Pause the film', exact: true })).toBeVisible()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(film).toHaveJSProperty('paused', true)
  await expect(page.getByRole('button', { name: 'Play the film', exact: true })).toBeVisible()
})
