// Figures: hinges, jumps, pushes and rows. See src/training/figures.js for the format.
import { arrow, bandLine, bell, block, down, up, weight } from './helpers.js'

const J = '14 -22 172 152'

export const FIGS_B = {
  pushup: [
    { label: '1 · Straight arms, body like a plank', hl: ['uarm'], head: [146, 78], sh: [132, 88], hip: [80, 106], kn: [55, 115], an: [30, 124], toe: [24, 128], el: [133, 108], wr: [134, 128], el2: [126, 108], wr2: [126, 128] },
    { label: '2 · Lower the chest, elbows about 45°', hl: ['uarm'], head: [146, 108], sh: [130, 114], hip: [80, 119], kn: [55, 121], an: [30, 124], toe: [24, 128], el: [112, 106], wr: [134, 128], el2: [106, 110], wr2: [126, 128], extra: down(166, 76, 106) },
  ],

  swing: [
    { label: '1 · Hike the bell back between your legs', hl: ['thigh'], head: [107, 55], sh: [98, 66], hip: [74, 82], kn: [100, 102], an: [96, 128], toe: [108, 128], el: [100, 80], wr: [96, 94], kn2: [96, 102], an2: [90, 128], toe2: [102, 128], extra: bell(86, 100, 7) + arrow('M60 96 L46 96 M52 90 L46 96 L52 102') },
    { label: '2 · Snap the hips, bell floats to chest height', hl: ['thigh'], head: [100, 20], sh: [100, 34], hip: [100, 66], kn: [101, 98], an: [100, 128], toe: [112, 128], el: [117, 36], wr: [134, 38], kn2: [98, 98], an2: [94, 128], toe2: [106, 128], extra: bell(142, 42, 8) + arrow('M120 100 L156 100 M149 94 L156 100 L149 106') },
  ],
  rdl: [
    { label: '1 · Stand tall, weights at your thighs', hl: ['thigh'], head: [100, 20], sh: [100, 34], hip: [100, 66], kn: [101, 98], an: [100, 128], toe: [112, 128], el: [101, 51], wr: [102, 68], kn2: [98, 98], an2: [94, 128], toe2: [106, 128], extra: weight(103, 72) },
    { label: '2 · Hips back, flat back, weights slide down your legs', hl: ['thigh'], head: [112, 58], sh: [99, 64], hip: [68, 72], kn: [84, 100], an: [88, 128], toe: [100, 128], el: [100, 81], wr: [101, 98], kn2: [82, 100], an2: [84, 128], toe2: [96, 128], extra: weight(102, 102) + arrow('M60 56 L44 56 M50 50 L44 56 L50 62') },
  ],
  slrdl: [
    { label: '1 · Stand on one leg, weight in the opposite hand', hl: ['thigh'], head: [100, 20], sh: [100, 34], hip: [100, 66], kn: [101, 98], an: [100, 128], toe: [112, 128], el: [101, 51], wr: [102, 68], kn2: [98, 96], an2: [84, 114], toe2: [80, 120], extra: bell(103, 74, 6) },
    { label: '2 · Hinge, free leg straight back like a seesaw', hl: ['thigh'], head: [130, 63], sh: [116, 66], hip: [84, 70], kn: [88, 99], an: [88, 128], toe: [100, 128], el: [117, 83], wr: [118, 100], kn2: [52, 72], an2: [22, 74], toe2: [17, 82], extra: bell(118, 106, 6) + arrow('M50 52 L34 52 M40 46 L34 52 L40 58') },
  ],
  thrust: [
    { label: '1 · Upper back on the bench, weight on your hips', hl: ['thigh'], back: block(14, 100, 36, 30), head: [42, 86], sh: [52, 100], hip: [72, 124], kn: [94, 102], an: [112, 128], toe: [122, 128], el: [66, 114], wr: [78, 122], extra: bell(76, 116, 6) },
    { label: '2 · Drive your heels up until hips and shoulders line up', hl: ['thigh'], back: block(14, 98, 36, 32), head: [40, 86], sh: [50, 96], hip: [82, 97], kn: [112, 98], an: [112, 128], toe: [122, 128], el: [66, 94], wr: [82, 92], extra: bell(82, 89, 6) + up(98, 56, 84) },
  ],
  goodmorning: [
    { label: '1 · Stand on the band, loop across your upper back', hl: ['thigh'], head: [100, 20], sh: [100, 34], hip: [100, 66], kn: [101, 98], an: [100, 128], toe: [112, 128], el: [90, 46], wr: [98, 32], kn2: [98, 98], an2: [94, 128], toe2: [106, 128], extra: bandLine('M96 31 Q84 80 92 127') },
    { label: '2 · Hinge until your torso is nearly flat', hl: ['thigh'], head: [112, 58], sh: [99, 64], hip: [68, 72], kn: [84, 100], an: [88, 128], toe: [100, 128], el: [86, 72], wr: [97, 63], kn2: [82, 100], an2: [84, 128], toe2: [96, 128], extra: bandLine('M95 63 L89 127') + arrow('M60 56 L44 56 M50 50 L44 56 L50 62') },
  ],
  jumpsquat: [
    { label: '1 · Dip fast, swing your arms back', vb: J, hl: ['thigh'], head: [100, 49], sh: [94, 62], hip: [80, 90], kn: [110, 98], an: [98, 128], toe: [110, 128], el: [80, 68], wr: [66, 74], kn2: [108, 98], an2: [94, 128], toe2: [106, 128] },
    { label: '2 · Explode up, arms overhead', vb: J, hl: ['thigh'], head: [100, 4], sh: [100, 18], hip: [100, 50], kn: [101, 82], an: [100, 112], toe: [106, 120], el: [108, 3], wr: [114, -12], kn2: [99, 82], an2: [96, 112], toe2: [102, 120], extra: up(150, 20, 76) },
  ],
  broadjump: [
    { label: '1 · Arms back, hinge and bend your knees', hl: ['thigh'], head: [107, 55], sh: [98, 66], hip: [78, 90], kn: [108, 100], an: [98, 128], toe: [110, 128], el: [84, 72], wr: [70, 80], kn2: [106, 100], an2: [94, 128], toe2: [106, 128] },
    { label: '2 · Swing arms forward and jump out', hl: ['thigh'], head: [122, 30], sh: [114, 42], hip: [98, 68], kn: [76, 90], an: [60, 114], toe: [56, 122], el: [130, 40], wr: [146, 36], kn2: [80, 92], an2: [66, 116], toe2: [62, 124], extra: arrow('M110 100 L156 100 M149 94 L156 100 L149 106') },
    { label: '3 · Land on both feet, sink and hold', hl: ['thigh'], head: [100, 58], sh: [92, 72], hip: [78, 106], kn: [112, 100], an: [98, 128], toe: [112, 128], el: [108, 76], wr: [124, 80], kn2: [110, 100], an2: [94, 128], toe2: [108, 128], extra: down(150, 56, 100) },
  ],
  skater: [
    { label: '1 · Front view: sink on one leg, free foot trailing behind', flat: true, vb: '14 8 172 140', hl: ['thigh'], head: [84, 22], sh: [84, 36], hip: [84, 68], kn: [76, 97], an: [72, 128], toe: [66, 129], el: [72, 48], wr: [86, 56], kn2: [92, 98], an2: [112, 112], toe2: [118, 112], el2: [98, 46], wr2: [110, 40], extra: arrow('M84 140 L128 140 M121 134 L128 140 L121 146') },
    { label: '2 · Bound sideways, land softly on the other leg', flat: true, vb: '14 8 172 140', hl: ['thigh'], head: [124, 22], sh: [124, 36], hip: [124, 68], kn: [132, 97], an: [136, 128], toe: [142, 129], el: [112, 48], wr: [100, 40], el2: [138, 48], wr2: [126, 56], kn2: [116, 98], an2: [96, 112], toe2: [90, 112], extra: arrow('M84 140 L128 140 M121 134 L128 140 L121 146') },
  ],
  floorpress: [
    { label: '1 · Arms straight over your chest', hl: ['uarm'], head: [33, 123], sh: [46, 124], hip: [78, 124], kn: [98, 100], an: [112, 127], toe: [122, 128], el: [46, 107], wr: [46, 90], extra: bell(46, 84, 7) + down(74, 78, 106) },
    { label: '2 · Lower until your upper arms touch the floor', hl: ['uarm'], head: [33, 123], sh: [46, 124], hip: [78, 124], kn: [98, 100], an: [112, 127], toe: [122, 128], el: [56, 126], wr: [53, 109], extra: bell(53, 103, 7) + up(74, 78, 106) },
  ],
  hkpress: [
    { label: '1 · Half-kneeling, weight at your shoulder', hl: ['uarm'], back: block(64, 124, 28, 6), head: [78, 50], sh: [78, 64], hip: [78, 92], kn: [78, 124], an: [48, 127], toe: [42, 128], el: [85, 78], wr: [88, 63], kn2: [110, 98], an2: [108, 128], toe2: [120, 128], extra: bell(90, 57, 6) },
    { label: '2 · Press straight up, bicep by your ear', hl: ['uarm'], back: block(64, 124, 28, 6), head: [78, 50], sh: [78, 64], hip: [78, 92], kn: [78, 124], an: [48, 127], toe: [42, 128], el: [85, 47], wr: [86, 30], kn2: [110, 98], an2: [108, 128], toe2: [120, 128], extra: bell(86, 23, 6) + up(122, 22, 56) },
  ],
  bandpress: [
    { label: '1 · From above: hands at your chest, band across your back to the post', flat: true, vb: '14 36 172 88', hl: ['uarm'], back: block(18, 70, 12, 20), head: [108, 80], sh: [96, 56], hip: [96, 104], el: [98, 44], wr: [112, 58], extra: bandLine('M30 80 L88 80 M88 56 L88 104 M88 56 L112 58 M88 104 L112 102') + '<line class="fg-limb hl" x1="96" y1="104" x2="100" y2="114"/><line class="fg-limb hl" x1="100" y1="114" x2="112" y2="102"/>' },
    { label: '2 · Press both hands straight out (from above)', flat: true, vb: '14 36 172 88', hl: ['uarm'], back: block(18, 70, 12, 20), head: [108, 80], sh: [96, 56], hip: [96, 104], el: [112, 52], wr: [130, 56], extra: bandLine('M30 80 L88 80 M88 56 L88 104 M88 56 L130 56 M88 104 L130 104') + '<line class="fg-limb hl" x1="96" y1="104" x2="112" y2="108"/><line class="fg-limb hl" x1="112" y1="108" x2="130" y2="104"/>' + arrow('M138 80 L168 80 M161 74 L168 80 L161 86') },
  ],
  row: [
    { label: '1 · Flat back, arm hanging straight down', hl: ['uarm', 'farm'], back: block(30, 104, 72, 26), head: [120, 63], sh: [106, 66], hip: [74, 72], kn: [96, 100], an: [96, 128], toe: [108, 128], el: [114, 83], wr: [118, 100], kn2: [60, 100], an2: [32, 101], toe2: [26, 102], el2: [106, 86], wr2: [104, 104], extra: bell(118, 107, 7) },
    { label: '2 · Drive the elbow back, weight to your hip', hl: ['uarm', 'farm'], back: block(30, 104, 72, 26), head: [120, 63], sh: [106, 66], hip: [74, 72], kn: [96, 100], an: [96, 128], toe: [108, 128], el: [90, 62], wr: [96, 74], kn2: [60, 100], an2: [32, 101], toe2: [26, 102], el2: [106, 86], wr2: [104, 104], extra: bell(97, 80, 7) + up(144, 60, 92) },
  ],
  bandrow: [
    { label: '1 · Arms straight, band tight', hl: ['uarm'], back: block(166, 26, 6, 104), head: [100, 20], sh: [100, 34], hip: [100, 66], kn: [101, 98], an: [100, 128], toe: [112, 128], el: [117, 37], wr: [134, 40], kn2: [98, 98], an2: [94, 128], toe2: [106, 128], extra: bandLine('M134 40 L166 44') },
    { label: '2 · Pull your hands to your ribs, squeeze your shoulder blades', hl: ['uarm'], back: block(166, 26, 6, 104), head: [100, 20], sh: [100, 34], hip: [100, 66], kn: [101, 98], an: [100, 128], toe: [112, 128], el: [88, 46], wr: [104, 52], kn2: [98, 98], an2: [94, 128], toe2: [106, 128], extra: bandLine('M104 52 L166 44') + arrow('M146 70 L122 70 M129 64 L122 70 L129 76') },
  ],
}
