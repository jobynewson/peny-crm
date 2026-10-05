// Build a contact sheet of every figure: node src/training/figs-preview.mjs out.html [dark]
import { writeFileSync } from 'node:fs'
import { EXERCISES } from './data.js'
import { figureHtml, FIGURES } from './figures.js'
const css = `:root{--text:#1c1f26;--text-muted:#5b6270;--border:#e3e6ec;--accent:#d9480f;--bg:#fff}
:root[data-theme=dark]{--text:#e8eaee;--text-muted:#9aa1ad;--border:#2b2f38;--accent:#ff7a45;--bg:#14161b}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,sans-serif;padding:20px 16px;max-width:900px;margin-inline:auto}h2{font-size:15px;margin:22px 0 4px}`
const style = await (await import('node:fs/promises')).readFile(new URL('../style.css', import.meta.url), 'utf8')
const fg = style.split('\n').filter(l => l.startsWith('.fg-')).join('\n')
const [a0, n0] = [+(process.argv[4] ?? 0), +(process.argv[5] ?? 999)]
const body = EXERCISES.slice(a0, a0 + n0).map(e => `<h2>${e.name} <small>(${e.id})</small></h2>${FIGURES[e.id] ? figureHtml(e.id) : '<p><em>missing</em></p>'}`).join('')
writeFileSync(process.argv[2] ?? 'figs.html', `<!doctype html><html${process.argv[3] ? ' data-theme="dark"' : ''}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}\n${fg}</style></head><body>${body}</body></html>`)
