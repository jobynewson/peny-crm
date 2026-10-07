// src/pdf/richbox.js
// A rich text box for the PDF Generator: a contenteditable that takes bold,
// italic and line breaks, and nothing else. It keeps the page's own undo, and
// reports its content as the stored markup (richtext.js). Pasting brings in
// plain text only, so nothing a browser or Word carries along (fonts, colours,
// links) reaches a document.

import { htmlToMarkup, markupToHtml } from './richtext.js'

function insertPlain(text) {
  text.replace(/\r/g, '').split('\n').forEach((line, i) => {
    if (i) document.execCommand('insertLineBreak')
    if (line) document.execCommand('insertText', false, line)
  })
}

/**
 * @param {HTMLElement} el      the box
 * @param {string} markup       the stored markup to show
 * @param {{ editable: boolean, onInput: (markup: string) => void }} opts
 */
export function mountRichBox(el, markup, { editable, onInput }) {
  el.innerHTML = markupToHtml(markup)
  if (!editable) { el.contentEditable = 'false'; return }
  el.contentEditable = 'true'
  el.addEventListener('beforeinput', e => {
    // Enter is a line break, as in the stored text, not a new block.
    if (e.inputType === 'insertParagraph') { e.preventDefault(); document.execCommand('insertLineBreak') }
  })
  el.addEventListener('paste', e => { e.preventDefault(); insertPlain(e.clipboardData?.getData('text/plain') ?? '') })
  el.addEventListener('drop', e => e.preventDefault())
  el.addEventListener('input', () => {
    if (!el.textContent) el.innerHTML = ''        // lets the placeholder show again
    onInput(htmlToMarkup(el))
  })
}

/** Toggle bold or italic on the box's selection (or from the caret on). */
export function toggleFormat(el, kind) {
  el.focus()
  document.execCommand('styleWithCSS', false, false)
  document.execCommand(kind === 'bold' ? 'bold' : 'italic')
}

/** Whether the selection is bold / italic, for the buttons' pressed state. */
export function formatState() {
  return { bold: document.queryCommandState('bold'), italic: document.queryCommandState('italic') }
}
