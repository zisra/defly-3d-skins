# Skin Hangar

3D versions of the skins in `sprite_kit.svg`, shown in a small web viewer
with team-colour tinting.

```sh
npm install
npm run dev       # http://localhost:5173
npm run build     # static site in dist/, can be hosted from any folder
```

- **Paint**: the 13 team colours from the sprite sheet (each with its own
  outline colour), plus a custom colour picker that derives a matching outline.
- **Style**: Matte (realistic, muted), Sprite (flat cel shading, matches the 2D
  colours exactly from above) or Glossy (shiny toy). Same model, different materials.
- **3D / Top**: Top looks straight down through a near-orthographic lens, so
  the model lines up with the sprite.
- **Compare** (`C`): Top view with the original sprite laid over the render;
  drag the handle to wipe between them.
- **Spin / Turntable**: rotors and the slow auto-rotate.
- Keys: left and right arrows switch skins, `T` toggles the Top view.
- URL options: `?skin=1&colour=red&style=sprite&view=top&compare=50`.

All 15 skins are 3D. Skin 1 (Gunship) is hand-tuned in `src/skins/skin01.js`;
skins 2–15 are built automatically from their sprites by `src/skins/auto.js`.
See `src/skins/README.md` for how both work.
