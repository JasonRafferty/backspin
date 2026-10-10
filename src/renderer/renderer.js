const api = window.backspin;
const $ = (id) => document.getElementById(id);

const deck = $('deck');
const record = $('record');
const arm = $('arm');
const hint = $('hint');
const progress = $('progress');

const PLAY_SPEED = 200; // degrees per second ≈ 33⅓ rpm
const LABEL_RADIUS = 0.28; // label size as a fraction of the record's diameter
const ARM_START = 15; // tonearm angle at the start of a track…
const ARM_END = 23; // …and at the end
const SKIP_ANGLE = 80; // how far you have to drag the record to skip
const SKIP_FLING = 900; // or how fast you have to flick it (deg/s)

const isMac = navigator.userAgent.includes('Mac');
const mod = isMac ? '⌘⌥' : 'Ctrl+Alt+';
$('prev').title = `Previous (${mod}←)`;
$('next').title = `Next (${mod}→)`;

let ui = null;
let player = null;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function trackProgress() {
  const t = player?.track;
  if (!t?.durationMs) return 0;
  const pos = player.progressMs + (player.isPlaying ? Date.now() - player.receivedAt : 0);
  return clamp(pos / t.durationMs, 0, 1);
}

/* ---------- Spinning ---------- */

let angle = 0;
let velocity = 0;
let drag = null;
let lastFrame = performance.now();

function tick(now) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  if (!drag) {
    const target = player?.isPlaying ? PLAY_SPEED : 0;
    // Spin up quickly, coast down slowly like a real platter.
    const rate = velocity < target ? 3 : 0.9;
    velocity += (target - velocity) * (1 - Math.exp(-rate * dt));
    angle = (angle + velocity * dt) % 360;
  }
  record.style.transform = `rotate(${angle}deg)`;
  progress.style.transform = `scaleX(${trackProgress()})`;
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

function updateArm() {
  const deg = player?.isPlaying ? ARM_START + (ARM_END - ARM_START) * trackProgress() : 0;
  arm.style.transform = `rotate(${deg}deg)`;
}
setInterval(updateArm, 1000);

/* ---------- Controls ---------- */

function control(action) {
  if (ui?.phase !== 'ready') return;
  api.control(action);
}

function skip(direction, kick = true) {
  if (kick) velocity += direction === 'next' ? 1200 : -1200;
  control(direction);
}

$('prev').addEventListener('click', () => skip('prev'));
$('next').addEventListener('click', () => skip('next'));

// Drag the record to scrub it; flick or spin it far enough to skip.
// Clockwise = next, anticlockwise = previous. Click the label to play/pause.
function geometry() {
  const r = record.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, radius: r.width / 2 };
}
const pointerAngle = (e, c) => Math.atan2(e.clientY - c.y, e.clientX - c.x) * 180 / Math.PI;
const onLabel = (e, c) => Math.hypot(e.clientX - c.x, e.clientY - c.y) < c.radius * LABEL_RADIUS * 2;

record.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const c = geometry();
  drag = { c, last: pointerAngle(e, c), total: 0, samples: [], onLabel: onLabel(e, c) };
  record.setPointerCapture(e.pointerId);
  record.classList.add('grabbing');
});

record.addEventListener('pointermove', (e) => {
  if (!drag) {
    const c = geometry();
    hint.classList.toggle('visible', ui?.phase === 'ready' && onLabel(e, c));
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
    if (clickedLabel) control('toggle');
    return;
  }
  if (total > SKIP_ANGLE || fling > SKIP_FLING) skip('next', false);
  else if (total < -SKIP_ANGLE || fling < -SKIP_FLING) skip('prev', false);
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

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'ArrowRight') skip('next');
  else if (e.key === 'ArrowLeft') skip('prev');
  else if (e.key === ' ') control('toggle');
});

deck.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  api.menu();
});

/* ---------- Album art & colour ---------- */

const arts = [$('artA'), $('artB')];
let front = 0;
let currentArt = null;

function setArt(url) {
  if (url === currentArt) return;
  currentArt = url;
  if (!url) {
    arts.forEach((img) => img.classList.remove('show'));
    deck.style.removeProperty('--accent');
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
  extractAccent(url);
}

// Average the album cover's colours (favouring saturated pixels) to tint the deck.
function extractAccent(url) {
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
      for (let i = 0; i < data.length; i += 4) {
        const max = Math.max(data[i], data[i + 1], data[i + 2]);
        const min = Math.min(data[i], data[i + 1], data[i + 2]);
        const weight = (max - min) / 255 * (max / 255) + 0.04;
        r += data[i] * weight;
        g += data[i + 1] * weight;
        b += data[i + 2] * weight;
        total += weight;
      }
      deck.style.setProperty('--accent', `rgb(${r / total | 0} ${g / total | 0} ${b / total | 0})`);
    } catch {
      deck.style.removeProperty('--accent');
    }
  };
  img.onerror = () => deck.style.removeProperty('--accent');
  img.src = url;
}

/* ---------- State ---------- */

function setPlayer(p) {
  player = p;
  const t = p?.track;
  const ready = ui.phase === 'ready';
  $('title').textContent = t?.name ?? (ready ? 'Nothing playing' : 'Backspin');
  $('artist').textContent = p?.offline
    ? 'Offline — reconnecting…'
    : t ? t.artists : (ready ? 'Play something on Spotify' : '');
  record.title = t ? `${t.name} — ${t.album}${p.device ? `\nPlaying on ${p.device}` : ''}` : '';
  setArt(t?.art ?? null);
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
