const api = window.backspin;
const $ = (id) => document.getElementById(id);

const deck = $('deck');
const record = $('record');
const label = $('label');
const arm = $('arm');
const hint = $('hint');
const progress = $('progress');
const peek = $('peek');
const bubble = $('bubble');

const PLAY_SPEED = 200; // degrees per second ≈ 33⅓ rpm
const LABEL_RADIUS = 0.28; // label radius as a fraction of the record's diameter
const ARM_PIVOT = { x: 248, y: 34 }; // tonearm pivot, in deck coordinates
const ARM_START = 9; // tonearm angle at the outer edge (start of a track)…
const ARM_END = 24; // …and right by the label (end of a track)
const ARM_LIFT = 5; // drop the arm below this angle and playback pauses
const ARM_MAX = 27;
const SKIP_ANGLE = 80; // how far you have to spin the record to skip
const SKIP_FLING = 900; // or how fast you have to flick it (deg/s)
const PEEK_FROM = 12; // degrees of spin before the next cover starts to show
const OPTIMISTIC_MS = 3000; // how long to trust a skip before Spotify confirms it

const isMac = navigator.userAgent.includes('Mac');
const mod = isMac ? '⌘⌥' : 'Ctrl+Alt+';
$('prev').title = `Previous (${mod}←)`;
$('next').title = `Next (${mod}→)`;
$('playPause').title = `Play / Pause (${mod}↓)`;

let ui = null;
let player = null;
// Right after a skip we show the target track straight away, until Spotify catches up.
let optimistic = null; // { fromId, track | null, until }

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const isReady = () => ui?.phase === 'ready';

function formatTime(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function trackProgress() {
  const t = player?.track;
  if (optimistic || !t?.durationMs) return 0;
  const pos = player.progressMs + (player.isPlaying ? Date.now() - player.receivedAt : 0);
  return clamp(pos / t.durationMs, 0, 1);
}

/* ---------- Spinning ---------- */

let angle = 0;
let velocity = 0;
let drag = null;
let armDrag = null;
let lastFrame = performance.now();

function tick(now) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  if (!drag) {
    const target = player?.isPlaying ? PLAY_SPEED : 0;
    // Spin up quickly, brake firmly when stopped, coast down slowly after a flick.
    const rate = target === 0 ? 2.4 : velocity < target ? 3 : 0.9;
    velocity += (target - velocity) * (1 - Math.exp(-rate * dt));
    angle = (angle + velocity * dt) % 360;
  }
  record.style.transform = `rotate(${angle}deg)`;
  progress.style.transform = `scaleX(${armDrag ? armDrag.fraction : trackProgress()})`;
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// The tonearm tracks the song: it starts at the outer edge and creeps in towards the label.
let armHoldUntil = 0;
function updateArm() {
  if (armDrag || Date.now() < armHoldUntil) return;
  const deg = player?.isPlaying ? ARM_START + (ARM_END - ARM_START) * trackProgress() : 0;
  arm.style.transform = `rotate(${deg}deg)`;
}
setInterval(updateArm, 1000);

/* ---------- Controls ---------- */

function skip(direction, { kick = true } = {}) {
  if (!isReady()) return;
  if (kick) velocity += direction === 'next' ? 1200 : -1200;
  Sounds.play('scratch', direction === 'next' ? 1 : -1);

  if (player?.track) {
    const target = optimistic ? null : (direction === 'next' ? player.next : player.prev);
    optimistic = { fromId: player.track.id, track: target ?? null, until: Date.now() + OPTIMISTIC_MS };
    setTimeout(renderTrack, OPTIMISTIC_MS + 50);
    renderTrack();
  }
  api.control(direction);
}

function setPlaying(play) {
  if (!isReady() || !!player?.isPlaying === play) return;
  Sounds.play(play ? 'needleOn' : 'needleOff');
  api.control(play ? 'play' : 'pause');
}

const togglePlay = () => setPlaying(!player?.isPlaying);

$('prev').addEventListener('click', () => skip('prev'));
$('next').addEventListener('click', () => skip('next'));
$('playPause').addEventListener('click', togglePlay);

api.onRemote((action) => {
  if (action === 'next' || action === 'prev') skip(action);
  else if (action === 'toggle') togglePlay();
});

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'ArrowRight') skip('next');
  else if (e.key === 'ArrowLeft') skip('prev');
  else if (e.key === ' ') togglePlay();
});

