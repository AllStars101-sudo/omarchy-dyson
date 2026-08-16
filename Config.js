// Non-secret configuration, stored at ~/.config/omarchy/<plugin-id>/config.json.
// The token is deliberately NOT here: shell.json and this file are both plain
// user-readable JSON, and shell.json in particular is copied into timestamped
// backups by the shell. Tokens live in the system keyring — see
// CredentialManager.qml.
//
// Structure follows konradk/hass ConfigStore.js (MIT, Copyright (c) 2026
// Konrad Kruk); the schema is this plugin's own. See THIRD_PARTY_NOTICES.md.

var DEFAULTS = {
  baseUrl: "",
  barMetric: "Fan speed",
  historyHours: 24,
  pollSeconds: 30,
  staleSeconds: 300,
  autoReconnect: true
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function boundedInt(value, fallback, min, max) {
  // Number(null) is 0 and Number("") is 0, both finite — so coercing first
  // would silently clamp a missing value to the minimum instead of falling
  // back to the default. Reject the blanks before touching Number().
  if (value === null || value === undefined || value === "") return fallback
  var n = Number(value)
  if (!isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.round(n)))
}

function parse(text) {
  var raw = null
  var error = ""
  try {
    raw = JSON.parse(String(text || "") || "{}")
  } catch (e) {
    // A malformed file degrades to defaults rather than leaving the plugin
    // dead: the user can still open settings and fix the connection.
    raw = {}
    error = "config.json is not valid JSON"
  }
  if (!isPlainObject(raw)) { raw = {}; error = error || "config.json is not an object" }

  var metric = String(raw.barMetric || DEFAULTS.barMetric)
  if (["Fan speed", "PM2.5", "None"].indexOf(metric) === -1) metric = DEFAULTS.barMetric

  return {
    baseUrl: typeof raw.baseUrl === "string" ? raw.baseUrl : DEFAULTS.baseUrl,
    barMetric: metric,
    historyHours: boundedInt(raw.historyHours, DEFAULTS.historyHours, 1, 240),
    pollSeconds: boundedInt(raw.pollSeconds, DEFAULTS.pollSeconds, 5, 300),
    staleSeconds: boundedInt(raw.staleSeconds, DEFAULTS.staleSeconds, 60, 3600),
    autoReconnect: raw.autoReconnect !== false,
    error: error
  }
}

function merge(current, patch) {
  var next = {}
  for (var key in DEFAULTS) next[key] = current && key in current ? current[key] : DEFAULTS[key]
  if (isPlainObject(patch)) {
    for (var k in patch) if (k in DEFAULTS) next[k] = patch[k]
  }
  return next
}

// `error` is runtime state, not configuration, and must never be written back.
function serialize(config) {
  var out = {}
  for (var key in DEFAULTS) out[key] = config && key in config ? config[key] : DEFAULTS[key]
  return JSON.stringify(out, null, 2) + "\n"
}

// QML imports this file directly and never defines `module`; the guard lets
// node require() the same source so coverage instrumentation can see it.
if (typeof module !== "undefined") module.exports = { boundedInt: boundedInt, isPlainObject: isPlainObject, merge: merge, parse: parse, serialize: serialize, DEFAULTS: DEFAULTS }
