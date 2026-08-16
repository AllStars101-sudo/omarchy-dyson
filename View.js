// Every decision the panel and bar button make about what to show, as pure
// functions over a plain model object. Kept out of Panel.qml so each view state
// — connecting, unconfigured, stale, heating, humidifying, a device with almost
// no capabilities — can be asserted without a compositor.
//
// The QML side owns pixels and colour values; this owns which text appears,
// which rows exist, and what the numbers say.

var FAN_ICON = "󰈐"

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
    nightMode: !!m.nightSwitch,
    autoMode: !!m.autoSupported,
    airQuality: readings(m).length > 0,
    graph: (m.historyPoints || 0) > 1,
    filterWarning: !!m.filterDue
  }
}

// --- readings -------------------------------------------------------------

// Only PM2.5 is banded. The others have no comparably settled thresholds, so
// colouring them would imply a judgement this plugin cannot actually make.
function readings(m) {
  var out = []
  function add(label, value, unit, band) {
    if (value !== "" && value !== null && value !== undefined)
      out.push({ label: label, value: value, unit: unit, band: !!band })
  }
  add("PM2.5", m.pm25, "µg/m³", true)
  add("PM10", m.pm10, "µg/m³", false)
  add("VOC", m.voc, "", false)
  add("NO₂", m.no2, "", false)
  add("HCHO", m.hcho, "mg/m³", false)
  add("CO₂", m.co2, "ppm", false)
  add("AQI", m.aqi, "", false)
  add("Humidity", m.humidity, "%", false)
  add("Filter", m.hepaFilter, "%", false)
  return out
}

function readingText(entry) {
  return entry.value + (entry.unit ? " " + entry.unit : "")
}

// Colour is named rather than valued so the QML side owns the palette.
function bandColorKey(band) {
  if (band === "fair") return "accent"
  if (band === "poor" || band === "bad") return "urgent"
  return "foreground"
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
    for (var i = 0; i < list.length; i++) {
      var entry = list[i]
      var id = entry && entry.id ? String(entry.id) : String(entry)
      if (id !== pluginId) continue
      out.push({
        section: order[s],
        index: i,
        label: order[s] + " · " + (i + 1),
        fanEntity: entry && entry.fanEntity ? String(entry.fanEntity) : ""
      })
    }
  }
  return out
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
  FAN_ICON: FAN_ICON, barLabel: barLabel, barActive: barActive, barDimmed: barDimmed,
  statusLine: statusLine, heroSubtitle: heroSubtitle, staleMinutes: staleMinutes,
  isFiniteNumber: isFiniteNumber, sections: sections, readings: readings,
  readingText: readingText, bandColorKey: bandColorKey, hvacOptions: hvacOptions,
  deviceOptions: deviceOptions, spinDurationMs: spinDurationMs,
  placements: placements, connectionStatus: connectionStatus
}
