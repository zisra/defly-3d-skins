// All 15 skins from sprite_kit.svg. A skin's `recipe` builds its 3D model
// (a module whose default export follows the contract in ./README.md).
// Skin 01 is hand-tuned; the rest use the automatic builder in ./auto.js,
// with a little config where the SVG alone isn't enough (propeller hubs).
const auto = (config) => () => import('./auto.js').then((m) => ({ default: m.autoRecipe(config) }));

export const SKINS = [
  { no: 1, name: 'Gunship', recipe: () => import('./skin01.js') },
  { no: 2, name: 'Quad', recipe: auto({ legs: true, pods: 'nacelle', props: [{ group: 'g7296', pivots: ['ellipse7282', 'ellipse7284', 'ellipse7286', 'ellipse7288'] }] }) },
  { no: 3, name: 'Scout', recipe: auto({ tall: 1.5 }) },
  { no: 4, name: 'Hauler', recipe: auto({ profile: 'box' }) },
  { no: 5, name: 'Ranger', recipe: auto({ tall: 1.35 }) },
  { no: 6, name: 'Raptor', recipe: auto({ tall: 1.35 }) },
  { no: 7, name: 'Guardian', recipe: auto({ props: [{ group: 'g8311', pivots: ['ellipse8273', 'ellipse8283', 'ellipse8293', 'ellipse8303'] }] }) },
  { no: 8, name: 'Twin Fan', recipe: auto({ tall: 1.6, props: [{ group: 'g6752-7', pivotSubpaths: 'circle6750-0' }] }) },
  { no: 9, name: 'Hornet', recipe: auto({ tall: 1.2 }) },
  { no: 10, name: 'Tandem', recipe: auto({ tall: 1.2 }) },
  { no: 11, name: 'Wasp', recipe: () => import('./skin11.js') },
  { no: 12, name: 'Carrier', recipe: auto({ tall: 1.6, props: [{ group: 'g8433', pivotSubpaths: 'path8415' }] }) },
  { no: 13, name: 'Manta', recipe: auto({ tall: 1.6, parts: { 'path8463': { droop: 10 } } }) },
  { no: 14, name: 'Halo', recipe: auto({ rotorBars: ['path8491', 'path8503'] }) },
  { no: 15, name: 'Turbine', recipe: auto({ tall: 1.7, spin: [{ ids: ['path10122'], about: 'ellipse9938', speed: 1.6 }] }) },
].map((s) => ({ ...s, svg: `skins/skin_${String(s.no).padStart(2, '0')}.svg` }));
