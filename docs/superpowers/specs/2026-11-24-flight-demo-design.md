# Flight Demo: design

Date: 2026-11-24. Status: approved ("just make it") and built; see As built at the end.

## Intent

A **Demo** button on the Skin Hangar site (`web/`). Pressing it plays a
roughly two-minute 3D show, rendered live in the browser, featuring all 20
3D skins. Nobody steers anything; the show plays by itself.

The show tells the project's own story: **flat sprites become 3D craft**. It
then shows them off as an **airshow**. It ends where it began: seen from
straight above, the landed 3D fleet looks just like the flat sprites.

Owner's words: "a super cool 3D demonstration of all the sprites we created",
"an in-browser thing. you press a button on the website and it does the
demo", concept "Sprite to sky" combined with an airshow.

## Goals

- Every one of the 20 skins gets at least one close-up moment where its detail
  is readable, then gets to fly in a spectacle.
- It feels cinematic and polished: smooth motion, deliberate camera work,
  good pacing, sound. "Really cool" is the bar, not "works".
- One click from the viewer; Esc or ✕ returns to the viewer exactly as it was
  (same skin, colour, style, camera view).
- Works on desktop (Chrome, Safari, Firefox) and on phones, with lighter
  effects on phones.

## Non-goals

- No player control: no flying the craft, no game rules, no scoring. It is
  not gameplay and not a version of any existing game.
- No seeking or scrubbing for viewers (pause is fine). A time-jump URL exists
  only for testing.
- No video export.
- No new skins, and no changes to how any craft looks.

## Anti-goals (failure even if it technically works)

- **Hitches or stutter while things fly.** All heavy work (building models)
  happens before the flying starts.
- **Craft passing through each other or the floor.**
- **Craft looking muddier, darker or different from the viewer.** The night
  lighting must keep paint vivid and readable, and the lines stay trim-coloured.
- **Parts added to craft.** Effects (trails, tracers, beams, sparks) are
  scene effects, never new parts on a craft. The owner has repeatedly said no
  extra elements that aren't in the sprite.
- **Slowing or breaking the normal viewer.** The demo code loads only when
  the button is pressed.
- **Dragging pacing.** No act longer than about 20 s, and variety from shot to shot.
- **Harsh or loud audio.**

## Constraints (from the project)

- Stack: three.js 0.187, Vite, static hosting on Cloudflare Workers (static
  assets only). No new runtime dependencies; three's own add-ons (bloom,
  composer) are fine.
- **Build cost:** building all 20 models takes about 8 s on a desktop, and
  each build blocks the main thread for 50–1300 ms (the image skins 17, 19 and
  55 take about 1.2 s each). Phones are slower.
- **Render cost:** about 3.7 M triangles for all 20 models (largest: 7 at
  387 k, 2 at 362 k, 55 at 251 k). Fine on desktop GPUs; phones need no
  shadows and a lower resolution.
- **Craft size:** craft are 15–27 units across (sprite units; one arena grid
  cell is 18.5 units). Nose points +x. Models aren't centred on their origin.
- **Team colour is global today.** `createStyles()` holds one tint, shared by
  every model built with its sets. Different colours at once need one
  `createStyles()` instance per craft; `applyStyle()` re-materials a built
  model without rebuilding.
- **Model contract:** `recipe.build({ svg, mats })` returns
  `{ object, update(dt, t, state) }`. `state.spin` spins the rotors up and
  down, and moving-only layers follow it.

## Approaches considered

1. **"Sprite to sky"** (chosen, combined with 3): flat sprites inflate into 3D
   one by one, then fly. It tells the project's story and gives every craft a
   close-up.
2. **Showroom:** dark studio, each craft on a lit turntable, slow camera
   moves. Shows detail best, but nothing flies.
3. **Airshow:** everything flies from the start: flybys, loops, smoke, a
   mock dogfight. Most action, but each craft gets little screen time.

