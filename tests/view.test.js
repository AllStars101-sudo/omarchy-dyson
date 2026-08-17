const { test, describe } = require("node:test")
const assert = require("node:assert/strict")
const View = require("../View.js")

// Every view state the panel and bar can be in, as a model. These are the
// states a screenshot would show; asserting them here is what makes the views
// testable without a compositor.
function model(over) {
  return Object.assign({
    hasService: true, configured: true, everLoaded: true, lastError: "", ready: true,
    actionable: true, fanEntity: "fan.d", title: "Dyson Pure Hot+Cool Link",
    fans: [{ entityId: "fan.d", name: "Dyson A", serial: "AAA-EU-1111111" }],
    pinnedFan: "", barMetric: "Fan speed", fanOn: true, speed: 5, maxSpeed: 10,
    stale: false, staleMs: 0, autoReconnect: true,
    heating: false, targetTemp: 22, currentTemp: 24.15,
    climateEntity: "climate.d", hvacModes: ["off", "fan_only", "heat"],
    humidifierEntity: "", humidifying: false,
    nightSwitch: "switch.d_night_mode", autoSupported: true,
    filterDue: false, historyPoints: 10,
    pm25: "3", pm10: "", voc: "0.0", no2: "", co2: "", hcho: "",
    aqi: "4", humidity: "51", hepaFilter: ""
  }, over || {})
}

describe("bar label", () => {
  test("shows the speed while running", () => {
    assert.equal(View.barLabel(model()), "󰈐  5")
  })

  test("drops the number when the device is off", () => {
    // A speed beside a device that is off describes nothing happening.
    assert.equal(View.barLabel(model({ fanOn: false })), "󰈐")
    assert.equal(View.barLabel(model({ fanOn: true, speed: 0 })), "󰈐")
  })

  test("drops the number when the data is stale", () => {
    // Stale numbers describe the past; showing one is what made an earlier
    // build claim a device was off while it was plainly running.
    assert.equal(View.barLabel(model({ stale: true })), "󰈐")
    assert.equal(View.barLabel(model({ stale: true, barMetric: "PM2.5" })), "󰈐")
  })

  test("PM2.5 mode", () => {
    assert.equal(View.barLabel(model({ barMetric: "PM2.5" })), "󰈐  3")
    assert.equal(View.barLabel(model({ barMetric: "PM2.5", pm25: "" })), "󰈐",
      "no reading, no number")
  })

  test("None mode shows only the icon", () => {
    assert.equal(View.barLabel(model({ barMetric: "None" })), "󰈐")
    assert.equal(View.barLabel(model({ barMetric: "nonsense" })), "󰈐")
  })

  test("active and dimmed", () => {
    assert.equal(View.barActive(model()), true)
    assert.equal(View.barActive(model({ fanOn: false })), false)
    assert.equal(View.barActive(model({ stale: true })), false, "stale is never active")
    assert.equal(View.barDimmed(model()), false)
    assert.equal(View.barDimmed(model({ stale: true })), true)
    assert.equal(View.barDimmed(model({ actionable: false })), true)
  })
})

