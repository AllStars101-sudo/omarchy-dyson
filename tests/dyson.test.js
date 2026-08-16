#!/usr/bin/env node

const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")

// The QML modules are loaded into a sandbox rather than required, because they
// are plain scripts shared with QML's JS engine and carry no module syntax.
// Note: values that cross this boundary have a different Array/Object
// constructor, so assertions compare by value, never with deepStrictEqual.
function load(name) {
  const ctx = {}
  vm.createContext(ctx)
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", name), "utf8"), ctx, { filename: name })
  return ctx
}

const Dyson = load("Dyson.js")
const Config = load("Config.js")
const Origin = load("Origin.js")
const fx = require("./fixtures/synthetic.js")

// The one fixture from real hardware: a Dyson Pure Hot+Cool Link (type 455).
const hp02 = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "hp02-455.json"), "utf8"))
const hp02Fan = "fan.dyson_sz2_au_tba2519a"

let checks = 0
function ok(cond, msg) { assert.ok(cond, msg); checks++ }
function eq(a, b, msg) { assert.equal(a, b, msg); checks++ }

// =========================================================================
// Identity and discovery
// =========================================================================

eq(Dyson.resolveFan(hp02, ""), hp02Fan, "finds the real fan in a live states dump")
eq(Dyson.resolveFan(fx.multiHouse(), ""), "fan.dyson_hp07",
  "picks a Dyson over the unrelated ceiling fan, lowest entity id first")
eq(Dyson.resolveFan(fx.multiHouse(), "fan.dyson_tp09"), "fan.dyson_tp09",
  "an explicit pin always wins")
eq(Dyson.resolveFan([], ""), "", "no fan, no guess")
eq(Dyson.listFans(fx.multiHouse()).length, 2, "both Dysons are offered, the ceiling fan is not")
eq(Dyson.listFans(hp02)[0].serial, "SZ2-AU-TBA2519A", "serial is recovered for the picker")

// =========================================================================
// The auto-mode regression
// =========================================================================
// A substring match once resolved auto mode to firmware_auto_update, so
// clicking Auto toggled firmware updates. Both fixtures contain that trap.

const hp02Caps = Dyson.discover(hp02, hp02Fan)
eq(hp02Caps.autoSwitch, "",
  "the Link model has NO auto switch, and must not fall back to firmware_auto_update")
ok(Dyson.hasPreset(hp02.find(e => e.entity_id === hp02Fan).attributes, "auto"),
  "the Link model offers auto as a preset instead")

const tp09Caps = Dyson.discover(fx.tp09, "fan.dyson_tp09")
eq(tp09Caps.autoSwitch, "switch.dyson_tp09_auto_mode",
  "a newer model DOES have an auto switch, and it is the right one")
ok(tp09Caps.autoSwitch.indexOf("firmware") === -1, "never firmware_auto_update")

// =========================================================================
// The air-quality regression
// =========================================================================
// Matching on the name "pm25" found nothing on the Link model, which calls it
// "particulates". device_class matching must work on both namings.

eq(hp02Caps.pm25, "sensor.dyson_sz2_au_tba2519a_particulates",
  "PM2.5 found by device_class despite being named 'particulates'")
eq(tp09Caps.pm25, "sensor.dyson_tp09_pm25", "and on a model that names it pm25")
eq(tp09Caps.aqi, "sensor.dyson_tp09_air_quality_index",
  "indoor AQI wins over the outdoor sensor sharing its device_class")
eq(tp09Caps.hcho, "sensor.dyson_tp09_hcho",
  "formaldehyde is found by name, the one reading with no device class")
eq(hp02Caps.hcho, "", "a model without formaldehyde reports none")

// =========================================================================
// Capability discovery per model
// =========================================================================

