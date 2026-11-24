// Team colours, taken from the colour dots in sprite_kit.svg.
// Every skin is drawn in `body` with `trim` outlines; tinting swaps both.
export const TEAM_COLORS = [ // the game's colors2, in its order
  { name: 'Blue', body: '#3d5dff', trim: '#0a2fee' },
  { name: 'Red', body: '#fd3535', trim: '#ce0202' },
  { name: 'Forest', body: '#008037', trim: '#005f29' },
  { name: 'Orange', body: '#ff8a2a', trim: '#ab4d00' },
  { name: 'Purple', body: '#924bff', trim: '#5a00e4' },
  { name: 'Aqua', body: '#55d5ff', trim: '#00a3d7' },
  { name: 'Green', body: '#18e21f', trim: '#0f9214' },
  { name: 'Magenta', body: '#f659ff', trim: '#c900d6' },
  { name: 'Yellow', body: '#f7ff2a', trim: '#afb500' },
  { name: 'Pink', body: '#ff5fae', trim: '#e20070' },
  { name: 'Lime', body: '#93fe00', trim: '#6dbd00' },
  { name: 'Mint', body: '#00ffbc', trim: '#00bb8a' },
];

// Colours the source SVGs are drawn in (not a team colour); used to tint the 2D thumbnails.
export const SOURCE_BODY = '#00b2e1';
export const SOURCE_TRIM = '#0088ac';

// For a custom colour, derive the outline the same way the team pairs do:
// same hue, full-ish saturation, about two thirds of the lightness.
export function deriveTrim(hex) {
  const { h, s, l } = hexToHsl(hex);
  return hslToHex(h, Math.max(s, Math.min(1, s * 1.15)), l * 0.66);
}

export function hexToHsl(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h / 6, s, l };
}

export function hslToHex(h, s, l) {
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
