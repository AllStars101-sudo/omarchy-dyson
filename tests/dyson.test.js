const { test, describe } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const Dyson = require("../Dyson.js")
const fx = require("./fixtures/synthetic.js")

// The one fixture captured from real hardware: a Dyson Pure Hot+Cool Link.
const hp02 = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "hp02-455.json"), "utf8"))
const hp02Fan = "fan.dyson_sz2_au_tba2519a"
const hp02Caps = Dyson.discover(hp02, hp02Fan)
const hp02Attrs = hp02.find(e => e.entity_id === hp02Fan).attributes

describe("identity", () => {
  test("slugOf splits on the first dot", () => {
    assert.equal(Dyson.slugOf("fan.dyson_abc"), "dyson_abc")
    assert.equal(Dyson.slugOf("no-dot"), "")
    assert.equal(Dyson.slugOf(""), "")
    assert.equal(Dyson.slugOf(null), "")
  })

  test("isDysonFan trusts Dyson-specific attributes over names", () => {
    assert.ok(Dyson.isDysonFan({ entity_id: "fan.x", attributes: { night_mode: false } }))
    assert.ok(Dyson.isDysonFan({ entity_id: "fan.x", attributes: { oscillation_span: 350 } }))
    assert.ok(Dyson.isDysonFan({ entity_id: "fan.x", attributes: { model: "Dyson TP04" } }))
    assert.ok(Dyson.isDysonFan({ entity_id: "fan.x", attributes: { manufacturer: "dyson" } }))
    assert.ok(Dyson.isDysonFan({ entity_id: "fan.my_dyson", attributes: {} }))
    assert.ok(!Dyson.isDysonFan({ entity_id: "fan.ceiling", attributes: {} }))
    assert.ok(!Dyson.isDysonFan({ entity_id: "light.dyson_lamp", attributes: {} }),
      "a Dyson lamp is not a fan")
    assert.ok(!Dyson.isDysonFan({ entity_id: "fan.x" }), "no attributes at all")
    assert.ok(!Dyson.isDysonFan(null))
    assert.ok(!Dyson.isDysonFan({}))
  })

  test("listFans returns only Dysons, ordered, with serials", () => {
    const fans = Dyson.listFans(fx.multiHouse())
    assert.equal(fans.length, 2)
    assert.equal(fans[0].entityId, "fan.dyson_hp07", "sorted by entity id")
    assert.equal(fans[0].serial, "HP7-US-QRS4567C")
    assert.equal(Dyson.listFans(hp02)[0].serial, "SZ2-AU-TBA2519A")
    assert.equal(Dyson.listFans([]).length, 0)
  })

  test("a fan with no friendly name falls back to its entity id", () => {
    const fans = Dyson.listFans([{ entity_id: "fan.bare", attributes: { night_mode: false } }])
    assert.equal(fans[0].name, "fan.bare")
    assert.equal(fans[0].serial, "")
  })

  test("a Dyson identified only by its entity id, with no attributes key", () => {
    const fans = Dyson.listFans([{ entity_id: "fan.dyson_nameless" }])
    assert.equal(fans.length, 1)
    assert.equal(fans[0].name, "fan.dyson_nameless")
  })

  test("fans sort by entity id in both directions", () => {
    const sorted = Dyson.listFans([
      { entity_id: "fan.dyson_a", attributes: { night_mode: false } },
      { entity_id: "fan.dyson_z", attributes: { night_mode: false } }
    ])
    assert.equal(sorted.map(f => f.entityId).join(","), "fan.dyson_a,fan.dyson_z")
    const reversed = Dyson.listFans([
      { entity_id: "fan.dyson_z", attributes: { night_mode: false } },
      { entity_id: "fan.dyson_a", attributes: { night_mode: false } }
    ])
    assert.equal(reversed.map(f => f.entityId).join(","), "fan.dyson_a,fan.dyson_z")
  })

  test("resolveFan prefers an explicit pin, even one not present", () => {
    assert.equal(Dyson.resolveFan(hp02, ""), hp02Fan)
    assert.equal(Dyson.resolveFan(fx.multiHouse(), "fan.absent"), "fan.absent")
    assert.equal(Dyson.resolveFan([], ""), "")
  })

  test("serialFromName", () => {
    assert.equal(Dyson.serialFromName("Dyson SZ2-AU-TBA2519A"), "SZ2-AU-TBA2519A")
    assert.equal(Dyson.serialFromName("Study Purifier"), "")
    assert.equal(Dyson.serialFromName(""), "")
    assert.equal(Dyson.serialFromName(null), "")
  })
})

