import QtQuick
import QtQuick.Controls
import Quickshell
import Quickshell.Io
import qs.Ui
import qs.Commons
import "Dyson.js" as Dyson
import "View.js" as View

// Bar button plus dropdown panel for one Dyson air treatment device.
//
// Home Assistant owns the Dyson MQTT session (via the hass-dyson integration);
// this widget only reads /api/states and posts to /api/services through the
// shared Service. That keeps it honest when the device is changed from the
// MyDyson app, a physical remote, or an HA automation — it never holds a second
// opinion about what the device is doing.
Panel {
  id: root
  moduleName: "io.github.allstars101-sudo.dyson-air"
  ipcTarget: "dyson-air"

  readonly property var service: bar && bar.shell ? bar.shell.serviceFor(root.moduleName) : null
  // Named entityStates, not states: QQuickItem already defines `states`.
  readonly property var entityStates: service ? service.entityStates : []
  readonly property var config: service ? service.config : ({})

  // Which device this particular widget shows. Stored inline on this bar entry
  // rather than in config.json, because two widgets of this plugin share a
  // module name and only their placement tells them apart — and the settings
  // overlay is the surface that knows placements.
  readonly property string pinnedFan: String(setting("fanEntity", ""))
  property string overrideFan: ""   // in-panel switcher, this session only

  readonly property string barMetric: String(setting("barMetric", config.barMetric || "Fan speed"))
  readonly property int historyHours: Math.max(1, Number(setting("historyHours", config.historyHours || 24)))
  readonly property int staleSeconds: Math.max(60, Number(setting("staleSeconds", config.staleSeconds || 300)))
  readonly property bool autoReconnect: setting("autoReconnect", config.autoReconnect !== false)

  // --- resolved device ----------------------------------------------------

  readonly property var fans: entityStates.length ? Dyson.listFans(entityStates) : []
  readonly property string fanEntity: {
    if (overrideFan) return overrideFan
    if (pinnedFan) return pinnedFan
    return Dyson.resolveFan(entityStates, "")
  }
  readonly property var caps: fanEntity && entityStates.length
    ? Dyson.discover(entityStates, fanEntity) : ({})

  function stateOf(entityId) {
    if (!entityId) return null
    for (var i = 0; i < entityStates.length; i++)
      if (entityStates[i].entity_id === entityId) return entityStates[i]
    return null
  }

  function attrsOf(entityId) {
    var s = stateOf(entityId)
    return s ? (s.attributes || {}) : ({})
  }

  function numberOf(entityId, decimals) {
    var s = stateOf(entityId)
    if (!s) return ""
    var v = Number(s.state)
    if (!isFinite(v)) return ""
    return decimals ? v.toFixed(decimals) : String(Math.round(v))
  }

  readonly property var fanAttrs: attrsOf(fanEntity)
  readonly property bool fanOn: (stateOf(fanEntity) || {}).state === "on"
  readonly property int maxSpeed: Dyson.stepsFor(fanAttrs)
  readonly property int speed: Dyson.speedFromPercentage(fanAttrs.percentage, fanAttrs)
  readonly property bool oscillating: !!fanAttrs.oscillating

  // Sweep width and vertical tilt, each a Home Assistant select whose option
  // list comes from the device rather than from a table here.
  readonly property var angleOptions: attrsOf(caps.oscillationMode).options || []
  readonly property string angleMode: (stateOf(caps.oscillationMode) || {}).state || ""
  readonly property var tiltOptions: attrsOf(caps.tiltMode).options || []
  readonly property string tiltMode: (stateOf(caps.tiltMode) || {}).state || ""
  // Sweep aiming. Absolute to the machine's zero; the fan entity reports these
  // on every model even where no number entity exists to set them.
  readonly property int angleLow: Dyson.clampAngle(fanAttrs.angle_low, Dyson.ANGLE_MIN)
  readonly property int angleHigh: Dyson.clampAngle(fanAttrs.angle_high, Dyson.ANGLE_MAX)
  readonly property string anglePreset: Dyson.activeAnglePreset(fanAttrs.angle_low, fanAttrs.angle_high)

  // Home Assistant's FanEntityFeature.DIRECTION is bit 4. The attribute is
  // present on devices that cannot act on it, so the feature bit is the test.
  readonly property bool directionSupported: (Number(fanAttrs.supported_features) & 4) !== 0
  readonly property string fanDirection: String(fanAttrs.direction || "forward")

  readonly property var heatingModeOptions: attrsOf(caps.heatingMode).options || []
  readonly property string heatingModeValue: (stateOf(caps.heatingMode) || {}).state || ""
  readonly property var waterHardnessOptions: attrsOf(caps.waterHardness).options || []
  readonly property string waterHardnessValue: (stateOf(caps.waterHardness) || {}).state || ""

  readonly property var sleepTimerAttrs: attrsOf(caps.sleepTimer)
  readonly property int sleepTimerMinutes: {
    var v = Number((stateOf(caps.sleepTimer) || {}).state)
    return isFinite(v) ? Math.round(v) : 0
  }
  readonly property bool monitoring: (stateOf(caps.monitorSwitch) || {}).state === "on"
  readonly property bool firmwareAuto: (stateOf(caps.firmwareAutoUpdate) || {}).state === "on"

  readonly property string rawName: fanAttrs.friendly_name || "Dyson"
  readonly property string serial: Dyson.serialFromName(rawName)

  readonly property bool autoSupported: caps.autoSwitch !== "" || Dyson.hasPreset(fanAttrs, "auto")
  readonly property bool autoMode: caps.autoSwitch
    ? (stateOf(caps.autoSwitch) || {}).state === "on"
    : Dyson.isAutoMode(fanAttrs)
  readonly property bool nightMode: fanAttrs.night_mode !== undefined
    ? !!fanAttrs.night_mode
    : (stateOf(caps.nightSwitch) || {}).state === "on"

  // Climate
  readonly property var climateAttrs: attrsOf(caps.climate)
  readonly property var hvacModes: climateAttrs.hvac_modes || []
  readonly property bool hasClimate: caps.climate !== "" && hvacModes.length > 0
  readonly property string hvacMode: (stateOf(caps.climate) || {}).state || "off"
  readonly property bool heating: hvacMode === "heat"
  // Focused jet versus diffused spill. Present only on FocusMode devices, and
  // carried on the climate entity even though it is not a heating control.
  readonly property var fanModes: climateAttrs.fan_modes || []
  readonly property string fanMode: climateAttrs.fan_mode || ""
  readonly property real targetTemp: Number(climateAttrs.temperature)
  readonly property real minTemp: Number(climateAttrs.min_temp || 1)
  readonly property real maxTemp: Number(climateAttrs.max_temp || 37)
  readonly property real currentTemp: {
    // The fan entity reports -273.15 when it has no reading, so the climate
    // entity and then the standalone sensor are preferred in that order.
    var c = Number(climateAttrs.current_temperature)
    if (isFinite(c) && c > -100) return c
    var s = Number(numberOf(caps.temperature, 1))
    return isFinite(s) ? s : NaN
  }

  // Humidifier
  readonly property var humAttrs: attrsOf(caps.humidifier)
  readonly property bool hasHumidifier: caps.humidifier !== ""
  readonly property bool humidifying: (stateOf(caps.humidifier) || {}).state === "on"
  readonly property real targetHumidity: Number(humAttrs.humidity)
  readonly property real minHumidity: Number(humAttrs.min_humidity || 30)
  readonly property real maxHumidity: Number(humAttrs.max_humidity || 70)

  // Readings
  readonly property string pm25: numberOf(caps.pm25)
  readonly property string pm10: numberOf(caps.pm10)
  readonly property string voc: numberOf(caps.voc, 1)
  readonly property string no2: numberOf(caps.no2)
  readonly property string co2: numberOf(caps.co2)
  readonly property string hcho: numberOf(caps.hcho, 2)
  readonly property string aqi: numberOf(caps.aqi)
  readonly property string humidity: numberOf(caps.humidity)
  readonly property string hepaFilter: numberOf(caps.hepaFilter)
  readonly property string carbonFilter: numberOf(caps.carbonFilter)
  readonly property string hepaFilterType: (stateOf(caps.hepaFilterType) || {}).state || ""
  readonly property string carbonFilterType: (stateOf(caps.carbonFilterType) || {}).state || ""
  readonly property string aqiCategory: (stateOf(caps.aqiCategory) || {}).state || ""
  readonly property string dominantPollutant: (stateOf(caps.dominantPollutant) || {}).state || ""
  readonly property string outdoorAqi: numberOf(caps.outdoorAqi)
  readonly property string connectionStatus: (stateOf(caps.connectionStatus) || {}).state || ""
  readonly property string wifiSignal: numberOf(caps.wifiSignal)
  readonly property string scheduledEvents: (stateOf(caps.scheduledEvents) || {}).state || ""
  // The single colour exception: PM2.5 past the WHO guideline.
  readonly property bool airAlarm: Dyson.airQualityAlarm(pm25)

  readonly property bool filterDue: (stateOf(caps.filterReplacement) || {}).state === "on"

  property string modelName: ""
  readonly property string title: modelName !== "" ? modelName : rawName

  // --- liveness -----------------------------------------------------------

  property real staleMs: -1
  property real lastReconnectAt: 0
  readonly property bool stale: Dyson.isStale(staleMs, staleSeconds)

  function refreshLiveness() {
    if (!fanEntity || !entityStates.length) { staleMs = -1; return }
    staleMs = Dyson.stalenessMs(entityStates, fanEntity)
    var now = Date.now()
    if (!Dyson.shouldReconnect({
      enabled: autoReconnect, stale: stale, ready: !!service && service.ready,
      reconnectEntity: caps.reconnect || "", lastAttemptAt: lastReconnectAt, now: now
    })) return
    lastReconnectAt = now
    service.callService("button", "press", { entity_id: caps.reconnect })
  }

  onEntityStatesChanged: {
    refreshLiveness()
    if (fanEntity && modelName === "" && service)
      service.fetchModel(fanEntity, function(name) { root.modelName = name })
  }
  onFanEntityChanged: {
    modelName = ""
    historyPoints = []
    if (fanEntity && service)
      service.fetchModel(fanEntity, function(name) { root.modelName = name })
  }

  // --- history ------------------------------------------------------------

  property var historyPoints: []
  property var historyBounds: null

  function fetchHistory() {
    if (!service || !caps.pm25) return
    service.fetchHistory(caps.pm25, historyHours, function(points) {
      root.historyPoints = points
      root.historyBounds = Dyson.historyStats(points)
      graph.requestPaint()
    })
  }

  Timer {
    id: historyTimer
    // Only while the panel is on screen: nobody is looking at the graph
    // otherwise, and the recorder query is by far the heaviest.
    interval: 300000
    running: root.opened && !!root.service
    repeat: true
    triggeredOnStart: true
    onTriggered: root.fetchHistory()
  }

  // Tell the shared service to poll faster while any panel is open.
  onOpenedChanged: {
    if (!service) return
    service.openPanels = Math.max(0, service.openPanels + (opened ? 1 : -1))
  }
  Component.onDestruction: {
    if (service && opened) service.openPanels = Math.max(0, service.openPanels - 1)
  }

  // --- actions ------------------------------------------------------------
  // Home Assistant answers before Dyson does, so nothing here waits for the
  // poll: the panel draws the intent immediately and the next poll reconciles.

  readonly property bool actionable: !!service && service.ready && fanEntity !== ""

  function togglePower() {
    if (!actionable) return
    service.callService("fan", fanOn ? "turn_off" : "turn_on", { entity_id: fanEntity })
  }
  function setSpeed(value) {
    if (!actionable) return
    var next = Math.max(0, Math.min(maxSpeed, Math.round(value)))
    if (next === speed) return
    service.callService("fan", "set_percentage",
      { entity_id: fanEntity, percentage: Dyson.percentageFromSpeed(next, fanAttrs) })
  }
  function toggleOscillation() {
    if (!actionable) return
    service.callService("fan", "oscillate", { entity_id: fanEntity, oscillating: !oscillating })
  }
  function setFanMode(mode) {
    if (!actionable || !caps.climate || !mode || mode === fanMode) return
    service.callService("climate", "set_fan_mode", { entity_id: caps.climate, fan_mode: mode })
  }
  function setSelectOption(entityId, option) {
    if (!actionable || !entityId || !option) return
    service.callService("select", "select_option", { entity_id: entityId, option: option })
  }
  function setSwitch(entityId, on) {
    if (!actionable || !entityId) return
    service.callService("switch", on ? "turn_on" : "turn_off", { entity_id: entityId })
  }
  function setNumber(entityId, value) {
    if (!actionable || !entityId) return
    service.callService("number", "set_value", { entity_id: entityId, value: value })
  }
  function setDirection(direction) {
    if (!actionable || !directionSupported) return
    service.callService("fan", "set_direction", { entity_id: fanEntity, direction: direction })
  }
  function setAngles(low, high) {
    if (!actionable) return
    if (low === angleLow && high === angleHigh) return
    service.setOscillationAngles(fanEntity, low, high)
  }
  function applyAnglePreset(name) {
    var presets = Dyson.anglePresets()
    for (var i = 0; i < presets.length; i++)
      if (presets[i].value === name) { setAngles(presets[i].low, presets[i].high); return }
  }
  function moveAngle(which, value) {
    var next = Dyson.angleRange(which === "low" ? value : angleLow,
                                which === "high" ? value : angleHigh, which)
    setAngles(next.low, next.high)
  }
  function resetFilter(kind) {
    if (!actionable) return
    service.resetFilter(fanEntity, kind)
  }
  function toggleNight() {
    if (!actionable || !caps.nightSwitch) return
    service.callService("switch", nightMode ? "turn_off" : "turn_on", { entity_id: caps.nightSwitch })
  }
  // Auto is a switch on newer models and only a fan preset on older Link ones.
  function toggleAuto() {
    if (!actionable || !autoSupported) return
    if (caps.autoSwitch)
      service.callService("switch", autoMode ? "turn_off" : "turn_on", { entity_id: caps.autoSwitch })
    else
      service.callService("fan", "set_preset_mode",
        { entity_id: fanEntity, preset_mode: autoMode ? "manual" : "auto" })
  }
  function setHvacMode(mode) {
    if (!actionable || !hasClimate) return
    service.callService("climate", "set_hvac_mode", { entity_id: caps.climate, hvac_mode: mode })
  }
  function setTargetTemp(value) {
    if (!actionable || !hasClimate) return
    var next = Math.max(minTemp, Math.min(maxTemp, Math.round(value)))
    if (next === Math.round(targetTemp)) return
    service.callService("climate", "set_temperature", { entity_id: caps.climate, temperature: next })
  }
  function toggleHumidifier() {
    if (!actionable || !hasHumidifier) return
    service.callService("humidifier", humidifying ? "turn_off" : "turn_on",
      { entity_id: caps.humidifier })
  }
  function setTargetHumidity(value) {
    if (!actionable || !hasHumidifier) return
    var next = Math.max(minHumidity, Math.min(maxHumidity, Math.round(value)))
    if (next === Math.round(targetHumidity)) return
    service.callService("humidifier", "set_humidity",
      { entity_id: caps.humidifier, humidity: next })
  }

  function openSettings(tab) {
    if (bar && bar.shell && typeof bar.shell.summon === "function")
      bar.shell.summon(root.moduleName, JSON.stringify({ tab: tab || "connection" }))
  }

  IpcHandler {
    target: root.ipcTarget
    function settings(): void { root.openSettings("connection") }
    function devices(): void { root.openSettings("devices") }
    function toggle(): void { root.toggle() }
    function power(): void { root.togglePower() }
  }

  // --- bar button ---------------------------------------------------------

  // The single model every view decision reads. Built once so the bar label,
  // tooltip, hero text and section visibility cannot drift apart.
  readonly property var viewModel: ({
    hasService: !!service,
    configured: !!service && service.configured,
    everLoaded: !!service && service.everLoaded,
    lastError: service ? service.lastError : "",
    ready: !!service && service.ready,
    actionable: actionable,
    fanEntity: fanEntity, title: title, fans: fans, pinnedFan: pinnedFan,
    barMetric: barMetric, fanOn: fanOn, speed: speed, maxSpeed: maxSpeed,
    stale: stale, staleMs: staleMs, autoReconnect: autoReconnect,
    heating: heating, targetTemp: targetTemp, currentTemp: currentTemp,
    climateEntity: caps.climate || "", hvacModes: hvacModes,
    humidifierEntity: caps.humidifier || "", humidifying: humidifying,
    nightSwitch: caps.nightSwitch || "", autoSupported: autoSupported,
    oscillating: oscillating, angleOptions: angleOptions, tiltOptions: tiltOptions,
    fanModes: fanModes,
    sleepTimerEntity: caps.sleepTimer || "", monitorSwitch: caps.monitorSwitch || "",
    heatingModeOptions: heatingModeOptions, waterHardnessOptions: waterHardnessOptions,
    directionSupported: directionSupported,
    aqiCategory: aqiCategory, dominantPollutant: dominantPollutant, outdoorAqi: outdoorAqi,
    carbonFilter: carbonFilter, hepaFilterType: hepaFilterType,
    carbonFilterType: carbonFilterType, connectionStatus: connectionStatus,
    wifiSignal: wifiSignal, scheduledEvents: scheduledEvents, faults: caps.faults || [],
    filterDue: filterDue, historyPoints: historyPoints.length,
    pm25: pm25, pm10: pm10, voc: voc, no2: no2, co2: co2, hcho: hcho,
    aqi: aqi, humidity: humidity, hepaFilter: hepaFilter
  })
  readonly property var view: View.sections(viewModel)

  // Details starts open when something in it is worth reading — an active
  // fault, a filter due — and closed otherwise. Tri-state so a click is a real
  // override in both directions: -1 follows the default, 0 and 1 are the user's.
  property int detailsChoice: -1
  readonly property int faultCount: View.activeFaultCount(viewModel)
  readonly property bool detailsOpen: detailsChoice === -1
    ? view.detailsOpenByDefault : detailsChoice === 1


  readonly property string barLabel: View.barLabel(viewModel)

  readonly property string statusLine: View.statusLine(viewModel)

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: root.barLabel
    active: View.barActive(root.viewModel)
    activeColor: root.barMetric === "PM2.5" && root.airAlarm
      ? Color.urgent : (bar ? bar.barForeground : Color.foreground)
    // Stale reads as broken on purpose: the numbers are still there, but they
    // describe the past. Presenting them at full strength is what makes a
    // widget claim a device is off while it is plainly running.
    dimmed: View.barDimmed(root.viewModel)
    tooltipText: root.statusLine
    onPressed: function(b) {
      if (b === Qt.MiddleButton) root.togglePower()
      else if (!root.service || !root.service.configured) root.openSettings("connection")
      else root.toggle()
    }
    onWheelMoved: function(delta) {
      if (!root.actionable) return
      var wheel = Util.wheelSteps(root.wheelAccumulator, delta)
      root.wheelAccumulator = wheel.remainder
      if (wheel.steps === 0) return
      root.setSpeed(root.speed + wheel.steps)
    }
  }
  property int wheelAccumulator: 0

  // --- panel --------------------------------------------------------------

  KeyboardPanel {
    id: panel
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(340))
    contentHeight: panel.fittedContentHeight(panelColumn.implicitHeight, Style.space(680))

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      onMoveRequested: function(dx, dy) { if (dx !== 0) root.setSpeed(root.speed + dx) }
      onActivateRequested: root.togglePower()
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }

      ScrollView {
        id: scrollArea
        anchors.fill: parent
        clip: true
        ScrollBar.horizontal.policy: ScrollBar.AlwaysOff
        ScrollBar.vertical.policy: panelColumn.implicitHeight > height ? ScrollBar.AsNeeded : ScrollBar.AlwaysOff

        Column {
          id: panelColumn
          width: scrollArea.availableWidth
          spacing: Style.space(14)

          // ---------- Hero ----------
          Item {
            width: parent.width
            implicitHeight: Math.max(heroIcon.implicitHeight, heroLabels.implicitHeight)

            Text {
              id: heroIcon
              text: "󰈐"
              color: root.bar.foreground
              font.family: root.bar.fontFamily
              font.pixelSize: Style.font.display
              opacity: root.fanOn ? 1 : 0.5
              anchors.left: parent.left
              anchors.verticalCenter: parent.verticalCenter

              RotationAnimator on rotation {
                running: root.fanOn && !root.stale
                from: 0; to: 360
                // Slowest speed turns once every 3s, fastest every ~0.35s:
                // fast enough to read the dial at a glance without nagging.
                duration: View.spinDurationMs(root.speed, root.maxSpeed)
                loops: Animation.Infinite
              }
              onRotationChanged: if (!root.fanOn) rotation = 0
            }

            Column {
              id: heroLabels
              anchors.left: heroIcon.right
              anchors.leftMargin: Style.space(12)
              anchors.right: settingsButton.left
              anchors.rightMargin: Style.space(6)
              anchors.verticalCenter: parent.verticalCenter
              spacing: Style.space(2)

              Text {
                width: parent.width
                text: root.title
                color: root.bar.foreground
                font.family: root.bar.fontFamily
                font.pixelSize: Style.font.title
                elide: Text.ElideRight
              }

              Text {
                width: parent.width
                text: View.heroSubtitle(root.viewModel)
                color: root.bar.foreground
                opacity: 0.6
                font.family: root.bar.fontFamily
                font.pixelSize: Style.font.caption
                elide: Text.ElideRight
              }
            }

            PanelActionButton {
              id: settingsButton
              anchors.right: parent.right
              anchors.verticalCenter: parent.verticalCenter
              iconText: "󰒓"
              foreground: root.bar.foreground
              tooltipText: "Settings"
              onClicked: { root.close(); root.openSettings("connection") }
            }
          }

          // ---------- Device switcher ----------
          // Only when there is a genuine choice and this widget is not pinned:
          // a pinned widget showing a switcher would silently disagree with
          // its own settings.
          ButtonGroup {
            width: parent.width
            visible: root.view.deviceSwitcher
            foreground: root.bar.foreground
            background: root.bar.background
            fontFamily: root.bar.fontFamily
            options: View.deviceOptions(root.fans, false)
            value: root.fanEntity
            onChanged: function(v) { root.overrideFan = v }
          }

          // ---------- Mode ----------
          // On a heater this replaces a plain power toggle: the climate
          // entity's "off" is the same off, and two controls could disagree
          // about what the device is doing.
          PanelSectionHeader {
            width: parent.width
            text: "Mode"
            foreground: root.bar.foreground
            fontFamily: root.bar.fontFamily
            visible: root.view.climate
          }

          ButtonGroup {
            width: parent.width
            visible: root.view.climate
            enabled: root.actionable
            opacity: root.actionable ? 1 : 0.4
            foreground: root.bar.foreground
            background: root.bar.background
            fontFamily: root.bar.fontFamily
            options: View.hvacOptions(root.hvacModes)
            value: root.hvacMode
            onChanged: function(v) { root.setHvacMode(v) }
          }

          Toggle {
            width: parent.width
            label: "Power"
            description: "Turn the device on or off"
            checked: root.fanOn
            visible: root.view.powerToggle
            enabled: root.actionable
            opacity: root.actionable ? 1 : 0.4
            foreground: root.bar.foreground
            fontFamily: root.bar.fontFamily
            onClicked: root.togglePower()
          }

          // ---------- Target temperature ----------
          PanelSectionHeader {
            width: parent.width
            text: "Target " + Math.round(root.targetTemp) + "°C"
            foreground: root.bar.foreground
            fontFamily: root.bar.fontFamily
            visible: root.heating
          }

          PanelSlider {
            width: parent.width
            visible: root.view.targetTemp
            bar: root.bar
            enabled: root.actionable
            minimum: root.minTemp; maximum: root.maxTemp
            step: 1; integer: true
            value: root.targetTemp
            onMoved: function(v) { root.setTargetTemp(v) }
          }

          // ---------- Humidity ----------
          PanelSectionHeader {
            width: parent.width
            text: "Humidity — target " + Math.round(root.targetHumidity) + "%"
            foreground: root.bar.foreground
            fontFamily: root.bar.fontFamily
            visible: root.view.humidifier
          }

          Toggle {
            width: parent.width
            label: "Humidify"
            description: root.humidity !== "" ? "Room is at " + root.humidity + "%" : "Add moisture to the air"
            checked: root.humidifying
            visible: root.view.humidifier
            enabled: root.actionable
            foreground: root.bar.foreground
            fontFamily: root.bar.fontFamily
            onClicked: root.toggleHumidifier()
          }

          PanelSlider {
            width: parent.width
            visible: root.view.humiditySlider
            bar: root.bar
            enabled: root.actionable
            minimum: root.minHumidity; maximum: root.maxHumidity
            step: 1; integer: true
            value: root.targetHumidity
            onMoved: function(v) { root.setTargetHumidity(v) }
          }

          // ---------- Speed ----------
          PanelSectionHeader {
            width: parent.width
            text: "Speed"
            foreground: root.bar.foreground
            fontFamily: root.bar.fontFamily
          }

          PanelSlider {
            width: parent.width
            bar: root.bar
            enabled: root.actionable
            opacity: root.actionable ? 1 : 0.4
            minimum: 0; maximum: root.maxSpeed
            step: 1; integer: true
            tickCount: root.maxSpeed + 1
            value: root.speed
            onMoved: function(v) { root.setSpeed(v) }
          }

          PanelSectionHeader {
            width: parent.width
            text: "Airflow"
            visible: root.view.airflow
            foreground: root.bar.foreground
            fontFamily: root.bar.fontFamily
          }

          ButtonGroup {
            width: parent.width
            visible: root.view.airflow
            enabled: root.actionable
            opacity: root.actionable ? 1 : 0.4
            foreground: root.bar.foreground
            background: root.bar.background
            fontFamily: root.bar.fontFamily
            options: View.airflowOptions(root.fanModes)
            value: root.fanMode
            onChanged: function(v) { root.setFanMode(v) }
          }

          // ---------- Modes ----------
          PanelSectionHeader {
            width: parent.width
            text: "Modes"
            foreground: root.bar.foreground
            fontFamily: root.bar.fontFamily
          }

          Toggle {
            width: parent.width
            label: "Oscillation"
            description: "Sweep left and right"
            checked: root.oscillating
            enabled: root.actionable
            opacity: root.actionable ? 1 : 0.4
            foreground: root.bar.foreground
            fontFamily: root.bar.fontFamily
            onClicked: root.toggleOscillation()
          }

          PanelSectionHeader {
            width: parent.width
            text: "Width"
            visible: root.view.oscillationAngle
            foreground: root.bar.foreground
            fontFamily: root.bar.fontFamily
          }

          ButtonGroup {
            width: parent.width
            visible: root.view.oscillationAngle
            enabled: root.actionable
            opacity: root.actionable ? 1 : 0.4
            foreground: root.bar.foreground
            background: root.bar.background
            fontFamily: root.bar.fontFamily
            options: View.selectOptions(root.angleOptions)
            value: root.angleMode
            onChanged: function(v) { root.setSelectOption(root.caps.oscillationMode, v) }
          }

          PanelSectionHeader {
            width: parent.width
            text: "Tilt"
            visible: root.view.tilt
            foreground: root.bar.foreground
            fontFamily: root.bar.fontFamily
          }

          ButtonGroup {
            width: parent.width
            visible: root.view.tilt
            enabled: root.actionable
            opacity: root.actionable ? 1 : 0.4
            foreground: root.bar.foreground
            background: root.bar.background
            fontFamily: root.bar.fontFamily
            options: View.selectOptions(root.tiltOptions)
            value: root.tiltMode
            onChanged: function(v) { root.setSelectOption(root.caps.tiltMode, v) }
          }

          PanelSectionHeader {
            width: parent.width
            text: "Aim"
            visible: root.view.aiming
            foreground: root.bar.foreground
            fontFamily: root.bar.fontFamily
          }

          ButtonGroup {
            width: parent.width
            visible: root.view.aiming
            enabled: root.actionable
            opacity: root.actionable ? 1 : 0.4
            foreground: root.bar.foreground
            background: root.bar.background
            fontFamily: root.bar.fontFamily
            options: Dyson.anglePresets()
            value: root.anglePreset
            onChanged: function(v) { root.applyAnglePreset(v) }
          }

          Text {
            width: parent.width
            visible: root.view.aiming
            text: View.angleLabel(root.angleLow, root.angleHigh, Dyson.ANGLE_MIN, Dyson.ANGLE_MAX)
            color: root.bar.foreground
            opacity: 0.7
            font.family: root.bar.fontFamily
            font.pixelSize: Style.font.caption
          }

          // Posted on release, not on every drag step: each call reaches the
          // fan over MQTT, and a drag emits dozens of intermediate values.
          PanelSlider {
            width: parent.width
            visible: root.view.aiming
            bar: root.bar
            enabled: root.actionable
            minimum: Dyson.ANGLE_MIN; maximum: Dyson.ANGLE_MAX
            step: Dyson.ANGLE_STEP; integer: true
            value: root.angleLow
            onReleased: function(v) { root.moveAngle("low", v) }
          }

          PanelSlider {
            width: parent.width
            visible: root.view.aiming
            bar: root.bar
            enabled: root.actionable
            minimum: Dyson.ANGLE_MIN; maximum: Dyson.ANGLE_MAX
            step: Dyson.ANGLE_STEP; integer: true
            value: root.angleHigh
            onReleased: function(v) { root.moveAngle("high", v) }
          }

          // Hidden rather than greyed when the device has no such control: a
          // permanently dead row is worse than a shorter panel.
          Toggle {
            width: parent.width
            label: "Night mode"
            description: "Quiet running, display dimmed"
            checked: root.nightMode
            visible: root.view.nightMode
            enabled: root.actionable
            foreground: root.bar.foreground
            fontFamily: root.bar.fontFamily
            onClicked: root.toggleNight()
          }

          Toggle {
            width: parent.width
            label: "Auto mode"
            description: "Let the device follow air quality"
            checked: root.autoMode
            visible: root.view.autoMode
            enabled: root.actionable
            foreground: root.bar.foreground
            fontFamily: root.bar.fontFamily
            onClicked: root.toggleAuto()
          }

          Toggle {
            width: parent.width
            label: "Continuous monitoring"
            description: "Keep sensing air quality while the fan is off"
            checked: root.monitoring
            visible: root.view.monitoring
            enabled: root.actionable
            foreground: root.bar.foreground
            fontFamily: root.bar.fontFamily
            onClicked: root.setSwitch(root.caps.monitorSwitch, !root.monitoring)
          }

          Row {
            width: parent.width
            visible: root.view.direction
            spacing: Style.space(10)

            Text {
              anchors.verticalCenter: parent.verticalCenter
              text: "Airflow direction"
              color: root.bar.foreground
              font.family: root.bar.fontFamily
              font.pixelSize: Style.font.caption
            }

            ButtonGroup {
              enabled: root.actionable
              opacity: root.actionable ? 1 : 0.4
              foreground: root.bar.foreground
              background: root.bar.background
              fontFamily: root.bar.fontFamily
              options: [{ value: "forward", label: "Front" }, { value: "reverse", label: "Back" }]
              value: root.fanDirection
              onChanged: function(v) { root.setDirection(v) }
            }
          }

          PanelSectionHeader {
            width: parent.width
            text: "Heating mode"
            visible: root.view.heatingMode
            foreground: root.bar.foreground
            fontFamily: root.bar.fontFamily
          }

          ButtonGroup {
            width: parent.width
            visible: root.view.heatingMode
            enabled: root.actionable
            opacity: root.actionable ? 1 : 0.4
            foreground: root.bar.foreground
            background: root.bar.background
            fontFamily: root.bar.fontFamily
            options: View.selectOptions(root.heatingModeOptions)
            value: root.heatingModeValue
            onChanged: function(v) { root.setSelectOption(root.caps.heatingMode, v) }
          }

          PanelSectionHeader {
            width: parent.width
            text: "Water hardness"
            visible: root.view.waterHardness
            foreground: root.bar.foreground
            fontFamily: root.bar.fontFamily
          }

          ButtonGroup {
            width: parent.width
            visible: root.view.waterHardness
            enabled: root.actionable
            opacity: root.actionable ? 1 : 0.4
            foreground: root.bar.foreground
            background: root.bar.background
            fontFamily: root.bar.fontFamily
            options: View.selectOptions(root.waterHardnessOptions)
            value: root.waterHardnessValue
            onChanged: function(v) { root.setSelectOption(root.caps.waterHardness, v) }
          }

          PanelSectionHeader {
            width: parent.width
            text: "Sleep timer · " + View.sleepTimerLabel(root.sleepTimerMinutes)
            visible: root.view.sleepTimer
            foreground: root.bar.foreground
            fontFamily: root.bar.fontFamily
          }

          PanelSlider {
            width: parent.width
            visible: root.view.sleepTimer
            bar: root.bar
            enabled: root.actionable
            minimum: 0
            maximum: Number(root.sleepTimerAttrs.max || 540)
            step: Number(root.sleepTimerAttrs.step || 15)
            integer: true
            value: root.sleepTimerMinutes
            onReleased: function(v) { root.setNumber(root.caps.sleepTimer, v) }
          }

          // ---------- Air quality ----------
          PanelSectionHeader {
            width: parent.width
            text: "Air quality"
            foreground: root.bar.foreground
            fontFamily: root.bar.fontFamily
            visible: root.view.airQuality
          }

          // PM2.5 over the last `historyHours`, the way the Dyson app plots it.
          // Drawn rather than charted with a library: one series, no axes, and
          // a Canvas keeps the plugin dependency-free.
          Item {
            width: parent.width
            implicitHeight: Style.space(78)
            visible: root.view.graph

            Canvas {
              id: graph
              anchors.fill: parent
              anchors.bottomMargin: Style.space(14)

              readonly property var points: root.historyPoints
              readonly property var bounds: root.historyBounds
              readonly property color line: root.airAlarm ? Color.urgent : root.bar.foreground
              onPointsChanged: requestPaint()
              onLineChanged: requestPaint()

              onPaint: {
                var ctx = getContext("2d")
                ctx.reset()
                var b = bounds
                if (!b || points.length < 2) return

                var w = width, h = height
                var tSpan = Math.max(1, b.tMax - b.tMin)
                var vSpan = Math.max(0.0001, b.max - b.min)
                function px(p) { return (p.t - b.tMin) / tSpan * w }
                function py(p) { return h - (p.v - b.min) / vSpan * h }

                ctx.beginPath()
                ctx.moveTo(px(points[0]), h)
                for (var i = 0; i < points.length; i++) ctx.lineTo(px(points[i]), py(points[i]))
                ctx.lineTo(px(points[points.length - 1]), h)
                ctx.closePath()
                ctx.fillStyle = Qt.rgba(line.r, line.g, line.b, 0.16)
                ctx.fill()

                ctx.beginPath()
                for (var j = 0; j < points.length; j++) {
                  var x = px(points[j]), y = py(points[j])
                  if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
                }
                ctx.strokeStyle = line
                ctx.lineWidth = Math.max(1.5, Style.space(2))
                ctx.lineJoin = "round"; ctx.lineCap = "round"
                ctx.stroke()

                // Mark the latest reading — the one the numbers below quote.
                var last = points[points.length - 1]
                ctx.beginPath()
                ctx.arc(px(last), py(last), Math.max(2.5, Style.space(3)), 0, Math.PI * 2)
                ctx.fillStyle = line
                ctx.fill()
              }
            }

            // Peak and window, so a level line is still quantified: the
            // minimum-span padding in historyStats means a steady reading
            // draws flat, and these say which of the two you are looking at.
            Text {
              anchors.left: parent.left; anchors.bottom: parent.bottom
              text: root.historyBounds ? "peak " + root.historyBounds.max.toFixed(0) + " µg/m³" : ""
              color: root.bar.foreground; opacity: 0.5
              font.family: root.bar.fontFamily; font.pixelSize: Style.font.caption
            }
            Text {
              anchors.right: parent.right; anchors.bottom: parent.bottom
              text: "last " + root.historyHours + "h"
              color: root.bar.foreground; opacity: 0.5
              font.family: root.bar.fontFamily; font.pixelSize: Style.font.caption
            }
          }

          Grid {
            id: readings
            width: parent.width
            columns: 2
            columnSpacing: Style.space(10)
            rowSpacing: Style.space(6)

            readonly property var entries: View.readings(root.viewModel)
            visible: root.view.airQuality

            Repeater {
              model: readings.entries

              Item {
                required property var modelData
                width: (readings.width - Style.space(10)) / 2
                implicitHeight: Math.max(readingLabel.implicitHeight, readingValue.implicitHeight)

                Text {
                  id: readingLabel
                  anchors.left: parent.left; anchors.verticalCenter: parent.verticalCenter
                  text: parent.modelData.label
                  color: root.bar.foreground; opacity: 0.6
                  font.family: root.bar.fontFamily; font.pixelSize: Style.font.caption
                }

                Text {
                  id: readingValue
                  anchors.right: parent.right; anchors.verticalCenter: parent.verticalCenter
                  text: View.readingText(parent.modelData)
                  color: View.readingColorKey(parent.modelData, root.airAlarm) === "urgent"
                    ? Color.urgent : root.bar.foreground
                  font.family: root.bar.fontFamily; font.pixelSize: Style.font.body
                }
              }
            }
          }

          Text {
            width: parent.width
            visible: root.view.filterWarning
            text: "󰀪  Filter needs replacing"
            color: root.bar.foreground
            font.family: root.bar.fontFamily
            font.pixelSize: Style.font.caption
          }

          // ---------- Details ----------
          // Read-only diagnostics, folded away unless something in them wants
          // reading. Opening it is sticky for the session but never overrides
          // the auto-open, so a fault that appears while the panel is shut is
          // still visible when it next opens.
          Item {
            width: parent.width
            visible: root.view.details
            implicitHeight: detailsHeader.implicitHeight + Style.space(6)

            Text {
              id: detailsHeader
              anchors.left: parent.left
              anchors.verticalCenter: parent.verticalCenter
              text: (root.detailsOpen ? "▾  Details" : "▸  Details")
              color: root.bar.foreground
              opacity: 0.7
              font.family: root.bar.fontFamily
              font.pixelSize: Style.font.caption
              font.bold: true
            }

            Text {
              anchors.right: parent.right
              anchors.verticalCenter: parent.verticalCenter
              visible: root.faultCount > 0
              text: root.faultCount + (root.faultCount === 1 ? " fault" : " faults")
              color: Color.urgent
              font.family: root.bar.fontFamily
              font.pixelSize: Style.font.caption
            }

            MouseArea {
              anchors.fill: parent
              cursorShape: Qt.PointingHandCursor
              onClicked: root.detailsChoice = root.detailsOpen ? 0 : 1
            }
          }

          Grid {
            id: detailRows
            width: parent.width
            columns: 2
            columnSpacing: Style.space(10)
            rowSpacing: Style.space(6)
            visible: root.view.details && root.detailsOpen

            readonly property var entries: View.details(root.viewModel)

            Repeater {
              model: detailRows.entries

              Item {
                required property var modelData
                width: (detailRows.width - Style.space(10)) / 2
                implicitHeight: Math.max(detailLabel.implicitHeight, detailValue.implicitHeight)

                Text {
                  id: detailLabel
                  anchors.left: parent.left; anchors.verticalCenter: parent.verticalCenter
                  text: parent.modelData.label
                  color: root.bar.foreground; opacity: 0.6
                  font.family: root.bar.fontFamily; font.pixelSize: Style.font.caption
                }

                Text {
                  id: detailValue
                  anchors.right: parent.right
                  anchors.verticalCenter: parent.verticalCenter
                  width: parent.width - detailLabel.implicitWidth - Style.space(8)
                  horizontalAlignment: Text.AlignRight
                  elide: Text.ElideRight
                  text: parent.modelData.value
                  color: parent.modelData.alarm ? Color.urgent : root.bar.foreground
                  font.family: root.bar.fontFamily; font.pixelSize: Style.font.caption
                }
              }
            }
          }

          Toggle {
            width: parent.width
            visible: root.view.details && root.detailsOpen && root.caps.firmwareAutoUpdate !== ""
            label: "Firmware auto-update"
            description: "Let the device update itself"
            checked: root.firmwareAuto
            enabled: root.actionable
            foreground: root.bar.foreground
            fontFamily: root.bar.fontFamily
            onClicked: root.setSwitch(root.caps.firmwareAutoUpdate, !root.firmwareAuto)
          }

          Row {
            width: parent.width
            visible: root.view.details && root.detailsOpen && root.caps.hepaFilter !== ""
            spacing: Style.space(8)

            Button {
              enabled: root.actionable
              opacity: root.actionable ? 1 : 0.4
              text: "Reset filter life"
              bordered: true
              foreground: root.bar.foreground
              background: root.bar.background
              fontFamily: root.bar.fontFamily
              onClicked: root.resetFilter(root.caps.carbonFilter !== "" ? "both" : "hepa")
            }
          }
        }
      }
    }
  }
}