// Heat
ok(hp02Caps.climate !== "", "HP02 exposes a climate entity")
ok(fx.hp07 && Dyson.discover(fx.hp07, "fan.dyson_hp07").climate !== "", "HP07 exposes heat")
eq(Dyson.discover(fx.tp09, "fan.dyson_tp09").climate, "", "a cool-only model has no climate entity")
eq(Dyson.discover(fx.ph01, "fan.dyson_ph01").climate, "", "a humidifier model has no heat")

// Humidifier
eq(Dyson.discover(fx.ph01, "fan.dyson_ph01").humidifier, "humidifier.dyson_ph01",
  "PH01 exposes a humidifier")
eq(tp09Caps.humidifier, "", "a cool-only model does not")

// Oscillation extras, sleep timer, filters
eq(tp09Caps.sleepTimer, "number.dyson_tp09_sleep_timer")
eq(tp09Caps.oscillationAngle, "number.dyson_tp09_oscillation_angle_span")
eq(tp09Caps.oscillationMode, "select.dyson_tp09_oscillation_mode")
eq(tp09Caps.hepaFilter, "sensor.dyson_tp09_hepa_filter_life")
eq(tp09Caps.carbonFilter, "sensor.dyson_tp09_carbon_filter_life")
eq(tp09Caps.filterReplacement, "binary_sensor.dyson_tp09_filter_replacement")
eq(Dyson.discover(fx.hp07, "fan.dyson_hp07").heatingMode, "select.dyson_hp07_heating_mode")

// The sparse device: every optional control must be absent, not dead.
const sparseCaps = Dyson.discover(fx.sparse, "fan.dyson_sparse")
for (const key of ["climate", "humidifier", "autoSwitch", "nightSwitch", "sleepTimer",
                   "oscillationMode", "pm25", "voc", "aqi", "hcho", "hepaFilter", "reconnect"]) {
  eq(sparseCaps[key], "", `a minimal device exposes no ${key}`)
}

// Reconnect button, which drives the staleness self-heal
eq(hp02Caps.reconnect, "button.dyson_sz2_au_tba2519a_reconnect")

// =========================================================================
// Device scoping
// =========================================================================
// Two fans in one dump must never borrow each other's entities.

const house = fx.multiHouse()
const a = Dyson.discover(house, "fan.dyson_tp09")
const b = Dyson.discover(house, "fan.dyson_hp07")
ok(a.pm25.indexOf("tp09") > 0 && b.pm25.indexOf("hp07") > 0,
  "each fan resolves only its own sensors")
eq(b.climate, "climate.dyson_hp07", "the heater belongs to the fan that has one")
eq(a.climate, "", "and not to the one that doesn't")

// =========================================================================
// Speed
// =========================================================================

const hp02Attrs = hp02.find(e => e.entity_id === hp02Fan).attributes
eq(Dyson.stepsFor(hp02Attrs), 10)
eq(Dyson.stepsFor({}), 10, "a missing step assumes Dyson's ten speeds")
eq(Dyson.speedFromPercentage(null, hp02Attrs), 0, "an absent percentage reads as off")
eq(Dyson.speedFromPercentage(0, hp02Attrs), 0)

// Round-tripping every speed must be lossless, or the slider fights the fan.
for (const attrs of [hp02Attrs, { percentage_step: 20 }, { percentage_step: 25 }]) {
  const steps = Dyson.stepsFor(attrs)
  for (let s = 0; s <= steps; s++) {
    eq(Dyson.speedFromPercentage(Dyson.percentageFromSpeed(s, attrs), attrs), s,
      `speed ${s} of ${steps} round-trips`)
  }
}
eq(Dyson.percentageFromSpeed(99, hp02Attrs), 100, "speeds clamp to the top of the dial")
eq(Dyson.percentageFromSpeed(-3, hp02Attrs), 0, "and to the bottom")

// =========================================================================
// Presets
// =========================================================================

eq(Dyson.isAutoMode({ auto_mode: true, preset_mode: "manual" }), true,
  "the attribute wins over a stale preset_mode")