describe("entity lookup", () => {
  test("deviceEntities scopes to one device", () => {
    assert.equal(Dyson.deviceEntities([], hp02Fan, "sensor").length, 0)
    assert.equal(Dyson.deviceEntities(hp02, "", "sensor").length, 0, "no fan, no entities")
    assert.ok(Dyson.deviceEntities(hp02, hp02Fan, "sensor").length > 5)
    // An entity whose id is not a string at all must not crash the scan.
    assert.equal(Dyson.deviceEntities([{ state: "on" }], hp02Fan, "sensor").length, 0)
  })

  test("companionEntity matches an exact suffix, never a substring", () => {
    // The regression: the only switch containing "auto" here is
    // firmware_auto_update, and it must NOT be returned for auto_mode.
    assert.equal(Dyson.companionEntity(hp02, hp02Fan, "switch", ["auto_mode"]), "")
    assert.equal(Dyson.companionEntity(fx.tp09, "fan.dyson_tp09", "switch", ["auto_mode"]),
      "switch.dyson_tp09_auto_mode")
    assert.equal(Dyson.companionEntity(hp02, hp02Fan, "switch", ["nope"]), "")
    assert.equal(Dyson.companionEntity(hp02, "", "switch", ["night_mode"]), "")
  })

  test("companionEntity honours suffix priority order", () => {
    const states = [
      { entity_id: "fan.d", attributes: { night_mode: false } },
      { entity_id: "switch.d_nightmode", attributes: {} },
      { entity_id: "switch.d_night_mode", attributes: {} }
    ]
    assert.equal(Dyson.companionEntity(states, "fan.d", "switch", ["night_mode", "nightmode"]),
      "switch.d_night_mode",
      "the first listed suffix wins even when the other appears earlier")
  })

  test("primaryEntity prefers the exact slug, then falls back", () => {
    assert.equal(Dyson.primaryEntity(hp02, hp02Fan, "climate"), "climate.dyson_sz2_au_tba2519a")
    assert.equal(Dyson.primaryEntity(hp02, hp02Fan, "humidifier"), "")
    // Fallback: a device whose only climate entity carries a suffix.
    const odd = [
      { entity_id: "fan.d", attributes: { night_mode: false } },
      { entity_id: "climate.d_zone", attributes: {} }
    ]
    assert.equal(Dyson.primaryEntity(odd, "fan.d", "climate"), "climate.d_zone")
  })

  test("sensorByClass matches device_class, excludes outdoor, prefers plainest", () => {
    assert.equal(hp02Caps.pm25, "sensor.dyson_sz2_au_tba2519a_particulates")
    assert.equal(Dyson.sensorByClass(fx.tp09, "fan.dyson_tp09", "aqi"),
      "sensor.dyson_tp09_air_quality_index", "indoor beats outdoor")
    assert.equal(Dyson.sensorByClass(hp02, hp02Fan, "carbon_dioxide"), "")
    // A sensor with no attributes at all must be skipped, not crash.
    assert.equal(Dyson.sensorByClass(
      [{ entity_id: "fan.d", attributes: { night_mode: false } }, { entity_id: "sensor.d_x" }],
      "fan.d", "pm25"), "")
  })

  test("sensorByClass keeps the shortest name whichever order they appear in", () => {
    // A 15-minute average sits alongside the instantaneous reading; the plain
    // one wins regardless of which the dump lists first.
    const longFirst = [
      { entity_id: "fan.d", attributes: { night_mode: false } },
      { entity_id: "sensor.d_pm25_15_min_average", attributes: { device_class: "pm25" } },
      { entity_id: "sensor.d_pm25", attributes: { device_class: "pm25" } }
    ]
    assert.equal(Dyson.sensorByClass(longFirst, "fan.d", "pm25"), "sensor.d_pm25")
    const shortFirst = [longFirst[0], longFirst[2], longFirst[1]]
    assert.equal(Dyson.sensorByClass(shortFirst, "fan.d", "pm25"), "sensor.d_pm25")
  })

  test("sensorByName finds formaldehyde, which has no device class", () => {
    assert.equal(Dyson.sensorByName(fx.tp09, "fan.dyson_tp09", ["hcho"]), "sensor.dyson_tp09_hcho")
    assert.equal(Dyson.sensorByName(hp02, hp02Fan, ["hcho", "formaldehyde"]), "")
  })

  // These are the tests the exact-suffix rule actually needs. An assertion that
  // "auto_mode" does not match "firmware_auto_update" cannot fail under ANY
  // matching strategy, because one is not a substring of the other — it reads
  // like a regression test and cannot regress. Only a name that EXTENDS a real
  // suffix discriminates.
  test("a name that extends a wanted suffix must not match it", () => {
    const nm = "fan.dyson_nm"
    assert.equal(Dyson.companionEntity(fx.nearMiss, nm, "switch", ["night_mode"]), "",
      "night_mode_schedule is a schedule, not the night mode toggle")
    assert.equal(Dyson.companionEntity(fx.nearMiss, nm, "switch", ["auto_mode"]), "",
      "auto_mode_override is not auto mode")
    assert.equal(Dyson.companionEntity(fx.nearMiss, nm, "number", ["sleep_timer"]), "",
      "sleep_timer_remaining is a readout, not the control")
    assert.equal(Dyson.companionEntity(fx.nearMiss, nm, "sensor", ["hepa_filter_life"]), "")
    assert.equal(Dyson.companionEntity(fx.nearMiss, nm, "button", ["reconnect"]), "")
    assert.equal(Dyson.companionEntity(fx.nearMiss, nm, "select", ["oscillation_mode"]), "")
  })

  test("a whole device of near-miss names yields no controls at all", () => {
    const c = Dyson.discover(fx.nearMiss, "fan.dyson_nm")
    for (const key of ["nightSwitch", "autoSwitch", "sleepTimer", "hepaFilter",
                       "reconnect", "oscillationMode"]) {
      assert.equal(c[key], "", `${key} must not latch onto a near-miss name`)
    }
  })

  test("a device whose slug is a prefix of another never borrows its entities", () => {
    // The separator rule alone cannot separate fan.dyson_a from fan.dyson_ab;
    // this is what proves the tie-breaking holds.
    const a = Dyson.discover(fx.prefixSiblings, "fan.dyson_a")
    const ab = Dyson.discover(fx.prefixSiblings, "fan.dyson_ab")
    assert.equal(a.pm25, "sensor.dyson_a_pm25")
    assert.equal(ab.pm25, "sensor.dyson_ab_pm25")
    assert.equal(a.nightSwitch, "switch.dyson_a_night_mode")
    assert.equal(ab.nightSwitch, "switch.dyson_ab_night_mode")

    // The decisive pair: AB has these, A does not. Shortest-name tie-breaking
    // cannot help — only the separator rule keeps them apart.
    assert.equal(a.voc, "", "A must not report AB's VOC sensor")
    assert.equal(ab.voc, "sensor.dyson_ab_voc")
    assert.equal(a.sleepTimer, "", "nor AB's sleep timer")
    assert.equal(ab.sleepTimer, "number.dyson_ab_sleep_timer")
    assert.equal(Dyson.deviceEntities(fx.prefixSiblings, "fan.dyson_a", "sensor").length, 1,
      "only A's own sensor is even a candidate")
  })

  test("the reconnect button, which drives the staleness self-heal", () => {
    assert.equal(hp02Caps.reconnect, "button.dyson_sz2_au_tba2519a_reconnect")
    assert.equal(Dyson.discover(fx.sparse, "fan.dyson_sparse").reconnect, "")
  })
})

