import createDOMPurify from 'dompurify'
import { linkify } from '@mysticals/core/logic/details'

/** Formatting-only tags; no images (tracking pixels), forms, media, or style/class attributes. */
const TAGS = [
  'a', 'b', 'strong', 'i', 'em', 'u', 's', 'del', 'sub', 'sup', 'br', 'p', 'div', 'span',
  'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'code', 'hr',
  'table', 'thead', 'tbody', 'tr', 'th', 'td'
]
const WEB = /^https?:\/\//i

let purify: ReturnType<typeof createDOMPurify> | undefined
function sanitizer(): ReturnType<typeof createDOMPurify> {
  if (purify) return purify
  purify = createDOMPurify(window)
  // Links open only as http(s) in the system browser (main's window-open handler); anything else becomes text.
  purify.addHook('afterSanitizeAttributes', (node) => {
    if (node.nodeName !== 'A') return
    const href = node.getAttribute('href') ?? ''
    if (!WEB.test(href)) node.removeAttribute('href')
    else {
      node.setAttribute('target', '_blank')
      node.setAttribute('rel', 'noopener noreferrer')
      node.setAttribute('class', 'details-link')
    }
  })
  return purify
}

/** Bare urls in text outside links become links, like plain-text notes. */
function linkifyText(root: Node): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const texts: Text[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (!n.parentElement?.closest('a')) texts.push(n as Text)
  for (const text of texts) {
    const parts = linkify(text.data)
    if (!parts.some((p) => p.href)) continue
    text.replaceWith(
      ...parts.map((p) => {
        if (!p.href) return p.text
        const a = document.createElement('a')
        a.href = p.href
        a.target = '_blank'
        a.rel = 'noopener noreferrer'
        a.className = 'details-link'
        a.textContent = p.text
        return a
      })
    )
  }
}

/** An event's HTML description, sanitized to inert formatting and safe links, as nodes ready to mount. */
export function notesFragment(html: string): DocumentFragment {
  const frag = sanitizer().sanitize(html, {
    ALLOWED_TAGS: TAGS,
    ALLOWED_ATTR: ['href'],
    ALLOW_DATA_ATTR: false,
    RETURN_DOM_FRAGMENT: true
  })
  linkifyText(frag)
  return frag
}
