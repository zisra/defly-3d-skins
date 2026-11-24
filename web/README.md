# Skin Hangar

3D versions of the skins in `sprite_kit.svg`, shown in a small web viewer
with team-colour tinting.

```sh
npm install
npm run dev       # http://localhost:5173
npm run build     # static site in dist/, can be hosted from any folder
```

### Deploying to Cloudflare Workers

The site is served by a static-assets Worker (no server code), configured in
`wrangler.jsonc`; cache rules are in `public/_headers` (hashed build files
are cached for a year, skin data for a day).

```sh
npx wrangler login    # once, opens the browser
npm run deploy        # builds dist/ and uploads it; prints the *.workers.dev URL
npm run preview:cf    # optional: serve the build locally in Cloudflare's runtime
```

Change `"name"` in `wrangler.jsonc` to pick the Worker's name (and URL). A
custom domain can be attached in the Cloudflare dashboard under the Worker's
Settings → Domains & Routes.

- **Paint**: the game's 12 team colours (`colors2`, in the game's order).
- **Style**: Matte (realistic, muted), Sprite (flat cel shading, matches the 2D
  colours exactly from above) or Glossy (shiny toy). Same model, different materials.
- **3D / Top**: Top looks straight down through a near-orthographic lens, so
  the model lines up with the sprite.
- **Compare** (`C`): Top view with the original sprite laid over the render;
  drag the handle to wipe between them.
- **Spin / Turntable**: rotors and the slow auto-rotate.
- Keys: left and right arrows switch skins, `T` toggles the Top view.
- URL options: `?skin=1&colour=red&style=sprite&view=top&compare=50`.

- **Spin** also switches layers marked moving-only / idle-only in image skins.

Skins 1–15 come from `sprite_kit.svg`: skin 1 (Gunship) is hand-tuned in
`src/skins/skin01.js`; 2–15 are built from their vector sprites by
`src/skins/auto.js`.

Skins 17, 19, 28, 55 and 99 are in the game's own skin format (JSON with PNG
layers, in `public/skins-json/`) and are built by `src/skins/image.js`. To add
one, drop its file into `public/skins-json/` and add a line to
`src/skins/index.js`: `{ no: 42, name: 'Name', file: 'skins-json/42.json', recipe: image() }`.

See `src/skins/README.md` for how the builders work.