describe("status line", () => {
  test("reports the most severe problem first", () => {
    assert.match(View.statusLine(model({ hasService: false })), /starting up/)
    assert.match(View.statusLine(model({ configured: false })), /not connected/)
    assert.match(View.statusLine(model({ lastError: "token rejected" })), /token rejected/)
    assert.match(View.statusLine(model({ everLoaded: false })), /connecting/)
    assert.match(View.statusLine(model({ fanEntity: "" })), /no Dyson found/)
  })

  test("precedence holds when problems compete", () => {
    // Each case sets TWO conditions at once. Varying one field against an
    // otherwise-healthy model can never pin an ordering.
    assert.match(View.statusLine(model({ hasService: false, configured: false, lastError: "x" })),
      /starting up/, "no service outranks everything")
    assert.match(View.statusLine(model({ configured: false, lastError: "x", everLoaded: false })),
      /not connected/, "unconfigured outranks an error")
    assert.match(View.statusLine(model({ lastError: "boom", everLoaded: false, fanEntity: "" })),
      /boom/, "an error outranks still-connecting")
    assert.match(View.statusLine(model({ everLoaded: false, fanEntity: "", stale: true })),
      /connecting/, "connecting outranks no-device-found")
    assert.match(View.statusLine(model({ fanEntity: "", stale: true, staleMs: 999999 })),
      /no Dyson found/, "no device outranks stale")
  })

  test("hero subtitle precedence holds when problems compete", () => {
    assert.equal(View.heroSubtitle(model({ configured: false, lastError: "x", fanEntity: "" })),
      "Not connected")
    assert.equal(View.heroSubtitle(model({ lastError: "boom", fanEntity: "", stale: true })),
      "boom", "an error outranks both no-device and stale")
    assert.equal(View.heroSubtitle(model({ fanEntity: "", stale: true, staleMs: 999999 })),
      "No Dyson found", "no device outranks stale")
  })

  test("a service problem outranks a device reading", () => {
    // Reporting "on · speed 5" while unable to reach Home Assistant would be
    // stating something the widget has no basis for.
    const s = View.statusLine(model({ lastError: "unreachable", fanOn: true }))
    assert.ok(!s.includes("speed"))
  })

  test("stale says how long and whether it is recovering", () => {
    const s = View.statusLine(model({ stale: true, staleMs: 420000 }))
    assert.match(s, /no data for 7 min/)
    assert.match(s, /reconnecting/)
    assert.ok(!View.statusLine(model({ stale: true, staleMs: 420000, autoReconnect: false }))
      .includes("reconnecting"))
  })

  test("running, off, and heating each read differently", () => {
    assert.match(View.statusLine(model()), /on · speed 5/)
    assert.match(View.statusLine(model({ fanOn: false })), /— off/)
    assert.match(View.statusLine(model({ heating: true, targetTemp: 22.4 })),
      /heating to 22°C · speed 5/)
  })

  test("temperature and PM2.5 are appended only when present", () => {
    assert.match(View.statusLine(model()), /24\.1°C/)
    assert.match(View.statusLine(model()), /PM2\.5 3 µg\/m³/)
    const bare = View.statusLine(model({ currentTemp: NaN, pm25: "" }))
    assert.ok(!bare.includes("°C"))
    assert.ok(!bare.includes("PM2.5"))
  })
})

describe("hero subtitle", () => {
  test("mirrors the status severity order", () => {
    assert.equal(View.heroSubtitle(model({ configured: false })), "Not connected")
    assert.equal(View.heroSubtitle(model({ lastError: "boom" })), "boom")
    assert.equal(View.heroSubtitle(model({ fanEntity: "" })), "No Dyson found")
    assert.match(View.heroSubtitle(model({ stale: true, staleMs: 120000 })),
      /No data for 2 min · reconnecting/)
    assert.equal(View.heroSubtitle(model({ stale: true, staleMs: 120000, autoReconnect: false })),
      "No data for 2 min", "with auto-reconnect off it only states the fact")
  })

  test("describes the running state", () => {
    assert.equal(View.heroSubtitle(model({ currentTemp: NaN })), "On · speed 5 of 10")
    assert.equal(View.heroSubtitle(model({ fanOn: false, currentTemp: NaN })), "Off")
    assert.equal(View.heroSubtitle(model({ heating: true, currentTemp: NaN })),
      "Heating · speed 5")
    assert.equal(View.heroSubtitle(model()), "On · speed 5 of 10 · 24.1°C")
  })
})

describe("staleMinutes and isFiniteNumber", () => {
  test("rounds to whole minutes", () => {
    assert.equal(View.staleMinutes({ staleMs: 90000 }), 2)
    assert.equal(View.staleMinutes({}), 0)
  })

  test("isFiniteNumber rejects the empty string that Number() would accept", () => {
    assert.equal(View.isFiniteNumber(0), true)
    assert.equal(View.isFiniteNumber("24.1"), true)
    assert.equal(View.isFiniteNumber(""), false)
    assert.equal(View.isFiniteNumber(null), false)
    assert.equal(View.isFiniteNumber(undefined), false)
    assert.equal(View.isFiniteNumber(NaN), false)
  })
})

