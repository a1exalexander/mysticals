// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { notesFragment } from './notesHtml'

const render = (html: string): string => {
  const div = document.createElement('div')
  div.append(notesFragment(html))
  return div.innerHTML
}

describe('notesFragment', () => {
  it('renders a Google description as formatted html with safe links', () => {
    expect(
      render('<a href="https://track.example.com/browse/PH-1" rel="noopener noreferrer" target="_blank">https://track.example.com/browse/PH-1</a><br>AI run 2.0<br>')
    ).toBe(
      '<a href="https://track.example.com/browse/PH-1" target="_blank" rel="noopener noreferrer" class="details-link">https://track.example.com/browse/PH-1</a><br>AI run 2.0<br>'
    )
  })
  it('keeps formatting, drops styles, classes and handlers', () => {
    expect(render('<p class="x" style="color:red" onclick="alert(1)"><b>Agenda</b>: <i>one</i></p><ul><li>a</li></ul>')).toBe(
      '<p><b>Agenda</b>: <i>one</i></p><ul><li>a</li></ul>'
    )
  })
  it('removes scripts, iframes, images, forms and svg', () => {
    expect(render('x<script>alert(1)</script><iframe src="https://e.vil"></iframe><img src="https://e.vil/p.gif" onerror="alert(1)"><form><input></form><svg><use href="#a"/></svg>y')).toBe('xy')
  })
  it('turns non-http links into plain text', () => {
    expect(render('<a href="javascript:alert(1)">a</a> <a href="file:///etc/passwd">b</a> <a href="mailto:me@x.io">c</a>')).toBe('<a>a</a> <a>b</a> <a>c</a>')
  })
  it('linkifies bare urls outside links', () => {
    expect(render('<p>See https://x.io/a, ok</p>')).toBe(
      '<p>See <a href="https://x.io/a" target="_blank" rel="noopener noreferrer" class="details-link">https://x.io/a</a>, ok</p>'
    )
  })
})
