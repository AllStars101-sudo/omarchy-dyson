// Pure helpers for mapping a Home Assistant /api/states dump onto Dyson air
// treatment devices. No QML types, so tests/ can run it under plain node.
//
// The design rule throughout: discover what EXISTS rather than branch on model.
// hass-dyson creates entities conditionally from the device's own capability
// list (Heating, Humidifier, Formaldehyde, VOC, ExtendedAQ, AdvanceOscillation,
// Scheduling), so entity presence already is the capability map. A widget that
// renders only what it finds supports models nobody has tested it against.

// --- identity -------------------------------------------------------------

// Every entity on one device shares a slug derived from the fan's serial:
// fan.dyson_sz2_au_tba2519a, switch.<slug>_night_mode, sensor.<slug>_particulates.
function slugOf(entityId) {
  var dot = String(entityId || "").indexOf(".")
  return dot < 0 ? "" : entityId.slice(dot + 1)
}

function isDysonFan(state) {
  if (!state || String(state.entity_id || "").indexOf("fan.") !== 0) return false
  var attrs = state.attributes || {}
  // Dyson-specific attributes are a firmer signal than a user-editable name.
  if (attrs.night_mode !== undefined || attrs.oscillation_span !== undefined) return true
  var haystack = [
    attrs.model, attrs.manufacturer, attrs.friendly_name, state.entity_id
  ].join(" ").toLowerCase()
  return haystack.indexOf("dyson") >= 0
}

function listFans(states) {
  var out = []
  for (var i = 0; i < states.length; i++) {
    if (!isDysonFan(states[i])) continue
    var attrs = states[i].attributes || {}
    out.push({
      entityId: states[i].entity_id,
      name: attrs.friendly_name || states[i].entity_id,
      serial: serialFromName(attrs.friendly_name || "")
    })
  }
  out.sort(function(a, b) { return a.entityId < b.entityId ? -1 : 1 })
  return out
}

// An explicit entity id always wins, even when absent from the dump: a fan that
// is unreachable at startup should still be the one we control once it comes
// back, rather than silently sliding onto some other fan in the house.
function resolveFan(states, configured) {
  if (configured) return configured
  var fans = listFans(states)
  return fans.length ? fans[0].entityId : ""
}

// --- entity lookup --------------------------------------------------------

// Entities on the same device, in a given domain. The slug must be followed by
// a separator or nothing, which rules out unrelated devices — but NOT a sibling
// whose slug genuinely extends this one's (`<slug>_two_particulates` is a real
// `<slug>_*` match). Entity ids alone cannot separate those, so the callers
// break the tie: companionEntity requires an exact suffix, sensorByClass
// prefers the shortest name.
function deviceEntities(states, fanEntity, domain) {
  var slug = slugOf(fanEntity)
  var out = []
  if (!slug) return out
  for (var i = 0; i < states.length; i++) {
    var id = String(states[i].entity_id || "")
    if (id.indexOf(domain + ".") !== 0) continue
    var tail = slugOf(id)
    if (tail !== slug && tail.indexOf(slug + "_") !== 0) continue
    out.push(states[i])
  }
  return out
}

// Suffix match is EXACT, never a substring. A substring match here once made
// "auto mode" resolve to switch.<slug>_firmware_auto_update, so clicking Auto
// toggled firmware updates instead. A control that silently drives the wrong
// entity is worse than one that is absent, so an unrecognised name yields "".
function companionEntity(states, fanEntity, domain, suffixes) {
  var slug = slugOf(fanEntity)
  var candidates = deviceEntities(states, fanEntity, domain)
  for (var s = 0; s < suffixes.length; s++) {
    for (var i = 0; i < candidates.length; i++) {
      var rest = slugOf(candidates[i].entity_id).slice(slug.length).replace(/^_+/, "")
      if (rest === suffixes[s]) return candidates[i].entity_id
    }
  }
  return ""
}