describe("which rows exist", () => {
  test("a heater shows Off/Fan/Heat instead of a power toggle", () => {
    const s = View.sections(model())
    assert.equal(s.climate, true)
    assert.equal(s.powerToggle, false, "two power controls could disagree")
    assert.equal(s.targetTemp, false, "not heating yet")
    assert.equal(View.sections(model({ heating: true })).targetTemp, true)
  })

  test("a cool-only device shows a power toggle and no heat", () => {
    const s = View.sections(model({ climateEntity: "", hvacModes: [] }))
    assert.equal(s.climate, false)
    assert.equal(s.powerToggle, true)
    assert.equal(s.targetTemp, false)
  })

  test("a model with fields entirely absent is still safe to render", () => {
    // Real callers always supply these, but a partially-built model must not
    // throw part-way through drawing a panel.
    const s = View.sections({ climateEntity: "climate.d" })
    assert.equal(s.climate, false, "no hvacModes key at all")
    assert.equal(s.deviceSwitcher, false, "no fans key at all")
    assert.equal(s.airQuality, false)
  })

  test("a climate entity with no modes is not a heater", () => {
    const s = View.sections(model({ hvacModes: [] }))
    assert.equal(s.climate, false)
    assert.equal(s.powerToggle, true)
  })

  test("humidity rows appear only on a humidifier, slider only while running", () => {
    assert.equal(View.sections(model()).humidifier, false)
    const on = View.sections(model({ humidifierEntity: "humidifier.d", humidifying: true }))
    assert.equal(on.humidifier, true)
    assert.equal(on.humiditySlider, true)
    const off = View.sections(model({ humidifierEntity: "humidifier.d", humidifying: false }))
    assert.equal(off.humidifier, true)
    assert.equal(off.humiditySlider, false, "a target with nothing humidifying does nothing")
  })

  test("optional toggles are hidden, never dead", () => {
    assert.equal(View.sections(model()).nightMode, true)
    assert.equal(View.sections(model({ nightSwitch: "" })).nightMode, false)
    assert.equal(View.sections(model({ autoSupported: false })).autoMode, false)
  })

  test("airflow needs two modes to be a choice", () => {
    assert.equal(View.sections(model()).airflow, false, "no fan_modes, no row")
    assert.equal(View.sections(model({ fanModes: ["focus"] })).airflow, false,
      "one mode is not a choice")
    assert.equal(View.sections(model({ fanModes: ["focus", "diffuse"] })).airflow, true)
  })

  test("airflow modes get the names Dyson uses, not Home Assistant's", () => {
    assert.deepEqual(View.airflowOptions(["focus", "diffuse"]), [
      { value: "focus", label: "Focused" }, { value: "diffuse", label: "Diffused" }
    ])
    // The value posted back to climate.set_fan_mode stays Home Assistant's.
    assert.deepEqual(View.airflowOptions(["focus"]).map(o => o.value), ["focus"])
    // A mode this plugin has never seen is titled rather than dropped.
    assert.deepEqual(View.airflowOptions(["breeze"]), [{ value: "breeze", label: "Breeze" }])
    assert.deepEqual(View.airflowOptions([null, "", 3, undefined, "focus"]),
      [{ value: "focus", label: "Focused" }])
    assert.deepEqual(View.airflowOptions([]), [])
    assert.deepEqual(View.airflowOptions(null), [])
    assert.deepEqual(View.airflowOptions(undefined), [])
  })

  test("width follows the oscillation toggle, tilt does not", () => {
    const width = ["45°", "350°"]
    const tilt = ["0°", "50°"]
    assert.equal(View.sections(model()).oscillationAngle, false, "no select, no row")
    assert.equal(View.sections(model({ angleOptions: width })).oscillationAngle, false,
      "a sweep width with the head held still has nothing to show")
    assert.equal(
      View.sections(model({ angleOptions: width, oscillating: true })).oscillationAngle, true)
    assert.equal(View.sections(model({ angleOptions: [] , oscillating: true })).oscillationAngle,
      false, "an empty option list is no control")

    assert.equal(View.sections(model()).tilt, false)
    assert.equal(View.sections(model({ tiltOptions: tilt })).tilt, true,
      "tilt is a separate axis and stands on its own")
  })

  test("select options pass the device's own labels through", () => {
    assert.deepEqual(View.selectOptions(["45°", "Breeze"]), [
      { value: "45°", label: "45°" }, { value: "Breeze", label: "Breeze" }
    ])
    // A model nobody here has seen will name options nobody anticipated, so
    // anything usable survives and only unusable entries are dropped.
    assert.deepEqual(View.selectOptions(["Whoosh"]), [{ value: "Whoosh", label: "Whoosh" }])
    assert.deepEqual(View.selectOptions([null, "", 45, undefined, "90°"]),
      [{ value: "90°", label: "90°" }])
    assert.deepEqual(View.selectOptions([]), [])
    assert.deepEqual(View.selectOptions(null), [])
    assert.deepEqual(View.selectOptions(undefined), [])
  })

  test("the device switcher appears only with a real choice and no pin", () => {
    const two = [{ entityId: "fan.a" }, { entityId: "fan.b" }]
    assert.equal(View.sections(model()).deviceSwitcher, false, "one device is no choice")
    assert.equal(View.sections(model({ fans: two })).deviceSwitcher, true)
    assert.equal(View.sections(model({ fans: two, pinnedFan: "fan.a" })).deviceSwitcher, false,
      "a pinned widget must not offer to disagree with its own settings")
    assert.equal(View.sections(model({ fans: [] })).deviceSwitcher, false)
  })

  test("air quality and graph follow the data", () => {
    assert.equal(View.sections(model()).airQuality, true)
    const blank = model({ pm25: "", voc: "", aqi: "", humidity: "" })
    assert.equal(View.sections(blank).airQuality, false)
    assert.equal(View.sections(model({ historyPoints: 1 })).graph, false,
      "one point is not a line")
    assert.equal(View.sections(model({ historyPoints: 0 })).graph, false)
    assert.equal(View.sections(model({ historyPoints: 2 })).graph, true)
  })

  test("the filter warning", () => {
    assert.equal(View.sections(model()).filterWarning, false)
    assert.equal(View.sections(model({ filterDue: true })).filterWarning, true)
  })

  test("a minimal device renders almost nothing", () => {
    const s = View.sections(model({
      climateEntity: "", hvacModes: [], humidifierEntity: "", nightSwitch: "",
      autoSupported: false, historyPoints: 0, filterDue: false, fans: [],
      pm25: "", pm10: "", voc: "", no2: "", co2: "", hcho: "", aqi: "", humidity: "", hepaFilter: ""
    }))
    assert.deepEqual({ ...s }, {
      deviceSwitcher: false, climate: false, powerToggle: true, targetTemp: false,
      humidifier: false, humiditySlider: false, airflow: false,
      oscillationAngle: false, tilt: false, aiming: false,
      nightMode: false, autoMode: false, sleepTimer: false, monitoring: false,
      heatingMode: false, waterHardness: false, direction: false,
      airQuality: false, graph: false, filterWarning: false,
      details: false, detailsOpenByDefault: false
    }, "only the power toggle and speed survive")
  })
})