describe("capability discovery", () => {
  test("the real HP02 exposes heat, no humidifier, no formaldehyde", () => {
    assert.notEqual(hp02Caps.climate, "")
    assert.equal(hp02Caps.humidifier, "")
    assert.equal(hp02Caps.hcho, "")
    assert.equal(hp02Caps.autoSwitch, "", "auto is a preset on this model, not a switch")
    assert.equal(hp02Caps.nightSwitch, "switch.dyson_sz2_au_tba2519a_night_mode")
    assert.equal(hp02Caps.monitorSwitch, "switch.dyson_sz2_au_tba2519a_continuous_monitoring")
    assert.equal(hp02Caps.sleepTimer, "number.dyson_sz2_au_tba2519a_sleep_timer")
  })

  test("a cool-only model has no heat and no humidifier", () => {
    const c = Dyson.discover(fx.tp09, "fan.dyson_tp09")
    assert.equal(c.climate, "")
    assert.equal(c.humidifier, "")
    assert.equal(c.autoSwitch, "switch.dyson_tp09_auto_mode")
    assert.equal(c.hcho, "sensor.dyson_tp09_hcho")
    assert.equal(c.pm10, "sensor.dyson_tp09_pm10")
    assert.equal(c.no2, "sensor.dyson_tp09_no2")
    assert.equal(c.oscillationAngle, "number.dyson_tp09_oscillation_angle_span")
    assert.equal(c.oscillationMode, "select.dyson_tp09_oscillation_mode")
    assert.equal(c.hepaFilter, "sensor.dyson_tp09_hepa_filter_life")
    assert.equal(c.carbonFilter, "sensor.dyson_tp09_carbon_filter_life")
    assert.equal(c.filterReplacement, "binary_sensor.dyson_tp09_filter_replacement")
  })

  test("a humidifier model exposes humidity and no heat", () => {
    const c = Dyson.discover(fx.ph01, "fan.dyson_ph01")
    assert.equal(c.humidifier, "humidifier.dyson_ph01")
    assert.equal(c.climate, "")
  })

  test("a heater model exposes climate and a heating-mode select", () => {
    const c = Dyson.discover(fx.hp07, "fan.dyson_hp07")
    assert.equal(c.climate, "climate.dyson_hp07")
    assert.equal(c.heatingMode, "select.dyson_hp07_heating_mode")
  })

  test("a minimal device exposes nothing optional", () => {
    const c = Dyson.discover(fx.sparse, "fan.dyson_sparse")
    for (const key of ["climate", "humidifier", "autoSwitch", "nightSwitch", "heatSwitch",
                       "monitorSwitch", "sleepTimer", "oscillationAngle", "oscillationMode",
                       "heatingMode", "pm25", "pm10", "no2", "voc", "co2", "temperature",
                       "humidity", "aqi", "hcho", "hepaFilter", "carbonFilter",
                       "filterReplacement", "reconnect"]) {
      assert.equal(c[key], "", `expected no ${key}`)
    }
    assert.equal(c.fan, "fan.dyson_sparse", "the fan itself is still the fan")
  })

  test("two devices in one house never borrow each other's entities", () => {
    const house = fx.multiHouse()
    const a = Dyson.discover(house, "fan.dyson_tp09")
    const b = Dyson.discover(house, "fan.dyson_hp07")
    assert.ok(a.pm25.includes("tp09"))
    assert.ok(b.pm25.includes("hp07"))
    assert.equal(a.climate, "")
    assert.equal(b.climate, "climate.dyson_hp07")
  })
})

