import { expect, test, type Locator, type Page } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', (route) => route.fulfill({
    status: 401,
    contentType: 'application/json',
    body: '{"error":"unauthorized"}',
  }))
  await page.setViewportSize({ width: 1440, height: 900 })
})

async function animationFrames(page: Page, count = 6) {
  await page.evaluate(async (count) => {
    for (let frame = 0; frame < count; frame++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    }
  }, count)
}

async function revealBird(page: Page) {
  await page.locator('.corporate-partners').evaluate((section) => {
    section.scrollIntoView({ behavior: 'instant', block: 'center' })
  })
  return page.locator('.xt-bird')
}

async function renderedBird(bird: Locator) {
  return bird.evaluate((element) => {
    const overlay = element as SVGSVGElement
    const traveller = element.querySelector<SVGGElement>('.xt-bird-traveller')!
    const wing = element.querySelector<SVGPathElement>('.xt-bird-flight-wing')!
    const point = new DOMPoint(0, 0).matrixTransform(traveller.getScreenCTM()!)
    const local = point.matrixTransform(overlay.getScreenCTM()!.inverse())
    const bounds = overlay.getBoundingClientRect()
    return {
      travel: getComputedStyle(traveller).transform,
      wing: getComputedStyle(wing).transform,
      screen: { x: point.x, y: point.y },
      local: { x: local.x, y: local.y },
      overlay: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      viewBox: { width: overlay.viewBox.baseVal.width, height: overlay.viewBox.baseVal.height },
    }
  })
}

test('the slow bird flight has no playback control, waits offscreen and lands after resize', async ({ page }) => {
  await page.goto('/')
  const bird = await revealBird(page)
  await expect(bird).toHaveAttribute('data-phase', 'flying')
  await expect(bird).toHaveAttribute('data-active', 'true')
  await expect(page.getByRole('button', { name: /bird animation/i })).toHaveCount(0)
  const duration = await bird.locator('.xt-bird-traveller').evaluate((element) =>
    Number(element.getAnimations()[0].effect!.getTiming().duration))
  expect(duration).toBeGreaterThanOrEqual(9000)
  expect(duration).toBeLessThanOrEqual(14000)
  const startingPoint = (await renderedBird(bird)).screen
  await expect.poll(async () => {
    const point = (await renderedBird(bird)).screen
    return Math.hypot(point.x - startingPoint.x, point.y - startingPoint.y)
  }).toBeGreaterThan(40)
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  await expect(bird).toHaveAttribute('data-active', 'false')
  await animationFrames(page, 2)
  const frozen = await renderedBird(bird)
  await animationFrames(page)
  await expect(bird).toHaveAttribute('data-active', 'false')
  const still = await renderedBird(bird)
  expect(still.travel).toBe(frozen.travel)
  expect(still.wing).toBe(frozen.wing)

  const beforeResize = await renderedBird(bird)
  const oldGeometry = await bird.getAttribute('viewBox')
  await page.setViewportSize({ width: 1280, height: 900 })
  await expect(bird).not.toHaveAttribute('viewBox', oldGeometry!)
  await animationFrames(page)
  await expect(bird).toHaveAttribute('data-active', 'false')
  const resized = await renderedBird(bird)
  // Account for responsive layout and the old viewBox scaling. Retargeting
  // preserves that visible point instead of restarting the flight at the river.
  const scale = Math.min(
    resized.overlay.width / beforeResize.viewBox.width,
    resized.overlay.height / beforeResize.viewBox.height,
  )
  const expectedScreen = {
    x: resized.overlay.x + (resized.overlay.width - beforeResize.viewBox.width * scale) / 2
      + beforeResize.local.x * scale,
    y: resized.overlay.y + (resized.overlay.height - beforeResize.viewBox.height * scale) / 2
      + beforeResize.local.y * scale,
  }
  expect(Math.hypot(
    resized.screen.x - expectedScreen.x,
    resized.screen.y - expectedScreen.y,
  )).toBeLessThan(1.5)
  await animationFrames(page)
  const stillResized = await renderedBird(bird)
  expect(stillResized.travel).toBe(resized.travel)
  expect(stillResized.wing).toBe(resized.wing)

  await revealBird(page)
  await expect(bird).toHaveAttribute('data-active', 'true')
  await expect.poll(async () => (await renderedBird(bird)).travel).not.toBe(resized.travel)
  await expect.poll(async () => (await renderedBird(bird)).wing).not.toBe(resized.wing)
  await expect(bird).toHaveAttribute('data-phase', 'perched', { timeout: 16000 })
  await expect(page.getByRole('button', { name: /bird animation/i })).toHaveCount(0)
  await expect(bird.locator('.xt-bird-flight-wing')).toHaveCSS('display', 'none')
  const landing = await bird.evaluate((element) => {
    const traveller = element.querySelector<SVGGElement>('.xt-bird-traveller')!
    const position = new DOMPoint(0, 0).matrixTransform(traveller.getScreenCTM()!)
    const heading = document.getElementById('partners-heading')!
    const text = heading.firstChild as Text
    const finalLetter = text.data.search(/\p{L}(?=[^\p{L}]*$)/u)
    const range = document.createRange()
    range.setStart(text, finalLetter)
    range.setEnd(text, finalLetter + 1)
    const glyph = range.getBoundingClientRect()
    return {
      horizontalError: Math.abs(position.x - (glyph.left + glyph.width / 2)),
      heightAboveLineBottom: glyph.bottom - position.y,
      heightBelowLineTop: position.y - glyph.top,
    }
  })
  expect(landing.horizontalError).toBeLessThan(0.5)
  expect(landing.heightAboveLineBottom).toBeGreaterThan(0)
  expect(landing.heightBelowLineTop).toBeGreaterThanOrEqual(0)
})

test('reduced motion starts with a still perched bird and no flight control', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  const bird = await revealBird(page)
  await expect(bird).toHaveAttribute('data-phase', 'perched')
  await expect(page.getByRole('button', { name: /bird animation/i })).toHaveCount(0)
  const initial = await renderedBird(bird)
  await animationFrames(page)
  expect(await renderedBird(bird)).toEqual(initial)
  await expect(bird.locator('.xt-bird-flight-wing')).toHaveCSS('display', 'none')
})

test('enabling reduced motion during flight lands the bird without restarting it', async ({ page }) => {
  await page.goto('/')
  const bird = await revealBird(page)
  await expect(bird).toHaveAttribute('data-phase', 'flying')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(bird).toHaveAttribute('data-phase', 'perched')
  await expect(page.getByRole('button', { name: /bird animation/i })).toHaveCount(0)
  const perched = await renderedBird(bird)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await animationFrames(page)
  await expect(bird).toHaveAttribute('data-phase', 'perched')
  expect(await renderedBird(bird)).toEqual(perched)
})
