// Synthetic /api/states slices for models not physically available here.
//
// These are NOT captured from real hardware — they are built from hass-dyson's
// own entity definitions (custom_components/hass_dyson/{fan,climate,humidifier,
// switch,sensor,number,select,button}.py), which decide entity creation from
// the device capability list. They pin down that the right controls appear and,
// just as importantly, that absent ones stay hidden.
//
// The one fixture taken from real hardware is hp02-455.json, captured from a
// Dyson Pure Hot+Cool Link.

function entity(id, state, attributes, lastUpdated) {
  return {
    entity_id: id,
    state: state,
    last_updated: lastUpdated || "2026-08-16T08:00:00+00:00",
    attributes: attributes || {}
  }
}

// Purifier Cool Formaldehyde (TP09, type 438E): cool only, no heat, and unlike
// the older Link models it exposes auto as a SWITCH rather than only a preset.
var tp09 = [
  entity("fan.dyson_tp09", "on", {
    friendly_name: "Dyson XY1-EU-ABC1234A",
    preset_modes: ["auto", "manual"],
    preset_mode: "manual",
    auto_mode: false,
    night_mode: false,
    oscillating: true,
    oscillation_span: 350,
    percentage: 30,
    percentage_step: 10.0
  }),
  entity("switch.dyson_tp09_auto_mode", "off"),
  entity("switch.dyson_tp09_night_mode", "off"),
  entity("switch.dyson_tp09_continuous_monitoring", "on"),
  entity("switch.dyson_tp09_firmware_auto_update", "off"),
  entity("button.dyson_tp09_reconnect", "unknown"),
  entity("number.dyson_tp09_sleep_timer", "0"),
  entity("number.dyson_tp09_oscillation_angle_span", "350"),
  entity("select.dyson_tp09_oscillation_mode", "350"),
  // Newer models name it pm25 rather than "particulates".
  entity("sensor.dyson_tp09_pm25", "6", { device_class: "pm25" }),
  entity("sensor.dyson_tp09_pm10", "9", { device_class: "pm10" }),
  entity("sensor.dyson_tp09_no2", "1", { device_class: "nitrogen_dioxide" }),
  entity("sensor.dyson_tp09_voc", "0.3", { device_class: "volatile_organic_compounds" }),
  // Formaldehyde has no Home Assistant device class, so it must be found by name.
  entity("sensor.dyson_tp09_hcho", "0.02", { unit_of_measurement: "mg/m³" }),
  entity("sensor.dyson_tp09_temperature", "21.5", { device_class: "temperature" }),
  entity("sensor.dyson_tp09_humidity", "44", { device_class: "humidity" }),
  entity("sensor.dyson_tp09_air_quality_index", "2", { device_class: "aqi" }),
  entity("sensor.dyson_tp09_outdoor_aqi", "51", { device_class: "aqi" }),
  entity("sensor.dyson_tp09_hepa_filter_life", "88", { unit_of_measurement: "%" }),
  entity("sensor.dyson_tp09_carbon_filter_life", "72", { unit_of_measurement: "%" }),
  entity("binary_sensor.dyson_tp09_filter_replacement", "off")
]

// Pure Humidify+Cool (PH01, type 358): adds a humidifier entity and water
// hardness, and has no heater.
var ph01 = [
  entity("fan.dyson_ph01", "on", {
    friendly_name: "Dyson PH1-AU-XYZ9876B",
    preset_modes: ["auto", "manual"],
    preset_mode: "auto",
    auto_mode: true,
    night_mode: true,
    oscillating: false,
    oscillation_span: 90,
    percentage: 20,
    percentage_step: 10.0
  }),
  entity("humidifier.dyson_ph01", "on", {
    device_class: "humidifier",
    humidity: 50,
    current_humidity: 43,
    min_humidity: 30,
    max_humidity: 70
  }),
  entity("switch.dyson_ph01_night_mode", "on"),
  entity("select.dyson_ph01_water_hardness", "Medium"),
  entity("button.dyson_ph01_reconnect", "unknown"),
  entity("sensor.dyson_ph01_pm25", "4", { device_class: "pm25" }),
  entity("sensor.dyson_ph01_humidity", "43", { device_class: "humidity" }),
  entity("sensor.dyson_ph01_temperature", "23.0", { device_class: "temperature" })
]

