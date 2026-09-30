/**
 * The in-page half of the annotations, injected into every document with
 * `context.addInitScript`. It draws on its own layer above the app and never
 * takes pointer events, so the app behaves exactly as without it.
 *
 * Kept as a function so TypeScript checks it; Playwright serialises it.
 */
export function installOverlay(): void {
  if ((window as unknown as { __demo?: unknown }).__demo) return

  const css = `
    #demo-layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;
      font: 15px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
    #demo-layer * { box-sizing: border-box; }
    .demo-progress { position: absolute; top: 0; left: 0; right: 0; display: flex; gap: 4px; padding: 6px 8px;
      background: rgba(15, 23, 42, .82); color: #cbd5e1; font-size: 12px; }
    .demo-progress span { flex: 1; padding: 3px 8px; border-radius: 4px; background: rgba(255,255,255,.06);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .demo-progress span.done { color: #94a3b8; background: rgba(34,197,94,.18); }
    .demo-progress span.now { color: #fff; background: #4f46e5; font-weight: 600; }
    .demo-caption { position: absolute; left: 50%; bottom: 28px; transform: translate(-50%, 12px); opacity: 0;
      width: min(980px, calc(100% - 48px)); padding: 14px 20px; border-radius: 12px;
      background: rgba(15, 23, 42, .92); color: #f8fafc; box-shadow: 0 12px 32px rgba(0,0,0,.35);
      transition: opacity .35s ease, transform .35s ease; }
    .demo-caption.show { opacity: 1; transform: translate(-50%, 0); }
    .demo-caption.top { top: 44px; bottom: auto; }
    .demo-caption .chip { display: inline-block; margin-right: 10px; padding: 2px 8px; border-radius: 999px;
      background: #4f46e5; font-size: 12px; font-weight: 600; letter-spacing: .02em; vertical-align: 2px; }
    .demo-caption .title { font-size: 18px; font-weight: 650; }
    .demo-caption .text { margin-top: 4px; color: #cbd5e1; }
    .demo-caption .text b { color: #fde68a; font-weight: 600; }
    .demo-ring { position: absolute; border: 3px solid #f59e0b; border-radius: 10px; opacity: 0;
      box-shadow: 0 0 0 9999px rgba(15, 23, 42, .38); transition: all .35s ease; }
    .demo-ring.show { opacity: 1; }
    .demo-label { position: absolute; max-width: 420px; padding: 6px 10px; border-radius: 8px; opacity: 0;
      background: #f59e0b; color: #1f2937; font-weight: 600; font-size: 14px; transition: opacity .35s ease;
      box-shadow: 0 6px 16px rgba(0,0,0,.25); }
    .demo-label.show { opacity: 1; }
    .demo-label::before { content: ""; position: absolute; left: 16px; border: 7px solid transparent; }
    .demo-label.below::before { top: -14px; border-bottom-color: #f59e0b; }
    .demo-label.above::before { bottom: -14px; border-top-color: #f59e0b; }
    .demo-cursor { position: absolute; width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%;
      background: rgba(239, 68, 68, .35); border: 2px solid #ef4444; transition: transform .1s ease; }
    .demo-cursor.down { transform: scale(.7); }
    .demo-ripple { position: absolute; width: 16px; height: 16px; margin: -8px 0 0 -8px; border-radius: 50%;
      border: 3px solid #ef4444; animation: demo-ripple .6s ease-out forwards; }
    @keyframes demo-ripple { to { transform: scale(4); opacity: 0; } }
    .demo-card { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center;
      justify-content: center; gap: 14px; padding: 48px; text-align: center; opacity: 0;
      background: radial-gradient(circle at 30% 20%, #312e81, #0f172a 70%); color: #f8fafc;
      transition: opacity .5s ease; }
    .demo-card.show { opacity: 1; }
    .demo-card .kicker { font-size: 14px; letter-spacing: .18em; text-transform: uppercase; color: #a5b4fc; }
    .demo-card h1 { margin: 0; font-size: 44px; font-weight: 700; }
    .demo-card p { margin: 0; max-width: 820px; font-size: 20px; color: #cbd5e1; }
    .demo-card ul { margin: 8px 0 0; padding: 0; list-style: none; font-size: 18px; color: #e2e8f0; }
    .demo-card li { margin: 6px 0; }
  `

  function ensureLayer(): HTMLElement {
    let layer = document.getElementById('demo-layer')
    if (layer) return layer
    const style = document.createElement('style')
    style.textContent = css
    document.documentElement.appendChild(style)
    layer = document.createElement('div')
    layer.id = 'demo-layer'
    layer.innerHTML = `
      <div class="demo-progress" hidden></div>
      <div class="demo-ring"></div>
      <div class="demo-label"></div>
      <div class="demo-caption"><span class="chip"></span><span class="title"></span><div class="text"></div></div>
      <div class="demo-card"></div>
      <div class="demo-cursor" hidden></div>`
    // Outside <body>, so React re-rendering the app cannot remove it.
    document.documentElement.appendChild(layer)
    return layer
  }

  function part<T extends HTMLElement>(selector: string): T {
    return ensureLayer().querySelector(selector) as T
  }

  const escape = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)
  // **bold** in caption text highlights a number or a name.
  const rich = (s: string) => escape(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')

  const demo = {
    progress(sections: string[], current: number, step: string) {
      const bar = part('.demo-progress')
      bar.hidden = false
      bar.innerHTML = sections
        .map((name, i) => {
          const state = i < current ? 'done' : i === current ? 'now' : ''
          const label = i === current && step ? `${i + 1} · ${name} — ${step}` : `${i + 1} · ${name}`
          return `<span class="${state}">${escape(label)}</span>`
        })
        .join('')
    },
    caption(chip: string, title: string, text: string) {
      const box = part('.demo-caption')
      box.querySelector('.chip')!.textContent = chip
      box.querySelector('.title')!.textContent = title
      box.querySelector('.text')!.innerHTML = rich(text)
      box.classList.add('show')
    },
    hideCaption() {
      part('.demo-caption').classList.remove('show')
    },
    avoid(rect: { x: number; y: number; width: number; height: number }) {
      // The caption moves to the top while the action is in the bottom band.
      part('.demo-caption').classList.toggle('top', rect.y + rect.height > window.innerHeight - 190)
    },
    spotlight(rect: { x: number; y: number; width: number; height: number }, label: string) {
      demo.avoid(rect)
      const pad = 6
      const ring = part('.demo-ring')
      Object.assign(ring.style, {
        left: `${rect.x - pad}px`,
        top: `${rect.y - pad}px`,
        width: `${rect.width + pad * 2}px`,
        height: `${rect.height + pad * 2}px`,
      })
      ring.classList.add('show')
      const tag = part('.demo-label')
      tag.innerHTML = rich(label)
      tag.hidden = !label
      // Below the target unless that would run into the caption.
      const below = rect.y + rect.height + 90 < window.innerHeight - 150
      tag.className = `demo-label ${below ? 'below' : 'above'}`
      tag.style.left = `${Math.max(8, Math.min(rect.x - pad, window.innerWidth - 440))}px`
      tag.style.top = below ? `${rect.y + rect.height + pad + 12}px` : ''
      tag.style.bottom = below ? '' : `${window.innerHeight - rect.y + pad + 12}px`
      requestAnimationFrame(() => label && tag.classList.add('show'))
    },
    clearSpotlight() {
      part('.demo-ring').classList.remove('show')
      part('.demo-label').classList.remove('show')
    },
    card(kicker: string, title: string, body: string[]) {
      const card = part('.demo-card')
      card.innerHTML =
        `<div class="kicker">${escape(kicker)}</div><h1>${escape(title)}</h1>` +
        (body.length === 1 ? `<p>${rich(body[0])}</p>` : `<ul>${body.map((b) => `<li>${rich(b)}</li>`).join('')}</ul>`)
      card.classList.add('show')
    },
    hideCard() {
      part('.demo-card').classList.remove('show')
    },
  }
  ;(window as unknown as { __demo: typeof demo }).__demo = demo

  // The cursor follows the real (Playwright-driven) mouse; a ripple marks each click.
  document.addEventListener(
    'mousemove',
    (event) => {
      const cursor = part('.demo-cursor')
      cursor.hidden = false
      cursor.style.left = `${event.clientX}px`
      cursor.style.top = `${event.clientY}px`
    },
    true,
  )
  document.addEventListener(
    'mousedown',
    (event) => {
      part('.demo-cursor').classList.add('down')
      const ripple = document.createElement('div')
      ripple.className = 'demo-ripple'
      ripple.style.left = `${event.clientX}px`
      ripple.style.top = `${event.clientY}px`
      ensureLayer().appendChild(ripple)
      setTimeout(() => ripple.remove(), 700)
    },
    true,
  )
  document.addEventListener('mouseup', () => part('.demo-cursor').classList.remove('down'), true)
}

export type DemoApi = {
  progress(sections: string[], current: number, step: string): void
  caption(chip: string, title: string, text: string): void
  hideCaption(): void
  avoid(rect: { x: number; y: number; width: number; height: number }): void
  spotlight(rect: { x: number; y: number; width: number; height: number }, label: string): void
  clearSpotlight(): void
  card(kicker: string, title: string, body: string[]): void
  hideCard(): void
}
