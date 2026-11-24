import { SOURCE_BODY, SOURCE_TRIM } from './palette.js';

// Flat 2D sprites in a team colour.

// SVG skins tint by swapping their source colours in the file text.
export const tintSvg = (text, c) => text
  .replace(new RegExp(SOURCE_BODY, 'gi'), c.body)
  .replace(new RegExp(SOURCE_TRIM, 'gi'), c.trim);
export const svgUrl = (text) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;

// The sprite of a loaded skin (SkinSvg or ImageSkin) as an image URL covering
// its viewBox. mapping 'trim' colours image skins the way their 3D models are
// painted (line shade -> trim, fill -> body); 'multiply' is the game's tint.
export function spriteUrl(source, colour, { mapping = 'multiply' } = {}) {
  return source.text ? svgUrl(tintSvg(source.text, colour)) : source.render(colour, { mapping });
}