describe("presets", () => {
  test("hasPreset", () => {
    assert.ok(Dyson.hasPreset(hp02Attrs, "auto"))
    assert.ok(Dyson.hasPreset(hp02Attrs, "heat"))
    assert.ok(!Dyson.hasPreset(hp02Attrs, "sleep"))
    assert.ok(!Dyson.hasPreset({}, "auto"))
    assert.ok(!Dyson.hasPreset(null, "auto"))
  })

  test("isAutoMode prefers the attribute over a stale preset", () => {
    assert.equal(Dyson.isAutoMode({ auto_mode: true, preset_mode: "manual" }), true)
    assert.equal(Dyson.isAutoMode({ auto_mode: false, preset_mode: "auto" }), false)
    assert.equal(Dyson.isAutoMode({ preset_mode: "Auto" }), true)
    assert.equal(Dyson.isAutoMode({ preset_mode: "manual" }), false)
    assert.equal(Dyson.isAutoMode({}), false)
    assert.equal(Dyson.isAutoMode(null), false)
  })
})

describe("speed", () => {
  test("stepsFor reads the device's own step", () => {
    assert.equal(Dyson.stepsFor(hp02Attrs), 10)
    assert.equal(Dyson.stepsFor({}), 10, "a missing step assumes ten speeds")
    assert.equal(Dyson.stepsFor(null), 10)
    assert.equal(Dyson.stepsFor({ percentage_step: 0 }), 10, "a zero step is not usable")
    assert.equal(Dyson.stepsFor({ percentage_step: "bad" }), 10)
    assert.equal(Dyson.stepsFor({ percentage_step: 20 }), 5)
    assert.equal(Dyson.stepsFor({ percentage_step: 100 }), 1, "a single-speed device")
  })

  test("an absent or zero percentage reads as off", () => {
    assert.equal(Dyson.speedFromPercentage(null, hp02Attrs), 0)
    assert.equal(Dyson.speedFromPercentage(undefined, hp02Attrs), 0)
    assert.equal(Dyson.speedFromPercentage("", hp02Attrs), 0)
    assert.equal(Dyson.speedFromPercentage(0, hp02Attrs), 0)
    assert.equal(Dyson.speedFromPercentage(-5, hp02Attrs), 0)
  })

  // A round trip alone only proves the two functions are inverses; it would
  // still pass with the whole dial inverted. These pin absolute values.
  test("absolute speed positions, not just a round trip", () => {
    assert.equal(Dyson.percentageFromSpeed(1, hp02Attrs), 10)
    assert.equal(Dyson.percentageFromSpeed(3, hp02Attrs), 30)
    assert.equal(Dyson.percentageFromSpeed(5, hp02Attrs), 50)
    assert.equal(Dyson.percentageFromSpeed(8, hp02Attrs), 80)
    assert.equal(Dyson.speedFromPercentage(10, hp02Attrs), 1)
    assert.equal(Dyson.speedFromPercentage(30, hp02Attrs), 3)
    assert.equal(Dyson.speedFromPercentage(50, hp02Attrs), 5)
    assert.equal(Dyson.speedFromPercentage(80, hp02Attrs), 8)
    // Speed must rise with percentage, everywhere, not just at the ends.
    for (let pct = 10; pct <= 100; pct += 10) {
      assert.ok(Dyson.speedFromPercentage(pct, hp02Attrs)
        >= Dyson.speedFromPercentage(pct - 10, hp02Attrs), `monotonic at ${pct}%`)
    }
  })

  test("an off-step percentage rounds to the nearest speed", () => {
    // Home Assistant reports whatever the device says, which is not always a
    // clean multiple of the step.
    assert.equal(Dyson.speedFromPercentage(35, hp02Attrs), 4, "35% is nearer speed 4 than 3")
    assert.equal(Dyson.speedFromPercentage(34, hp02Attrs), 3)
    assert.equal(Dyson.speedFromPercentage(1, hp02Attrs), 1, "never rounds down to off")
  })

  test("a device with a non-ten-speed dial", () => {
    const bp = fx.bigQuiet[0].attributes
    assert.equal(Dyson.stepsFor(bp), 8, "12.5% steps means eight speeds")
    assert.equal(Dyson.speedFromPercentage(60, bp), 5)
    assert.equal(Dyson.percentageFromSpeed(8, bp), 100)
  })

  test("every speed round-trips losslessly on any dial size", () => {
    for (const attrs of [hp02Attrs, { percentage_step: 20 }, { percentage_step: 25 },
                         { percentage_step: 100 }]) {
      const steps = Dyson.stepsFor(attrs)
      for (let s = 0; s <= steps; s++) {
        assert.equal(Dyson.speedFromPercentage(Dyson.percentageFromSpeed(s, attrs), attrs), s,
          `speed ${s} of ${steps}`)
      }
    }
  })

  test("speeds clamp at both ends", () => {
    assert.equal(Dyson.percentageFromSpeed(99, hp02Attrs), 100)
    assert.equal(Dyson.percentageFromSpeed(-3, hp02Attrs), 0)
    assert.equal(Dyson.speedFromPercentage(500, hp02Attrs), 10)
  })
})

