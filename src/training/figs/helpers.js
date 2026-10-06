// Helpers for the `extra` field of a figure frame (equipment, arrows).
export const arrow = d => `<path class="fg-arrow" d="${d}"/>`
export const down = (x, y1, y2) => arrow(`M${x} ${y1} L${x} ${y2} M${x - 6} ${y2 - 7} L${x} ${y2} L${x + 6} ${y2 - 7}`)
export const up = (x, y1, y2) => arrow(`M${x} ${y2} L${x} ${y1} M${x - 6} ${y1 + 7} L${x} ${y1} L${x + 6} ${y1 + 7}`)
export const bell = (x, y, r = 7) => `<circle class="fg-eq" cx="${x}" cy="${y}" r="${r}"/>`
export const weight = (x, y) => `<rect class="fg-eq" x="${x - 6}" y="${y - 3}" width="12" height="6" rx="2"/>`
export const bandLine = d => `<path class="fg-band" d="${d}"/>`
export const block = (x, y, w, h) => `<rect class="fg-eq" x="${x}" y="${y}" width="${w}" height="${h}" rx="2"/>`

