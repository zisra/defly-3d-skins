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