deck.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  api.menu();
});

/* ---------- Spin the record: drag to scrub, flick to skip, peek at what's next ---------- */
// Clockwise = next, anticlockwise = previous. Click the label to play/pause.

function geometry() {
  const r = record.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, radius: r.width / 2 };
}
const pointerAngle = (e, c) => Math.atan2(e.clientY - c.y, e.clientX - c.x) * 180 / Math.PI;
const onLabel = (e, c) => Math.hypot(e.clientX - c.x, e.clientY - c.y) < c.radius * LABEL_RADIUS * 2;

function showPeek(total) {
  const direction = total > 0 ? 'next' : 'prev';
  const target = direction === 'next' ? player?.next : player?.prev;
  const strength = clamp((Math.abs(total) - PEEK_FROM) / (SKIP_ANGLE - PEEK_FROM), 0, 1);
  if (strength <= 0 || !isReady()) return hidePeek();

  if (target?.art && peek.dataset.src !== target.art) {
    peek.dataset.src = target.art;
    peek.src = target.art;
  }
  peek.style.opacity = target?.art ? String(strength * 0.95) : '0';
  $('title').textContent = target?.name ?? (direction === 'next' ? 'Next track' : 'Previous track');
  $('artist').textContent = `${direction === 'next' ? 'Up next' : 'Back to'}${target ? ` · ${target.artists}` : ''}`;
}

function hidePeek() {
  if (peek.style.opacity === '0') return;
  // If we just skipped to the peeked track, hold it until the real label has faded in underneath.
  const committed = optimistic?.track?.art && optimistic.track.art === peek.dataset.src;
  const src = peek.dataset.src;
  setTimeout(() => {
    if (!drag && peek.dataset.src === src) peek.style.opacity = '0';
  }, committed ? 750 : 0);
  if (!committed) peek.style.opacity = '0';
  renderTrack();
}

record.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const c = geometry();
  drag = { c, last: pointerAngle(e, c), total: 0, samples: [], onLabel: onLabel(e, c) };
  record.setPointerCapture(e.pointerId);
  record.classList.add('grabbing');
});

record.addEventListener('pointermove', (e) => {
  if (!drag) {
    hint.classList.toggle('visible', isReady() && onLabel(e, geometry()));
    return;
  }
  const a = pointerAngle(e, drag.c);
  let d = a - drag.last;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  drag.last = a;
  drag.total += d;
  angle += d;
  const now = performance.now();
  drag.samples.push({ t: now, d });
  while (drag.samples.length && now - drag.samples[0].t > 80) drag.samples.shift();
  showPeek(drag.total);
});

function endDrag() {
  if (!drag) return;
  const { total, samples, onLabel: clickedLabel } = drag;
  drag = null;
  record.classList.remove('grabbing');

  const span = samples.length > 1 ? (samples.at(-1).t - samples[0].t) / 1000 : 0;
  const fling = span > 0 ? samples.slice(1).reduce((s, x) => s + x.d, 0) / span : 0;
  velocity = clamp(fling, -2500, 2500);

  if (Math.abs(total) < 4) {
    hidePeek();
    if (clickedLabel) togglePlay();
    return;
  }
  if (total > SKIP_ANGLE || fling > SKIP_FLING) skip('next', { kick: false });
  else if (total < -SKIP_ANGLE || fling < -SKIP_FLING) skip('prev', { kick: false });
  hidePeek();
}
record.addEventListener('pointerup', endDrag);
record.addEventListener('pointercancel', endDrag);
record.addEventListener('pointerleave', () => hint.classList.remove('visible'));

