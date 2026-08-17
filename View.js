// Every decision the panel and bar button make about what to show, as pure
// functions over a plain model object. Kept out of Panel.qml so each view state
// — connecting, unconfigured, stale, heating, humidifying, a device with almost
// no capabilities — can be asserted without a compositor.
//
// The QML side owns pixels and colour values; this owns which text appears,
// which rows exist, and what the numbers say.

var FAN_ICON = "󰈐"

// Home Assistant failures, phrased for someone who did not write this plugin.
var PARSE_ERROR = "Home Assistant sent a response we could not read."

function httpError(status, baseUrl) {
  // Status 0 is XMLHttpRequest's "the request never completed" — a wrong
  // address or a stopped server, not something Home Assistant answered.
  if (status === 0) return "Cannot reach Home Assistant at " + baseUrl + "."
  if (status === 401 || status === 403) return "Home Assistant rejected the access token."
  if (status === 404) return "Home Assistant has no such entity or endpoint."
  return "Home Assistant returned HTTP " + status + "."
}

// --- bar button -----------------------------------------------------------

// A speed reading beside a device that is off describes nothing happening, and
// a reading from a dead session describes the past. Both drop the number rather
// than show one that is wrong.
function barLabel(m) {
  if (m.stale) return FAN_ICON
  if (m.barMetric === "Fan speed") return m.fanOn && m.speed > 0 ? FAN_ICON + "  " + m.speed : FAN_ICON
  if (m.barMetric === "PM2.5" && m.pm25 !== "") return FAN_ICON + "  " + m.pm25
  return FAN_ICON
}

function barActive(m) { return !!m.fanOn && !m.stale }

// Dimmed means "do not trust this", covering both no connection and a stale one.
function barDimmed(m) { return !m.actionable || !!m.stale }

// --- text -----------------------------------------------------------------

// Ordered most-severe first: a widget that cannot reach Home Assistant should
// say so rather than report a device state it has no basis for.
function statusLine(m) {
  if (!m.hasService) return "Dyson Air: starting up"
  if (!m.configured) return "Dyson Air: not connected — click to set up"
  if (m.lastError) return "Dyson Air: " + m.lastError
  if (!m.everLoaded) return "Dyson Air: connecting"
  if (!m.fanEntity) return "Dyson Air: no Dyson found in Home Assistant"
  if (m.stale) return m.title + " — no data for " + staleMinutes(m)
    + " min; Home Assistant lost the device" + (m.autoReconnect ? ", reconnecting" : "")

  var parts = [m.title]
  if (!m.fanOn) parts.push("off")
  else if (m.heating) parts.push("heating to " + Math.round(m.targetTemp) + "°C · speed " + m.speed)
  else parts.push("on · speed " + m.speed)
  if (isFiniteNumber(m.currentTemp)) parts.push(Number(m.currentTemp).toFixed(1) + "°C")
  if (m.pm25 !== "") parts.push("PM2.5 " + m.pm25 + " µg/m³")
  return parts.join(" — ")
}

function heroSubtitle(m) {
  if (!m.configured) return "Not connected"
  if (m.lastError) return m.lastError
  if (!m.fanEntity) return "No Dyson found"
  if (m.stale) return "No data for " + staleMinutes(m) + " min"
    + (m.autoReconnect ? " · reconnecting" : "")
  var s = m.fanOn ? "On · speed " + m.speed + " of " + m.maxSpeed : "Off"
  if (m.heating) s = "Heating · speed " + m.speed
  if (isFiniteNumber(m.currentTemp)) s += " · " + Number(m.currentTemp).toFixed(1) + "°C"
  return s
}

function staleMinutes(m) { return Math.round((m.staleMs || 0) / 60000) }

function isFiniteNumber(v) {
  return v !== null && v !== undefined && v !== "" && isFinite(Number(v))
}

// --- which rows exist -----------------------------------------------------
// A control that cannot act is hidden, never greyed: a permanently dead row is
// worse than a shorter panel.

