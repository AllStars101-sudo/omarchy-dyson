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
      humidifier: false, humiditySlider: false, nightMode: false, autoMode: false,
      airQuality: false, graph: false, filterWarning: false
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

  test("readings carry no emphasis flag, because nothing is emphasised", () => {
    // The plugin paints entirely in the bar's foreground, so a reading is a
    // label, a value and a unit — there is no band to colour by.
    for (const entry of View.readings(model())) {
      assert.equal("band" in entry, false)
    }
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
    assert.equal(p[0].label, "center · 1", "labels are 1-based for humans")
    assert.equal(p[1].section, "right")
    assert.equal(p[1].index, 1, "the index addresses the entry, so it counts other widgets")
    assert.equal(p[1].fanEntity, "", "unpinned")
  })

  test("copes with a layout that uses bare string ids", () => {
    assert.equal(View.placements({ right: ["omarchy.tray", ID] }, ID)[0].index, 1)
  })

  test("no layout, no placements", () => {
    assert.equal(View.placements(null, ID).length, 0)
    assert.equal(View.placements({}, ID).length, 0)
    assert.equal(View.placements(layout, "other.plugin").length, 0)
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
