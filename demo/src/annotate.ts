import type { Locator, Page } from 'playwright'

import type { DemoApi } from './overlay'
import type { Timeline } from './timeline'

type DemoCall = { [K in keyof DemoApi]: [K, ...Parameters<DemoApi[K]>] }[keyof DemoApi]

/** Reading speed for captions: long enough to read, never under the minimum. */
const MS_PER_CHAR = 55
const MIN_READ_MS = 2500

/**
 * The recorder's side of the annotations. Sections call these instead of raw
 * Playwright, so every action is visible (cursor glide, ring, caption) and
 * every caption lands in the subtitle file.
 */
export class Demo {
  private section = 0
  private chip = ''
  private step = ''

  constructor(
    readonly page: Page,
    private readonly timeline: Timeline,
    private readonly sections: string[],
  ) {
    // A navigation loads a fresh overlay; put the progress strip back on it.
    page.on('load', () => void this.draw('progress', this.sections, this.section, this.step).catch(() => {}))
  }

  private async draw(...[method, ...args]: DemoCall): Promise<void> {
    await this.page.evaluate(
      ([m, a]) => ((window as unknown as { __demo: Record<string, (...x: unknown[]) => void> }).__demo[m](...a)),
      [method, args] as const,
    )
  }

  /** A full-screen title card between sections, also a chapter marker. */
  async card(index: number, title: string, body: string[], holdMs = 4500): Promise<void> {
    // A second card within a part is not a new chapter.
    if (index !== this.section || !this.chip) this.timeline.chapter(`${index + 1}. ${this.sections[index]}`)
    this.section = index
    this.step = ''
    this.chip = `${index + 1} · ${this.sections[index]}`
    this.timeline.caption(`${title} — ${body.join(' ').replace(/\*\*/g, '')}`)
    await this.draw('progress', this.sections, index, '')
    await this.draw('card', `Part ${index + 1} of ${this.sections.length}`, title, body)
    await this.pause(holdMs)
    await this.draw('hideCard')
    this.timeline.close()
    await this.pause(600)
  }

  /** Caption at the bottom: what this step shows and why it matters. */
  async say(title: string, text: string, readMs?: number): Promise<void> {
    this.step = title
    this.timeline.caption(`${title}. ${text.replace(/\*\*/g, '')}`)
    await this.draw('progress', this.sections, this.section, title)
    await this.draw('caption', this.chip, title, text)
    await this.pause(readMs ?? Math.max(MIN_READ_MS, text.length * MS_PER_CHAR))
  }

  async hideCaption(): Promise<void> {
    this.timeline.close()
    await this.draw('hideCaption')
  }

  /** Ring the element, dim the rest, and point a label at it. */
  async spotlight(target: Locator, label = '', holdMs = 2200): Promise<void> {
    const box = await this.center(target)
    if (!box) return
    await this.draw('spotlight', box, label)
    await this.pause(holdMs)
  }

  async clear(): Promise<void> {
    await this.draw('clearSpotlight')
  }

  /** Scroll the element to the middle of the screen, away from the caption. */
  private async center(target: Locator) {
    await target.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }))
    await this.pause(150)
    return target.boundingBox()
  }

  /** Like spotlight, but skipped if the element is not there (third-party pages). */
  async spotlightIfPresent(target: Locator, label = '', holdMs = 2200): Promise<boolean> {
    const visible = await target
      .first()
      .waitFor({ state: 'visible', timeout: 4000 })
      .then(() => true, () => false)
    if (visible) await this.spotlight(target.first(), label, holdMs)
    return visible
  }

  /** Glide the cursor to the element, so viewers can follow it. */
  async moveTo(target: Locator): Promise<void> {
    const box = await this.center(target)
    if (!box) return
    await this.draw('avoid', box)
    await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 18 })
  }

  async click(target: Locator, label?: string): Promise<void> {
    if (label) await this.spotlight(target, label, 1400)
    await this.moveTo(target)
    await this.pause(250)
    await this.clear()
    await target.click()
    await this.pause(700)
  }

  async type(target: Locator, text: string): Promise<void> {
    await this.moveTo(target)
    await target.click()
    await target.fill('')
    await target.pressSequentially(text, { delay: 70 })
    await this.pause(500)
  }

  /**
   * Native <select> menus and title tooltips are drawn by the OS and never
   * reach the video, so the label says what was chosen or what the tooltip reads.
   */
  async select(target: Locator, option: string, label?: string): Promise<void> {
    await this.moveTo(target)
    await this.spotlight(target, label ?? `→ **${option}**`, 1300)
    await target.selectOption({ label: option })
    await this.pause(900)
    await this.clear()
  }

  async hover(target: Locator, label: string, holdMs = 3500): Promise<void> {
    await this.moveTo(target)
    await target.hover()
    await this.spotlight(target, label, holdMs)
    await this.clear()
  }

  async goto(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: 'load' })
    // GitHub keeps live connections open, so "network idle" may never come.
    await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})
    await this.pause(600)
  }

  pause(ms: number): Promise<void> {
    return this.page.waitForTimeout(ms)
  }
}
