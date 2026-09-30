# Demo recorder

Records the end-to-end demo of the Feedback Table with Playwright. On-screen annotations explain every step:

- a caption bar with the part and step
- a spotlight ring with a callout on the element being discussed
- a visible cursor with click ripples
- a progress strip across the top
- title cards between parts

Numbers in the captions come from this run: the table's own counts, and server timings from `time_feedback_table`,
taken just before recording.

The recording runs in four parts, about 6 minutes in total:

1. **The problem:** the legacy API against the paged table.
2. **Table & filters:** columns, edge cases, filters kept in the URL.
3. **Six requirements:** labels, multi-select, comments, re-answering, latest settings, conditions.
4. **How it was built:** PRs, commits, the AI collaboration note and CI, on GitHub.

## Run it

Prerequisites:

- Node 22.
- The backend running: `cd backend && docker compose up -d`.
- The frontend running: `cd frontend && npm run dev`.

```bash
cd demo
npm install
npx playwright install chromium

npm run login        # once: log in to GitHub in the Chrome window that opens (the repo is private)
npm run record       # all four parts
npm run record:app   # parts 1–3 only, no GitHub login needed
```

Extra flags go after `--`, for example `npm run record -- --headless`:

- `--headless` records without showing the browser.
- `--no-reseed` skips resetting the database.

**The recorder resets the dev database.** It reseeds 10,000 responses (`seed_bulk --seed 42 --clear`) before and
after the run, because the demo adds a question, a response and label changes.

## Output

Files go to `recordings/` (gitignored), named `demo-<timestamp>`:

| File | What |
|---|---|
| `.webm` | the video, 1440×900 |
| `.mp4` | H.264 with the captions as a subtitle track (only if `ffmpeg` is on the PATH) |
| `.vtt` | subtitles for every caption, for players and upload sites |
| `-chapters.md` | chapter timestamps, e.g. for a video description |
| `-timings.md` | the `time_feedback_table` report the captions quote |

The video has no audio, so you can record a voice-over on top of it.

## GitHub session

Google sign-in refuses browsers that Playwright controls. So `npm run login` opens your installed Chrome (or Edge)
as a normal browser, with a separate profile in `.auth/browser-profile/`. Log in there any way you like: password,
Google or 2FA.

Once a GitHub page loads with you logged in, the script connects, copies only GitHub's cookies to
`.auth/github.json`, and closes the browser.

Everything in `.auth/` is gitignored. Never commit it, and delete the folder when you're done recording. To use
another browser, set `DEMO_BROWSER` to its executable.

## Layout

| File | Role |
|---|---|
| `src/record.ts` | entry point: reset, measure, record, write the outputs |
| `src/overlay.ts` | the in-page annotation layer (plain DOM, `pointer-events: none`) |
| `src/annotate.ts` | `Demo`: `say`, `spotlight`, `click`, `type`, `select`, `hover`, `card` |
| `src/timeline.ts` | caption and chapter times, written as `.vtt` and `-chapters.md` |
| `src/sections/` | one file per part |

To add a step, call the `Demo` helpers from a section. Each helper already moves the cursor, draws the highlight
and logs the caption.

Two things need a spotlight label instead: native `<select>` menus and `title` tooltips are drawn by the operating
system, so they never appear in the video. `select` and `hover` put the chosen option, or the tooltip text, in the
label.
