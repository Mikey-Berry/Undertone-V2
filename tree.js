// The streak is drawn as a tree planted by streams of water (Psalm 1:3).
// It grows through six stages as the streak lengthens.

const NAMES = [
  'A seed in the ground',
  'A sprout',
  'A sapling',
  'A young tree',
  'A full-grown tree',
  'A tree bearing fruit',
];
const NEXT = [1, 3, 7, 30, 100, null];

export function stageFor(streak) {
  if (streak >= 100) return 5;
  if (streak >= 30) return 4;
  if (streak >= 7) return 3;
  if (streak >= 3) return 2;
  if (streak >= 1) return 1;
  return 0;
}

export function stageCaption(streak) {
  const s = stageFor(streak);
  if (s === 0) return 'A seed in the ground. Read today and it sprouts.';
  const n = NEXT[s];
  if (!n) return 'A tree bearing fruit, like the one in Psalm 1:3.';
  return `${NAMES[s]}. It grows again at ${n} days.`;
}

const TRUNK = {
  2: { top: 128, w: 7 },
  3: { top: 104, w: 11 },
  4: { top: 86, w: 16 },
  5: { top: 86, w: 16 },
};

const CANOPY = {
  2: [[160, 118, 16], [146, 128, 11], [174, 128, 11]],
  3: [[160, 88, 28], [136, 101, 19], [184, 101, 19], [148, 74, 17], [172, 72, 17]],
  4: [[160, 66, 40], [124, 86, 28], [196, 86, 28], [138, 52, 26], [182, 50, 26], [160, 36, 22], [108, 104, 17], [212, 104, 17]],
};
CANOPY[5] = CANOPY[4];

const FRUIT = [[130, 88], [178, 62], [200, 94], [148, 50], [112, 104], [208, 110], [164, 82], [142, 72], [186, 40]];

const BRANCHES = {
  3: ['M160 128 C 152 116, 144 108, 138 102', 'M160 120 C 168 110, 176 104, 184 100'],
  4: ['M160 120 C 146 104, 132 94, 124 86', 'M160 112 C 176 98, 188 92, 196 86', 'M158 100 C 150 86, 144 70, 140 56', 'M162 98 C 170 84, 176 68, 180 54'],
};
BRANCHES[5] = BRANCHES[4];

function trunk(top, w) {
  const mid = (172 + top) / 2;
  return `<path class="bark" d="M${160 - w / 2} 174 C ${160 - w / 2} ${mid}, ${160 - w / 4} ${top + 12}, 160 ${top} C ${160 + w / 4} ${top + 12}, ${160 + w / 2} ${mid}, ${160 + w / 2} 174 Z"/>`;
}

export function treeSVG(streak, watered, grow) {
  const s = stageFor(streak);
  let plant = '';

  if (s === 0) {
    plant = `<ellipse class="earth" cx="160" cy="170" rx="18" ry="6"/><ellipse class="bark" cx="160" cy="166" rx="3.5" ry="2.4"/>`;
  } else if (s === 1) {
    plant = `<g class="canopy">
      <path d="M160 174 C 160 164, 158 156, 160 146" fill="none" stroke="var(--leaf-deep)" stroke-width="3" stroke-linecap="round"/>
      <ellipse class="leaf" cx="151" cy="150" rx="10" ry="4.5" transform="rotate(-28 151 150)"/>
      <ellipse class="leaf" cx="169" cy="146" rx="10" ry="4.5" transform="rotate(28 169 146)"/>
    </g>`;
  } else {
    const t = TRUNK[s];
    const branches = (BRANCHES[s] || [])
      .map((d) => `<path d="${d}" fill="none" stroke="var(--bark)" stroke-width="${s >= 4 ? 4 : 3}" stroke-linecap="round"/>`)
      .join('');
    const shade = CANOPY[s].map(([x, y, r]) => `<circle class="leaf-deep" cx="${x + 3}" cy="${y + 4}" r="${r}"/>`).join('');
    const leaves = CANOPY[s].map(([x, y, r]) => `<circle class="leaf" cx="${x}" cy="${y}" r="${r}"/>`).join('');
    const fruit = s === 5 ? FRUIT.map(([x, y]) => `<circle class="fruit" cx="${x}" cy="${y}" r="5"/>`).join('') : '';
    plant = `${trunk(t.top, t.w)}${branches}<g class="canopy">${shade}${leaves}${fruit}</g>`;
  }

  return `<svg class="tree ${watered ? 'watered' : 'thirsty'} ${grow ? 'grow' : ''}" viewBox="0 0 320 200" role="img" aria-label="${NAMES[s]}">
    <ellipse class="earth" cx="160" cy="176" rx="118" ry="10"/>
    ${plant}
    <path class="water" d="M0 184 Q 40 177 80 184 T 160 184 T 240 184 T 320 184 V 200 H 0 Z"/>
    <path class="water-line" d="M18 192 Q 50 187 82 192 T 146 192 M190 191 Q 222 186 254 191 T 306 191"/>
  </svg>`;
}
