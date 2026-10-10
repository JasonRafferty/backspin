// Tiny JSON settings file in the user's app-data folder.
// Secrets (the Spotify refresh token) are encrypted with the OS keychain via safeStorage.
const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

let data = null;

function file() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function load() {
  if (data) return data;
  try {
    data = JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch {
    data = {};
  }
  return data;
}

function save() {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(data, null, 2));
}

function get(key) {
  return load()[key];
}

function set(key, value) {
  load();
  if (value === undefined || value === null) delete data[key];
  else data[key] = value;
  save();
}

function getSecret(key) {
  const value = get(key);
  if (!value) return null;
  try {
    if (value.enc) return safeStorage.decryptString(Buffer.from(value.enc, 'base64'));
    return value.plain ?? null;
  } catch {
    return null;
  }
}

function setSecret(key, secret) {
  if (!secret) return set(key, null);
  if (safeStorage.isEncryptionAvailable()) {
    set(key, { enc: safeStorage.encryptString(secret).toString('base64') });
  } else {
    set(key, { plain: secret });
  }
}

module.exports = { get, set, getSecret, setSecret };