describe("air quality", () => {
  test("WHO 2021 thresholds", () => {
    assert.equal(Dyson.pm25Band(0), "good")
    assert.equal(Dyson.pm25Band(12), "good")
    assert.equal(Dyson.pm25Band(12.1), "fair")
    assert.equal(Dyson.pm25Band(35), "fair")
    assert.equal(Dyson.pm25Band(35.1), "poor")
    assert.equal(Dyson.pm25Band(55), "poor")
    assert.equal(Dyson.pm25Band(55.1), "bad")
    assert.equal(Dyson.pm25Band("7"), "good", "states arrive as strings")
  })

  test("a missing reading is never a good reading", () => {
    // Number("") is 0, which would band an absent sensor as pristine air.
    for (const v of ["", null, undefined, "unavailable", NaN])
      assert.equal(Dyson.pm25Band(v), "unknown", String(v))
  })

  test("the alarm fires only past the guideline, and never on no data", () => {
    assert.equal(Dyson.airQualityAlarm("3"), false)
    assert.equal(Dyson.airQualityAlarm("35"), false, "at the guideline is not past it")
    assert.equal(Dyson.airQualityAlarm("36"), true)
    assert.equal(Dyson.airQualityAlarm("120"), true)
    assert.equal(Dyson.airQualityAlarm(""), false, "no reading is not an alarm")
    assert.equal(Dyson.airQualityAlarm("unavailable"), false)
  })
})