**Chosen: 1 + 3.** The owner picked 1 "in combo of an airshow". The roll
call from 1 provides the close-ups; the airshow from 3 provides the
spectacle.

**Technical approach.** The demo gets its own full-screen canvas and
renderer, laid over the page, and the viewer's render loop pauses while it
runs. Rejected alternative: reusing the viewer's renderer and scene. It
couples the two tightly, and the demo needs a different camera system, post
effects and lighting. The demo is a lazily imported module (`web/src/demo/`).

## The show

About 2:05 in total. Times are targets; the builder tunes the pacing.

### 0. Loading (before the show clock starts)
On click, the page fades to black. A title card, **SKIN HANGAR · FLIGHT
DEMO**, appears with a row of 20 small sprite icons that light up one by one
as each model is built. One build runs per frame, so the progress paints
between builds. On a replay within the same visit, the models are already
built and this step is skipped.

### 1. Lights out (0:00–0:07)
A dark night arena. The grid floor lights up line by line, rippling out from
the centre with a low swell. The camera cranes down from high above and
reveals **20 flat sprites lying on 20 pads**, laid out in a 5 × 4 grid like a
sprite sheet on the floor, each in its team colour.

### 2. Roll call (0:07–0:45)
Pad by pad, in skin-number order (1 → 99), each flat sprite becomes its 3D
craft:
- **The transformation:** a glowing scan beam sweeps across the sprite. Behind
  the beam the flat image is replaced by the 3D model, which rises out of the
  floor to full height with a slight overshoot. Its rotors spin up, then it
  lifts off with a soft pulse ring on the pad and climbs to a holding ring
  overhead.
- **Pacing:**
  - Skins 1 and 2 go slowly (about 4 s each), with a close camera and a
    name card (`SKIN 01 · Gunship`).
  - 3–15 are a quick montage, about 1 s apart and overlapping, with small tags,
    while the camera cranes across the pads.
  - The five image skins (17, 19, 28, 55, 99) close the roll call at medium
    pace (about 2.5 s each), with name cards.

### 3. Paint wave (0:45–0:55)
All 20 circle overhead in a ring. The camera sits in the middle looking up and
around. A wave of colour ripples around the ring through all 12 team colours,
then each craft settles back to its own colour.

### 4. Formation flight (0:55–1:15)
Team-coloured smoke trails turn on. The ring opens into an arrowhead and flies
past the camera, then changes from arrowhead to diamond to line abreast. A low
ground camera watches the formation thunder overhead. The act ends in a
**bomb burst**: the craft peel off upward in every direction, and their trails
draw a flower in the sky.

### 5. Solo stunts (1:15–1:30)
One craft does a loop and another a barrel roll, both trailing smoke. Then an
**opposition pass**: two craft fly head-on towards each other and cross at
the camera.

### 6. Mock dogfight (1:30–1:48)
Six craft are repainted into two team colours in a quick colour flash, three
against three. They weave and chase while the rest circle high above. Glowing
tracer bolts fire from the gun muzzles. A hit makes sparks and a puff of smoke,
and the hit craft wobbles and recovers. Nothing is destroyed. The camera rides
behind an attacker, then pulls wide.

### 7. Finale: dawn (1:48–2:05)
The sky brightens to the viewer's daylight colours and the grid fades back to
the light arena. All craft regroup and land on their own pads, and their
rotors spin down and settle at their resting angle. The camera rises to
straight overhead, and the fleet now looks like a sprite sheet. A **wipe**
sweeps across the screen, swapping the 3D craft for the flat sprites and back:
they line up. An end card follows: **20 skins**, with **Replay** and **Back to
the hangar**.

## How it's built (decided)

### Entry and exit
- **Button:** a **Demo** pill with a play icon in the header's actions, next to
  Compare.
- **Lazy loading:** clicking it runs `import('./demo/index.js')` (lazy, its
  own bundle chunk), pauses the viewer's render loop (new
  `viewer.pause()` / `viewer.resume()`), hides the HUD and starts the demo.