// Purifier Hot+Cool (HP07, type 527K): heat as a climate entity, plus a
// heating-mode select some firmware exposes.
var hp07 = [
  entity("fan.dyson_hp07", "on", {
    friendly_name: "Dyson HP7-US-QRS4567C",
    preset_modes: ["auto", "manual", "heat"],
    preset_mode: "manual",
    auto_mode: false,
    night_mode: false,
    oscillating: true,
    oscillation_span: 350,
    percentage: 70,
    percentage_step: 10.0
  }),
  entity("climate.dyson_hp07", "heat", {
    hvac_modes: ["off", "fan_only", "heat"],
    min_temp: 1,
    max_temp: 37,
    current_temperature: 19.4,
    temperature: 22.0
  }),
  entity("switch.dyson_hp07_night_mode", "off"),
  entity("switch.dyson_hp07_auto_mode", "off"),
  entity("select.dyson_hp07_heating_mode", "Heating"),
  entity("button.dyson_hp07_reconnect", "unknown"),
  entity("sensor.dyson_hp07_pm25", "18", { device_class: "pm25" }),
  entity("sensor.dyson_hp07_temperature", "19.4", { device_class: "temperature" })
]

// A minimal device: an old Link fan with almost nothing. Everything optional
// must stay hidden rather than render dead controls.
var sparse = [
  entity("fan.dyson_sparse", "off", {
    friendly_name: "Dyson OLD-EU-AAA0000A",
    night_mode: false,
    percentage: 0,
    percentage_step: 10.0
  })
]

// Near-miss companion names. Real hass-dyson installs carry entities whose tail
// EXTENDS a suffix the matcher looks for, and only these can tell an exact-suffix
// matcher apart from a substring or prefix one.
var nearMiss = [
  entity("fan.dyson_nm", "on", { friendly_name: "Dyson NM1-EU-AAA1111A", night_mode: false,
                                 percentage: 30, percentage_step: 10.0 }),
  entity("switch.dyson_nm_night_mode_schedule", "off"),
  entity("switch.dyson_nm_auto_mode_override", "off"),
  entity("number.dyson_nm_sleep_timer_remaining", "12"),
  entity("sensor.dyson_nm_hepa_filter_life_hours", "800"),
  entity("button.dyson_nm_reconnect_wifi", "unknown"),
  entity("select.dyson_nm_oscillation_mode_preset", "wide")
]

// Two devices whose slugs overlap by prefix: fan.dyson_a and fan.dyson_ab. The
// separator rule alone cannot separate these, so this is what proves the
// tie-breaking actually holds.
var prefixSiblings = [
  entity("fan.dyson_a", "on", { friendly_name: "Dyson AAA-EU-1111111", night_mode: false,
                                percentage: 20, percentage_step: 10.0 }),
  entity("sensor.dyson_a_pm25", "3", { device_class: "pm25" }),
  entity("switch.dyson_a_night_mode", "off"),
  entity("fan.dyson_ab", "on", { friendly_name: "Dyson BBB-EU-2222222", night_mode: false,
                                 percentage: 90, percentage_step: 10.0 }),
  entity("sensor.dyson_ab_pm25", "99", { device_class: "pm25" }),
  entity("switch.dyson_ab_night_mode", "on"),
  // Deliberately present on AB and absent on A. Shortest-name tie-breaking
  // cannot save A here — if the separator rule stops excluding AB's entities,
  // A starts reporting a VOC reading that belongs to a different device.
  entity("sensor.dyson_ab_voc", "7.7", { device_class: "volatile_organic_compounds" }),
  entity("number.dyson_ab_sleep_timer", "30")
]

// Environmental readings go unavailable whenever a device reconnects — the
// integration's own docs call this normal, and it must not be plotted or shown.
var unavailable = [
  entity("fan.dyson_u", "on", { friendly_name: "Dyson UUU-EU-3333333", night_mode: false,
                                percentage: 10, percentage_step: 10.0 }),
  entity("sensor.dyson_u_pm25", "unavailable", { device_class: "pm25" }),
  entity("sensor.dyson_u_voc", "unknown", { device_class: "volatile_organic_compounds" }),
  entity("sensor.dyson_u_temperature", "21.0", { device_class: "temperature" })
]

// Big+Quiet does not use Dyson's usual ten-speed dial.
var bigQuiet = [
  entity("fan.dyson_bp", "on", { friendly_name: "Dyson BP1-EU-4444444", night_mode: false,
                                 preset_modes: ["auto", "manual"], percentage: 60,
                                 percentage_step: 12.5 }),
  entity("sensor.dyson_bp_pm25", "8", { device_class: "pm25" })
]

// Two fans in one house, plus an unrelated ceiling fan.
function multiHouse() {
  return [entity("fan.ceiling", "off", { friendly_name: "Ceiling fan" })]
    .concat(tp09).concat(hp07)
}

if (typeof module !== "undefined") {
  module.exports = { entity: entity, tp09: tp09, ph01: ph01, hp07: hp07, sparse: sparse,
  nearMiss: nearMiss, prefixSiblings: prefixSiblings, unavailable: unavailable,
  bigQuiet: bigQuiet, multiHouse: multiHouse }
}