function sections(m) {
  var hasClimate = !!m.climateEntity && (m.hvacModes || []).length > 0
  return {
    // The device switcher would silently disagree with a pinned widget's own
    // settings, so it appears only when the widget is following autodetect.
    deviceSwitcher: (m.fans || []).length > 1 && !m.pinnedFan,
    climate: hasClimate,
    // Off/Fan/Heat subsumes power on a heater: the climate entity's "off" is
    // the same off, and two controls could disagree about the device state.
    powerToggle: !hasClimate,
    targetTemp: hasClimate && !!m.heating,
    humidifier: !!m.humidifierEntity,
    // A humidity target on a humidifier that is off has no effect to observe.
    humiditySlider: !!m.humidifierEntity && !!m.humidifying,
    // A single airflow mode is not a choice, so the row needs two.
    airflow: airflowOptions(m.fanModes).length > 1,
    // An angle chosen while the head is still has nothing to observe, so the
    // width row follows the oscillation toggle. Tilt is a separate axis and
    // does not.
    oscillationAngle: selectOptions(m.angleOptions).length > 0 && !!m.oscillating,
    tilt: selectOptions(m.tiltOptions).length > 0,
    nightMode: !!m.nightSwitch,
    autoMode: !!m.autoSupported,
    sleepTimer: !!m.sleepTimerEntity,
    monitoring: !!m.monitorSwitch,
    heatingMode: (m.heatingModeOptions || []).length > 1,
    waterHardness: (m.waterHardnessOptions || []).length > 1,
    direction: !!m.directionSupported,
    airQuality: readings(m).length > 0,
    graph: (m.historyPoints || 0) > 1,
    filterWarning: !!m.filterDue,
    // Aiming needs somewhere to aim: with the head still there is nothing to
    // narrow. The service works on every model, so unlike the other controls
    // this one is not gated on an entity existing.
    aiming: !!m.oscillating && !!m.fanEntity,
    details: details(m).length > 0,
    // Diagnostics stay folded away until something in them is worth reading.
    detailsOpenByDefault: activeFaultCount(m) > 0 || !!m.filterDue
  }
}

function activeFaultCount(m) {
  var list = m.faults || []
  var n = 0
  for (var i = 0; i < list.length; i++) if (list[i].active) n++
  return n
}

// --- diagnostics ----------------------------------------------------------

// The read-only half: everything Home Assistant knows about the device that no
// control acts on. Each row is {label, value, alarm}; absent entities produce
// no row, so a device that reports little shows a short list rather than a
// column of dashes.
function details(m) {
  var out = []
  function add(label, value, alarm) {
    if (value === "" || value === null || value === undefined) return
    out.push({ label: label, value: String(value), alarm: !!alarm })
  }

  var air = m.aqiCategory || ""
  if (air && m.dominantPollutant) air += " · " + m.dominantPollutant + " leading"
  add("Air quality", air)
  add("Outdoor AQI", m.outdoorAqi)

  add("HEPA filter", filterLine(m.hepaFilter, m.hepaFilterType), !!m.filterDue)
  add("Carbon filter", filterLine(m.carbonFilter, m.carbonFilterType))

  var link = m.connectionStatus || ""
  if (link && isFiniteNumber(m.wifiSignal)) link += " · " + m.wifiSignal + " dBm"
  else if (!link && isFiniteNumber(m.wifiSignal)) link = m.wifiSignal + " dBm"
  add("Connection", link)
  add("Schedule", m.scheduledEvents)

  var faults = m.faults || []
  if (faults.length) {
    var bad = []
    for (var i = 0; i < faults.length; i++) if (faults[i].active) bad.push(faults[i].label)
    add("Faults", bad.length ? bad.join(", ") : "None reported", bad.length > 0)
  }
  return out
}

// Percentage and cartridge type read as one fact, and either half can be
// missing: a device with no cartridge fitted reports a type and no life.
function filterLine(life, type) {
  var parts = []
  if (isFiniteNumber(life)) parts.push(life + "%")
  if (type) parts.push(String(type))
  return parts.join(" · ")
}

// --- readings -------------------------------------------------------------

// Readings are drawn in the theme's foreground, with one exception: PM2.5
// carries an alarm flag so genuinely bad air can be called out.
function readings(m) {
  var out = []
  function add(label, value, unit, alarm) {
    if (value !== "" && value !== null && value !== undefined)
      out.push({ label: label, value: value, unit: unit, alarm: !!alarm })
  }
  add("PM2.5", m.pm25, "µg/m³", true)
  add("PM10", m.pm10, "µg/m³")
  add("VOC", m.voc, "")
  add("NO₂", m.no2, "")
  add("HCHO", m.hcho, "mg/m³")
  add("CO₂", m.co2, "ppm")
  add("AQI", m.aqi, "")
  add("Humidity", m.humidity, "%")
  add("Filter", m.hepaFilter, "%")
  return out
}

