import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

import { Demo } from './annotate'
import { AUTH_FILE, RECORDINGS_DIR, checkServers, measure, reseed } from './env'
import { installOverlay } from './overlay'
import { problem } from './sections/01-problem'
import { table } from './sections/02-table'
import { requirements } from './sections/03-requirements'
import { howBuilt } from './sections/04-how-built'
import { Timeline } from './timeline'

const args = new Set(process.argv.slice(2))
const appOnly = args.has('--app-only')
const headless = args.has('--headless')
const skipReseed = args.has('--no-reseed')

const SECTIONS = ['The problem', 'Table & filters', 'Six requirements', 'How it was built']
const VIEWPORT = { width: 1440, height: 900 }

// The repo is public, so part 4 works logged out; a saved session is used if
// there is one (it only changes GitHub's header, e.g. your avatar).
const githubSession = !appOnly && existsSync(AUTH_FILE) ? AUTH_FILE : undefined
await checkServers()
if (!skipReseed) reseed()
const { table: timingTable, timings } = measure()

mkdirSync(RECORDINGS_DIR, { recursive: true })
rmSync(join(RECORDINGS_DIR, 'failure.png'), { force: true })
const browser = await chromium.launch({ headless, slowMo: 40 })
// One context, so the video is one continuous file. GitHub cookies are scoped
// to github.com and never reach the app on localhost.
const context = await browser.newContext({
  viewport: VIEWPORT,
  recordVideo: { dir: RECORDINGS_DIR, size: VIEWPORT },
  storageState: githubSession,
})
// tsx wraps named functions in a `__name` helper that the page lacks; shim it.
await context.addInitScript({ content: `var __name = (f) => f; (${installOverlay.toString()})()` })
const page = await context.newPage()
const timeline = new Timeline()
const demo = new Demo(page, timeline, appOnly ? SECTIONS.slice(0, 3) : SECTIONS)

let failed: unknown = null
try {
  await problem(demo, timings)
  await table(demo)
  await requirements(demo)
  if (!appOnly) await howBuilt(demo)
  await demo.pause(1500)
} catch (error) {
  failed = error
  await page.screenshot({ path: join(RECORDINGS_DIR, 'failure.png') }).catch(() => {})
}

const video = page.video()
await context.close()
await browser.close()

const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')
const base = join(RECORDINGS_DIR, `demo-${stamp}${appOnly ? '-app' : ''}`)
if (video) renameSync(await video.path(), `${base}.webm`)
timeline.write(`${base}.vtt`, `${base}-chapters.md`)
writeFileSync(`${base}-timings.md`, timingTable)
console.log(`Video:     ${base}.webm\nSubtitles: ${base}.vtt\nChapters:  ${base}-chapters.md\nTimings:   ${base}-timings.md`)

// An MP4 with the subtitles as a selectable track, if ffmpeg is installed.
try {
  execFileSync(
    'ffmpeg',
    ['-y', '-loglevel', 'error', '-i', `${base}.webm`, '-i', `${base}.vtt`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-crf', '20', '-c:s', 'mov_text', '-metadata:s:s:0', 'language=eng', `${base}.mp4`],
    { stdio: 'inherit' },
  )
  console.log(`MP4:       ${base}.mp4`)
} catch {
  console.log('ffmpeg not found or failed: skipped the MP4 (the .webm plays in any browser).')
}

if (!skipReseed) reseed()
if (failed) {
  console.error('The recording stopped early; see recordings/failure.png.')
  throw failed
}
