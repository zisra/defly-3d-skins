import { Viewer } from './viewer.js';
import { createStyles, applyStyle, STYLE_LIST, SCENES } from './styles.js';
import { SkinSvg } from './geometry/svg.js';
import { SKINS } from './skins/index.js';
import { TEAM_COLORS, SOURCE_BODY, SOURCE_TRIM, deriveTrim } from './palette.js';

const $ = (sel) => document.querySelector(sel);
const viewer = new Viewer($('#stage'));
const styles = createStyles();

// Frame the craft between the header and the dock.
const fitInsets = () => viewer.setInsets({
  top: $('.top').getBoundingClientRect().bottom * 0.6,
  bottom: window.innerHeight - $('.dock').getBoundingClientRect().top + 12,
});
new ResizeObserver(fitInsets).observe($('.dock'));
fitInsets();

const saved = load();
const state = {
  skin: SKINS.find((s) => s.no === saved.skin && s.recipe) ?? SKINS.find((s) => s.recipe),
  // a saved team colour that's no longer offered falls back to the default
  colour: saved.colour && (saved.colour.name === 'Custom' || TEAM_COLORS.some((c) => c.body === saved.colour.body))
    ? saved.colour : TEAM_COLORS[0],
  style: STYLE_LIST.some((s) => s.id === saved.style) ? saved.style : STYLE_LIST[0].id,
  svg: null, // SkinSvg of the skin on show
};

// ---------------------------------------------------------------- colours
const swatchBox = $('#swatches');
const swatchButtons = TEAM_COLORS.map((c) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'swatch';
  b.title = c.name;
  b.setAttribute('role', 'radio');
  b.setAttribute('aria-label', c.name);
  b.style.setProperty('--body', c.body);
  b.style.setProperty('--trim', c.trim);
  b.addEventListener('click', () => setColour(c));
  swatchBox.append(b);
  return { b, c };
});
const custom = document.createElement('label');
custom.className = 'swatch custom';
custom.title = 'Custom colour';
custom.setAttribute('role', 'radio');
custom.innerHTML = '<input type="color" aria-label="Custom colour" />';
const picker = custom.querySelector('input');
picker.addEventListener('input', () => setColour({ name: 'Custom', body: picker.value, trim: deriveTrim(picker.value) }));
swatchBox.append(custom);

function setColour(c) {
  state.colour = c;
  styles.setTint(c);
  document.documentElement.style.setProperty('--accent', c.body);
  document.documentElement.style.setProperty('--accent-dark', c.trim);
  let matched = false;
  for (const { b, c: tc } of swatchButtons) {
    const on = tc.body === c.body && tc.trim === c.trim;
    matched ||= on;
    b.setAttribute('aria-checked', String(on));
  }
  custom.setAttribute('aria-checked', String(!matched));
  if (!matched) {
    custom.style.setProperty('--body', c.body);
    custom.style.setProperty('--trim', c.trim);
    picker.value = c.body;
  }
  tintThumbnails();
  save();
}

const tint = (text) => text
  .replace(new RegExp(SOURCE_BODY, 'gi'), state.colour.body)
  .replace(new RegExp(SOURCE_TRIM, 'gi'), state.colour.trim);
const svgUrl = (text) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;

// ---------------------------------------------------------------- styles
const styleBox = $('#styles');
const styleButtons = STYLE_LIST.map((s) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = s.label;
  b.title = s.hint;
  b.setAttribute('role', 'radio');
  b.addEventListener('click', () => setStyle(s.id));
  styleBox.append(b);
  return { b, s };
});

function setStyle(id) {
  state.style = id;
  viewer.setStyle(SCENES[id]);
  if (viewer.model) applyStyle(viewer.model.object, styles.sets[id]);
  for (const { b, s } of styleButtons) b.setAttribute('aria-checked', String(s.id === id));
  save();
}

// ---------------------------------------------------------------- skins
const strip = $('#skins');
const sources = new Map(); // skin no -> raw SVG text
const tiles = SKINS.map((skin) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'skin';
  b.setAttribute('role', 'radio');
  b.title = skin.recipe ? skin.name : `${skin.name}: 3D model not built yet`;
  b.disabled = !skin.recipe;
  b.innerHTML = `<span class="num">${skin.no}</span><img alt="" />${skin.recipe ? '<span class="badge">3D</span>' : ''}`;
  b.addEventListener('click', () => showSkin(skin));
  strip.append(b);
  fetch(skin.svg).then((r) => r.text()).then((text) => {
    sources.set(skin.no, text);
    tintThumbnails();
  });
  return { b, skin };
});

function tintThumbnails() {
  for (const { b, skin } of tiles) {
    const text = sources.get(skin.no);
    if (text) b.querySelector('img').src = svgUrl(tint(text));
  }
  if (state.svg) compareImg.src = svgUrl(tint(state.svg.text));
}

