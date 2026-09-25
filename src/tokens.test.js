import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'

// tokens.css repeats the Darkroom values: once for the forced theme
// (html[data-theme="dark"]) and once inside the prefers-color-scheme media
// query for System. These tests keep the copies identical and make sure every
// themed token exists in both themes.

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')

// Body of the first rule whose selector is exactly `selector`, searching from `from`.
function ruleBody(source, selector, from = 0) {
  const re = new RegExp(`(^|[}\\s])${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{`, 'g')
  re.lastIndex = from
  const m = re.exec(source)
  if (!m) return null
  let depth = 1, i = m.index + m[0].length
  const start = i
  for (; i < source.length && depth; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') depth--
  }
  return source.slice(start, i - 1)
}

function declarations(body) {
  const out = {}
  for (const m of body.matchAll(/([a-z0-9-]+)\s*:\s*([^;{}]+);/gi)) out[m[1]] = m[2].trim().replace(/\s+/g, ' ')
  return out
}

// The light theme is the :root rule that sets color-scheme: light.
function lightTheme() {
  for (const m of css.matchAll(/(?:^|[}\s]):root\s*\{/g)) {
    const body = ruleBody(css, ':root', m.index)
    if (body && /color-scheme:\s*light/.test(body)) return declarations(body)
  }
  return null
}

const media = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'))
const forcedDark = declarations(ruleBody(css, 'html[data-theme="dark"]') ?? '')
const systemDark = declarations(ruleBody(media, ':root:not([data-theme="light"])') ?? '')
const light = lightTheme() ?? {}

describe('theme tokens', () => {
  it('finds all three theme blocks', () => {
    expect(Object.keys(light).length).toBeGreaterThan(20)
    expect(Object.keys(forcedDark).length).toBeGreaterThan(20)
    expect(Object.keys(systemDark).length).toBeGreaterThan(20)
  })

  it('uses the same Darkroom values when forced and when following the device', () => {
    expect(systemDark).toEqual(forcedDark)
  })

  it('defines every themed token in both themes', () => {
    expect(Object.keys(forcedDark).sort()).toEqual(Object.keys(light).sort())
  })
})