describe("model naming", () => {
  test("known codes become product names", () => {
    assert.equal(Dyson.modelName("455"), "Dyson Pure Hot+Cool Link")
    assert.equal(Dyson.modelName("527K"), "Dyson Purifier Hot+Cool")
    assert.equal(Dyson.modelName("527k"), "Dyson Purifier Hot+Cool")
    assert.equal(Dyson.modelName(" 358E "), "Dyson Purifier Humidify+Cool Formaldehyde")
    assert.equal(Dyson.modelName("664"), "Dyson Purifier Big+Quiet Formaldehyde")
  })

  test("an unlisted code degrades to the truth rather than a guess", () => {
    assert.equal(Dyson.modelName("999"), "Dyson 999")
    assert.equal(Dyson.modelName(""), "")
    assert.equal(Dyson.modelName(null), "")
    assert.equal(Dyson.modelName("unknown"), "")
    assert.equal(Dyson.modelName("None"), "")
  })

  // Asserting the function agrees with the table it reads is a tautology — it
  // passes for any lookup implementation and cannot catch a transposed name.
  // Assert the contract instead, and let the table be data.
  test("the contract holds for every listed code", () => {
    for (const code of Object.keys(Dyson.MODEL_NAMES)) {
      const name = Dyson.modelName(code)
      assert.ok(name.startsWith("Dyson "), `${code} is prefixed`)
      assert.ok(name.length > "Dyson ".length + 3, `${code} resolves to a real name`)
      assert.notEqual(name, "Dyson " + code, `${code} is translated, not passed through`)
    }
  })
})

