import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const APP_URL = process.env.DEMO_APP_URL ?? 'http://localhost:5173'
export const API_URL = process.env.DEMO_API_URL ?? 'http://localhost:8000'
export const REPO_URL = 'https://github.com/khaoksk/v1-self'

const BACKEND_DIR = fileURLToPath(new URL('../../backend', import.meta.url))

/** Fail fast, with the command to fix it, if the app is not running. */
export async function checkServers(): Promise<void> {
  const checks = [
    { url: `${API_URL}/api/surveys/`, fix: 'cd backend && docker compose up -d' },
    { url: `${APP_URL}/api/surveys/`, fix: 'cd frontend && npm run dev' },
  ]
  for (const { url, fix } of checks) {
    const ok = await fetch(url).then((r) => r.ok, () => false)
    if (!ok) throw new Error(`${url} is not responding. Start it with: ${fix}`)
  }
}

/**
 * Reset the dev database to the deterministic 10K dataset. The demo writes
 * data (labels, a question, a response), so it runs before and after.
 */
export function reseed(): void {
  console.log('Reseeding 10,000 responses (seed 42)…')
  execFileSync(
    'docker',
    ['compose', 'exec', '-T', 'web', 'python', 'manage.py', 'seed_bulk', '--responses', '10000', '--seed', '42', '--clear'],
    { cwd: BACKEND_DIR, stdio: 'inherit' },
  )
}

export interface Timing {
  scenario: string
  rows: number
  queries: number
  medianMs: number
}

/**
 * Server-side timings from `time_feedback_table`, taken just before the
 * recording. The browser's own clock would add Docker networking, the dev
 * proxy and the video encoder, and overstate the API several times over.
 */
export function measure(): { table: string; timings: Timing[] } {
  console.log('Timing the API (time_feedback_table)…')
  const table = execFileSync('docker', ['compose', 'exec', '-T', 'web', 'python', 'manage.py', 'time_feedback_table', '--runs', '5'], {
    cwd: BACKEND_DIR,
    encoding: 'utf-8',
  })
  const timings = table
    .split('\n')
    .map((line) => line.split('|').map((cell) => cell.trim()))
    // | Scenario | Params | Rows | Queries | Median ms | p95 ms | Target |
    .filter((cells) => cells.length >= 8 && /^\d+$/.test(cells[3]))
    .map((cells) => ({ scenario: cells[1], rows: Number(cells[3]), queries: Number(cells[4]), medianMs: Number(cells[5]) }))
  return { table, timings }
}

/** GitHub session saved by `npm run login`; gitignored. */
export const AUTH_FILE = fileURLToPath(new URL('../.auth/github.json', import.meta.url))
export const RECORDINGS_DIR = fileURLToPath(new URL('../recordings', import.meta.url))