// Scroll over the record: down = next, up = previous.
let wheelTotal = 0;
let wheelLockUntil = 0;
record.addEventListener('wheel', (e) => {
  e.preventDefault();
  const now = performance.now();
  if (now < wheelLockUntil) {
    wheelLockUntil = Math.max(wheelLockUntil, now + 250); // swallow trackpad momentum
    return;
  }
  wheelTotal += e.deltaY + e.deltaX;
  if (Math.abs(wheelTotal) > 60) {
    skip(wheelTotal > 0 ? 'next' : 'prev');
    wheelTotal = 0;
    wheelLockUntil = now + 700;
  }
}, { passive: false });

/* ---------- Tonearm: drag it across the record to seek ---------- */

function armAngleAt(e) {
  const r = deck.getBoundingClientRect();
  const dx = e.clientX - (r.left + ARM_PIVOT.x);
  const dy = e.clientY - (r.top + ARM_PIVOT.y);
  return clamp(Math.atan2(-dx, dy) * 180 / Math.PI, 0, ARM_MAX);
}

function armFraction(deg) {
  return clamp((deg - ARM_START) / (ARM_END - ARM_START), 0, 1);
}

const armHit = $('armHit');

armHit.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !isReady() || !player?.track || optimistic) return;
  e.stopPropagation();
  armHit.setPointerCapture(e.pointerId);
  arm.classList.add('dragging');
  armDrag = { deg: 0, fraction: trackProgress() };
  moveArm(e);
});

function moveArm(e) {
  armDrag.deg = armAngleAt(e);
  armDrag.fraction = armFraction(armDrag.deg);
  arm.style.transform = `rotate(${armDrag.deg}deg)`;
  bubble.hidden = false;
  bubble.textContent = armDrag.deg < ARM_LIFT
    ? (player?.isPlaying ? 'Lift to pause' : 'Drop on the record to play')
    : `${formatTime(armDrag.fraction * player.track.durationMs)} / ${formatTime(player.track.durationMs)}`;
}

armHit.addEventListener('pointermove', (e) => {
  if (armDrag) moveArm(e);
});

function endArmDrag() {
  if (!armDrag) return;
  const { deg, fraction } = armDrag;
  armDrag = null;
  arm.classList.remove('dragging');
  bubble.hidden = true;

  // Leave the arm exactly where it was put down (or swing it onto its rest) instead of
  // jumping around while Spotify catches up.
  armHoldUntil = Date.now() + 1200;
  if (deg < ARM_LIFT) {
    arm.style.transform = 'rotate(0deg)';
    setPlaying(false);
  } else if (player?.track) {
    arm.style.transform = `rotate(${deg}deg)`;
    api.control('seek', fraction * player.track.durationMs);
    if (player.isPlaying) Sounds.play('needleOn');
    else setPlaying(true);
  }
}
armHit.addEventListener('pointerup', endArmDrag);
armHit.addEventListener('pointercancel', endArmDrag);

/* ---------- Resize grip ---------- */

const grip = $('grip');
let resizing = false;
grip.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  grip.setPointerCapture(e.pointerId);
  resizing = true;
  api.resizeStart();
});
grip.addEventListener('pointermove', () => {
  if (resizing) api.resizeMove();
});
const endResize = () => {
  if (!resizing) return;
  resizing = false;
  api.resizeEnd();
};
grip.addEventListener('pointerup', endResize);
grip.addEventListener('pointercancel', endResize);

/* ---------- Album art, colour & vinyl ---------- */

const arts = [$('artA'), $('artB')];
let front = 0;
let currentArt = null;

function setArt(url) {
  if (url === currentArt) return;
  currentArt = url;
  if (!url) {
    arts.forEach((img) => img.classList.remove('show'));
    deck.style.removeProperty('--accent');
    deck.style.removeProperty('--accent2');
    return;
  }
  const back = arts[1 - front];
  back.onload = () => {
    if (currentArt !== url) return;
    back.classList.add('show');
    arts[front].classList.remove('show');
    front = 1 - front;
  };
  back.src = url;
  extractColours(url);
}

