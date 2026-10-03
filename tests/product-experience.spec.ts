import { expect, test } from '@playwright/test'

// Deterministic, offline API fixtures: these checks never touch customer data.
test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: '{"error":"unauthorized"}',
    }),
  )
})

const corporateHeadline = /Connecting people\.\s*Enabling possibility\./

test('the public homepage leads to company information and a working partnership enquiry', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    // A signed-out session deliberately receives the 401 fixture above.
    if (
      message.type() === 'error' &&
      !message.text().includes('the server responded with a status of 401')
    ) errors.push(message.text())
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(corporateHeadline)
  for (const name of ['Company', 'Compliance', 'Security', 'Partnerships']) {
    await expect(page.locator('header').getByRole('link', { name, exact: true })).toBeVisible()
  }

  await expect(
    page.getByRole('button', { name: /Explore the app|Download the app|Watch the film/i }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('link', { name: /Explore the app|Download the app|Watch the film/i }),
  ).toHaveCount(0)
  await expect(page.getByText(/Coming soon|Concept preview|Private creative preview|\bbeta\b/i)).toHaveCount(0)
  await expect(page.locator('a[href*=".apk"], a[href*="testflight.apple.com"]')).toHaveCount(0)

  await page.getByRole('link', { name: 'Discover XpressTend', exact: true }).click()
  await expect(page).toHaveURL(/#\/company$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('About XpressTend')
  await page.goto('/')
  await page.locator('main').getByRole('link', { name: 'Discuss a partnership', exact: true }).click()
  await expect(page).toHaveURL(/#\/partners$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Partner with XpressTend')
  await expect(
    page.locator('main a[href^="mailto:"][href*="subject="]').first(),
  ).toHaveAttribute('href', /^mailto:support@xpresstend\.com\?subject=Partnership%20enquiry$/)
  expect(errors).toEqual([])
})

test('keyboard users can skip the homepage navigation', async ({ page }) => {
  await page.goto('/')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Skip to content', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('main')).toBeFocused()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(corporateHeadline)
})

test('explore enters the actual app, navigates, and exits to the website', async ({
  page,
}) => {
  const writes: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/api\//.test(request.url()))
      writes.push(request.url())
  })
  await page.goto('/#/login')
  await page
    .getByRole('button', { name: 'Explore the app', exact: true })
    .first()
    .click()
  await expect(page).toHaveURL(/#\/app$/)
  await expect(page.getByText('Explore mode · Sample data')).toBeVisible()
  await page
    .locator('.product-phone')
    .getByRole('link', { name: 'Recipients', exact: true })
    .click()
  await expect(page).toHaveURL(/#\/recipients$/)
  await page.getByRole('button', { name: 'Leave explore mode' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    corporateHeadline,
  )
  expect(writes).toEqual([])
})

test('guest transfer walkthrough completes locally without asking for a real password', async ({
  page,
}) => {
  const writes: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/api\//.test(request.url()))
      writes.push(request.url())
  })
  await page.goto('/#/login')
  await page
    .getByRole('button', { name: 'Explore the app', exact: true })
    .first()
    .click()
  await page.locator('.product-send-card > button').click()
  await expect(page).toHaveURL(/#\/send$/)
  await page.getByRole('button', { name: /Continue/i }).click()
  await expect(page).toHaveURL(/#\/review$/)
  await page.getByRole('button', { name: /^Send \$/ }).click()
  await expect(page).toHaveURL(/#\/success$/)
  await expect(page.locator('input[type=password]')).toHaveCount(0)
  await expect(page.getByText('Explore mode · Sample data')).toBeVisible()
  expect(writes).toEqual([])
})

test('a signed-in empty account never sees the tour recipients or history on Home', async ({
  page,
}) => {
  await page.route('**/api/**', (route) => {
    const endpoint = new URL(route.request().url()).pathname
    const body = endpoint.endsWith('/auth/me')
      ? {
          user: {
            id: 'customer-test',
            firstName: 'Taylor',
            lastName: 'Test',
            email: 'test@example.com',
            kycStatus: 'pending',
            kycTier: 0,
            status: 'active',
          },
        }
      : endpoint.endsWith('/recipients')
        ? { recipients: [] }
        : endpoint.endsWith('/transfers')
          ? { transfers: [] }
          : {}
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(body),
    })
  })
  await page.goto('/#/app')
  await expect(page.locator('.product-home-greeting')).toContainText('Taylor')
  await expect(page.getByText('Explore mode · Sample data')).toHaveCount(0)
  await expect(
    page.getByText('Add new recipient', { exact: true }),
  ).toBeVisible()
  await expect(page.locator('.product-home-section ul li')).toHaveCount(0)
})

for (const width of [320, 390, 768, 1440]) {
  test(`public pages, navigation and app fit a ${width}px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/')
    await expect(page.locator('main').getByRole('link', { name: 'Discuss a partnership', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)

    for (const [name, path] of [['Company', 'company'], ['Partnerships', 'partners']]) {
      await page.locator('header').getByRole('link', { name, exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`#/${path}$`))
      await expect(page.locator('header').getByRole('link', { name, exact: true })).toHaveAttribute('aria-current', 'page')
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    }

    await page.goto('/#/login')
    await page.getByRole('button', { name: 'Explore the app', exact: true }).click()
    await expect(page).toHaveURL(/#\/app$/)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  })
}

for (const [language, explore] of [
  ['so', 'Isku day abka'],
  ['es', 'Explorar la app'],
  ['pt-BR', 'Explorar o app'],
  ['ar', 'استكشف التطبيق'],
]) {
  test(`corporate homepage and app work in ${language}`, async ({ page }) => {
    await page.addInitScript(
      (language) => localStorage.setItem('xpresstend.lang', language),
      language,
    )
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('lang', language)
    await expect(page.locator('html')).toHaveAttribute('dir', language === 'ar' ? 'rtl' : 'ltr')
    await expect(page.getByRole('heading', { level: 1 })).not.toHaveText(corporateHeadline)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

    await page.locator('.corporate-hero .brand-primary').click()
    await expect(page).toHaveURL(/#\/partners$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Partner with XpressTend')
    // Institutional and legal pages are published in English, including when
    // reached from an Arabic homepage.
    await expect(page.locator('main').locator('..')).toHaveAttribute('lang', 'en')
    await expect(page.locator('main')).toHaveCSS('direction', 'ltr')
    await page.goto('/#/login')
    await page.getByRole('button', { name: explore, exact: true }).click()
    await expect(page).toHaveURL(/#\/app$/)
    await expect(page.locator('.product-explore-bar')).toBeVisible()
  })
}

test('real accounts still require a password before any transfer submission', async ({
  page,
}) => {
  const writes: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/api\//.test(request.url()))
      writes.push(request.url())
  })
  await page.route('**/api/**', (route) => {
    const endpoint = new URL(route.request().url()).pathname
    const body = endpoint.endsWith('/auth/me')
      ? {
          user: {
            id: 'customer-test',
            firstName: 'Taylor',
            lastName: 'Test',
            email: 'test@example.com',
            kycStatus: 'approved',
            kycTier: 1,
            status: 'active',
          },
        }
      : endpoint.endsWith('/recipients')
        ? {
            recipients: [
              {
                id: 'recipient-test',
                full_name: 'Test Recipient',
                country: 'SO',
                payout_method: 'mobile_wallet',
                phone: '+252610000000',
                bank_name: null,
                relationship: 'Family',
                created_at: '2026-01-01',
              },
            ],
          }
        : endpoint.endsWith('/transfers')
          ? { transfers: [] }
          : {}
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(body),
    })
  })
  await page.goto('/#/send')
  await page.getByRole('button', { name: /Continue/i }).click()
  await expect(page).toHaveURL(/#\/review$/)
  await page.getByRole('button', { name: /^Send \$/ }).click()
  await expect(page.locator('input[type=password]')).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Authorise transfer', exact: true }),
  ).toBeDisabled()
  expect(writes).toEqual([])
})

test('company pages retain verifiable registration and accurate service availability', async ({ page }) => {
  await page.goto('/')
  await page.locator('header').getByRole('link', { name: 'Compliance', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Compliance')
  await expect(page.getByText('NMLS ID 2900672').first()).toBeVisible()
  await expect(page.getByRole('link', { name: /NMLS Consumer Access/ }).first()).toHaveAttribute(
    'href',
    'https://www.nmlsconsumeraccess.org/',
  )
  await expect(page.getByText(/Unverified accounts cannot create transfers/)).toBeVisible()
  await expect(page.getByText(/transaction limits linked to the account's verification tier/)).toBeVisible()
  await expect(page.getByText(/does not hold or move customer funds/).first()).toBeVisible()

  for (const [path, heading] of [
    ['company', 'About XpressTend'],
    ['security', 'Security and platform'],
    ['partners', 'Partner with XpressTend'],
  ]) {
    await page.goto(`/#/${path}`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading)
    await expect(page.getByText(/NMLS ID 2900672/).first()).toBeVisible()
  }
})

test('footer company, support and privacy links reach their intended pages', async ({ page }) => {
  for (const [name, heading] of [
    ['Company', 'About XpressTend'],
    ['Compliance', 'Compliance'],
    ['Security', 'Security and platform'],
    ['Partnerships', 'Partner with XpressTend'],
    ['Contact', 'Contact and support'],
    ['Privacy', 'Privacy Policy'],
  ]) {
    await page.goto('/')
    await page.locator('footer').getByRole('link', { name, exact: true }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading)
  }
})

test('company contents navigate within the document without replacing the page route', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/#/company')
  await page.getByRole('navigation', { name: 'On this page', exact: true })
    .getByRole('button', { name: 'Contact the company', exact: true }).click()
  await expect(page).toHaveURL(/#\/company$/)
  await expect(page.locator('#contact')).toBeFocused()
  await expect(page.locator('#contact')).toBeInViewport()
  await expect(page.locator('header').getByRole('link', { name: 'Company', exact: true })).toHaveAttribute('aria-current', 'page')
})
