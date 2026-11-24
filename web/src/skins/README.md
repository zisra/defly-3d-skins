# 3D skins

Every skin has a 2D sprite in `public/skins/skin_NN.svg` (extracted from
`sprite_kit.svg`) and a **recipe** that builds its 3D model, registered in
`src/skins/index.js`.

## The automatic builder (`auto.js`): skins 2–15

`autoRecipe(config)` reads the sprite in draw order and turns each element
into a smooth part with its stroke printed on, so the Top view matches the
sprite:

- **Team-colour shapes** are smooth "balloons" over their outline
  (`geometry/inflate.js`: an even mesh, heights from a Poisson solve, so the
  cross-section is round for any width and never wobbles). Parts much wider
  sideways than long (wings, stabilisers) are flattened. **Circles and
  ellipses** are built ring by ring: pods, hubs, caps, and big discs as rigid
  saucers with an upright rim. **Grey parts** are lofted flat blocks (guns,
  blades). A shape resting almost entirely on earlier parts becomes a low dome
  on them; grey ones that aren't round caps are glass canopies, and white ones
  are lights.
- **Holes** that a later shape covers completely (a socket under a canopy) are
  filled in; real openings (ducts) stay open.
- **Draw order is height**: each part is placed just above whatever it overlaps
  (tracked in a top-down heightfield), so later elements cover earlier ones as
  in 2D.
- **Lines** drawn across a part are printed on as thin strips. Free-standing
  lines become straight rods; rods that cross share one height, and rods
  inside a guard ring sit at the ring's height. Stroke-only loops (propeller
  guards) become rings.
- **Main rotors** are found automatically: any group of grey blade rects plus a
  hub circle. They're built last, above everything, with a mast and blur disc,
  and they spin. Rotor craft get landing skids, propeller craft get legs
  under their motor pods, and a forward gun gets a muzzle opening.
- **Propellers** need config naming their group and hubs, e.g.
  `{ props: [{ group: 'g7296', pivots: ['ellipse7282', ...] }] }`, or
  `pivotSubpaths: 'id'` when one element's sub-paths are the hubs.
  `skids: false` drops the skids.

`skin11.js` uses the builder plus a hand-made `extras` joint. Skin 01 is entirely hand-built. See the
config options at the top of `auto.js`.

Check any skin with `npm run shots` (dev server running), e.g.
`node scripts/screenshot.mjs http://localhost:5173/ shots "skin=7" "skin=7&view=top&compare=0&style=sprite"`.

## Recipe contract

```js
export default {
  pivot: 'rect1234', // id of the sprite's invisible export frame; its centre becomes the origin
  build({ svg, mats }) {
    const root = new THREE.Group();
    // ... add meshes ...
    return {
      object: root,
      update(dt, time, state) {}, // optional; state.spin is the Spin toggle
    };
  },
};
```

### Coordinates

`svg` returns points in SVG units, centred on the pivot. Map them as
**svg x → 3D x** (the nose points +x), **svg y → 3D z**, and build height on
**3D y**. The Top view then shows the model exactly as the sprite is drawn.

### What `svg` gives you (`src/geometry/svg.js`)

Open the skin's SVG and find the element ids of its parts.

| call | returns |
| --- | --- |
| `svg.outline(id)` / `svg.outlines(id)` | closed outline(s), evenly sampled |
| `svg.shapes(id)` | filled `THREE.Shape`s (with holes) |
| `svg.box(id)`, `svg.center(id)` | bounds and centre |
| `svg.segment(id)` | end points of a stroked line (e.g. a spoke) |
| `svg.strokeWidth(id)` | the outline width, useful for seams |

### Matching the sprite from above (see `skin01.js`)

The Top view should look like the sprite. `skin01.js` shows the method:

- **Printed outlines.** Sprite strokes are centred on the path. Build each
  visible part as one smooth shape from the outline grown by half the stroke
  (`offsetOutline(poly, -sw / 2)`), then `edgeBand(geometry, thatOutline, sw)`
  and a `paint` / `paintMetal` / `paintGlass` material print the stroke as a
  darker band on the surface. From above it lands exactly where the sprite's
  stroke is; from the side it reads as a painted ring. `printedLoft()` and
  `greyBlock()` in `skin01.js` wrap this.
- **Draw order = height.** Parts drawn later in the SVG must sit higher, so
  they cover earlier parts where they overlap. For example, the gun is drawn
  first, so it sits under the nose and only its tip shows.
- **Invented parts** (skids, windows, sensors) go where they can't be seen from
  above: under the body or below its widest line.
- Check with **Compare** (Top view, sprite overlaid at the same scale) in the
  Sprite style, which uses flat lighting. Its colours match the SVG exactly.

### Building blocks (`src/geometry/shapes.js`)

- `loftOutline(outline, { y0, top, bottom })` turns a top-view outline into a
  rounded body whose top view is that outline. Its geometry has two groups, so
  `mesh(loft.geometry, [mats.body, mats.trim])` paints the top in team colour
  and the belly in trim. It also gives you `loft.sample(x)`,
  `loft.surfaceY(x, z)` (the height of the top surface) and
  `loft.patch(x0, x1, a0, a1)` (a piece of its skin, for windows and panels).
- `offsetOutline`, `edgeBand`: the grown outline and the printed band, as described above.
- `drapeDome(outline, { base, height })` is a dome whose rim sits on another
  surface, e.g. a canopy on the fuselage.
- `slab(shape, { bottomY, height, bevel, grow })` extrudes a shape upward with soft edges.
- `sidePlate(points, { thickness })` extrudes a side-view profile (fins).
- `smoothLathe([[r, y], ...])` spins a profile into round parts (discs, domes).
- `tubeAlong`, `cylinderX`, `roundedRect`, `blurDisc`, `mesh`.

### Materials and styles (`src/styles.js`)

Build with the shared roles: `body` (sprite fill, team colour), `trim`
(sprite outline, darker team colour), `glow`, `metal` / `metalDark` (the
sprite greys), `rubber`, `glass`, `light`, plus the printed-outline roles
`paint` (body + trim band), `paintMetal` (metal + metalDark band) and
`paintGlass` (glass + metalDark band). Each style (Matte, Sprite, Glossy)
has its own material for every role, and switching style swaps them by role
name, so never hard-code a colour or make your own material for a role.
