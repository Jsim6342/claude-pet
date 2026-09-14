'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

let cache = null;

function file() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function all() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch {
    cache = {};
  }
  return cache;
}

function get(key, fallback) {
  const v = all()[key];
  return v === undefined ? fallback : v;
}

function set(key, value) {
  all()[key] = value;
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(cache, null, 2));
  } catch (err) {
    console.error('[store] 저장 실패', err);
  }
}

module.exports = { get, set };