// Named rather than valued so the QML side owns the palette. `alarmActive` is
// Dyson.airQualityAlarm, passed in rather than imported: this file has to load
// under both QML's JS engine and node, and cross-file imports do not survive
// both cleanly.
function readingColorKey(entry, alarmActive) {
  return entry && entry.alarm && alarmActive ? "urgent" : "foreground"
}

function readingText(entry) {
  return entry.value + (entry.unit ? " " + entry.unit : "")
}

// --- controls -------------------------------------------------------------

// Home Assistant's hvac mode names are not what a person calls them on a fan.
function hvacOptions(hvacModes) {
  var out = []
  var modes = hvacModes || []
  for (var i = 0; i < modes.length; i++) {
    var mode = String(modes[i])
    var label = mode === "fan_only" ? "Fan" : (mode === "heat" ? "Heat" : "Off")
    out.push({ value: mode, label: label })
  }
  return out
}

// Focused jet versus diffused spill, which hass-dyson carries as the climate
// entity's fan_mode on FocusMode-capable devices. Home Assistant's own names
// for these are "focus" and "diffuse"; anything else a device offers is titled
// and passed through rather than dropped.
function airflowOptions(fanModes) {
  var out = []
  var modes = fanModes || []
  for (var i = 0; i < modes.length; i++) {
    var mode = modes[i]
    if (typeof mode !== "string" || mode === "") continue
    var label = mode === "focus" ? "Focused"
      : (mode === "diffuse" ? "Diffused"
        : mode.charAt(0).toUpperCase() + mode.slice(1))
    out.push({ value: mode, label: label })
  }
  return out
}

// Minutes as the device counts them. Zero is off rather than "0m", which would
// read as a timer about to fire.
function sleepTimerLabel(minutes) {
  if (!isFiniteNumber(minutes)) return ""
  var m = Math.max(0, Math.round(Number(minutes)))
  if (m === 0) return "Off"
  if (m < 60) return m + "m"
  var h = Math.floor(m / 60)
  var rest = m % 60
  return rest ? h + "h " + rest + "m" : h + "h"
}

// What the current sweep range means in words. Absolute to the machine's own
// zero, so this describes the arc rather than naming a direction in the room.
function angleLabel(low, high, minAngle, maxAngle) {
  if (!isFiniteNumber(low) || !isFiniteNumber(high)) return ""
  var l = Number(low)
  var h = Number(high)
  if (l === h) return "Held at " + l + "°"
  if (l <= minAngle && h >= maxAngle) return "Full sweep"
  return l + "° – " + h + "°  (" + (h - l) + "° arc)"
}

// The aim presets plus a Custom chip that reveals the two angle sliders. Takes
// the preset list rather than importing it: this file has to load under both
// QML's JS engine and node, and cross-file imports do not survive both.
function aimOptions(presets) {
  var out = []
  var list = presets || []
  for (var i = 0; i < list.length; i++)
    out.push({ value: list[i].value, label: list[i].label })
  out.push({ value: "custom", label: "···" })
  return out
}

// A range matching no preset IS custom, so it selects the Custom chip and the
// sliders unfold on their own — otherwise the panel would show an arc no lit
// chip accounted for.
function aimChoice(activePreset, userWantsCustom) {
  if (userWantsCustom) return "custom"
  return activePreset || "custom"
}

// On/off as two chips. A switch reads the same as every other chip row this
// way, rather than being the one control shaped like a card.
function onOffOptions() {
  return [{ value: "on", label: "On" }, { value: "off", label: "Off" }]
}

// A Home Assistant `select` renders as a chip row. The labels are the
// integration's own ("45°", "Breeze", "Custom") and are passed through rather
// than rewritten: a model this plugin has never seen will list options nobody
// here anticipated, and a hardcoded label map would drop them.
function selectOptions(options) {
  var out = []
  var list = options || []
  for (var i = 0; i < list.length; i++) {
    var value = list[i]
    if (typeof value !== "string" || value === "") continue
    out.push({ value: value, label: value })
  }
  return out
}