describe("readings", () => {
  test("only present readings appear, in a stable order", () => {
    const r = View.readings(model())
    assert.equal(r.map(e => e.label).join(","), "PM2.5,VOC,AQI,Humidity")
  })

  test("every reading, when a device has them all", () => {
    const r = View.readings(model({
      pm25: "3", pm10: "5", voc: "0.1", no2: "2", hcho: "0.02", co2: "600",
      aqi: "4", humidity: "51", hepaFilter: "88"
    }))
    assert.equal(r.length, 9)
    assert.equal(r.map(e => e.label).join(","),
      "PM2.5,PM10,VOC,NO₂,HCHO,CO₂,AQI,Humidity,Filter")
  })

  test("null and undefined readings are omitted like empty ones", () => {
    assert.equal(View.readings(model({ pm25: null, voc: undefined, aqi: "", humidity: "" })).length, 0)
  })

  test("only PM2.5 can raise an alarm", () => {
    const r = View.readings(model({ pm25: "3", pm10: "5", aqi: "4", humidity: "51" }))
    assert.equal(r.find(e => e.label === "PM2.5").alarm, true)
    for (const label of ["PM10", "AQI", "Humidity"])
      assert.equal(r.find(e => e.label === label).alarm, false,
        `${label} has no settled threshold to alarm on`)
  })

  test("readingColorKey colours only an alarming PM2.5", () => {
    const pm = { label: "PM2.5", alarm: true }
    const other = { label: "AQI", alarm: false }
    assert.equal(View.readingColorKey(pm, true), "urgent")
    assert.equal(View.readingColorKey(pm, false), "foreground", "clean air is not urgent")
    assert.equal(View.readingColorKey(other, true), "foreground",
      "a non-alarming reading stays neutral even while the air is bad")
    assert.equal(View.readingColorKey(null, true), "foreground")
  })

  test("httpError explains each failure in the reader's terms", () => {
    assert.match(View.httpError(0, "http://ha:8123"), /Cannot reach Home Assistant at http:\/\/ha:8123/)
    assert.match(View.httpError(401, "x"), /rejected the access token/)
    assert.match(View.httpError(403, "x"), /rejected the access token/)
    assert.match(View.httpError(404, "x"), /no such entity or endpoint/)
    assert.match(View.httpError(500, "x"), /HTTP 500/)
    assert.match(View.httpError(502, "x"), /HTTP 502/)
    assert.ok(View.PARSE_ERROR.length > 10)
  })

  test("readingText appends the unit only when there is one", () => {
    assert.equal(View.readingText({ value: "3", unit: "µg/m³" }), "3 µg/m³")
    assert.equal(View.readingText({ value: "4", unit: "" }), "4")
  })

})

