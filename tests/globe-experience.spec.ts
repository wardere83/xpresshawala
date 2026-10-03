import { expect, test, type Page } from '@playwright/test'

// Keep the visual journeys independent of live accounts and payment services.
test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', (route) => route.fulfill({
    status: 401,
    contentType: 'application/json',
    body: '{"error":"unauthorized"}',
  }))
})

async function waitForAnimationFrames(page: Page, count = 6) {
  await page.evaluate(async (count) => {
    for (let frame = 0; frame < count; frame++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    }
  }, count)
}

test('the homepage film plays silently inline and returns to the beginning of its loop', async ({ page }) => {
  await page.goto('/')
  const video = page.locator('#brand-film video')
  await video.scrollIntoViewIfNeeded()
  await expect.poll(() => video.evaluate((element) => {
    const film = element as HTMLVideoElement
    return Number.isFinite(film.duration) && film.duration > 0
  })).toBe(true)
  expect(await video.evaluate((element) => {
    const film = element as HTMLVideoElement
    return { muted: film.muted, controls: film.controls, loop: film.loop, inline: film.playsInline }
  })).toEqual({ muted: true, controls: false, loop: true, inline: true })

  const startedAt = await video.evaluate((element) => (element as HTMLVideoElement).currentTime)
  await expect.poll(() => video.evaluate((element) => (element as HTMLVideoElement).currentTime))
    .toBeGreaterThan(startedAt + 0.15)

  // Exercise the wraparound itself without waiting for the entire film.
  await video.evaluate((element) => {
    const film = element as HTMLVideoElement
    film.currentTime = film.duration - 0.35
  })
  await expect.poll(() => video.evaluate((element) => (element as HTMLVideoElement).currentTime), {
    timeout: 10_000,
  }).toBeLessThan(2)
  expect(await video.evaluate((element) => (element as HTMLVideoElement).paused)).toBe(false)

  await page.getByRole('button', { name: 'Pause the XpressTend film', exact: true }).click()
  await expect.poll(() => video.evaluate((element) => (element as HTMLVideoElement).paused)).toBe(true)
  const pausedTime = await video.evaluate((element) => (element as HTMLVideoElement).currentTime)
  // A visitor's explicit pause survives changes to the system preference.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect.poll(() => video.evaluate((element) => (element as HTMLVideoElement).autoplay)).toBe(false)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await expect.poll(() => video.evaluate((element) => (element as HTMLVideoElement).autoplay)).toBe(true)
  await waitForAnimationFrames(page)
  expect(await video.evaluate((element) => (element as HTMLVideoElement).paused)).toBe(true)
  expect(await video.evaluate((element) => (element as HTMLVideoElement).currentTime)).toBe(pausedTime)
  await expect(page.getByRole('button', { name: 'Play the XpressTend film', exact: true })).toBeVisible()
})

test('the globe animates real land shapes and supports keyboard pause, rotation and resume', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  const globe = page.locator('figure.xt-globe')
  const land = globe.locator('.xt-globe-land').first()
  await expect(land).toHaveAttribute('d', /^M/)
  const initialLand = await land.getAttribute('d')
  await expect.poll(() => land.getAttribute('d')).not.toBe(initialLand)

  await page.getByRole('button', { name: 'Pause globe', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(globe).toHaveAttribute('data-paused', 'true')
  const pausedLand = await land.getAttribute('d')
  await waitForAnimationFrames(page)
  await expect(land).toHaveAttribute('d', pausedLand!)

  await globe.locator('.xt-globe-surface').focus()
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => land.getAttribute('d')).not.toBe(pausedLand)
  await expect(globe).toHaveAttribute('data-paused', 'true')
  const rotatedLand = await land.getAttribute('d')
  await page.keyboard.press('Space')
  await expect(globe).toHaveAttribute('data-paused', 'false')
  await expect.poll(() => land.getAttribute('d')).not.toBe(rotatedLand)
})

test('dragging the paused globe changes its visible orientation', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  const globe = page.locator('figure.xt-globe')
  await page.getByRole('button', { name: 'Pause globe', exact: true }).click()
  await expect(globe).toHaveAttribute('data-paused', 'true')
  const land = globe.locator('.xt-globe-land').first()
  await expect(land).toHaveAttribute('d', /^M/)
  const before = await land.getAttribute('d')
  const surface = await globe.locator('.xt-globe-surface').boundingBox()
  expect(surface).not.toBeNull()
  const middleY = surface!.y + surface!.height / 2
  const middleX = surface!.x + surface!.width / 2
  await page.mouse.move(middleX - 60, middleY)
  await page.mouse.down()
  await page.mouse.move(middleX + 60, middleY, { steps: 8 })
  await page.mouse.up()
  await expect.poll(() => land.getAttribute('d')).not.toBe(before)
  await expect(land).toHaveAttribute('d', /^M/)
  await expect(globe).toHaveAttribute('data-paused', 'true')
})

test('reduced motion waits for deliberate film and globe playback', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  const globe = page.locator('figure.xt-globe')
  const land = globe.locator('.xt-globe-land').first()
  await expect(globe).toHaveAttribute('data-paused', 'true')
  await expect(land).toHaveAttribute('d', /^M/)
  const initialLand = await land.getAttribute('d')
  await waitForAnimationFrames(page)
  await expect(land).toHaveAttribute('d', initialLand!)

  const video = page.locator('#brand-film video')
  await video.scrollIntoViewIfNeeded()
  expect(await video.evaluate((element) => {
    const film = element as HTMLVideoElement
    return { autoplay: film.autoplay, paused: film.paused, time: film.currentTime }
  })).toEqual({ autoplay: false, paused: true, time: 0 })
  await page.getByRole('button', { name: 'Play the XpressTend film', exact: true }).click()
  await expect.poll(() => video.evaluate((element) => (element as HTMLVideoElement).currentTime))
    .toBeGreaterThan(0.15)

  await globe.scrollIntoViewIfNeeded()
  await page.getByRole('button', { name: 'Resume globe', exact: true }).click()
  await expect(globe).toHaveAttribute('data-paused', 'false')
  await expect.poll(() => land.getAttribute('d')).not.toBe(initialLand)
})

test.describe('mobile globe gestures', () => {
  test.use({ viewport: { width: 320, height: 844 }, hasTouch: true, isMobile: true })

  test('a vertical swipe over the globe scrolls the page without horizontal overflow', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/')
    const surface = page.locator('.xt-globe-surface')
    await surface.scrollIntoViewIfNeeded()
    await expect(surface).toHaveCSS('touch-action', 'pan-y')
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
    const bounds = await surface.boundingBox()
    expect(bounds).not.toBeNull()
    const initialScroll = await page.evaluate(() => window.scrollY)
    const session = await page.context().newCDPSession(page)
    const x = bounds!.x + bounds!.width / 2
    const y = bounds!.y + bounds!.height * 0.7
    try {
      // Let the browser decide when vertical touch scrolling cancels the
      // globe's pointer capture, as it would for a real finger swipe.
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchStart', touchPoints: [{ x, y, id: 1, radiusX: 1, radiusY: 1 }],
      })
      for (const distance of [15, 30, 45, 60, 75, 90, 105, 120]) {
        await session.send('Input.dispatchTouchEvent', {
          type: 'touchMove', touchPoints: [{ x, y: y - distance, id: 1, radiusX: 1, radiusY: 1 }],
        })
        await waitForAnimationFrames(page, 1)
      }
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    } finally {
      await session.detach()
    }
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(initialScroll + 20)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
  })
})
