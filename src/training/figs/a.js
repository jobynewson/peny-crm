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
    { label: '1 · Lie on your side, knees bent, both arms straight out in front (from above)', flat: true, vb: '14 28 172 108', hl: ['uarm', 'farm'], back: '<rect class="fg-eq" style="fill:none;stroke:var(--border);stroke-width:2" x="20" y="32" width="162" height="98" rx="4"/>', head: [46, 70], sh: [62, 72], hip: [96, 72], kn: [98, 103], an: [128, 106], toe: [136, 108], el: [63, 89], wr: [63, 106], kn2: [102, 102], an2: [132, 105], toe2: [140, 107], el2: [59, 89], wr2: [59, 106] },
    { label: '2 · Sweep the top arm over and open it behind you, knees stay together (from above)', flat: true, vb: '14 28 172 108', hl: ['uarm', 'farm'], back: '<rect class="fg-eq" style="fill:none;stroke:var(--border);stroke-width:2" x="20" y="32" width="162" height="98" rx="4"/>', head: [46, 70], sh: [62, 72], hip: [96, 72], kn: [98, 103], an: [128, 106], toe: [136, 108], el: [63, 55], wr: [63, 38], kn2: [102, 102], an2: [132, 105], toe2: [140, 107], el2: [59, 89], wr2: [59, 106], extra: arrow('M76 104 Q96 72 78 42 M86 46 L78 42 L77 51') },
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
    { label: '1 · Sit tall, both knees dropped to your left (front view)', flat: true, hl: ['thigh', 'shin'], head: [100, 78], sh: [100, 92], hip: [100, 124], kn: [66, 118], an: [92, 128], toe: [98, 128], el: [90, 110], wr: [86, 126], kn2: [74, 104], an2: [48, 124], toe2: [42, 128], el2: [110, 110], wr2: [114, 126], extra: arrow('M74 64 Q100 44 126 64 M118 64 L126 64 L123 55') },
    { label: '2 · Lift and swing both knees across to your right (front view)', flat: true, hl: ['thigh', 'shin'], head: [100, 78], sh: [100, 92], hip: [100, 124], kn: [134, 118], an: [108, 128], toe: [102, 128], el: [110, 110], wr: [114, 126], kn2: [126, 104], an2: [152, 124], toe2: [158, 128], el2: [90, 110], wr2: [86, 126], extra: arrow('M126 64 Q100 44 74 64 M82 64 L74 64 L77 55') },
  ],
  wrists: [
    { label: '1 · Hands and knees, palms down, fingers point back', hl: ['farm'], head: [97, 90], sh: [82, 94], hip: [50, 94], kn: [50, 126], an: [22, 128], toe: [14, 128], el: [82, 111], wr: [82, 128], extra: arrow('M82 128 L66 128') },
    { label: '2 · Rock hips back gently; repeat with the backs of your hands down', hl: ['farm'], head: [83, 92], sh: [68, 94], hip: [36, 98], kn: [50, 126], an: [22, 128], toe: [14, 128], el: [74, 112], wr: [82, 128], extra: arrow('M66 128 L82 128') + arrow('M110 78 L94 78 M100 72 L94 78 L100 84') },
  ],
  monster: [
    { label: '1 · Half squat, band around your knees, feet hip-width (front view)', flat: true, hl: ['thigh'], head: [100, 34], sh: [100, 48], hip: [100, 80], kn: [86, 104], an: [82, 128], toe: [76, 128], el: [88, 64], wr: [97, 58], kn2: [114, 104], an2: [118, 128], toe2: [124, 128], el2: [112, 64], wr2: [103, 58], extra: bandLine('M86 104 L114 104') },
    { label: '2 · Step sideways with the right foot, keep the band tight', flat: true, hl: ['thigh'], head: [100, 34], sh: [100, 48], hip: [100, 80], kn: [90, 104], an: [86, 128], toe: [80, 128], el: [88, 64], wr: [97, 58], kn2: [128, 104], an2: [142, 128], toe2: [148, 128], el2: [112, 64], wr2: [103, 58], extra: bandLine('M90 104 L128 104') + arrow('M156 118 L178 118 M172 112 L178 118 L172 124') },
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