describe("controls", () => {
  test("hvac modes get human labels", () => {
    const o = View.hvacOptions(["off", "fan_only", "heat"])
    assert.equal(o.map(x => x.label).join(","), "Off,Fan,Heat")
    assert.equal(o[1].value, "fan_only", "the value stays Home Assistant's")
    assert.equal(View.hvacOptions(["cool"])[0].label, "Off", "an unmapped mode is not invented")
    assert.equal(View.hvacOptions([]).length, 0)
    assert.equal(View.hvacOptions(null).length, 0)
  })

  test("device options prefer serials, which are what distinguish two of a model", () => {
    const fans = [
      { entityId: "fan.a", name: "Dyson A", serial: "AAA-EU-1111111" },
      { entityId: "fan.b", name: "Dyson B", serial: "" }
    ]
    const withAuto = View.deviceOptions(fans, true)
    assert.equal(withAuto[0].label, "Automatic")
    assert.equal(withAuto[0].value, "")
    assert.equal(withAuto[1].label, "AAA-EU-1111111")
    assert.equal(withAuto[2].label, "Dyson B", "falls back to the name")
    assert.equal(View.deviceOptions(fans, false).length, 2)
    assert.equal(View.deviceOptions(null, true).length, 1)
  })

  test("spin duration spans 3s to 350ms on any dial size", () => {
    assert.equal(View.spinDurationMs(1, 10), 3000)
    assert.equal(View.spinDurationMs(10, 10), 350)
    assert.equal(View.spinDurationMs(1, 4), 3000)
    assert.equal(View.spinDurationMs(4, 4), 350, "a four-speed device reaches the same floor")
    assert.ok(View.spinDurationMs(5, 10) < View.spinDurationMs(3, 10), "faster means quicker")
  })

  test("spin duration copes with degenerate dials", () => {
    assert.equal(View.spinDurationMs(1, 1), 3000, "a single-speed device cannot interpolate")
    assert.equal(View.spinDurationMs(0, 10), 3000, "speed 0 is treated as the slowest")
    assert.equal(View.spinDurationMs(99, 10), 350, "an out-of-range speed clamps")
    assert.equal(View.spinDurationMs(null, null), 3000)
  })
})