// The primary entity of a domain for this device: same slug, no suffix.
function primaryEntity(states, fanEntity, domain) {
  var slug = slugOf(fanEntity)
  var candidates = deviceEntities(states, fanEntity, domain)
  for (var i = 0; i < candidates.length; i++)
    if (slugOf(candidates[i].entity_id) === slug) return candidates[i].entity_id
  return candidates.length ? candidates[0].entity_id : ""
}

// Air quality sensors are found by device_class rather than by name: this
// integration calls PM2.5 "particulates" on older models and "pm25" on newer
// ones, and the declared class is right on both.
function sensorByClass(states, fanEntity, deviceClass) {
  var candidates = deviceEntities(states, fanEntity, "sensor")
  var best = ""
  for (var i = 0; i < candidates.length; i++) {
    var attrs = candidates[i].attributes || {}
    if (attrs.device_class !== deviceClass) continue
    var id = candidates[i].entity_id
    // Dyson publishes an outdoor AQI alongside the indoor one, and a panel that
    // silently showed the outdoors would be actively misleading.
    if (/outdoor|external/.test(id)) continue
    // Prefer the plainest name when a class has several instances (a 15-minute
    // average sits alongside the instantaneous reading).
    if (!best || id.length < best.length) best = id
  }
  return best
}

// Formaldehyde is the one reading with no Home Assistant device class, so it is
// the one place a name match is correct rather than a shortcut.
function sensorByName(states, fanEntity, suffixes) {
  return companionEntity(states, fanEntity, "sensor", suffixes)
}

// --- capability discovery -------------------------------------------------

// Everything the panel might render, resolved once per poll. Absent entities
// come back as "" and their controls are simply not drawn.
function discover(states, fanEntity) {
  return {
    fan: fanEntity,
    climate: primaryEntity(states, fanEntity, "climate"),
    humidifier: primaryEntity(states, fanEntity, "humidifier"),
    reconnect: companionEntity(states, fanEntity, "button", ["reconnect"]),

    // Auto exists as a switch on newer models and only as a fan preset on the
    // older Link ones, so both forms are resolved and the caller prefers the
    // switch when present.
    autoSwitch: companionEntity(states, fanEntity, "switch", ["auto_mode"]),
    nightSwitch: companionEntity(states, fanEntity, "switch", ["night_mode", "nightmode"]),
    heatSwitch: companionEntity(states, fanEntity, "switch", ["heating"]),
    monitorSwitch: companionEntity(states, fanEntity, "switch", ["continuous_monitoring"]),

    sleepTimer: companionEntity(states, fanEntity, "number", ["sleep_timer"]),
    oscillationAngle: companionEntity(states, fanEntity, "number",
      ["oscillation_angle_span", "oscillation_angle"]),
    oscillationMode: companionEntity(states, fanEntity, "select", ["oscillation_mode", "oscillation"]),
    heatingMode: companionEntity(states, fanEntity, "select", ["heating_mode"]),

    pm25: sensorByClass(states, fanEntity, "pm25"),
    pm10: sensorByClass(states, fanEntity, "pm10"),
    no2: sensorByClass(states, fanEntity, "nitrogen_dioxide"),
    voc: sensorByClass(states, fanEntity, "volatile_organic_compounds"),
    co2: sensorByClass(states, fanEntity, "carbon_dioxide"),
    temperature: sensorByClass(states, fanEntity, "temperature"),
    humidity: sensorByClass(states, fanEntity, "humidity"),
    aqi: sensorByClass(states, fanEntity, "aqi"),
    hcho: sensorByName(states, fanEntity, ["hcho", "formaldehyde"]),

    hepaFilter: companionEntity(states, fanEntity, "sensor", ["hepa_filter_life", "filter_life"]),
    carbonFilter: companionEntity(states, fanEntity, "sensor", ["carbon_filter_life"]),
    filterReplacement: companionEntity(states, fanEntity, "binary_sensor", ["filter_replacement"])
  }
}

