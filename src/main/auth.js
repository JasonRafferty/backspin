// Spotify login using the Authorization Code + PKCE flow (no client secret needed).
// A one-shot local server on 127.0.0.1:8888 catches the redirect from the browser.
const crypto = require('crypto');
const http = require('http');
const { shell } = require('electron');
const store = require('./store');

const PORT = 8888;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`;
const SCOPES = [
  'user-read-currently-playing',
  'user-read-playback-state',
  'user-modify-playback-state',
].join(' ');

class LoggedOutError extends Error {}

let access = null; // { token, expiresAt }
let refreshing = null;
let pendingLogin = null; // { cancel() }

const clientId = () => store.get('clientId');
const isLoggedIn = () => !!store.getSecret('refreshToken');

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function tokenRequest(params) {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error_description || body.error || `Token request failed (${res.status})`);
    err.code = body.error;
    throw err;
  }
  return body;
}

function saveTokens(tokens) {
  access = { token: tokens.access_token, expiresAt: Date.now() + tokens.expires_in * 1000 };
  // Spotify sometimes rotates the refresh token; keep the newest one.
  if (tokens.refresh_token) store.setSecret('refreshToken', tokens.refresh_token);
}

async function refresh() {
  const refreshToken = store.getSecret('refreshToken');
  if (!refreshToken || !clientId()) throw new LoggedOutError('Not logged in');
  try {
    saveTokens(await tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId(),
    }));
    return access.token;
  } catch (err) {
    if (err.code === 'invalid_grant' || err.code === 'invalid_client') {
      logout();
      throw new LoggedOutError(err.message);
    }
    throw err; // network trouble etc. — stay logged in and retry later
  }
}

async function getAccessToken() {
  if (access && Date.now() < access.expiresAt - 60_000) return access.token;
  if (!refreshing) refreshing = refresh().finally(() => { refreshing = null; });
  return refreshing;
}

function invalidateAccessToken() {
  access = null;
}

function logout() {
  access = null;
  store.setSecret('refreshToken', null);
}

function waitForCallback(expectedState, openBrowser) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (err, code) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      pendingLogin = null;
      server.close();
      server.closeAllConnections?.();
      err ? reject(err) : resolve(code);
    };

    const server = http.createServer((req, res) => {
      const url = new URL(req.url, REDIRECT_URI);
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      const error = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      const ok = !error && code && url.searchParams.get('state') === expectedState;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(callbackPage(ok ? 'Backspin is connected' : 'Login failed',
        ok ? 'You can close this tab and go back to your turntable.' : (error || 'Please try again.')));
      if (ok) finish(null, code);
      else finish(new Error(error === 'access_denied' ? 'Login was cancelled in the browser' : 'Login failed — please try again'));
    });

    const timeout = setTimeout(() => finish(new Error('Login timed out')), 5 * 60_000);

    server.on('error', (err) => finish(err.code === 'EADDRINUSE'
      ? new Error(`Port ${PORT} is busy — close whatever is using it and try again`)
      : err));

    pendingLogin = {
      cancel: () => {
        const err = new Error('Login cancelled');
        err.cancelled = true;
        finish(err);
      },
    };

    server.listen(PORT, '127.0.0.1', openBrowser);
  });
}

async function login() {
  const id = clientId();
  if (!id) throw new Error('Add your Client ID first');
  cancelLogin();

  const verifier = b64url(crypto.randomBytes(64));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));
  const authorizeUrl = 'https://accounts.spotify.com/authorize?' + new URLSearchParams({
    client_id: id,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    scope: SCOPES,
    state,
  });

  const code = await waitForCallback(state, () => shell.openExternal(authorizeUrl));
  saveTokens(await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: id,
    code_verifier: verifier,
  }));
}

function cancelLogin() {
  pendingLogin?.cancel();
}

function callbackPage(title, message) {
  return `<!doctype html><meta charset="utf-8"><title>${title}</title>
<style>body{margin:0;height:100vh;display:grid;place-items:center;background:#121214;color:#eee;font:16px system-ui,sans-serif;text-align:center}
.disc{width:96px;height:96px;margin:0 auto 20px;border-radius:50%;background:radial-gradient(circle,#1db954 0 28%,#111 29% 100%)}</style>
<div><div class="disc"></div><h1>${title}</h1><p>${message}</p></div>`;
}

module.exports = {
  REDIRECT_URI,
  LoggedOutError,
  login,
  cancelLogin,
  logout,
  isLoggedIn,
  getAccessToken,
  invalidateAccessToken,
};