- **Controls during the show:** a ✕ (exit) and a mute toggle, top right. A
  thin progress line along the bottom. Esc exits, Space pauses.
- **On exit:** dispose the demo renderer and its GPU resources, remove the
  overlay, resume the viewer. The built fleet (JS objects) stays cached for
  a replay in the same visit.
- **URL hooks:**
  - `?demo` starts the show on load. It starts muted, because browsers block
    sound without a click.
  - `?demo=<seconds>` jumps to that time, for testing.
  - `&still` freezes the frame, for screenshots.

### The fleet
- **Building:** every skin is built once, with materials from its own
  `createStyles()` instance, so each craft has its own team colour. Recolouring
  is that instance's `setTint()` and is cheap; it is used by the paint wave and
  the dogfight's team paint.
- **Centring:** each model sits in a wrapper group, centred on its framing box
  (ignoring `noFrame` effects, as the viewer does). That wrapper is what flies.
- **Colours:** craft are assigned team colours in the game's colour order,
  cycling: skin 1 Blue, skin 2 Red, and so on.
- **Materials:** the show uses the **Glossy** style, whose clearcoat catches
  the night lights. The finale swaps to the **Sprite** style during the dawn
  brightening, so the overhead view matches the flat sprites.
- **Rotors:**
  - Each model's `update()` runs every frame with `{ spin }`.
  - A small new hook, `state.park`: when true, a model eases its spinning
    groups to their rest angle and holds them there. It is added in
    `skin01.js`, `auto.js` and `image.js`, and the viewer never sets it.
  - Needed so the finale's rotors line up with the sprites.
- **Muzzles:** `kit.addMuzzle()` tags its mesh (`userData.muzzle = true`), so
  tracers can fire from real gun positions. Craft without a gun fire from
  their nose tip.

### The flat sprites
- **Source:** the pads' flat sprites, and the finale's wipe, use each skin's 2D
  art in its team colour:
  - SVG skins: the existing colour-swap.
  - Image skins: a new option on `ImageSkin.render()` that colours the art the
    same way as the 3D (line shade → trim, fill → body), so flat and 3D match.
  - The viewer's own thumbnails are unchanged.
- **Sharing the colour-swap:** the SVG colour-swap currently lives in `main.js`
  and moves to a shared module.
- **In the scene:** the flat sprites are textured planes on the floor at the
  model's exact top-view footprint.
- **The final overhead shot** uses an orthographic camera, reached via a
  dolly-zoom, so flat sprites and 3D craft line up exactly with no parallax.

### Flight
- **Simulation:** a deterministic fixed-step simulation (60 Hz), seeded, so the
  show is identical every time and `?demo=<s>` can fast-forward to any time.
- **Steering:** each craft is a point mass steering towards a target that the
  choreography sets each step (arrive behaviour, limits on speed and
  acceleration). A separation force keeps craft at least about 30 units apart.
- **Orientation:** the nose follows the velocity. Bank comes from sideways
  acceleration, clamped to about 60° and smoothed. Pitch is limited.
- **Scripted moves:** stunts (the loop, the barrel roll, the opposition pass,
  lift-off and landing) follow scripted paths that drive the craft's whole
  orientation directly, then hand back to steering.
- **Parked craft** bob gently.

### Choreography and camera
- **Timeline:** a list of acts, each with a start time and a duration. An act
  sets craft targets, scripted moves, effects and the camera shot for its
  span.
- **Camera:**
  - Shots are functions of time: chase, orbit, crane, fixed position looking
    at a craft, ground camera, overhead.
  - Shots join by cuts or eased blends.
  - The lens widens on portrait screens so the framing still works.

### Look
- **Night:**
  - deep navy-to-violet sky dome with faint stars, and fog
  - dark floor with a procedural glowing grid (cyan): an ignition ripple at
    the start, pulse rings at lift-offs
  - a cool key light, a warm rim light, and an environment map for glossy
    reflections
- **Paint stays readable:** the night look must not darken craft paint. The
  lighting is tuned so lit tops show the team colours at roughly the viewer's
  brightness.