let loadToken = 0;
const recipeCache = new Map();
const modelCache = new Map();
async function showSkin(skin) {
  const token = ++loadToken;
  state.skin = skin;
  $('#skin-no').textContent = String(skin.no).padStart(2, '0');
  $('#skin-name').textContent = skin.name;
  document.title = `${skin.name} · Skin Hangar`;
  for (const { b, skin: s } of tiles) b.setAttribute('aria-checked', String(s === skin));
  save();

  const status = $('#status');
  const slow = setTimeout(() => { status.textContent = 'Building…'; status.hidden = false; }, 150);
  try {
    if (!recipeCache.has(skin.no)) {
      const recipe = (await skin.recipe()).default;
      const svg = await SkinSvg.load(skin.svg, recipe.pivot);
      recipeCache.set(skin.no, { recipe, svg });
    }
    if (token !== loadToken) return;
    const { recipe, svg } = recipeCache.get(skin.no);
    state.svg = svg;
    compareImg.src = svgUrl(tint(svg.text));
    // build once per skin; coming back to a skin just restyles the cached model
    if (!modelCache.has(skin.no)) modelCache.set(skin.no, recipe.build({ svg, mats: styles.sets[state.style] }));
    const model = modelCache.get(skin.no);
    applyStyle(model.object, styles.sets[state.style]);
    viewer.setModel(model);
    status.hidden = true;
  } catch (err) {
    console.error(err);
    status.textContent = `Couldn't build ${skin.name}`;
    status.hidden = false;
  } finally {
    clearTimeout(slow);
  }
}

// ---------------------------------------------------------------- compare with the sprite
// In Top view the original sprite is laid over the render at the same scale;
// drag the handle to wipe between them.
const compareBox = $('#compare');
const compareImg = compareBox.querySelector('img');
const wipe = compareBox.querySelector('input');
const handle = compareBox.querySelector('.handle');
let comparing = false;

function setCompare(on) {
  comparing = on;
  $('#compare-toggle').setAttribute('aria-pressed', String(on));
  compareBox.hidden = !on;
  viewer.controls.enableRotate = !on; // keep the camera straight down while comparing
  // hold the rotors still so they line up with the sprite; restore the Spin toggle after
  viewer.state.spin = !on && $('#spin').getAttribute('aria-pressed') === 'true';
  if (on && viewer.state.view !== 'top') setView('top');
}
function updateWipe() {
  const v = Number(wipe.value);
  compareImg.style.clipPath = `inset(0 ${100 - v}% 0 0)`;
  handle.style.left = `${v}%`;
}
wipe.addEventListener('input', updateWipe);
updateWipe();

viewer.onFrame = () => {
  const vb = state.svg?.viewBox;
  if (!comparing || !vb) return;
  const a = viewer.project(vb.x, 0, vb.y);
  const b = viewer.project(vb.x + vb.w, 0, vb.y + vb.h);
  Object.assign(compareBox.style, {
    left: `${Math.min(a.x, b.x)}px`,
    top: `${Math.min(a.y, b.y)}px`,
    width: `${Math.abs(b.x - a.x)}px`,
    height: `${Math.abs(b.y - a.y)}px`,
  });
};

// ---------------------------------------------------------------- camera & toggles
const viewButtons = document.querySelectorAll('[data-view]');
function setView(view, opts) {
  viewer.setView(view, opts);
  viewButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
  if (view !== 'top' && comparing) setCompare(false);
}
viewButtons.forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

function toggle(id, apply) {
  const b = $(id);
  b.addEventListener('click', () => {
    const on = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', String(on));
    apply(on);
  });
}
toggle('#spin', (on) => (viewer.state.spin = on && !comparing));
toggle('#turntable', (on) => viewer.setTurntable(on));
$('#compare-toggle').addEventListener('click', () => setCompare(!comparing));

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement && e.target.type !== 'range') return;
  const built = SKINS.filter((s) => s.recipe);
  const i = built.indexOf(state.skin);
  if (e.key === 'ArrowRight' && !(e.target instanceof HTMLInputElement)) showSkin(built[(i + 1) % built.length]);
  if (e.key === 'ArrowLeft' && !(e.target instanceof HTMLInputElement)) showSkin(built[(i - 1 + built.length) % built.length]);
  if (e.key === 't' || e.key === 'T') setView(viewer.state.view === 'top' ? 'orbit' : 'top');
  if (e.key === 'c' || e.key === 'C') setCompare(!comparing);
});

// ---------------------------------------------------------------- persistence
function load() {
  try { return JSON.parse(localStorage.getItem('skin-hangar') ?? '{}'); } catch { return {}; }
}
function save() {
  try {
    localStorage.setItem('skin-hangar', JSON.stringify({ skin: state.skin?.no, colour: state.colour, style: state.style }));
  } catch { /* private mode */ }
}

// URL options for sharing / screenshots:
//   ?skin=1&colour=red&style=sprite&view=top&compare=50&still&cam=az,el,scale
const params = new URLSearchParams(location.search);
if (params.has('skin')) state.skin = SKINS.find((s) => s.no === Number(params.get('skin')) && s.recipe) ?? state.skin;
if (params.has('colour')) state.colour = TEAM_COLORS.find((c) => c.name.toLowerCase() === params.get('colour').toLowerCase()) ?? state.colour;
if (STYLE_LIST.some((s) => s.id === params.get('style'))) state.style = params.get('style');

if (params.has('still')) {
  viewer.setTurntable(false);
  viewer.state.spin = false;
}
setStyle(state.style);
setColour(state.colour);
await showSkin(state.skin);
if (params.get('view') === 'top') setView('top', { instant: params.has('still') });
if (params.has('compare')) {
  wipe.value = params.get('compare') || '50';
  updateWipe();
  setCompare(true);
}
if (params.has('cam')) viewer.lookFrom(...params.get('cam').split(',').map(Number));
// let the first frames compile before anyone (e.g. the screenshot script) looks
requestAnimationFrame(() => requestAnimationFrame(() => (window.__ready = true)));
window.__viewer = viewer; // handy for debugging in the console
