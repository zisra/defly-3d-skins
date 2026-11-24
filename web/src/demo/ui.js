// The demo's overlay: loading card, letterbox with chapter and controls,
// name cards, floating tags, the wipe labels and the end card.

const ICON = {
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  sound: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>',
  muted: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>',
  replay: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.3-5.6"/><path d="M4 4v4h4"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
};

export class DemoUI {
  constructor({ onClose, onMute, onReplay, muted }) {
    const root = document.createElement('div');
    root.className = 'demo';
    root.dataset.phase = 'loading';
    root.innerHTML = `
      <canvas class="demo-canvas" aria-label="Flight demo"></canvas>
      <div class="demo-flash"></div>
      <div class="demo-tags"></div>
      <div class="demo-wipe" hidden><span class="tag left">Sprite</span><span class="tag right">3D</span></div>
      <div class="demo-card" hidden><span class="eyebrow"></span><b></b></div>
      <div class="demo-bar top"><div class="demo-chapter"><span class="eyebrow">Flight demo</span><b></b></div></div>
      <div class="demo-bar bottom"><div class="demo-progress"><i></i></div></div>
      <div class="demo-controls">
        <button type="button" class="demo-btn mute" aria-label="Mute" title="Mute (M)">${muted ? ICON.muted : ICON.sound}</button>
        <button type="button" class="demo-btn close" aria-label="Close the demo" title="Close (Esc)">${ICON.close}</button>
      </div>
      <div class="demo-loading">
        <span class="eyebrow">Skin Hangar</span>
        <h1>Flight Demo</h1>
        <div class="demo-icons"></div>
        <p class="demo-note">Building the fleet…</p>
      </div>
      <div class="demo-paused" hidden>Paused · Space to resume</div>
      <div class="demo-end" hidden>
        <div class="panel">
          <span class="eyebrow">Flight demo</span>
          <h2></h2>
          <p>From flat sprites to a flying fleet.</p>
          <div class="actions">
            <button type="button" class="demo-pill replay">${ICON.replay}Replay</button>
            <button type="button" class="demo-pill primary back">${ICON.back}Back to the hangar</button>
          </div>
        </div>
      </div>`;
    document.body.append(root);
    this.root = root;
    this.canvas = root.querySelector('canvas');
    this.$ = (s) => root.querySelector(s);
    this.$('.close').addEventListener('click', onClose);
    this.$('.back').addEventListener('click', onClose);
    this.$('.replay').addEventListener('click', onReplay);
    this.muteBtn = this.$('.mute');
    this.muteBtn.addEventListener('click', onMute);
    this.tagEls = new Map();
    this.last = {};
  }

  // ------------------------------------------------------------ loading
  icon(i, url, n) {
    const box = this.$('.demo-icons');
    while (box.children.length < n) box.append(Object.assign(document.createElement('span'), { className: 'demo-icon' }));
    const el = box.children[i];
    if (!el.firstChild) el.append(Object.assign(document.createElement('img'), { src: url, alt: '' }));
  }

  built(i, n) {
    this.$('.demo-icons').children[i]?.classList.add('on');
    this.$('.demo-note').textContent = i + 1 < n ? `Building the fleet · ${i + 1} / ${n}` : 'Ready';
  }

  start(n) {
    this.$('.demo-end h2').textContent = `${n} skins`;
    this.root.dataset.phase = 'show';
  }

  setMuted(m) {
    this.muteBtn.innerHTML = m ? ICON.muted : ICON.sound;
    this.muteBtn.setAttribute('aria-label', m ? 'Unmute' : 'Mute');
  }

  paused(p) { this.$('.demo-paused').hidden = !p; }

  // ------------------------------------------------------------ per frame
  update(cap) {
    const L = this.last;
    if (cap.chapter !== L.chapter) {
      L.chapter = cap.chapter;
      const ch = this.$('.demo-chapter');
      ch.classList.toggle('hide', !cap.chapter);
      if (cap.chapter) {
        ch.querySelector('b').textContent = cap.chapter;
        ch.classList.remove('swap');
        void ch.offsetWidth;
        ch.classList.add('swap');
      }
    }
    this.root.classList.toggle('letterbox', !!cap.letterbox);
    this.$('.demo-progress i').style.transform = `scaleX(${Math.min(1, cap.progress).toFixed(4)})`;
    this.$('.demo-flash').style.opacity = cap.flash.toFixed(3);

    // name card
    const card = this.$('.demo-card');
    const key = cap.card ? `${cap.card.no}` : '';
    if (key !== L.card) {
      L.card = key;
      if (cap.card) {
        card.hidden = false;
        card.querySelector('.eyebrow').textContent = `Skin ${String(cap.card.no).padStart(2, '0')}`;
        card.querySelector('b').textContent = cap.card.name;
        card.style.setProperty('--team', cap.card.colour.body);
        card.classList.remove('in');
        void card.offsetWidth;
        card.classList.add('in');
      } else card.hidden = true;
    }
    card.classList.toggle('out', !!cap.card?.out);

    // floating tags over craft being printed
    const seen = new Set();
    for (const t of cap.tags) {
      seen.add(t.i);
      let el = this.tagEls.get(t.i);
      if (!el) {
        el = document.createElement('span');
        el.className = 'demo-tag';
        el.textContent = t.text;
        el.style.setProperty('--team', t.colour.body);
        this.$('.demo-tags').append(el);
        this.tagEls.set(t.i, el);
        requestAnimationFrame(() => el.classList.add('in'));
      }
      el.style.transform = `translate(${t.x.toFixed(1)}px, ${t.y.toFixed(1)}px) translate(-50%, -100%)`;
      el.classList.toggle('out', t.out);
    }
    for (const [i, el] of this.tagEls) if (!seen.has(i)) { el.remove(); this.tagEls.delete(i); }

    // wipe
    const wipe = this.$('.demo-wipe');
    wipe.hidden = !cap.wipe?.show;
    if (cap.wipe?.show) wipe.style.left = `${(cap.wipe.frac * 100).toFixed(2)}%`;

    if (cap.done !== L.done) {
      L.done = cap.done;
      this.$('.demo-end').hidden = !cap.done;
      if (cap.done) requestAnimationFrame(() => this.$('.demo-end').classList.add('in'));
      else this.$('.demo-end').classList.remove('in');
    }
  }

  remove() { this.root.remove(); }
}
