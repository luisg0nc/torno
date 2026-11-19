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
<meta name="color-scheme" content="light dark">
<link rel="icon" href="../assets/torno.svg" type="image/svg+xml">
<link rel="preload" href="../assets/fonts/instrument-sans-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="../assets/manual.css">
</head>
<body>
<header class="top">
  <a class="brand" href="../" aria-label="torno, home"><img src="../assets/torno.svg" alt="" width="32" height="32"><span>torno</span></a>
  <nav aria-label="Site"><a href="../">Home</a><a href="https://github.com/luisg0nc/torno">GitHub</a></nav>
</header>
<div class="layout">
<nav class="contents" aria-label="Contents"><h2>Contents</h2><ul>
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
