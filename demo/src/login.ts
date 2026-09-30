import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { chromium } from 'playwright'

import { AUTH_FILE } from './env'

/**
 * Log in to GitHub once, by hand, so the recording can show the private
 * repository. The session is saved to .auth/ (gitignored); delete it to log out.
 */
const browser = await chromium.launch({ headless: false })
const context = await browser.newContext()
const page = await context.newPage()
await page.goto('https://github.com/login')
console.log('Log in to GitHub in the opened window (including 2FA). This waits up to 5 minutes.')
await page.waitForURL((url) => url.hostname === 'github.com' && !/^\/(login|session|sessions)/.test(url.pathname), {
  timeout: 5 * 60_000,
})
mkdirSync(dirname(AUTH_FILE), { recursive: true })
await context.storageState({ path: AUTH_FILE })
console.log('Saved the GitHub session for the recorder.')
await browser.close()
