// Figures: warm-ups, squats and lunges. See src/training/figures.js for the format.
import { bell, weight, block, bandLine, down, up, arrow } from './helpers.js'

const W = '0 36 200 100'

export const FIGS_A = {
  goblet: [
    { label: '1 · Stand tall, bell at chest', hl: ['thigh'], head: [100, 20], sh: [100, 34], hip: [100, 66], kn: [101, 98], an: [100, 128], toe: [112, 128], el: [108, 52], wr: [114, 42], kn2: [98, 98], an2: [94, 128], toe2: [106, 128], el2: [106, 50], wr2: [112, 40], extra: bell(119, 43) },
    { label: '2 · Sit down between your heels', hl: ['thigh'], head: [100, 58], sh: [92, 72], hip: [78, 106], kn: [112, 100], an: [98, 128], toe: [112, 128], el: [106, 94], wr: [112, 80], kn2: [110, 100], an2: [94, 128], toe2: [108, 128], el2: [104, 92], wr2: [110, 80], extra: bell(118, 80) + down(152, 56, 100) },
  ],
  revlunge: [
    { label: '1 · Stand tall', hl: ['thigh'], head: [100, 20], sh: [100, 34], hip: [100, 66], kn: [101, 98], an: [100, 128], toe: [112, 128], el: [100, 52], wr: [101, 68], kn2: [98, 98], an2: [94, 128], toe2: [106, 128] },
    { label: '2 · Step back and lower, front shin upright', hl: ['thigh'], head: [90, 26], sh: [90, 40], hip: [90, 72], kn: [112, 100], an: [110, 128], toe: [122, 128], el: [92, 58], wr: [94, 74], kn2: [68, 122], an2: [46, 116], toe2: [40, 128], extra: down(24, 60, 100) },
  ],
  wgs: [
    { label: '1 · Long lunge, both hands on the floor', vb: W, hl: ['thigh'], head: [130, 84], sh: [120, 90], hip: [92, 104], kn: [126, 98], an: [126, 128], toe: [140, 128], el: [120, 110], wr: [118, 128], kn2: [62, 122], an2: [36, 124], toe2: [28, 128] },
    { label: '2 · Drop the elbow toward the front foot', vb: W, hl: ['uarm'], head: [132, 98], sh: [120, 98], hip: [92, 106], kn: [126, 98], an: [126, 128], toe: [140, 128], el: [124, 118], wr: [112, 128], kn2: [62, 122], an2: [36, 124], toe2: [28, 128], extra: arrow('M156 112 L144 124') },
    { label: '3 · Turn your chest and reach the top arm to the ceiling', vb: W, hl: ['uarm'], head: [128, 80], sh: [120, 90], hip: [92, 104], kn: [126, 98], an: [126, 128], toe: [140, 128], el: [120, 110], wr: [118, 128], el2: [122, 68], wr2: [122, 48], kn2: [62, 122], an2: [36, 124], toe2: [28, 128], extra: arrow('M156 96 Q170 70 150 50') },
  ],
  openbook: [
    { label: '1 · Lie on your side, knees bent, arms out in front', vb: '14 56 172 80', hl: ['uarm'], head: [47, 96], sh: [62, 96], hip: [94, 96], kn: [112, 70], an: [140, 78], toe: [148, 80], el: [64, 80], wr: [64, 63], kn2: [118, 74], an2: [144, 82], toe2: [152, 84], el2: [67, 80], wr2: [67, 63], extra: '<rect class="fg-eq" style="fill:none;opacity:.35" x="20" y="58" width="162" height="72" rx="4"/>' },
    { label: '2 · Open the top arm behind you, knees stay together', vb: '14 56 172 80', hl: ['uarm', 'farm'], head: [47, 96], sh: [62, 96], hip: [94, 96], kn: [112, 70], an: [140, 78], toe: [148, 80], el: [64, 113], wr: [66, 129], kn2: [118, 74], an2: [144, 82], toe2: [152, 84], el2: [64, 80], wr2: [64, 63], extra: '<rect class="fg-eq" style="fill:none;opacity:.35" x="20" y="58" width="162" height="72" rx="4"/>' + arrow('M78 66 Q106 96 80 126 M88 124 L80 126 L82 118') },
  ],
  pullapart: [
    { label: '1 · Arms straight out, band between your hands', hl: ['uarm', 'farm'], head: [100, 20], sh: [100, 34], hip: [100, 66], kn: [101, 98], an: [100, 128], toe: [112, 128], el: [117, 34], wr: [134, 34], el2: [117, 36], wr2: [134, 36], kn2: [98, 98], an2: [94, 128], toe2: [106, 128], extra: bandLine('M134 34 L134 36 M126 26 L142 26') },
    { label: '2 · Pull the band apart to your chest, squeeze your shoulder blades', hl: ['uarm', 'farm', 'torso'], head: [100, 20], sh: [100, 34], hip: [100, 66], kn: [101, 98], an: [100, 128], toe: [112, 128], el: [85, 38], wr: [102, 31], el2: [86, 40], wr2: [103, 33], kn2: [98, 98], an2: [94, 128], toe2: [106, 128], extra: bandLine('M104 30 L104 34') + arrow('M138 34 L116 34 M122 28 L116 34 L122 40') },
  ],
  bridge: [
    { label: '1 · Lie on your back, knees bent, feet flat', vb: '14 56 172 80', hl: ['thigh'], head: [29, 123], sh: [44, 127], hip: [76, 127], kn: [92, 101], an: [100, 128], toe: [112, 128], el: [61, 128], wr: [78, 128], kn2: [96, 101], an2: [104, 128], toe2: [116, 128] },
    { label: '2 · Drive through your heels, lift hips, squeeze', vb: '14 56 172 80', hl: ['thigh', 'torso'], head: [29, 123], sh: [44, 127], hip: [72, 112], kn: [98, 98], an: [102, 127], toe: [114, 128], el: [61, 128], wr: [78, 128], kn2: [101, 98], an2: [105, 127], toe2: [117, 128], extra: up(72, 62, 92) },
  ],
  hip9090: [
    { label: '1 · Sit tall, drop both knees to one side', hl: ['thigh', 'shin'], head: [88, 78], sh: [88, 92], hip: [88, 126], kn: [118, 114], an: [92, 128], toe: [80, 128], el: [74, 108], wr: [66, 126], kn2: [112, 100], an2: [136, 126], toe2: [146, 128], extra: arrow('M96 76 Q122 70 138 90 M132 84 L138 90 L130 92') },
    { label: '2 · Lift and rotate both knees to the other side', hl: ['thigh', 'shin'], head: [88, 78], sh: [88, 92], hip: [88, 126], kn: [58, 114], an: [84, 128], toe: [96, 128], el: [74, 108], wr: [66, 126], kn2: [64, 100], an2: [40, 126], toe2: [30, 128], extra: arrow('M80 76 Q54 70 38 90 M44 84 L38 90 L46 92') },
  ],
  wrists: [
    { label: '1 · Hands and knees, palms down, fingers point back', hl: ['farm'], head: [97, 90], sh: [82, 94], hip: [50, 94], kn: [50, 126], an: [22, 128], toe: [14, 128], el: [82, 111], wr: [82, 128], extra: arrow('M82 128 L66 128') },
    { label: '2 · Rock hips back gently; repeat with the backs of your hands down', hl: ['farm'], head: [83, 92], sh: [68, 94], hip: [36, 98], kn: [50, 126], an: [22, 128], toe: [14, 128], el: [74, 112], wr: [82, 128], extra: arrow('M66 128 L82 128') + arrow('M110 78 L94 78 M100 72 L94 78 L100 84') },
  ],
  monster: [
    { label: '1 · Half squat, band above your knees, toes forward', hl: ['thigh'], head: [99, 48], sh: [94, 62], hip: [82, 92], kn: [113, 96], an: [108, 127], toe: [120, 128], el: [104, 74], wr: [118, 70], kn2: [110, 94], an2: [104, 127], toe2: [116, 128], extra: bandLine('M109 84 Q114 92 110 100') },
    { label: '2 · Step sideways, keep tension on the band', hl: ['thigh'], head: [109, 48], sh: [104, 62], hip: [92, 92], kn: [122, 98], an: [128, 127], toe: [140, 128], el: [114, 74], wr: [128, 70], kn2: [66, 98], an2: [56, 127], toe2: [68, 128], extra: bandLine('M122 98 L66 98') + arrow('M144 112 L164 112 M158 106 L164 112 L158 118') },
  ],
  cossack: [
    { label: '1 · Feet very wide, bell at your chest', hl: ['thigh'], head: [100, 30], sh: [100, 44], hip: [100, 76], kn: [117, 102], an: [134, 128], toe: [146, 128], el: [108, 58], wr: [116, 48], kn2: [83, 102], an2: [66, 128], toe2: [78, 128], extra: bell(120, 46) },
    { label: '2 · Sit into one hip, other leg straight, toes up', hl: ['thigh'], head: [98, 62], sh: [98, 76], hip: [98, 108], kn: [128, 100], an: [130, 128], toe: [142, 128], el: [106, 92], wr: [112, 82], kn2: [70, 118], an2: [42, 128], toe2: [36, 118], extra: bell(116, 78) + down(70, 66, 94) },
  ],
  bss: [
    { label: '1 · Back foot on the bench, stand tall', hl: ['thigh'], head: [104, 22], sh: [104, 36], hip: [104, 68], kn: [114, 98], an: [124, 127], toe: [136, 128], el: [104, 53], wr: [104, 70], kn2: [84, 90], an2: [58, 98], toe2: [47, 99], extra: block(40, 100, 36, 30) + weight(104, 74) },
    { label: '2 · Lower straight down until back knee nearly touches', hl: ['thigh'], head: [118, 44], sh: [114, 58], hip: [108, 88], kn: [136, 98], an: [124, 127], toe: [136, 128], el: [116, 75], wr: [116, 92], kn2: [90, 116], an2: [65, 98], toe2: [53, 99], extra: block(40, 100, 36, 30) + weight(116, 97) + down(84, 56, 84) },
  ],
  latlunge: [
    { label: '1 · Feet together, bell at your chest', hl: ['thigh'], head: [100, 20], sh: [100, 34], hip: [100, 66], kn: [101, 98], an: [100, 128], toe: [112, 128], el: [108, 52], wr: [114, 42], kn2: [98, 98], an2: [94, 128], toe2: [106, 128], extra: bell(119, 43) },
    { label: '2 · Step wide, sit back over the bent leg, other leg straight', hl: ['thigh'], head: [98, 50], sh: [100, 65], hip: [104, 96], kn: [134, 100], an: [138, 128], toe: [150, 128], el: [108, 80], wr: [112, 68], kn2: [77, 112], an2: [50, 128], toe2: [62, 128], extra: bell(116, 66) + arrow('M146 78 L166 78 M160 72 L166 78 L160 84') },
  ],
  stepup: [
    { label: '1 · Whole foot on the step, lean slightly forward', hl: ['thigh'], head: [92, 42], sh: [88, 56], hip: [80, 86], kn: [108, 68], an: [112, 100], toe: [124, 101], el: [88, 73], wr: [88, 90], kn2: [92, 112], an2: [62, 128], toe2: [74, 128], extra: block(96, 102, 56, 28) + weight(88, 94) + up(166, 60, 100) },
    { label: '2 · Drive up and stand tall on the step', vb: '14 -16 172 152', hl: ['thigh'], head: [124, -3], sh: [120, 10], hip: [114, 40], kn: [114, 71], an: [112, 101], toe: [124, 102], el: [120, 27], wr: [120, 44], kn2: [122, 70], an2: [100, 90], toe2: [108, 92], extra: block(96, 102, 56, 28) + weight(120, 48) },
  ],
}