describe("settings", () => {
  const layout = {
    left: [{ id: "omarchy.menu" }],
    center: [{ id: "io.github.allstars101-sudo.dyson-air", fanEntity: "fan.b" }],
    right: [{ id: "omarchy.tray" }, { id: "io.github.allstars101-sudo.dyson-air" }]
  }
  const ID = "io.github.allstars101-sudo.dyson-air"

  test("finds every placement of this plugin, with its pin", () => {
    const p = View.placements(layout, ID)
    assert.equal(p.length, 2)
    assert.equal(p[0].section, "center")
    assert.equal(p[0].index, 0)
    assert.equal(p[0].fanEntity, "fan.b")
    assert.equal(p[0].label, "Center")
    assert.equal(p[1].section, "right")
    assert.equal(p[1].index, 1, "the index addresses the entry, so it counts other widgets")
    assert.equal(p[1].fanEntity, "", "unpinned")
    assert.equal(p[1].label, "Right")
  })

  test("the label never states a bar position", () => {
    // Omarchy's Super+Ctrl+N hotkey counts only panel-capable widgets, so any
    // label carrying `index` prints a number that disagrees with the key that
    // actually opens the panel. Here the tray sits at index 0 and is not a
    // panel, so the entry's own index (1) is not the hotkey's number either.
    const p = View.placements(layout, ID)
    assert.equal(/\d/.test(p[1].label), false, `"${p[1].label}" must carry no number`)

    // Numbering appears only once it has two widgets in one section to separate.
    const two = View.placements({ right: [{ id: ID }, { id: "omarchy.tray" }, { id: ID }] }, ID)
    assert.deepEqual(two.map(e => e.label), ["Right", "Right #2"])
    assert.deepEqual(two.map(e => e.index), [0, 2], "the addressing index is untouched")

    // Counted per section, not across the bar.
    const split = View.placements({ left: [{ id: ID }], right: [{ id: ID }] }, ID)
    assert.deepEqual(split.map(e => e.label), ["Left", "Right"])
  })

  test("copes with a layout that uses bare string ids", () => {
    assert.equal(View.placements({ right: ["omarchy.tray", ID] }, ID)[0].index, 1)
  })

  test("no layout, no placements", () => {
    assert.equal(View.placements(null, ID).length, 0)
    assert.equal(View.placements({}, ID).length, 0)
    assert.equal(View.placements(layout, "other.plugin").length, 0)
  })

  test("settingsTab distinguishes a settings request from the bar hotkey", () => {
    // Omarchy's Super+Ctrl+N hotkey and `omarchy-shell shell toggle <id>` both
    // land on the overlay with an empty payload, because declaring an overlay
    // kind opts the plugin out of the bar-widget summon path. Only a payload
    // naming a tab came from the settings button.
    assert.equal(View.settingsTab('{"tab":"connection"}'), "connection")
    assert.equal(View.settingsTab('{"tab":"devices"}'), "devices")
    assert.equal(View.settingsTab("{}"), "", "the bar hotkey wants the panel")
    assert.equal(View.settingsTab(""), "")
    assert.equal(View.settingsTab(null), "")
    assert.equal(View.settingsTab(undefined), "")
    assert.equal(View.settingsTab("not json"), "", "an unreadable payload is not a tab")
    assert.equal(View.settingsTab("null"), "", "JSON null must not throw")
    assert.equal(View.settingsTab('{"tab":"nonsense"}'), "", "an unknown tab is not honoured")
    assert.equal(View.settingsTab('{"other":1}'), "")
  })

  test("connection status", () => {
    const base = { hasService: true, configured: true, ready: true, fanCount: 1,
                   lastError: "", notice: "" }
    assert.equal(View.connectionStatus(base).text, "Connected · 1 Dyson found")
    assert.equal(View.connectionStatus({ ...base, fanCount: 2 }).text, "Connected · 2 Dysons found")
    assert.equal(View.connectionStatus({ ...base, ready: false }).text, "Connecting…")
    assert.equal(View.connectionStatus({ ...base, ready: false, configured: false }).text,
      "Not connected.")
    assert.equal(View.connectionStatus({ ...base, hasService: false }).text, "")

    const err = View.connectionStatus({ ...base, lastError: "token rejected" })
    assert.equal(err.text, "token rejected")
    assert.equal(err.error, true, "only a real error is coloured as one")

    const notice = View.connectionStatus({ ...base, notice: "Saved.", lastError: "x" })
    assert.equal(notice.text, "Saved.", "a fresh notice outranks a stale error")
    assert.equal(notice.error, false)
  })
})

