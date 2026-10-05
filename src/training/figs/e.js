// Figures: stretches. See src/training/figures.js for the format.
import { down, up, block, arrow } from './helpers.js'

const line = (a, b, cls = '') => `<line class="fg-limb ${cls}" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>`
// Top-down views (lying poses): crop so the ground line is hidden.
const WR = '70 6 100 76'
const TOP = '10 20 180 100'

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
    { label: '1 · Kneel, elbows on the sofa, hands together', hl: ['torso'], head: [138, 72], sh: [130, 78], hip: [108, 98], kn: [110, 128], an: [80, 128], toe: [72, 128], el: [143, 92], wr: [142, 74], kn2: [114, 128], an2: [84, 128], toe2: [76, 128], extra: block(145, 92, 45, 38) },
    { label: '2 · Walk knees back, sink your chest to the floor', hl: ['torso', 'uarm'], head: [136, 109], sh: [127, 102], hip: [97, 97], kn: [97, 128], an: [67, 128], toe: [59, 128], el: [143, 92], wr: [142, 74], kn2: [101, 128], an2: [71, 128], toe2: [63, 128], extra: block(145, 92, 45, 38) + down(118, 70, 90) },
  ],
  hipflexor: [
    { label: '1 · Back knee on a cushion, front foot flat', hl: ['thigh'], head: [98, 48], sh: [98, 64], hip: [98, 96], kn: [80, 124], an: [50, 128], toe: [44, 128], el: [104, 80], wr: [114, 95], kn2: [130, 98], an2: [130, 128], toe2: [142, 128], extra: block(66, 124, 24, 6) },
    { label: '2 · Tuck your tailbone, shift forward', hl: ['thigh'], head: [108, 42], sh: [108, 58], hip: [106, 98], kn: [78, 124], an: [48, 128], toe: [42, 128], el: [110, 42], wr: [112, 26], kn2: [134, 98], an2: [130, 128], toe2: [142, 128], extra: block(64, 124, 24, 6) + arrow('M84 84 L96 92 M92 84 L96 92 L88 94') },
  ],
  figure4: [
    { label: '1 · Lie back, ankle across the opposite knee', hl: ['thigh'], head: [48, 122], sh: [62, 127], hip: [94, 127], kn: [122, 104], an: [110, 100], toe: [102, 98], el: [76, 127], wr: [90, 127], kn2: [110, 100], an2: [126, 127], toe2: [136, 127] },
    { label: '2 · Hold behind the thigh and draw it toward you', hl: ['thigh'], head: [48, 122], sh: [62, 127], hip: [94, 127], kn: [112, 100], an: [92, 98], toe: [86, 96], el: [74, 110], wr: [88, 104], kn2: [92, 98], an2: [118, 94], toe2: [128, 100], extra: arrow('M142 86 L126 98 M130 90 L126 98 L136 99') },
  ],
  child: [
    { label: '1 · Kneel, sit your hips back toward your heels', hl: ['thigh'], head: [78, 62], sh: [74, 78], hip: [66, 107], kn: [90, 128], an: [60, 128], toe: [52, 128], el: [80, 94], wr: [84, 110], kn2: [96, 128], an2: [66, 128], toe2: [58, 128], extra: arrow('M104 96 L84 106 M92 100 L84 106 L90 112') },
    { label: '2 · Walk your hands forward, forehead down', hl: ['torso'], head: [112, 119], sh: [98, 114], hip: [66, 107], kn: [90, 128], an: [60, 128], toe: [52, 128], el: [116, 124], wr: [134, 129], kn2: [96, 128], an2: [66, 128], toe2: [58, 128], el2: [118, 122], wr2: [138, 128], extra: arrow('M146 108 L162 108 M156 102 L162 108 L156 114') },
  ],
  lumbartwist: [
    { label: '1 · Lie on your back, knees bent', hl: ['thigh'], head: [48, 122], sh: [62, 127], hip: [94, 127], kn: [110, 100], an: [126, 127], toe: [136, 127], el: [48, 108], wr: [36, 104], kn2: [114, 100], an2: [130, 127], toe2: [140, 127] },
    { label: '2 · Drop both knees to one side, shoulders stay down (from above)', vb: TOP, hl: ['thigh', 'shin'], head: [30, 60], sh: [46, 60], hip: [78, 60], kn: [86, 92], an: [112, 84], toe: [118, 82], el: [46, 43], wr: [46, 26], kn2: [80, 94], an2: [106, 90], toe2: [112, 88], el2: [46, 77], wr2: [46, 94], extra: arrow('M130 66 Q140 86 126 100 M134 98 L126 100 L128 90') },
  ],
  floorchest: [
    { label: '1 · Face down, arm out at shoulder height (from above)', vb: TOP, hl: ['uarm', 'farm'], head: [36, 70], sh: [52, 70], hip: [84, 70], kn: [116, 67], an: [146, 67], toe: [152, 67], el: [52, 53], wr: [52, 36], kn2: [116, 74], an2: [146, 74], toe2: [152, 74], el2: [62, 82], wr2: [74, 76] },
    { label: '2 · Roll toward the opposite hip, arm stays on the floor', vb: TOP, hl: ['uarm', 'farm'], head: [38, 78], sh: [54, 72], hip: [84, 68], kn: [112, 64], an: [142, 66], toe: [148, 66], el: [54, 55], wr: [54, 38], kn2: [100, 98], an2: [128, 90], toe2: [134, 88], el2: [64, 90], wr2: [78, 100], extra: arrow('M92 40 Q108 56 100 78 M106 72 L100 78 L94 70') },
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
