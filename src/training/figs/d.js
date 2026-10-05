// Figures: conditioning, hamstring, calf and foot stretches. See src/training/figures.js for the format.
import { bell, down, up, arrow, block, bandLine } from './helpers.js'

const W = '0 36 200 100'
const WALL = block(150, 14, 14, 116)

export const FIGS_D = {
  attack: [
    { label: '1 · Stand tall, weights at your sides', hl: ['thigh'], head: [100, 20], sh: [100, 34], hip: [100, 66], kn: [101, 98], an: [100, 128], toe: [112, 128], el: [101, 51], wr: [101, 68], kn2: [98, 98], an2: [94, 128], toe2: [106, 128], extra: bell(101, 76) },
    { label: '2 · Hinge, knees bent, back flat, hold', hl: ['thigh', 'torso'], head: [105, 67], sh: [96, 74], hip: [73, 96], kn: [104, 99], an: [96, 128], toe: [108, 128], el: [98, 91], wr: [99, 108], kn2: [105, 100], an2: [100, 128], toe2: [112, 128], extra: bell(99, 115) },
  ],
  burpee: [
    { label: '1 · Plank, chest to the floor, then push up', vb: W, hl: ['torso'], head: [141, 89], sh: [130, 92], hip: [100, 103], kn: [70, 114], an: [42, 124], toe: [38, 130], el: [131, 110], wr: [131, 128], kn2: [73, 115], an2: [45, 125], toe2: [41, 130] },
    { label: '2 · Jump your feet in to your hands', vb: '30 56 110 76', hl: ['thigh', 'shin'], head: [114, 91], sh: [104, 98], hip: [74, 88], kn: [104, 100], an: [94, 128], toe: [106, 128], el: [112, 113], wr: [118, 128], kn2: [101, 101], an2: [90, 128], toe2: [102, 128], el2: [114, 113], wr2: [122, 128], extra: arrow('M46 118 L64 118 M58 113 L64 118 L58 123') },
    { label: '3 · Stand and jump, hands overhead', vb: '14 -14 172 150', hl: ['thigh'], head: [99, 13], sh: [100, 28], hip: [100, 60], kn: [103, 92], an: [97, 121], toe: [106, 126], el: [108, 13], wr: [108, -4], kn2: [100, 92], an2: [92, 120], toe2: [102, 125], extra: up(150, 62, 104) },
  ],
  climbers: [
    { label: '1 · High plank, hands under shoulders', vb: W, hl: ['torso', 'uarm'], head: [141, 89], sh: [130, 92], hip: [100, 103], kn: [70, 114], an: [42, 124], toe: [38, 130], el: [131, 110], wr: [131, 128], kn2: [72, 116], an2: [46, 125], toe2: [41, 130] },
    { label: '2 · Drive one knee toward your chest, then switch', vb: W, hl: ['thigh', 'torso'], head: [141, 89], sh: [130, 92], hip: [100, 103], kn: [128, 104], an: [110, 127], toe: [104, 130], el: [131, 110], wr: [131, 128], kn2: [70, 114], an2: [42, 124], toe2: [38, 130] },
  ],
  hamstrap: [
    { label: '1 · Lie back, band round the foot, raise the leg straight', vb: W, hl: ['thigh', 'shin'], head: [29, 123], sh: [40, 126], hip: [72, 126], kn: [80, 95], an: [87, 66], toe: [96, 64], el: [49, 111], wr: [56, 96], kn2: [104, 127], an2: [134, 127], toe2: [137, 118], extra: bandLine('M96 65 L56 96') },
    { label: '2 · Draw it closer, keep the knee straight', vb: W, hl: ['thigh', 'shin'], head: [29, 123], sh: [40, 126], hip: [72, 126], kn: [64, 95], an: [58, 66], toe: [67, 63], el: [44, 112], wr: [50, 98], kn2: [104, 127], an2: [134, 127], toe2: [137, 118], extra: bandLine('M67 64 L50 98') + arrow('M92 96 Q96 82 84 68 M89 70 L84 68 L84 77') },
  ],
  seatedham: [
    { label: '1 · Sit tall, one leg straight, other foot to inner thigh', vb: W, hl: ['thigh', 'shin'], head: [61, 80], sh: [60, 94], hip: [60, 126], kn: [92, 127], an: [122, 128], toe: [128, 118], el: [70, 109], wr: [84, 120], kn2: [76, 110], an2: [90, 127] },
    { label: '2 · Hinge forward from the hips, reach for your foot', vb: W, hl: ['thigh', 'shin'], head: [101, 106], sh: [89, 112], hip: [60, 126], kn: [92, 127], an: [122, 128], toe: [128, 118], el: [105, 119], wr: [118, 125], kn2: [78, 119], an2: [90, 127], extra: arrow('M70 84 Q92 74 114 86 M107 80 L114 86 L105 90') },
  ],
  calfwall: [
    { label: '1 · Hands on the wall, back leg straight and heel down', hl: ['shin'], head: [129, 34], sh: [124, 44], hip: [109, 72], kn: [94, 100], an: [80, 127], toe: [92, 128], el: [136, 56], wr: [149, 46], kn2: [120, 99], an2: [122, 128], toe2: [134, 128], extra: WALL },
    { label: '2 · Bend the front knee and lean in, back heel pressed down', hl: ['shin'], head: [128, 41], sh: [122, 50], hip: [104, 77], kn: [87, 103], an: [70, 127], toe: [82, 128], el: [136, 58], wr: [149, 52], kn2: [124, 100], an2: [116, 128], toe2: [128, 128], extra: WALL + arrow('M88 50 L108 50 M102 45 L108 50 L102 55') },
  ],
  soleus: [
    { label: '1 · Start like the straight-knee stretch', hl: ['shin'], head: [128, 41], sh: [122, 50], hip: [104, 77], kn: [87, 103], an: [70, 127], toe: [82, 128], el: [136, 58], wr: [149, 52], kn2: [124, 100], an2: [116, 128], toe2: [128, 128], extra: WALL },
    { label: '2 · Bend the back knee too, heel stays down', hl: ['shin'], head: [126, 40], sh: [120, 51], hip: [100, 77], kn: [118, 101], an: [102, 127], toe: [114, 128], el: [136, 58], wr: [149, 52], kn2: [124, 100], an2: [132, 128], toe2: [144, 128], extra: WALL + arrow('M86 108 L106 108 M99 103 L106 108 L99 113') },
  ],
  footroll: [
    { label: '1 · Seated, ball under your heel', hl: ['shin'], head: [83, 46], sh: [82, 60], hip: [82, 92], kn: [112, 92], an: [108, 120], toe: [124, 127], el: [90, 73], wr: [104, 84], kn2: [112, 94], an2: [110, 126], toe2: [124, 128], extra: block(66, 96, 32, 4) + block(68, 100, 4, 30) + block(92, 100, 4, 30) + bell(106, 126, 4) },
    { label: '2 · Roll slowly forward to the ball of the foot', hl: ['shin'], head: [83, 46], sh: [82, 60], hip: [82, 92], kn: [112, 92], an: [110, 122], toe: [126, 121], el: [90, 73], wr: [104, 84], kn2: [112, 94], an2: [110, 126], toe2: [124, 128], extra: block(66, 96, 32, 4) + block(68, 100, 4, 30) + block(92, 100, 4, 30) + bell(124, 126, 4) + arrow('M114 108 L136 108 M130 103 L136 108 L130 113') },
  ],
  toestretch: [
    { label: '1 · Kneel, toes tucked under, hands on your thighs', hl: ['shin'], head: [73, 50], sh: [72, 64], hip: [72, 96], kn: [72, 128], an: [44, 113], toe: [40, 128], el: [78, 80], wr: [74, 96] },
    { label: '2 · Sit back toward your heels, hands on the floor', hl: ['shin'], head: [92, 90], sh: [80, 96], hip: [50, 106], kn: [72, 128], an: [44, 113], toe: [40, 128], el: [88, 111], wr: [94, 127], extra: arrow('M72 84 L46 84 M53 79 L46 84 L53 89') },
  ],
}