// --- presets --------------------------------------------------------------

function hasPreset(attrs, name) {
  var modes = (attrs && attrs.preset_modes) || []
  for (var i = 0; i < modes.length; i++)
    if (String(modes[i]).toLowerCase() === name) return true
  return false
}

function isAutoMode(attrs) {
  if (!attrs) return false
  if (attrs.auto_mode !== undefined) return !!attrs.auto_mode
  return String(attrs.preset_mode || "").toLowerCase() === "auto"
}

// --- speed ----------------------------------------------------------------
// HA fans express speed as a 0-100 percentage plus the step one press moves.
// Dyson's dial is usually 1-10, but Big+Quiet and some others differ, so the
// step is always read from the device rather than assumed.

function stepsFor(attrs) {
  var step = attrs && attrs.percentage_step ? Number(attrs.percentage_step) : 10
  if (!isFinite(step) || step <= 0) step = 10
  return Math.max(1, Math.round(100 / step))
}

function speedFromPercentage(percentage, attrs) {
  var steps = stepsFor(attrs)
  var pct = Number(percentage)
  if (!isFinite(pct) || pct <= 0) return 0
  return Math.max(1, Math.min(steps, Math.round(pct / (100 / steps))))
}

function percentageFromSpeed(speed, attrs) {
  var steps = stepsFor(attrs)
  var s = Math.max(0, Math.min(steps, Math.round(speed)))
  return s === 0 ? 0 : Math.round(s * (100 / steps))
}

// --- air quality ----------------------------------------------------------

// PM2.5 bands in µg/m³, following the WHO 2021 24-hour guidance the Dyson app
// broadly tracks. Returned as a name so the QML side owns the colors.
function pm25Band(value) {
  // A missing reading arrives as "", and Number("") is 0 — which would band an
  // absent sensor as pristine air. Reject blanks before coercing.
  if (value === "" || value === null || value === undefined) return "unknown"
  var v = Number(value)
  if (!isFinite(v)) return "unknown"
  if (v <= 12) return "good"
  if (v <= 35) return "fair"
  if (v <= 55) return "poor"
  return "bad"
}

// --- model names ----------------------------------------------------------
// HA's device registry records Dyson's numeric product type, not a name a
// person would recognise. These are libdyson's published type codes; anything
// unlisted falls back to the raw code, so a model released after this table
// degrades to something truthful rather than to a wrong guess.

var MODEL_NAMES = {
  "358": "Pure Humidify+Cool",
  "358E": "Purifier Humidify+Cool Formaldehyde",
  "358K": "Purifier Humidify+Cool Formaldehyde",
  "438": "Pure Cool Tower",
  "438E": "Purifier Cool Formaldehyde",
  "438K": "Purifier Cool Autoreact",
  "455": "Pure Hot+Cool Link",
  "469": "Pure Cool Link Desk",
  "475": "Pure Cool Link Tower",
  "520": "Pure Cool Desk",
  "527": "Pure Hot+Cool",
  "527E": "Purifier Hot+Cool Formaldehyde",
  "527K": "Purifier Hot+Cool",
  "664": "Purifier Big+Quiet Formaldehyde"
}

function modelName(code) {
  var key = String(code || "").trim().toUpperCase()
  if (!key || key === "NONE" || key === "UNKNOWN") return ""
  if (MODEL_NAMES[key]) return "Dyson " + MODEL_NAMES[key]
  return "Dyson " + key
}

// The serial doubles as the entity slug and is the only thing distinguishing
// two identical fans, so it stays available as a subtitle and picker label.
function serialFromName(friendlyName) {
  var m = String(friendlyName || "").match(/([A-Z0-9]{2,4}-[A-Z]{2}-[A-Z0-9]{6,})/i)
  return m ? m[1] : ""
}

