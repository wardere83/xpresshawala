import { expect, test } from '@playwright/test'
import { customer } from './fixtures/account'

test('password recovery gives a generic confirmation and allows retry after an unavailable request', async ({ page }) => {
  const requests: unknown[] = []
  let fail = true
  await page.route('**/api/**', (route) => {
    if (new URL(route.request().url()).pathname === '/api/auth/forgot-password') {
      requests.push(route.request().postDataJSON())
      return route.fulfill(fail
        ? { status: 503, json: { error: 'temporarily_unavailable', message: 'Please try again shortly.' } }
        : { status: 200, json: { ok: true } })
    }
    return route.fulfill({ status: 401, json: { error: 'unauthorized' } })
  })
  await page.goto('/#/login')
  await page.getByRole('link', { name: 'Forgot your password?', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Reset your password')
  await page.getByLabel('Email', { exact: true }).fill('person@example.invalid')
  await page.getByRole('button', { name: 'Send reset instructions', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('Please try again shortly.')
  fail = false
  await page.getByRole('button', { name: 'Send reset instructions', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('If an active account matches that address')
  await expect(page.getByRole('status')).not.toContainText('person@example.invalid')
  expect(requests).toEqual([{ email: 'person@example.invalid' }, { email: 'person@example.invalid' }])
})

test('reset forms reject mismatched passwords, explain expired links, and sign in after success', async ({ page }) => {
  const token = 'a'.repeat(64)
  const requests: unknown[] = []
  let expired = true
  await page.route('**/api/**', (route) => {
    if (new URL(route.request().url()).pathname === '/api/auth/reset-password') {
      requests.push(route.request().postDataJSON())
      return route.fulfill(expired
        ? { status: 400, json: { error: 'invalid_token' } }
        : { status: 200, json: { ok: true } })
    }
    return route.fulfill({ status: 401, json: { error: 'unauthorized' } })
  })
  await page.goto(`/#/reset-password/${token}`)
  await page.getByLabel('Password', { exact: true }).fill('NewCustomerPassword123!')
  await page.getByLabel('Confirm new password', { exact: true }).fill('DifferentPassword123!')
  await page.getByRole('button', { name: 'Reset password', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('The passwords do not match.')
  expect(requests).toEqual([])
  await page.getByLabel('Confirm new password', { exact: true }).fill('NewCustomerPassword123!')
  await page.getByRole('button', { name: 'Reset password', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('expired or has already been used')
  expired = false
  await page.getByRole('button', { name: 'Reset password', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Your password has been reset')
  expect(requests).toEqual(Array(2).fill({ token, password: 'NewCustomerPassword123!' }))
  await page.getByRole('link', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome back')
})

test('account deletion requires password and confirmation, reports failures, and clears the session after success', async ({ page }) => {
  const requests: { method: string; body: unknown }[] = []
  let deleted = false
  await page.route('**/api/**', (route) => {
    const request = route.request()
    if (new URL(request.url()).pathname === '/api/auth/account') {
      const body = request.postDataJSON()
      requests.push({ method: request.method(), body })
      if (body.password !== 'CustomerPassword123!') return route.fulfill({ status: 401, json: { error: 'invalid_credentials' } })
      deleted = true
      return route.fulfill({ status: 200, json: { ok: true, retainedFinancialRecords: false } })
    }
    return route.fulfill(deleted
      ? { status: 401, json: { error: 'unauthorized' } }
      : { status: 200, json: { user: customer } })
  })
  await page.setViewportSize({ width: 320, height: 844 })
  await page.goto('/#/delete-account')
  const action = page.getByRole('button', { name: 'Delete my account', exact: true })
  await expect(action).toBeDisabled()
  await page.getByRole('checkbox').check()
  await action.click()
  expect(requests).toEqual([])
  await page.getByLabel('Password', { exact: true }).fill('WrongPassword123!')
  await action.click()
  await expect(page.getByRole('alert')).toHaveText('That email and password do not match.')
  await page.getByLabel('Password', { exact: true }).fill('CustomerPassword123!')
  await action.click()
  await expect(page.getByRole('status')).toContainText('Your account has been deleted and all sessions have been signed out')
  expect(requests).toEqual([
    { method: 'DELETE', body: { password: 'WrongPassword123!', confirmation: 'DELETE' } },
    { method: 'DELETE', body: { password: 'CustomerPassword123!', confirmation: 'DELETE' } },
  ])
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
  await page.goto('/#/app')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome back')
})