eq(Dyson.isAutoMode({ preset_mode: "Auto" }), true, "falls back to preset_mode, case-insensitively")
eq(Dyson.isAutoMode({}), false)
ok(!Dyson.hasPreset({}, "auto"), "no preset_modes means no presets")

// =========================================================================
// Air quality banding
// =========================================================================

eq(Dyson.pm25Band(0), "good")
eq(Dyson.pm25Band(12), "good")
eq(Dyson.pm25Band(13), "fair")
eq(Dyson.pm25Band(35), "fair")
eq(Dyson.pm25Band(55), "poor")
eq(Dyson.pm25Band(120), "bad")
eq(Dyson.pm25Band("unavailable"), "unknown")
eq(Dyson.pm25Band(""), "unknown", "an empty reading is not a good reading")

// =========================================================================
// Model naming
// =========================================================================

eq(Dyson.modelName("455"), "Dyson Pure Hot+Cool Link")
eq(Dyson.modelName("527k"), "Dyson Purifier Hot+Cool", "codes are case-insensitive")
eq(Dyson.modelName("358E"), "Dyson Purifier Humidify+Cool Formaldehyde")
eq(Dyson.modelName("999"), "Dyson 999", "an unknown code degrades to the truth")
eq(Dyson.modelName(""), "")
eq(Dyson.modelName("unknown"), "")

// =========================================================================
// History
// =========================================================================

const pts = Dyson.parseHistory([[
  { state: "unknown", last_changed: "2026-08-16T05:00:00Z" },
  { state: "5", last_changed: "2026-08-16T05:10:00Z" },
  { state: "unavailable", last_changed: "2026-08-16T05:20:00Z" },
  { state: "9", last_changed: "2026-08-16T05:30:00Z" },
  { state: "3", last_changed: "2026-08-16T05:40:00Z" }
]])
eq(pts.length, 3, "non-numeric states are dropped, not coerced to zero")
eq(pts.map(p => p.v).join(","), "5,9,3")
eq(Dyson.parseHistory([]).length, 0)
eq(Dyson.parseHistory(null).length, 0)
eq(Dyson.parseHistory([[{ state: "7" }]]).length, 0, "a point with no timestamp cannot be plotted")

const stats = Dyson.historyStats(pts)
eq(stats.min, 3); eq(stats.max, 9); eq(stats.last.v, 3, "last is newest, not highest")
eq(Dyson.historyStats([]), null)
eq(Dyson.historyStats(null), null)

const flat = Dyson.historyStats([{ t: 1, v: 3 }, { t: 2, v: 3 }])
eq(flat.max - flat.min, 4, "a flat reading is padded, not amplified into noise")
const zero = Dyson.historyStats([{ t: 1, v: 0 }, { t: 2, v: 0 }])
eq(zero.min, 0, "padding never produces a negative concentration")

// =========================================================================
// Liveness
// =========================================================================

const T = Date.parse("2026-08-16T08:05:00+00:00")
eq(Dyson.stalenessMs(fx.tp09, "fan.dyson_tp09", T), 300000, "five minutes since the last word")

// The trap: the fan entity alone looks stale even when the device is alive.
const quietFan = [fx.entity("fan.dyson_q", "on", { night_mode: false }, "2026-08-16T06:00:00+00:00"),
                  fx.entity("sensor.dyson_q_pm25", "3", { device_class: "pm25" }, "2026-08-16T08:04:00+00:00")]
eq(Dyson.stalenessMs(quietFan, "fan.dyson_q", T), 60000,
  "a sensor heartbeat proves liveness even when the fan itself has not changed")
eq(Dyson.stalenessMs([quietFan[0]], "fan.dyson_q", T), 7500000,
  "the fan entity alone would wrongly read as hours stale")

// Unknown is not stale — otherwise a cold start fires a reconnect before the
// first poll has even landed.
eq(Dyson.stalenessMs([fx.entity("fan.dyson_q", "on", {}, null)].map(e => ({ entity_id: e.entity_id, state: e.state, attributes: e.attributes })), "fan.dyson_q", T), -1)
eq(Dyson.stalenessMs([], "fan.dyson_q", T), -1)