describe("history", () => {
  const payload = [[
    { state: "unknown", last_changed: "2026-08-16T05:00:00Z" },
    { state: "5", last_changed: "2026-08-16T05:10:00Z" },
    { state: "unavailable", last_changed: "2026-08-16T05:20:00Z" },
    { state: "9", last_changed: "2026-08-16T05:30:00Z" },
    { state: "3", last_changed: "2026-08-16T05:40:00Z" }
  ]]

  test("non-numeric states are dropped, not coerced to zero", () => {
    const pts = Dyson.parseHistory(payload)
    assert.equal(pts.length, 3)
    assert.equal(pts.map(p => p.v).join(","), "5,9,3")
  })

  test("points come out in time order regardless of input order", () => {
    const pts = Dyson.parseHistory([[
      { state: "9", last_changed: "2026-08-16T05:30:00Z" },
      { state: "5", last_changed: "2026-08-16T05:10:00Z" }
    ]])
    assert.equal(pts.map(p => p.v).join(","), "5,9")
  })

  test("last_updated is accepted when last_changed is absent", () => {
    assert.equal(Dyson.parseHistory([[{ state: "4", last_updated: "2026-08-16T05:00:00Z" }]]).length, 1)
  })

  test("unplottable payloads yield no points", () => {
    assert.equal(Dyson.parseHistory([]).length, 0)
    assert.equal(Dyson.parseHistory(null).length, 0)
    assert.equal(Dyson.parseHistory("nonsense").length, 0)
    assert.equal(Dyson.parseHistory([[{ state: "7" }]]).length, 0, "no timestamp")
    assert.equal(Dyson.parseHistory([[{ state: "7", last_changed: "not a date" }]]).length, 0)
    assert.equal(Dyson.parseHistory([[null]]).length, 0)
  })

  test("historyStats bounds", () => {
    const stats = Dyson.historyStats(Dyson.parseHistory(payload))
    assert.equal(stats.min, 3)
    assert.equal(stats.max, 9)
    assert.equal(stats.first.v, 5)
    assert.equal(stats.last.v, 3, "last is newest, not highest")
    assert.ok(stats.tMax > stats.tMin)
    assert.equal(Dyson.historyStats([]), null)
    assert.equal(Dyson.historyStats(null), null)
  })

  test("a flat reading draws level rather than as amplified noise", () => {
    const flat = Dyson.historyStats([{ t: 1, v: 3 }, { t: 2, v: 3 }])
    assert.equal(flat.max - flat.min, 4)
    assert.equal(flat.min, 1)
    const zero = Dyson.historyStats([{ t: 1, v: 0 }, { t: 2, v: 0 }])
    assert.equal(zero.min, 0, "padding never produces a negative concentration")
    assert.equal(zero.max, 4)
    const custom = Dyson.historyStats([{ t: 1, v: 10 }, { t: 2, v: 10 }], 2)
    assert.equal(custom.max - custom.min, 2, "the minimum span is configurable")
    const wide = Dyson.historyStats([{ t: 1, v: 0 }, { t: 2, v: 100 }])
    assert.equal(wide.min, 0, "a genuinely wide range is left alone")
    assert.equal(wide.max, 100)
  })
})