- **Bloom** (desktop only) makes the emissive things glow (grid, beams, trails,
  tracers, 99's rainbow), but not the craft paint.
- **Effects:**
  - smoke trails: camera-facing ribbons, about 3 s long, fading, in team colour
  - tracers: pooled instanced streaks with a short life
  - sparks and smoke puffs: pooled particles
  - the scan beam: an emissive bar, a thin light sheet and a floor glow
- **Dawn:** sky, fog, floor and lights blend to the viewer's daylight values.
  The overhead shot ends on exactly the viewer's Sprite-style lighting
  (`SCENES.sprite` in `styles.js`, tone mapping included), since that lighting
  is what makes the top view match the flat art.

### Sound (made in the browser, no audio files)
- **Music:** a minimal synth bed at about 110 BPM that builds act by act:
  - intro: pad
  - roll call: adds a pulsing bass
  - airshow: adds drums
  - dogfight: full
  - finale: resolves and fades
- **Effects:**
  - a rising sweep for each scan
  - a lift-off whoosh
  - flyby whooshes, panned, when a craft passes close to the camera
  - soft tracer ticks and hit crackles
  - a shimmer for the paint wave
- **Volume:** moderate. Mute persists between visits (stored in the browser;
  if storage is blocked, it is just on).

### Phones and slow devices
- **Phones** (coarse pointer): pixel ratio capped at 1.25, no bloom, no
  shadows, fewer particles, shorter trails.
- **Any device:** drops to the same reduced settings if frame time stays above
  about 25 ms for 2 s.
- **Reduced motion** (`prefers-reduced-motion`): no camera shake or flashes,
  and gentler blends.

## Verification

- **Screenshots:** `scripts/screenshot.mjs` gains demo support, e.g.
  `demo=12&still`. Check every act at several times, in landscape and
  portrait.
- **Loading:** builds happen only before the show clock starts. Check there's
  no main-thread task over 50 ms once the show is running.
- **Flight:** a check over the whole simulation that no two craft come closer
  than their sizes allow, and none dip below the floor.
- **Viewer intact:** exit returns the viewer with the same skin, colour, style
  and view, and it still works. Replay works without rebuilding.
- **Build:** `npm run build` passes, the demo is a separate chunk, and the
  Cloudflare preview runs it.
- **Final review** by the owner, by watching it.

## Left to the builder

Exact paths, speeds and timings; camera shot details; night palette values;
the sound patches; the trail and particle look; how the scan beam reveals the
model (clipping plane, scale, or both); and performance tuning, as long as the
anti-goals hold.

## As built (2026-11-24)

Where the build differs from the plan above, and why:

- **Rotor parking** is done generically by the demo (`fleet.js`): whatever a
  model's own update turned is eased back to its built angle, in the
  direction it was turning. No `state.park` hook was needed in the skin
  builders, which are untouched apart from the muzzle tag.
- **The reveal.** Behind the beam the craft appears whole and swells up as one
  piece, with a small overshoot. The planned per-position rise sheared thin
  parts (rotor blades) into odd slabs mid-sweep.
- **More close-ups** (owner's request during the build). The paint shop,
  formation and dogfight acts now have close follow, lead, wingman and flyby
  shots on individual craft. Act lengths are unchanged.
- **Spacing:**
  - separation looks 0.5 s ahead, measures on a flat ellipsoid and prefers
    passing over or under
  - formation slots go to the nearest craft, and diamond slots are matched to
    arrowhead slots
  - craft head home stacked at heights of their own
  - `scripts/demo-sim-check.mjs` finds no two craft closer than 1.25
    ellipsoid widths anywhere in the show
- **Leader:** skin 1 always takes the point of the arrowhead.
- **Night lighting:** a soft fill light rides with the camera at night, so
  craft seen from below keep their paint.
- **End framing:** the final overhead frame leaves room under the grid for the
  end card.
- **Length:** about 2:08.
