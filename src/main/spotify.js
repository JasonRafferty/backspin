// Polls Spotify for what's playing and sends playback commands.
const auth = require('./auth');

const API = 'https://api.spotify.com/v1';

let handlers = { onPlayer() {}, onLoggedOut() {}, onToast() {} };
let running = false;
let visible = true;
let timer = null;
let inflight = false;
let pollSoon = false;
let pausedUntil = 0; // set when Spotify rate-limits us
let lastPlayer = null;

function init(h) {
  handlers = { ...handlers, ...h };
}

async function request(method, endpoint, retry = true) {
  const token = await auth.getAccessToken();
  const res = await fetch(API + endpoint, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    body: method === 'GET' ? undefined : '',
  });
  if (res.status === 401 && retry) {
    auth.invalidateAccessToken();
    return request(method, endpoint, false);
  }
  if (res.status === 429) {
    pausedUntil = Date.now() + (Number(res.headers.get('retry-after')) || 5) * 1000;
  }
  return res;
}

function pickImage(images) {
  if (!images?.length) return null;
  const sorted = [...images].sort((a, b) => (a.width || 0) - (b.width || 0));
  return (sorted.find((img) => (img.width || 0) >= 300) || sorted.at(-1)).url;
}

function idle(extra = {}) {
  return { isPlaying: false, track: null, progressMs: 0, receivedAt: Date.now(), device: null, ...extra };
}

function toPlayer(data) {
  const item = data.item;
  if (!item) return idle({ isPlaying: !!data.is_playing, device: data.device?.name ?? null });
  return {
    isPlaying: !!data.is_playing,
    progressMs: data.progress_ms ?? 0,
    receivedAt: Date.now(),
    device: data.device?.name ?? null,
    track: {
      id: item.id || item.uri,
      name: item.name,
      artists: item.artists?.map((a) => a.name).join(', ') ?? item.show?.name ?? '',
      album: item.album?.name ?? item.show?.name ?? '',
      art: pickImage(item.album?.images || item.images || item.show?.images),
      durationMs: item.duration_ms || 0,
    },
  };
}

function emit(player) {
  lastPlayer = player;
  handlers.onPlayer(player);
}

function interval() {
  if (!visible) return 5000;
  return lastPlayer?.isPlaying ? 1500 : 3000;
}

function schedule(ms = interval()) {
  if (!running) return;
  clearTimeout(timer);
  timer = setTimeout(poll, Math.max(0, ms));
}

async function poll() {
  if (!running) return;
  if (inflight) { pollSoon = true; return; }
  if (Date.now() < pausedUntil) return schedule(pausedUntil - Date.now());

  inflight = true;
  try {
    const res = await request('GET', '/me/player?additional_types=track,episode');
    if (res.status === 204 || res.status === 202) emit(idle());
    else if (res.ok) emit(toPlayer(await res.json()));
    else if (res.status !== 429) console.warn('Spotify poll failed:', res.status);
  } catch (err) {
    inflight = false;
    if (err instanceof auth.LoggedOutError) {
      stop();
      handlers.onLoggedOut();
      return;
    }
    emit({ ...(lastPlayer || idle()), offline: true });
  }
  inflight = false;
  if (pollSoon) { pollSoon = false; schedule(300); } else schedule();
}

function currentProgress(p) {
  return p.progressMs + (p.isPlaying ? Date.now() - p.receivedAt : 0);
}

function explain(status, body) {
  const reason = body?.error?.reason;
  if (status === 404 || reason === 'NO_ACTIVE_DEVICE') return 'No active device — start Spotify somewhere first';
  if (reason === 'PREMIUM_REQUIRED') return 'Spotify Premium is needed for controls';
  if (status === 429) return 'Spotify says slow down — try again in a sec';
  return body?.error?.message || `Spotify error (${status})`;
}

const COMMANDS = {
  next: ['POST', '/me/player/next'],
  prev: ['POST', '/me/player/previous'],
  play: ['PUT', '/me/player/play'],
  pause: ['PUT', '/me/player/pause'],
};

async function control(action) {
  if (!running) return;
  if (action === 'toggle') action = lastPlayer?.isPlaying ? 'pause' : 'play';
  const command = COMMANDS[action];
  if (!command) return;

  // Show play/pause instantly; the next poll confirms it.
  if (lastPlayer?.track && (action === 'play' || action === 'pause')) {
    emit({ ...lastPlayer, isPlaying: action === 'play', progressMs: currentProgress(lastPlayer), receivedAt: Date.now() });
  }

  try {
    const res = await request(...command);
    if (!res.ok) handlers.onToast(explain(res.status, await res.json().catch(() => null)));
  } catch (err) {
    if (err instanceof auth.LoggedOutError) {
      stop();
      handlers.onLoggedOut();
      return;
    }
    handlers.onToast('Can’t reach Spotify');
  }
  if (inflight) pollSoon = true;
  else schedule(350);
}

function start() {
  if (running) return;
  running = true;
  schedule(0);
}

function stop() {
  running = false;
  clearTimeout(timer);
  lastPlayer = null;
}

function setVisible(v) {
  visible = v;
  if (v) schedule(0);
}

module.exports = { init, start, stop, control, setVisible };