describe("liveness", () => {
  const T = Date.parse("2026-08-16T08:05:00+00:00")

  test("the heartbeat is the newest timestamp across the whole device", () => {
    assert.equal(Dyson.newestUpdate(fx.tp09, "fan.dyson_tp09"),
      Date.parse("2026-08-16T08:00:00+00:00"))
    assert.equal(Dyson.stalenessMs(fx.tp09, "fan.dyson_tp09", T), 300000)
  })

  test("a quiet fan with live sensors is not stale", () => {
    // The trap this exists for: the fan entity's last_updated only moves when
    // the fan changes, so it alone cannot tell an idle device from a dead one.
    const quiet = [
      fx.entity("fan.d", "on", { night_mode: false }, "2026-08-16T06:00:00+00:00"),
      fx.entity("sensor.d_pm25", "3", { device_class: "pm25" }, "2026-08-16T08:04:00+00:00")
    ]
    assert.equal(Dyson.stalenessMs(quiet, "fan.d", T), 60000)
    assert.equal(Dyson.stalenessMs([quiet[0]], "fan.d", T), 7500000,
      "the fan alone would wrongly read as hours stale")
  })

  test("binary sensors count towards the heartbeat", () => {
    const only = [fx.entity("binary_sensor.d_filter_replacement", "off", {},
      "2026-08-16T08:04:00+00:00"),
      fx.entity("fan.d", "on", { night_mode: false }, null)]
    only[1].last_updated = undefined
    assert.equal(Dyson.stalenessMs(only, "fan.d", T), 60000)
  })

  test("no timestamps is unknown, not stale", () => {
    // Treating unknown as stale would fire a reconnect at every cold start,
    // before the first poll has even landed.
    assert.equal(Dyson.stalenessMs([{ entity_id: "fan.d", attributes: {} }], "fan.d", T), -1)
    assert.equal(Dyson.stalenessMs([], "fan.d", T), -1)
    assert.equal(Dyson.newestUpdate([], "fan.d"), 0)
  })

  test("staleness never goes negative on a clock skew", () => {
    const future = [fx.entity("sensor.d_pm25", "3", { device_class: "pm25" },
      "2027-01-01T00:00:00+00:00")]
    assert.equal(Dyson.stalenessMs(future, "fan.d", T), 0)
  })

  test("isStale: unknown is not stale", () => {
    assert.equal(Dyson.isStale(-1, 300), false, "no timestamps yet is unknown")
    assert.equal(Dyson.isStale(0, 300), false)
    assert.equal(Dyson.isStale(300000, 300), false, "exactly at the threshold is not past it")
    assert.equal(Dyson.isStale(300001, 300), true)
  })

  test("shouldReconnect honours every precondition", () => {
    const base = { enabled: true, stale: true, ready: true,
                   reconnectEntity: "button.d_reconnect", lastAttemptAt: 0, now: 1000000 }
    assert.equal(Dyson.shouldReconnect(base), true)
    assert.equal(Dyson.shouldReconnect({ ...base, enabled: false }), false, "opt-out is honoured")
    assert.equal(Dyson.shouldReconnect({ ...base, stale: false }), false, "nothing to fix")
    assert.equal(Dyson.shouldReconnect({ ...base, ready: false }), false,
      "cannot press a button we cannot reach")
    assert.equal(Dyson.shouldReconnect({ ...base, reconnectEntity: "" }), false,
      "some models expose no reconnect button")
    assert.equal(Dyson.shouldReconnect(null), false)
  })

  test("shouldReconnect rate limits to once every two minutes", () => {
    // The README promises this; a reconnect takes seconds to settle and firing
    // again inside the window tears down the session being rebuilt.
    const at = t => ({ enabled: true, stale: true, ready: true,
                       reconnectEntity: "button.d_reconnect",
                       lastAttemptAt: 1000000, now: 1000000 + t })
    assert.equal(Dyson.shouldReconnect(at(0)), false)
    assert.equal(Dyson.shouldReconnect(at(60000)), false, "one minute is too soon")
    assert.equal(Dyson.shouldReconnect(at(119999)), false)
    assert.equal(Dyson.shouldReconnect(at(120000)), true, "two minutes exactly is allowed")
    assert.equal(Dyson.shouldReconnect(at(600000)), true)
    assert.equal(Dyson.RECONNECT_INTERVAL_MS, 120000)
  })

  test("a never-attempted reconnect is not read as just-attempted", () => {
    // lastAttemptAt starts at 0; treating that as a timestamp would block the
    // very first recovery until the epoch plus two minutes.
    assert.equal(Dyson.shouldReconnect({ enabled: true, stale: true, ready: true,
      reconnectEntity: "button.d_reconnect", lastAttemptAt: 0, now: 60000 }), true)
  })

  test("stalenessMs defaults to now", () => {
    const fresh = [fx.entity("sensor.d_pm25", "3", { device_class: "pm25" },
      new Date().toISOString())]
    assert.ok(Dyson.stalenessMs(fresh, "fan.d") < 5000)
  })
})
