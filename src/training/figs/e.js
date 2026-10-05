// Figures: stretches. See src/training/figures.js for the format.
import { down, up, block, arrow } from './helpers.js'

const line = (a, b, cls = '') => `<line class="fg-limb ${cls}" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>`
// Top-down views (lying poses): crop so the ground line is hidden.
const WR = '70 6 100 76'
const TOP = '10 20 180 100'
const FRONT = '40 14 120 112'
const mat = (x, y, w, h) => `<rect class="fg-eq" opacity=".14" x="${x}" y="${y}" width="${w}" height="${h}" rx="6"/>`
const MAT = mat(52, 16, 96, 108)
const MAT2 = mat(14, 22, 164, 76)

export const FIGS_E = {
  thread: [
    { label: '1 · Hands and knees, hands under shoulders', hl: ['uarm'], head: [115, 92], sh: [102, 96], hip: [70, 96], kn: [70, 128], an: [40, 128], toe: [32, 128], el: [102, 113], wr: [102, 129], kn2: [74, 128], an2: [44, 128], toe2: [36, 128], el2: [104, 113], wr2: [104, 129] },
    { label: '2 · Slide one arm under, shoulder and head to the floor', hl: ['torso', 'uarm', 'farm'], head: [118, 120], sh: [98, 114], hip: [70, 96], kn: [70, 128], an: [40, 128], toe: [32, 128], el: [106, 126], wr: [90, 129], kn2: [74, 128], an2: [44, 128], toe2: [36, 128], el2: [116, 112], wr2: [128, 127], extra: down(98, 84, 104) },
  ],
  doorway: [
    { label: '1 · Forearm on the frame, elbow at shoulder height', hl: ['uarm'], head: [101, 20], sh: [101, 34], hip: [101, 66], kn: [102, 98], an: [101, 128], toe: [113, 128], el: [118, 34], wr: [118, 17], kn2: [98, 98], an2: [95, 128], toe2: [107, 128], el2: [101, 52], wr2: [102, 68], extra: block(121, 8, 6, 122) },
    { label: '2 · Step through until the chest opens', hl: ['uarm'], head: [106, 22], sh: [104, 36], hip: [104, 70], kn: [124, 96], an: [122, 127], toe: [134, 128], el: [120, 36], wr: [120, 19], kn2: [94, 100], an2: [78, 126], toe2: [88, 128], extra: block(121, 8, 6, 122) + arrow('M70 60 L90 60 M84 54 L90 60 L84 66') },
  ],
  latstretch: [
    { label: '1 · Kneel, elbows on the sofa, hands together (side view)', hl: ['torso'], head: [137, 77], sh: [124, 86], hip: [96, 99], kn: [98, 128], an: [68, 128], toe: [60, 128], el: [140, 92], wr: [156, 92], kn2: [102, 128], an2: [72, 128], toe2: [64, 128], extra: block(145, 96, 45, 34) },
    { label: '2 · Walk knees back, let your chest sink toward the floor', hl: ['torso', 'uarm'], head: [134, 120], sh: [126, 108], hip: [96, 94], kn: [98, 128], an: [68, 128], toe: [60, 128], el: [138, 94], wr: [156, 92], kn2: [102, 128], an2: [72, 128], toe2: [64, 128], extra: block(145, 96, 45, 34) + down(112, 62, 84) },
  ],
  hipflexor: [
    { label: '1 · Back knee on a cushion, front foot flat', hl: ['thigh'], head: [98, 48], sh: [98, 64], hip: [98, 96], kn: [80, 124], an: [50, 128], toe: [44, 128], el: [104, 80], wr: [114, 95], kn2: [130, 98], an2: [130, 128], toe2: [142, 128], extra: block(66, 124, 24, 6) },
    { label: '2 · Tuck your tailbone, shift forward', hl: ['thigh'], head: [108, 42], sh: [108, 58], hip: [106, 98], kn: [78, 124], an: [48, 128], toe: [42, 128], el: [110, 42], wr: [112, 26], kn2: [134, 98], an2: [130, 128], toe2: [142, 128], extra: block(64, 124, 24, 6) + arrow('M84 84 L96 92 M92 84 L96 92 L88 94') },
  ],
  figure4: [
    { label: '1 · Lie back, one foot flat, other ankle across that knee (view from your feet)', flat: true, vb: FRONT, back: MAT, hl: ['thigh'], head: [100, 28], sh: [100, 42], hip: [100, 74], kn: [80, 90], an: [82, 114], toe: [82, 120], el: [84, 58], wr: [76, 72], kn2: [122, 92], an2: [84, 88], toe2: [76, 86], el2: [116, 58], wr2: [124, 72] },
    { label: '2 · Hold behind the thigh and draw it toward your chest', flat: true, vb: FRONT, back: MAT, hl: ['thigh'], head: [100, 28], sh: [100, 42], hip: [100, 74], kn: [84, 70], an: [86, 96], toe: [86, 102], el: [82, 56], wr: [84, 76], kn2: [122, 80], an2: [86, 66], toe2: [78, 64], el2: [118, 56], wr2: [104, 74], extra: arrow('M104 112 L104 94 M98 100 L104 94 L110 100') },
  ],
  child: [
    { label: '1 · Kneel, sit your hips back toward your heels', hl: ['thigh'], head: [78, 62], sh: [74, 78], hip: [66, 107], kn: [90, 128], an: [60, 128], toe: [52, 128], el: [80, 94], wr: [84, 110], kn2: [96, 128], an2: [66, 128], toe2: [58, 128], extra: arrow('M104 96 L84 106 M92 100 L84 106 L90 112') },
    { label: '2 · Walk your hands forward, forehead down', hl: ['torso'], head: [112, 119], sh: [98, 114], hip: [66, 107], kn: [90, 128], an: [60, 128], toe: [52, 128], el: [116, 124], wr: [134, 129], kn2: [96, 128], an2: [66, 128], toe2: [58, 128], el2: [118, 122], wr2: [138, 128], extra: arrow('M146 108 L162 108 M156 102 L162 108 L156 114') },
  ],
  lumbartwist: [
    { label: '1 · Lie on your back, arms out, knees bent (from above)', flat: true, vb: TOP, back: MAT2, hl: ['thigh'], head: [30, 60], sh: [46, 60], hip: [78, 60], kn: [92, 50], an: [112, 54], toe: [118, 54], el: [46, 43], wr: [46, 26], kn2: [92, 70], an2: [112, 66], toe2: [118, 66], el2: [46, 77], wr2: [46, 94] },
    { label: '2 · Drop both knees to one side, shoulders stay down (from above)', flat: true, vb: TOP, back: MAT2, hl: ['thigh', 'shin'], head: [30, 60], sh: [46, 60], hip: [78, 60], kn: [86, 92], an: [112, 84], toe: [118, 82], el: [46, 43], wr: [46, 26], kn2: [80, 94], an2: [106, 90], toe2: [112, 88], el2: [46, 77], wr2: [46, 94], extra: arrow('M130 66 Q140 86 126 100 M134 98 L126 100 L128 90') },
  ],
  floorchest: [
    { label: '1 · Lie face down, arm straight out at shoulder height (from above)', flat: true, vb: TOP, back: MAT2, hl: ['uarm', 'farm'], head: [34, 70], sh: [50, 70], hip: [84, 70], kn: [116, 62], an: [148, 62], toe: [154, 62], el: [50, 53], wr: [50, 36], kn2: [116, 78], an2: [148, 78], toe2: [154, 78], el2: [60, 84], wr2: [72, 78] },
    { label: '2 · Roll your chest up and away, top knee forward; arm stays on the floor (from above)', flat: true, vb: TOP, back: MAT2, hl: ['uarm', 'farm'], head: [38, 80], sh: [56, 72], hip: [84, 64], kn: [116, 58], an: [148, 58], toe: [154, 58], el: [56, 55], wr: [56, 38], kn2: [100, 94], an2: [128, 90], toe2: [134, 88], el2: [66, 90], wr2: [78, 96], extra: arrow('M96 34 Q116 52 106 76 M110 70 L106 76 L100 68') },
  ],
  wristflex: [
    { vb: WR, label: '1 · Arm straight out, palm up', hl: ['farm'], head: [101, 20], sh: [101, 36], hip: [101, 68], kn: [102, 99], an: [101, 128], toe: [113, 128], el: [118, 36], wr: [135, 36], kn2: [98, 99], an2: [95, 128], toe2: [107, 128], el2: [101, 54], wr2: [102, 70], extra: line([135, 36], [145, 36], 'hl') + up(140, 14, 28) },
    { vb: WR, label: '2 · Other hand eases the fingers back toward the floor', hl: ['farm'], head: [101, 20], sh: [101, 36], hip: [101, 68], kn: [102, 99], an: [101, 128], toe: [113, 128], el: [118, 36], wr: [135, 36], kn2: [98, 99], an2: [95, 128], toe2: [107, 128], el2: [116, 56], wr2: [132, 52], extra: line([135, 36], [138, 52], 'hl') },
  ],
  wristext: [
    { vb: WR, label: '1 · Arm straight out, palm down', hl: ['farm'], head: [101, 20], sh: [101, 36], hip: [101, 68], kn: [102, 99], an: [101, 128], toe: [113, 128], el: [118, 36], wr: [135, 36], kn2: [98, 99], an2: [95, 128], toe2: [107, 128], el2: [101, 54], wr2: [102, 70], extra: line([135, 36], [145, 36], 'hl') + down(140, 44, 58) },
    { vb: WR, label: '2 · Other hand eases the hand down and toward you', hl: ['farm'], head: [101, 20], sh: [101, 36], hip: [101, 68], kn: [102, 99], an: [101, 128], toe: [113, 128], el: [118, 36], wr: [135, 36], kn2: [98, 99], an2: [95, 128], toe2: [107, 128], el2: [118, 54], wr2: [141, 50], extra: line([135, 36], [131, 52], 'hl') },
  ],
}