// --- history --------------------------------------------------------------
// /api/history/period returns one series per requested entity, each a list of
// state snapshots. Non-numeric states ("unknown", "unavailable") are real and
// frequent — a fan that has just reconnected reports them — so they are dropped
// rather than coerced, which would draw a phantom dip to zero.

function parseHistory(payload) {
  var series = (Array.isArray(payload) && payload.length) ? payload[0] : []
  var out = []
  for (var i = 0; i < series.length; i++) {
    var row = series[i]
    if (!row) continue
    var v = Number(row.state)
    if (!isFinite(v)) continue
    var t = Date.parse(row.last_changed || row.last_updated || "")
    if (!isFinite(t)) continue
    out.push({ t: t, v: v })
  }
  out.sort(function(a, b) { return a.t - b.t })
  return out
}

// Bounds for plotting. The value range is padded to a minimum span so a flat
// reading draws as a level line rather than as maximally jagged noise amplified
// out of nothing.
function historyStats(points, minSpan) {
  if (!points || !points.length) return null
  var lo = points[0].v, hi = points[0].v
  for (var i = 1; i < points.length; i++) {
    if (points[i].v < lo) lo = points[i].v
    if (points[i].v > hi) hi = points[i].v
  }
  var span = hi - lo
  var floor = minSpan === undefined ? 4 : minSpan
  if (span < floor) {
    var mid = (hi + lo) / 2
    lo = Math.max(0, mid - floor / 2)
    hi = lo + floor
  }
  return {
    min: lo, max: hi,
    first: points[0], last: points[points.length - 1],
    tMin: points[0].t, tMax: points[points.length - 1].t
  }
}

// --- liveness -------------------------------------------------------------
// A Dyson pushes environmental readings continuously, so the newest timestamp
// across the device's entities is a reliable heartbeat. The fan entity alone is
// not: its last_updated only moves when the fan changes, so a fan sitting
// untouched for an hour is indistinguishable from a dead MQTT session.
//
// This matters because a dead session is not an error anywhere — Home Assistant
// keeps serving the last state it saw. Suspending the machine HA runs on
// produces exactly that: on resume the widget would confidently report a fan
// that was turned off hours ago.

function newestUpdate(states, fanEntity) {
  var candidates = deviceEntities(states, fanEntity, "sensor")
    .concat(deviceEntities(states, fanEntity, "fan"))
    .concat(deviceEntities(states, fanEntity, "binary_sensor"))
  var newest = 0
  for (var i = 0; i < candidates.length; i++) {
    var t = Date.parse(candidates[i].last_updated || candidates[i].last_changed || "")
    if (isFinite(t) && t > newest) newest = t
  }
  return newest
}

// Milliseconds since the device last said anything, or -1 when nothing has a
// usable timestamp — which is not the same as stale and must not be treated as
// such, or a cold start would fire a reconnect before the first poll lands.
function stalenessMs(states, fanEntity, now) {
  var newest = newestUpdate(states, fanEntity)
  if (!newest) return -1
  return Math.max(0, (now === undefined ? Date.now() : now) - newest)
}

// QML imports this file directly and never defines `module`; the guard lets
// node require() the same source so coverage instrumentation can see it.
if (typeof module !== "undefined") module.exports = { companionEntity: companionEntity, deviceEntities: deviceEntities, discover: discover, hasPreset: hasPreset, historyStats: historyStats, isAutoMode: isAutoMode, isDysonFan: isDysonFan, listFans: listFans, modelName: modelName, newestUpdate: newestUpdate, parseHistory: parseHistory, percentageFromSpeed: percentageFromSpeed, pm25Band: pm25Band, primaryEntity: primaryEntity, resolveFan: resolveFan, sensorByClass: sensorByClass, sensorByName: sensorByName, serialFromName: serialFromName, slugOf: slugOf, speedFromPercentage: speedFromPercentage, stalenessMs: stalenessMs, stepsFor: stepsFor, MODEL_NAMES: MODEL_NAMES }