describe("controls beyond the basics", () => {
  test("each optional control follows its own entity", () => {
    assert.equal(View.sections(model()).sleepTimer, false)
    assert.equal(View.sections(model({ sleepTimerEntity: "number.d_sleep_timer" })).sleepTimer, true)
    assert.equal(View.sections(model()).monitoring, false)
    assert.equal(View.sections(model({ monitorSwitch: "switch.d_cm" })).monitoring, true)
    assert.equal(View.sections(model({ directionSupported: true })).direction, true)
    assert.equal(View.sections(model({ directionSupported: false })).direction, false)
  })

  test("a select with one option is not a choice worth a row", () => {
    assert.equal(View.sections(model({ heatingModeOptions: ["Heating"] })).heatingMode, false)
    assert.equal(View.sections(model({ heatingModeOptions: ["Off", "Heating"] })).heatingMode, true)
    assert.equal(View.sections(model({ waterHardnessOptions: ["Soft"] })).waterHardness, false)
    assert.equal(
      View.sections(model({ waterHardnessOptions: ["Soft", "Medium", "Hard"] })).waterHardness, true)
  })

  test("aiming needs the head moving, not an entity", () => {
    // The service works on every model, including ones with no angle entities,
    // so this control is deliberately not gated on discovery finding one.
    assert.equal(View.sections(model({ oscillating: true })).aiming, true)
    assert.equal(View.sections(model({ oscillating: false })).aiming, false)
    assert.equal(View.sections(model({ oscillating: true, fanEntity: "" })).aiming, false)
  })

  test("sleep timer minutes read as a duration", () => {
    assert.equal(View.sleepTimerLabel(0), "Off", "0m would read as about to fire")
    assert.equal(View.sleepTimerLabel(15), "15m")
    assert.equal(View.sleepTimerLabel(59), "59m")
    assert.equal(View.sleepTimerLabel(60), "1h")
    assert.equal(View.sleepTimerLabel(90), "1h 30m")
    assert.equal(View.sleepTimerLabel(540), "9h")
    assert.equal(View.sleepTimerLabel(-5), "Off")
    assert.equal(View.sleepTimerLabel(""), "", "a blank is not zero minutes")
    assert.equal(View.sleepTimerLabel(null), "")
    assert.equal(View.sleepTimerLabel("x"), "")
  })

  test("the sweep range is described as an arc, not a compass bearing", () => {
    // Angles are absolute to the machine's own zero, so naming a direction in
    // the room would be a guess about which way the unit is facing.
    assert.equal(View.angleLabel(0, 350, 0, 350), "Full sweep")
    assert.equal(View.angleLabel(0, 115, 0, 350), "0° – 115°  (115° arc)")
    assert.equal(View.angleLabel(180, 180, 0, 350), "Held at 180°", "point aim")
    assert.equal(View.angleLabel("", 350, 0, 350), "")
    assert.equal(View.angleLabel(0, null, 0, 350), "")
  })
})

