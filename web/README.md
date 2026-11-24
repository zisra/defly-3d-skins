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
- **Demo** (`D`): the flight demo, below.
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

### Flight demo

The **Demo** button plays a two-minute show, rendered live, starring every
skin. It lives in `src/demo/` and is only downloaded when the button is
pressed (its own chunk), so the viewer stays as light as before.

1. **Lights out** - a night arena; the grid lights up and every skin lies
   flat on its pad, like a sprite sheet on the floor.
2. **Roll call** - a scan beam sweeps each sprite and the 3D craft swells up
   behind it, spins up and lifts off (1 and 2 slowly, a montage, then the
   image skins).
3. **Paint shop** - the fleet circles while a wave of the 12 team colours
   runs round it.
4. **Formation** - arrowhead, diamond, a low pass and a bomb burst, with
   team-coloured smoke.
5. **Solo display** - a loop, a barrel roll and a head-on crossing pass.
6. **Dogfight** - Orange against Blue, with tracers from the real gun muzzles.
7. **Dawn** - everyone lands on their pad; seen from straight above the
   fleet is the sprite sheet again, and a wipe swaps 3D for the flat sprites.

Controls: `Esc` or ✕ leaves (back to where you were), `Space` pauses, `M`
mutes (remembered). The sound is synthesized in the browser; there are no
audio files. Phones and slow devices get lighter settings (no bloom or
shadows, lower resolution).

How it's built:

- `fleet.js` builds every skin once per visit, each with its own material
  set so each craft can carry its own team colour; it also holds the scan
  "rise" effect and the rotor parking (rotors spin down to their built angle,
  which is how the sprites draw them).
- `show.js` is the whole choreography: a fixed-step, seeded simulation (the
  same show every time), the camera shot list and the captions.
- `flight.js` steers each craft towards targets and turns its motion into
  banking and pitch; stunts follow scripted paths. Craft keep clear of each
  other by a look-ahead separation.
- `world.js` (sky, grid floor, pads, lights, dawn), `fx.js` (trails, tracers,
  sparks, scan beam), `camera.js`, `audio.js`, `ui.js`.

Testing (with `npm run dev` running):

```sh
node scripts/demo-shots.mjs http://localhost:5173/ shots 1280x720 9 60 104   # frames at those seconds
node scripts/demo-sim-check.mjs      # spacing between craft over the whole show
node scripts/demo-flow-check.mjs .   # start, pause, leave, return, replay
```

`?demo` in the URL starts the show on load (muted until you click);
`?demo=73` jumps to 73 s.
