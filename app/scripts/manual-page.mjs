import { Marked } from 'marked'

// The manual (docs/manual.md) as one page with a table of contents. docs/manual.md stays the one source; this only
// reads it. Relative links are rewritten so they work on GitHub and on the page: a picture stays relative (the build
// copies docs/images beside the page), any other file of the repository goes to its page on GitHub, and a link to
// a heading of the manual stays in the page.

export const REPO = 'https://github.com/luisg0nc/torno/blob/main'

/** Where a link of docs/manual.md points on the page. `docs` is the folder of the manual in the repository. */
export function rewriteLink(href, docs = 'docs') {
  if (/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href)) return href
  const [path, hash = ''] = href.split(/(?=#)/)
  const parts = []
  for (const part of `${docs}/${path}`.split('/')) {
    if (part === '..') parts.pop()
    else if (part !== '.' && part !== '') parts.push(part)
  }
  const target = parts.join('/')
  if (target === 'docs/manual.md') return hash || '#'
  if (target.startsWith('docs/images/')) return target.slice('docs/'.length) + hash
  return `${REPO}/${target}${hash}`
}

/** The id of a heading: what GitHub makes of it, so that `manual.md#projects-and-builds` is the same place in both. */
export function slug(text, taken = new Map()) {
  const base = text.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s/g, '-') || 'section'
  const n = taken.get(base) ?? 0
  taken.set(base, n + 1)
  return n ? `${base}-${n}` : base
}

const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Markup without its tags; repeated until nothing changes, so taking one tag out cannot leave another whole. */
function stripTags(markup) {
  let text = markup
  for (let before = ''; before !== text; ) {
    before = text
    text = text.replace(/<[^>]*>/g, '')
  }
  return text
}

/** The page's body and its headings (level 2 and 3), from the manual's Markdown. */
export function renderManual(markdown) {
  const headings = []
  const taken = new Map()
  const marked = new Marked({
    renderer: {
      heading({ tokens, depth }) {
        const inline = this.parser.parseInline(tokens)
        const text = stripTags(inline).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
        const id = slug(text, taken)
        if (depth === 2 || depth === 3) headings.push({ depth, id, text })
        return `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-label="Link to this heading">#</a>${inline}</h${depth}>\n`
      },
      link({ href, title, tokens }) {
        const t = title ? ` title="${escape(title)}"` : ''
        return `<a href="${escape(rewriteLink(href))}"${t}>${this.parser.parseInline(tokens)}</a>`
      },
      image({ href, title, text }) {
        const t = title ? ` title="${escape(title)}"` : ''
        return `<img src="${escape(rewriteLink(href))}" alt="${escape(text)}"${t}>`
      }
    }
  })
  return { html: marked.parse(markdown), headings }
}

const STYLE = `
:root { --bg: #FAF9F6; --panel: #F1EFE9; --ink: #20242B; --muted: #62666D; --hairline: #DAD6CE; --accent: #1D46B8; }
@media (prefers-color-scheme: dark) { :root { --bg: #1B1D20; --panel: #222529; --ink: #E9E7E2; --muted: #9EA3AA; --hairline: #3E434A; --accent: #7C9BF7; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.6 system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; }
a { color: var(--accent); }
code, pre, kbd { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.9em; }
code { background: var(--panel); padding: 0.1em 0.3em; border-radius: 3px; }
pre { background: var(--panel); border: 1px solid var(--hairline); padding: 0.8em 1em; overflow-x: auto; border-radius: 4px; }
pre code { background: none; padding: 0; }
.layout { display: grid; grid-template-columns: 17rem minmax(0, 1fr); gap: 2rem; max-width: 76rem; margin: 0 auto; padding: 0 1rem; }
nav { position: sticky; top: 0; align-self: start; max-height: 100vh; overflow-y: auto; padding: 1.5rem 0; font-size: 0.9rem; }
nav .site { display: block; font-weight: 600; margin-bottom: 0.8rem; }
nav ul { list-style: none; margin: 0; padding: 0; }
nav li.d3 { padding-left: 1rem; }
nav a { display: block; padding: 0.1rem 0; color: var(--muted); text-decoration: none; }
nav a:hover { color: var(--accent); }
main { padding: 1.5rem 0 4rem; min-width: 0; max-width: 50rem; }
h1, h2, h3, h4 { line-height: 1.25; scroll-margin-top: 1rem; }
h2 { margin-top: 2.4em; padding-top: 0.6em; border-top: 1px solid var(--hairline); }
.anchor { margin-left: -1.1em; padding-right: 0.3em; color: var(--muted); text-decoration: none; opacity: 0; }
:is(h2, h3, h4):hover .anchor, .anchor:focus { opacity: 1; }
table { border-collapse: collapse; display: block; overflow-x: auto; }
th, td { border: 1px solid var(--hairline); padding: 0.3em 0.6em; text-align: left; vertical-align: top; }
img { max-width: 100%; }
blockquote { margin-left: 0; padding-left: 1em; border-left: 3px solid var(--hairline); color: var(--muted); }
@media (max-width: 52rem) { .layout { grid-template-columns: 1fr; } nav { position: static; max-height: none; } }
`

/** The whole page. */
export function renderPage(markdown) {
  const { html, headings } = renderManual(markdown)
  const items = headings.map((h) => `<li class="d${h.depth}"><a href="#${h.id}">${escape(h.text)}</a></li>`).join('\n')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The torno manual</title>
<style>${STYLE}</style>
</head>
<body>
<div class="layout">
<nav aria-label="Contents"><a class="site" href="../">torno</a><ul>
${items}
</ul></nav>
<main>
${html}
</main>
</div>
</body>
</html>
`
}