describe("details", () => {
  const rich = () => model({
    aqiCategory: "Good", dominantPollutant: "PM2.5", outdoorAqi: "23",
    hepaFilter: "80", hepaFilterType: "Combination", carbonFilter: "60",
    carbonFilterType: "Carbon", connectionStatus: "Cloud", wifiSignal: "-34",
    scheduledEvents: "0 active",
    faults: [{ label: "Motor", active: false }, { label: "System", active: false }]
  })

  test("a device that reports everything", () => {
    const rows = View.details(rich())
    assert.deepEqual(rows.map(r => r.label),
      ["Air quality", "Outdoor AQI", "HEPA filter", "Carbon filter", "Connection",
       "Schedule", "Faults"])
    assert.equal(rows[0].value, "Good · PM2.5 leading")
    assert.equal(rows[2].value, "80% · Combination")
    assert.equal(rows[4].value, "Cloud · -34 dBm")
    assert.equal(rows[6].value, "None reported")
    assert.equal(rows.some(r => r.alarm), false, "a healthy device raises nothing")
  })

  test("a device that reports almost nothing shows a short list, not dashes", () => {
    assert.deepEqual(View.details(model()), [])
  })

  test("half a fact still reads", () => {
    // A cartridge that is not fitted reports a type and no life, and a device
    // can report signal strength without a connection label.
    assert.equal(View.details(model({ hepaFilterType: "Not Installed" }))[0].value,
      "Not Installed")
    assert.equal(View.details(model({ hepaFilter: "0" }))[0].value, "0%",
      "zero percent is a reading, not a blank")
    assert.equal(View.details(model({ wifiSignal: "-40" }))[0].value, "-40 dBm")
    assert.equal(View.details(model({ connectionStatus: "Local" }))[0].value, "Local")
    assert.equal(View.details(model({ aqiCategory: "Fair" }))[0].value, "Fair",
      "a category with no dominant pollutant stands alone")
    assert.equal(View.filterLine("", ""), "")
  })

  test("faults are named when active and counted for the header", () => {
    const faults = [{ label: "Motor", active: true }, { label: "Wifi", active: false },
                    { label: "System", active: true }]
    const row = View.details(model({ faults })).find(r => r.label === "Faults")
    assert.equal(row.value, "Motor, System")
    assert.equal(row.alarm, true)
    assert.equal(View.activeFaultCount(model({ faults })), 2)
    assert.equal(View.activeFaultCount(model()), 0)
    assert.equal(View.activeFaultCount({}), 0)
  })

  test("a due filter is the one detail drawn as urgent", () => {
    const rows = View.details(model({ hepaFilter: "0", filterDue: true }))
    assert.equal(rows[0].alarm, true)
  })

  test("the section exists only when it has something in it", () => {
    assert.equal(View.sections(model()).details, false)
    assert.equal(View.sections(rich()).details, true)
  })

  test("details unfold on their own only when something is wrong", () => {
    assert.equal(View.sections(rich()).detailsOpenByDefault, false,
      "a healthy device does not open a panel section at the reader")
    assert.equal(View.sections(model({ filterDue: true })).detailsOpenByDefault, true)
    assert.equal(
      View.sections(model({ faults: [{ label: "Motor", active: true }] })).detailsOpenByDefault,
      true)
    assert.equal(
      View.sections(model({ faults: [{ label: "Motor", active: false }] })).detailsOpenByDefault,
      false)
  })
})

describe("aim chips", () => {
  const presets = [{ value: "left", label: "Left" }, { value: "wide", label: "Wide" }]

  test("the presets get a Custom chip appended", () => {
    assert.deepEqual(View.aimOptions(presets), [
      { value: "left", label: "Left" },
      { value: "wide", label: "Wide" },
      { value: "custom", label: "···" }
    ])
    assert.deepEqual(View.aimOptions([]), [{ value: "custom", label: "···" }])
    assert.deepEqual(View.aimOptions(null), [{ value: "custom", label: "···" }])
  })

  test("a range matching no preset selects Custom on its own", () => {
    // Otherwise the panel would draw an arc that no lit chip accounted for,
    // and the sliders that could explain it would stay folded away.
    assert.equal(View.aimChoice("left", false), "left")
    assert.equal(View.aimChoice("", false), "custom")
    assert.equal(View.aimChoice("left", true), "custom", "the user's choice wins")
    assert.equal(View.aimChoice("", true), "custom")
  })
})

describe("on/off chips", () => {
  test("a switch reads as two chips like every other control", () => {
    assert.deepEqual(View.onOffOptions(),
      [{ value: "on", label: "On" }, { value: "off", label: "Off" }])
  })
})

describe("a sleep timer request that has not landed", () => {
  test("the label says the request is outstanding", () => {
    // hass-dyson only writes the entity back for 0, so a request that never
    // echoes would otherwise look like a slider that did nothing at all.
    assert.equal(View.sleepTimerLabel(45, true), "45m · setting…")
    assert.equal(View.sleepTimerLabel(45, false), "45m")
    assert.equal(View.sleepTimerLabel(45), "45m", "no flag reads as settled")
    assert.equal(View.sleepTimerLabel(0, true), "Off · setting…")
    assert.equal(View.sleepTimerLabel(90, true), "1h 30m · setting…")
    assert.equal(View.sleepTimerLabel("", true), "", "a blank stays blank, pending or not")
  })
})
