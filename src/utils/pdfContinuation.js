// ─────────────────────────────────────────────────────────────────────────────
// PDF "kept together" continuation notice
//
// Several PDF exports keep a whole section together (page-break-inside: avoid)
// so a section is never split across a page boundary. When a section doesn't
// fit in the space left on the current page, the browser pushes the entire
// section to the next page, leaving a blank gap at the bottom of the page.
//
// To a reader that gap can look like the document has ended or something is
// broken. This helper drops a small, unobtrusive caption into that gap letting
// them know the content continues overleaf.
//
// It works by measuring the laid-out sections at the *print* width just before
// printing, simulating where the page breaks land, and inserting the caption
// before any section that gets bumped to the next page. It is wrapped in a
// try/catch and always fails silently — it must never stop a document printing.
// ─────────────────────────────────────────────────────────────────────────────

const MM_TO_PX = 96 / 25.4

/** Printable height of an A4 page in CSS px, given top+bottom @page margins (mm). */
export function a4ContentHeightPx(marginTopMm, marginBottomMm = marginTopMm) {
  return (297 - marginTopMm - marginBottomMm) * MM_TO_PX
}

/** Printable width of an A4 page (content box) in CSS px, given left+right @page margins (mm). */
export function a4ContentWidthPx(marginLeftMm, marginRightMm = marginLeftMm) {
  return (210 - marginLeftMm - marginRightMm) * MM_TO_PX
}

/** CSS for the inserted caption. Append this inside the document's <style>. */
export const PDF_CONTINUED_CSS = `
  .pdf-continued {
    font-size: 9px; font-style: italic; letter-spacing: 0.3px;
    color: #a0a09a; text-align: center; padding: 6px 0 2px;
    border-top: 0.5px dashed #d8d8d2;
  }
  @media print { .pdf-continued { color: #a0a09a } }
`

const DEFAULT_MESSAGE = 'Kept together — continued on the next page ↓'

/**
 * Returns a self-contained <script> string to embed in a generated print
 * document. Run it once the document has loaded, before window.print().
 *
 * @param {object} cfg
 * @param {string} cfg.rootSelector    Element to measure within (and to size to the print width while measuring).
 * @param {number} cfg.rootWidthPx     Page content-box width in px (use a4ContentWidthPx).
 * @param {number} cfg.pageHeightPx    Printable page height in px (use a4ContentHeightPx).
 * @param {string} cfg.blockSelector   Selector for the kept-together sections.
 * @param {'table'|'block'} cfg.mode   How to insert the caption (inside a <table> vs. normal flow).
 * @param {boolean} [cfg.autoPrint]    If true, calls window.print() after inserting.
 * @param {number}  [cfg.printDelay]   Delay before printing when autoPrint (ms).
 * @param {string}  [cfg.message]      Caption text.
 */
export function continuationScript(cfg) {
  const message = cfg.message || DEFAULT_MESSAGE
  return `<script>(function(){
  function insertNotice(b){
    var msg = ${JSON.stringify(message)};
    ${cfg.mode === 'table'
      ? `var n = document.createElement('tbody');
         n.className = 'continued-note';
         n.innerHTML = '<tr><td colspan="99" style="padding:0;border:0"><div class="pdf-continued">'+msg+'</div></td></tr>';`
      : `var n = document.createElement('div');
         n.className = 'continued-note';
         n.innerHTML = '<div class="pdf-continued">'+msg+'</div>';`}
    b.parentNode.insertBefore(n, b);
  }
  function run(){
    try {
      var root = document.querySelector(${JSON.stringify(cfg.rootSelector)});
      if (!root) return;
      var pageH = ${cfg.pageHeightPx};
      var prevW = root.style.width, prevMax = root.style.maxWidth;
      root.style.width = ${cfg.rootWidthPx} + 'px';
      root.style.maxWidth = 'none';
      void root.offsetHeight; // force reflow at print width
      var rootTop = root.getBoundingClientRect().top;
      var blocks = Array.prototype.slice.call(root.querySelectorAll(${JSON.stringify(cfg.blockSelector)}));
      // Measure everything first, then decide — so insertions don't disturb later reads.
      var measured = blocks.map(function(b){
        var r = b.getBoundingClientRect();
        return { el: b, top: r.top - rootTop, h: r.height };
      });
      var TOL = 1, MIN_GAP = 24, shift = 0, toMark = [];
      for (var i = 0; i < measured.length; i++){
        var m = measured[i];
        if (m.h <= 0 || m.h > pageH) continue; // taller than a page: it can't be kept together
        var top = m.top + shift;
        var pageEnd = (Math.floor((top + TOL) / pageH) + 1) * pageH;
        if (top + m.h > pageEnd + TOL) {       // section straddles a page boundary
          var gap = pageEnd - top;             // ...so the browser bumps it to the next page
          shift += gap;
          if (gap >= MIN_GAP) toMark.push(m.el);
        }
      }
      root.style.width = prevW;
      root.style.maxWidth = prevMax;
      toMark.forEach(insertNotice);
    } catch (e) { /* never block printing */ }
  }
  ${cfg.autoPrint
    ? `function go(){ run(); setTimeout(function(){ window.print(); }, ${cfg.printDelay || 60}); }
       if (document.readyState === 'complete') go(); else window.addEventListener('load', go);`
    : `if (document.readyState !== 'loading') run(); else document.addEventListener('DOMContentLoaded', run);`}
})();<\/script>`
}
