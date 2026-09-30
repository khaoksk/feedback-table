import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { chromium } from 'playwright'

import { AUTH_FILE } from './env'

/**
 * Log in to GitHub once, by hand, so the recording can show the private
 * repository. The session is saved to .auth/ (gitignored); delete it to log out.
 *
 * Google (and some other sign-in providers) refuse browsers that Playwright
 * controls. So this opens your installed Chrome or Edge as a normal browser,
 * waits until you are logged in, and only then connects to read the cookies.
 */
const PORT = 9223
const PROFILE_DIR = join(dirname(AUTH_FILE), 'browser-profile')

const candidates = [
  process.env.DEMO_BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
]
const executable = candidates.find((path): path is string => Boolean(path) && existsSync(path!))
if (!executable) throw new Error('Chrome or Edge not found. Set DEMO_BROWSER to the browser executable.')

mkdirSync(PROFILE_DIR, { recursive: true })
// A separate profile: your everyday browser profile is never touched.
const browserProcess = spawn(
  executable,
  [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE_DIR}`, '--no-first-run', '--no-default-browser-check', 'https://github.com/login'],
  { stdio: 'ignore' },
)

console.log('Log in to GitHub in the browser window that opened (Google sign-in and 2FA work there).')
console.log('Waiting up to 10 minutes; this continues by itself once you reach GitHub logged in.')

/** Read the open tabs over plain HTTP, without attaching to any page. */
async function loggedIn(): Promise<boolean> {
  const tabs = (await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json(), () => [])) as { url: string }[]
  return tabs.some((tab) => {
    try {
      const url = new URL(tab.url)
      return url.hostname === 'github.com' && !/^\/(login|session|sessions|signup)/.test(url.pathname)
    } catch {
      return false
    }
  })
}

const deadline = Date.now() + 10 * 60_000
while (!(await loggedIn())) {
  if (Date.now() > deadline || browserProcess.exitCode !== null) {
    browserProcess.kill()
    throw new Error('Not logged in: the browser was closed or 10 minutes passed. Run `npm run login` again.')
  }
  await new Promise((resolve) => setTimeout(resolve, 2000))
}
// Let GitHub finish setting its session cookies.
await new Promise((resolve) => setTimeout(resolve, 3000))

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`)
const state = await browser.contexts()[0].storageState()
const github = state.cookies.filter((cookie) => cookie.domain.endsWith('github.com'))
if (!github.some((cookie) => cookie.name === 'user_session')) {
  await browser.close()
  throw new Error('No GitHub session cookie found. Finish logging in, then run `npm run login` again.')
}
mkdirSync(dirname(AUTH_FILE), { recursive: true })
// Only GitHub's cookies: the Google login cookies stay in the throwaway profile.
await chromium.launch().then(async (b) => {
  const context = await b.newContext({ storageState: { cookies: github, origins: [] } })
  await context.storageState({ path: AUTH_FILE })
  await b.close()
})
await browser.close()
browserProcess.kill()
console.log(`Saved the GitHub session to ${AUTH_FILE}. You can close the browser.`)