// --accent: the cover's average colour (favouring saturated pixels). --accent2: its most vivid pixel.
function extractColours(url) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    if (currentArt !== url) return;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 16;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, 16, 16);
      const { data } = ctx.getImageData(0, 0, 16, 16);
      let r = 0, g = 0, b = 0, total = 0;
      let vivid = [0, 0, 0], vividScore = -1;
      for (let i = 0; i < data.length; i += 4) {
        const max = Math.max(data[i], data[i + 1], data[i + 2]);
        const min = Math.min(data[i], data[i + 1], data[i + 2]);
        const score = ((max - min) / 255) * (max / 255);
        const weight = score + 0.04;
        r += data[i] * weight;
        g += data[i + 1] * weight;
        b += data[i + 2] * weight;
        total += weight;
        if (score > vividScore) {
          vividScore = score;
          vivid = [data[i], data[i + 1], data[i + 2]];
        }
      }
      deck.style.setProperty('--accent', `rgb(${r / total | 0} ${g / total | 0} ${b / total | 0})`);
      deck.style.setProperty('--accent2', `rgb(${vivid.join(' ')})`);
    } catch {
      deck.style.removeProperty('--accent');
      deck.style.removeProperty('--accent2');
    }
  };
  img.onerror = () => deck.style.removeProperty('--accent');
  img.src = url;
}

// Roughly 1 in 5 tracks is pressed on coloured vinyl, 1 in 10 on marbled. Same track, same record.
function setVinyl(id) {
  let hash = 0;
  for (const ch of id || '') hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  const roll = id ? Math.abs(hash) % 10 : 9;
  record.classList.toggle('vinyl-colour', roll < 2);
  record.classList.toggle('vinyl-marble', roll === 2);
}

/* ---------- State ---------- */

function renderTrack() {
  const ready = isReady();
  let t = player?.track ?? null;
  let pending = false;
  if (optimistic) {
    if (player?.track?.id !== optimistic.fromId || Date.now() > optimistic.until) optimistic = null;
    else if (optimistic.track) t = optimistic.track;
    else pending = true;
  }
  if (drag && peek.style.opacity !== '0') return; // the peek text owns the bar while spinning

  $('title').textContent = t?.name ?? (ready ? 'Nothing playing' : 'Backspin');
  $('artist').textContent = player?.offline
    ? 'Offline — reconnecting…'
    : t ? t.artists : (ready ? 'Play something on Spotify' : '');
  record.title = t?.album ? `${t.name} — ${t.album}${player?.device ? `\nPlaying on ${player.device}` : ''}` : '';
  setArt(t?.art ?? null);
  setVinyl(t?.id);
  label.classList.toggle('pending', pending);
}

function setPlayer(p) {
  player = p;
  renderTrack();
  deck.classList.toggle('playing', !!p?.isPlaying);
  hint.classList.toggle('play', !p?.isPlaying);
  hint.classList.toggle('pause', !!p?.isPlaying);
  updateArm();
}

function render(next) {
  ui = next;
  $('setup').hidden = ui.phase !== 'setup';
  $('login').hidden = ui.phase !== 'login';
  $('redirect').textContent = ui.redirectUri;
  Sounds.setEnabled(ui.settings?.sounds !== false);

  const loginBtn = $('loginBtn');
  loginBtn.disabled = ui.busy;
  loginBtn.textContent = ui.busy ? 'Waiting for browser…' : 'Log in with Spotify';
  $('cancelLogin').hidden = !ui.busy;
  $('loginError').textContent = ui.error || '';

  setPlayer(ui.phase === 'ready' ? ui.player : null);
}

/* ---------- Setup & login panels ---------- */

$('openDash').addEventListener('click', () => api.openDashboard());
$('copyRedirect').addEventListener('click', (e) => {
  api.copyRedirect();
  e.target.textContent = 'Copied';
  setTimeout(() => { e.target.textContent = 'Copy'; }, 1500);
});
$('clientForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const result = await api.setClientId($('clientId').value);
  $('setupError').textContent = result.ok ? '' : result.error;
});
$('loginBtn').addEventListener('click', () => api.login());
$('cancelLogin').addEventListener('click', () => api.cancelLogin());
$('changeId').addEventListener('click', () => api.resetClientId());

/* ---------- Toasts ---------- */

let toastTimer = null;
api.onToast((message) => {
  const toast = $('toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3000);
});

api.onState(render);
api.init().then(render);
