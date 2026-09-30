import { writeFileSync } from 'node:fs'

interface Cue {
  start: number
  end: number
  text: string
}

interface Chapter {
  start: number
  title: string
}

/**
 * Times of every caption and chapter, relative to the start of the video,
 * written out as WebVTT subtitles and a chapter list.
 */
export class Timeline {
  private readonly cues: Cue[] = []
  private readonly chapters: Chapter[] = []
  private open: { start: number; text: string } | null = null
  private readonly startedAt = Date.now()

  now(): number {
    return (Date.now() - this.startedAt) / 1000
  }

  chapter(title: string): void {
    this.chapters.push({ start: this.now(), title })
  }

  caption(text: string): void {
    this.close()
    this.open = { start: this.now(), text }
  }

  close(): void {
    if (this.open) this.cues.push({ ...this.open, end: this.now() })
    this.open = null
  }

  write(vttPath: string, chaptersPath: string): void {
    this.close()
    const vtt = ['WEBVTT', '', ...this.cues.map((c, i) => `${i + 1}\n${vttTime(c.start)} --> ${vttTime(c.end)}\n${c.text}\n`)]
    writeFileSync(vttPath, vtt.join('\n'))
    const lines = this.chapters.map((c) => `${chapterTime(c.start)} ${c.title}`)
    writeFileSync(chaptersPath, `# Chapters\n\n${lines.join('\n')}\n`)
  }
}

function vttTime(seconds: number): string {
  const ms = Math.round(seconds * 1000)
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor(ms / 60_000) % 60
  const s = Math.floor(ms / 1000) % 60
  return `${pad(h)}:${pad(m)}:${pad(s)}.${String(ms % 1000).padStart(3, '0')}`
}

/** YouTube-style chapter stamps: m:ss. */
function chapterTime(seconds: number): string {
  const s = Math.floor(seconds)
  return `${Math.floor(s / 60)}:${pad(s % 60)}`
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}
