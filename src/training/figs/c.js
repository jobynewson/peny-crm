// Figures: pulls, core and carries. See src/training/figures.js for the format.
import { bell, down, up, arrow, weight, bandLine, block } from './helpers.js'

// Standing legs shared by several frames.
const LEGS = { kn: [101, 98], an: [100, 128], toe: [112, 128], kn2: [98, 98], an2: [94, 128], toe2: [106, 128] }
// Walking legs (near leg forward).
const STEP = { kn: [112, 97], an: [110, 127], toe: [122, 128], kn2: [92, 98], an2: [82, 124], toe2: [91, 128] }
const post = (x, y1, y2) => block(x, y1, 6, y2 - y1)

// High plank over two dumbbells (hands at y=122 on top of the bells).
const PLANK = { head: [130, 83], sh: [117, 88], hip: [87, 100], kn: [58, 112], an: [30, 124], toe: [26, 128], el: [117, 105], wr: [117, 122] }

export const FIGS_C = {
  renegade: [
    { label: '1 · High plank, hands on the dumbbells, feet wide', hl: ['torso'], ...PLANK, extra: weight(117, 125) },
    { label: '2 · Row one bell to your hip, hips stay square', hl: ['uarm', 'farm', 'torso'], ...PLANK, el2: [101, 87], wr2: [103, 103], extra: weight(117, 125) + weight(103, 107) + up(80, 74, 94) },
  ],
  facepull: [
    { label: '1 · Arms out straight, band tight', hl: ['uarm'], head: [100, 20], sh: [100, 34], hip: [100, 66], ...LEGS, el: [117, 35], wr: [134, 36], extra: post(184, 20, 50) + bandLine('M134 36 L184 34') },
    { label: '2 · Pull to your eyes, elbows high and wide', hl: ['uarm', 'farm'], head: [100, 20], sh: [100, 34], hip: [100, 66], ...LEGS, el: [86, 34], wr: [102, 27], extra: post(184, 20, 50) + bandLine('M102 27 L184 34') + arrow('M150 54 L118 54 M124 49 L118 54 L124 59') },
  ],
  highpull: [
    { label: '1 · Hinge, arms long, bell between your shins', hl: ['thigh'], head: [106, 56], sh: [96, 65], hip: [74, 88], kn: [104, 99], an: [100, 128], toe: [112, 128], el: [101, 82], wr: [106, 98], kn2: [100, 99], an2: [96, 128], toe2: [108, 128], extra: bell(108, 106) },
    { label: '2 · Drive your hips, pull elbows high', hl: ['uarm', 'torso'], head: [100, 20], sh: [100, 34], hip: [100, 66], ...LEGS, el: [116, 30], wr: [111, 46], extra: bell(109, 53) + up(152, 40, 100) },
  ],
  deadbug: [
    { label: '1 · Arms up, knees over hips, back flat', hl: ['torso'], head: [32, 121], sh: [46, 127], hip: [78, 127], kn: [78, 95], an: [108, 95], toe: [114, 95], el: [46, 110], wr: [46, 93], kn2: [82, 96], an2: [112, 96], toe2: [118, 96], el2: [50, 110], wr2: [50, 93] },
    { label: '2 · Lower opposite arm and leg, back stays flat', hl: ['torso'], head: [32, 121], sh: [46, 127], hip: [78, 127], kn: [78, 95], an: [108, 95], toe: [114, 95], el: [37, 112], wr: [28, 97], kn2: [110, 123], an2: [140, 119], toe2: [146, 118], el2: [50, 110], wr2: [50, 93], extra: arrow('M20 88 Q10 100 22 112 M22 104 L22 112 L14 110') },
  ],
  pallof: [
    { label: '1 · Hands at chest, band pulls you sideways', hl: ['torso'], head: [100, 20], sh: [100, 34], hip: [100, 66], ...LEGS, el: [106, 50], wr: [120, 42], extra: post(34, 30, 130) + bandLine('M120 42 L40 46') },
    { label: '2 · Press straight out and hold, do not twist', hl: ['torso', 'uarm', 'farm'], head: [100, 20], sh: [100, 34], hip: [100, 66], ...LEGS, el: [117, 35], wr: [134, 37], extra: post(34, 30, 130) + bandLine('M134 37 L40 46') + arrow('M146 48 L166 48 M160 43 L166 48 L160 53') },
  ],
  sideplank: [
    { label: '1 · Elbow under shoulder, hips high, body straight', hl: ['torso', 'thigh'], head: [137, 107], sh: [123, 111], hip: [91, 116], kn: [60, 121], an: [30, 125], toe: [37, 128], el: [123, 127], wr: [134, 128], el2: [123, 94], wr2: [123, 77], extra: up(91, 82, 104) },
    { label: '2 · Easier: knees bent on the floor', hl: ['torso', 'thigh'], head: [131, 107], sh: [117, 111], hip: [86, 119], kn: [55, 127], an: [25, 127], toe: [19, 127], el: [117, 127], wr: [128, 128], el2: [117, 94], wr2: [117, 77], extra: up(86, 86, 108) },
  ],
  hollow: [
    { label: '1 · Lower back down, shoulders and legs lifted', hl: ['torso'], head: [40, 106], sh: [50, 116], hip: [80, 127], kn: [111, 121], an: [140, 115], toe: [146, 112], el: [34, 113], wr: [18, 110] },
    { label: '2 · Easier: knees bent, arms by your sides', hl: ['torso'], head: [40, 106], sh: [50, 116], hip: [80, 127], kn: [98, 101], an: [126, 112], toe: [132, 112], el: [66, 112], wr: [82, 108] },
  ],
  birddog: [
    { label: '1 · Hands under shoulders, knees under hips', hl: ['torso'], head: [134, 91], sh: [120, 95], hip: [88, 95], kn: [88, 127], an: [58, 127], toe: [52, 127], el: [120, 111], wr: [120, 128], kn2: [92, 127], an2: [62, 127], toe2: [56, 127], el2: [123, 111], wr2: [123, 128] },
    { label: '2 · Reach opposite arm and leg, hips level', hl: ['torso', 'uarm', 'farm'], head: [134, 91], sh: [120, 95], hip: [88, 95], kn: [88, 127], an: [58, 127], toe: [52, 127], el: [137, 94], wr: [154, 94], kn2: [56, 95], an2: [26, 95], toe2: [24, 100], el2: [120, 111], wr2: [120, 128] },
  ],
  plankdrag: [
    { label: '1 · High plank, weight beside one hand', hl: ['torso'], head: [130, 83], sh: [119, 94], hip: [89, 104], kn: [58, 114], an: [30, 124], toe: [26, 128], el: [119, 111], wr: [119, 128], extra: bell(142, 121) },
    { label: '2 · Drag it across under you, hips stay level', hl: ['torso', 'uarm', 'farm'], head: [130, 83], sh: [119, 94], hip: [89, 104], kn: [58, 114], an: [30, 124], toe: [26, 128], el: [119, 111], wr: [119, 128], el2: [111, 109], wr2: [100, 122], extra: bell(100, 121, 6) + arrow('M148 116 L130 116 M136 111 L130 116 L136 121') },
  ],
  chop: [
    { label: '1 · Kneel side-on, hands up by the anchor', hl: ['torso', 'uarm'], head: [88, 50], sh: [88, 64], hip: [88, 96], kn: [88, 126], an: [58, 127], toe: [52, 127], kn2: [120, 96], an2: [120, 126], toe2: [132, 127], el: [80, 52], wr: [72, 40], extra: post(36, 14, 30) + bandLine('M72 40 L42 22') },
    { label: '2 · Pull diagonally down, turn from your torso', hl: ['torso', 'uarm', 'farm'], head: [90, 50], sh: [88, 64], hip: [88, 96], kn: [88, 126], an: [58, 127], toe: [52, 127], kn2: [120, 96], an2: [120, 126], toe2: [132, 127], el: [102, 73], wr: [112, 88], extra: post(36, 14, 30) + bandLine('M112 88 L42 22') + arrow('M130 52 L146 76 M146 68 L146 76 L138 74') },
  ],
  farmer: [
    { label: '1 · Stand tall, a heavy bell in each hand', hl: ['farm', 'torso'], head: [100, 20], sh: [100, 34], hip: [100, 66], ...LEGS, el: [100, 51], wr: [100, 68], el2: [96, 51], wr2: [96, 68], extra: bell(96, 76) + bell(103, 76) },
    { label: '2 · Walk with short steps, no swinging', hl: ['farm', 'torso'], head: [100, 20], sh: [100, 34], hip: [100, 66], ...STEP, el: [101, 51], wr: [101, 68], el2: [97, 51], wr2: [97, 68], extra: bell(97, 76) + bell(104, 76) + arrow('M122 22 L150 22 M144 17 L150 22 L144 27') },
  ],
  suitcase: [
    { label: '1 · Bell in one hand, stand tall and level', hl: ['farm', 'torso'], head: [100, 20], sh: [100, 34], hip: [100, 66], ...LEGS, el: [100, 51], wr: [100, 68], el2: [104, 50], wr2: [108, 66], extra: bell(100, 76) },
    { label: '2 · Walk slowly without leaning to the bell', hl: ['farm', 'torso'], head: [100, 20], sh: [100, 34], hip: [100, 66], ...STEP, el: [101, 51], wr: [101, 68], el2: [105, 50], wr2: [109, 66], extra: bell(101, 76) + arrow('M122 22 L150 22 M144 17 L150 22 L144 27') },
  ],
  bottomsup: [
    { label: '1 · Bell upside down, elbow bent, wrist straight', hl: ['farm'], head: [100, 20], sh: [100, 34], hip: [100, 66], ...LEGS, el: [113, 47], wr: [113, 30], extra: bell(113, 22) },
    { label: '2 · Squeeze hard so the bell does not tip', vb: '60 4 100 75', hl: ['farm'], head: [100, 20], sh: [100, 34], hip: [100, 66], ...LEGS, el: [113, 47], wr: [113, 30], extra: bell(113, 22) + arrow('M101 12 Q104 6 110 6') + arrow('M125 12 Q122 6 116 6') },
  ],
  pinch: [
    { label: '1 · Grip one end of the dumbbell, hold at your side', hl: ['farm'], head: [100, 20], sh: [100, 34], hip: [100, 66], ...LEGS, el: [106, 50], wr: [110, 66], extra: block(104, 67, 12, 5) + block(109, 72, 3, 16) + block(104, 88, 12, 8) },
    { label: '2 · Fingers one side, thumb the other, squeeze', vb: '60 10 100 100', hl: ['farm'], head: [100, 20], sh: [100, 34], hip: [100, 66], ...LEGS, el: [106, 50], wr: [110, 66], extra: block(104, 67, 12, 5) + block(109, 72, 3, 16) + block(104, 88, 12, 8) + arrow('M98 70 L104 70 M101 67 L104 70 L101 73') + arrow('M122 70 L116 70 M119 67 L116 70 L119 73') },
  ],
}