// Serial first: two of the same model are otherwise indistinguishable in a list.
function deviceOptions(fans, includeAutomatic) {
  var out = includeAutomatic ? [{ value: "", label: "Automatic" }] : []
  var list = fans || []
  for (var i = 0; i < list.length; i++)
    out.push({ value: list[i].entityId, label: list[i].serial || list[i].name })
  return out
}

// The icon turns once every 3s at the slowest setting and ~0.35s at the
// fastest, on any device regardless of how many speeds its dial has: fast
// enough to read at a glance without becoming a distraction.
function spinDurationMs(speed, maxSpeed) {
  var steps = Math.max(1, Number(maxSpeed) || 1)
  if (steps < 2) return 3000
  var s = Math.max(1, Math.min(steps, Number(speed) || 1))
  return Math.max(350, Math.round(3000 - (s - 1) * (2650 / (steps - 1))))
}

// --- settings -------------------------------------------------------------

// Each placed widget is addressed by where it sits, because two widgets of one
// plugin share a module name and nothing else tells them apart.
function placements(barLayout, pluginId) {
  var out = []
  if (!barLayout) return out
  var order = ["left", "center", "right"]
  for (var s = 0; s < order.length; s++) {
    var list = barLayout[order[s]] || []
    var seen = 0
    for (var i = 0; i < list.length; i++) {
      var entry = list[i]
      var id = entry && entry.id ? String(entry.id) : String(entry)
      if (id !== pluginId) continue
      seen++
      out.push({
        section: order[s],
        index: i,
        // Deliberately NOT the bar position. Omarchy's Super+Ctrl+N hotkey
        // counts only panel-capable widgets, so a label carrying `index` would
        // print a number that disagrees with the key that opens the panel.
        // This counts this plugin's own widgets, which is all the label is for:
        // telling two of them apart.
        label: order[s].charAt(0).toUpperCase() + order[s].slice(1)
          + (seen > 1 ? " #" + seen : ""),
        fanEntity: entry && entry.fanEntity ? String(entry.fanEntity) : ""
      })
    }
  }
  return out
}

// Which settings tab a summon payload asks for, or "" when the summon did not
// come from this plugin's own settings button.
//
// Declaring an `overlay` kind opts a plugin out of Omarchy's bar-widget summon
// path, so the shell's generic toggle (the Super+Ctrl+N bar hotkey, and
// `omarchy-shell shell toggle <id>`) lands on the overlay rather than on the
// panel. Those arrive with an empty payload; the settings button always names a
// tab. Anything without a tab is a request for the panel.
function settingsTab(payloadJson) {
  var payload = {}
  try {
    payload = JSON.parse(payloadJson || "{}") || {}
  } catch (e) {
    return ""
  }
  if (payload.tab === "devices" || payload.tab === "connection") return payload.tab
  return ""
}

function connectionStatus(m) {
  if (m.notice) return { text: m.notice, error: false }
  if (!m.hasService) return { text: "", error: false }
  if (m.lastError) return { text: m.lastError, error: true }
  if (m.ready) return {
    text: "Connected · " + m.fanCount + (m.fanCount === 1 ? " Dyson found" : " Dysons found"),
    error: false
  }
  if (m.configured) return { text: "Connecting…", error: false }
  return { text: "Not connected.", error: false }
}

if (typeof module !== "undefined") module.exports = {
  FAN_ICON: FAN_ICON, PARSE_ERROR: PARSE_ERROR, httpError: httpError, barLabel: barLabel, barActive: barActive, barDimmed: barDimmed,
  statusLine: statusLine, heroSubtitle: heroSubtitle, staleMinutes: staleMinutes,
  isFiniteNumber: isFiniteNumber, sections: sections, readings: readings,
  readingText: readingText, readingColorKey: readingColorKey, hvacOptions: hvacOptions,
  selectOptions: selectOptions, airflowOptions: airflowOptions,
  aimOptions: aimOptions, aimChoice: aimChoice, onOffOptions: onOffOptions,
  details: details, filterLine: filterLine, activeFaultCount: activeFaultCount,
  sleepTimerLabel: sleepTimerLabel, angleLabel: angleLabel,
  deviceOptions: deviceOptions, spinDurationMs: spinDurationMs,
  placements: placements, connectionStatus: connectionStatus, settingsTab: settingsTab
}