// =========================================================================
// Origin normalization
// =========================================================================
// The keyring scopes tokens by origin, so two spellings of one address must
// normalize identically or a stored token becomes unfindable.

eq(Origin.normalizeOrigin("http://localhost:8123"), "http://localhost:8123")
eq(Origin.normalizeOrigin("http://localhost:8123/"), "http://localhost:8123",
  "a trailing slash is the same server")
eq(Origin.normalizeOrigin("http://localhost:8123/lovelace/0"), "http://localhost:8123",
  "so is a pasted dashboard path")
eq(Origin.normalizeOrigin("HTTP://LocalHost:8123"), "http://localhost:8123", "case is normalized")
eq(Origin.normalizeOrigin("homeassistant.local"), "https://homeassistant.local:443",
  "a bare host defaults to https")
eq(Origin.normalizeOrigin("ws://localhost:8123"), "http://localhost:8123",
  "a websocket URL lands on the same origin")
eq(Origin.normalizeOrigin("https://ha.example.com"), "https://ha.example.com:443")
eq(Origin.normalizeOrigin("[::1]:8123"), "https://[::1]:8123",
  "a bare IPv6 host gets the https default like any other")
eq(Origin.normalizeOrigin("[8123]"), "", "a mis-pasted port in brackets is not an address")
eq(Origin.normalizeOrigin("http://[::1]:8123"), "http://[::1]:8123")
eq(Origin.normalizeOrigin("http://ha.local:8123]"), "", "a half-pasted URL is rejected")
eq(Origin.normalizeOrigin("http://user:pw@ha.local"), "", "userinfo is rejected")
eq(Origin.normalizeOrigin("ftp://ha.local"), "", "only http/https/ws/wss")
eq(Origin.normalizeOrigin(""), "")
eq(Origin.normalizeOrigin("http://ha.local:99999"), "", "an impossible port is rejected")

eq(Origin.isPlaintextRemote("http://ha.example.com:8123"), true, "plaintext off-box warrants a warning")
eq(Origin.isPlaintextRemote("http://localhost:8123"), false, "but localhost does not")
eq(Origin.isPlaintextRemote("http://127.0.0.1:8123"), false)
eq(Origin.isPlaintextRemote("https://ha.example.com:443"), false)

// =========================================================================
// Config
// =========================================================================

const fresh = Config.parse("")
eq(fresh.baseUrl, ""); eq(fresh.barMetric, "Fan speed"); eq(fresh.autoReconnect, true)
eq(fresh.error, "", "an empty file is not an error")

const broken = Config.parse("{not json")
eq(broken.error, "config.json is not valid JSON")
eq(broken.barMetric, "Fan speed", "a broken file still yields usable defaults")

eq(Config.parse('{"barMetric":"nonsense"}').barMetric, "Fan speed", "an invalid metric falls back")
eq(Config.parse('{"historyHours":9999}').historyHours, 240, "out-of-range values clamp")
eq(Config.parse('{"pollSeconds":1}').pollSeconds, 5)
eq(Config.parse('{"autoReconnect":false}').autoReconnect, false)

// Device pinning deliberately does NOT live here. Two bar widgets of the same
// plugin share a module name and can only be told apart by their placement in
// the layout, so each widget's device is stored in its own inline bar entry and
// written by the settings overlay, which is the only surface that knows the
// placements. config.json holds connection and shared display options only.
eq("pinned" in fresh, false, "config.json carries no per-widget pins")
eq("pinned" in JSON.parse(Config.serialize(fresh)), false)

// The runtime `error` field must never be written back into the file.
eq(JSON.parse(Config.serialize(broken)).error, undefined)
ok(Config.serialize(fresh).endsWith("\n"), "serialized config ends with a newline")

console.log(`all ${checks} assertions passed`)
