import QtQuick
import Quickshell
import Quickshell.Io
import "Dyson.js" as Dyson
import "Config.js" as Config
import "Origin.js" as Origin

// One connection, one poll, shared by every bar widget. Two fans on the bar
// cost one /api/states request, not two.
//
// Transport is plain REST. This plugin watches one household's air treatment
// devices rather than every entity in the house, so polling is sufficient and
// costs no helper process, no Python, and no vendored websocket library.
Item {
  id: root

  // Injected by the shell's service loader.
  property var shell: null
  visible: false

  readonly property string pluginId: "io.github.allstars101-sudo.dyson-air"
  readonly property string configDir: Quickshell.env("HOME") + "/.config/omarchy/" + pluginId
  readonly property string configPath: configDir + "/config.json"

  // --- configuration ------------------------------------------------------

  property var config: Config.parse("")
  readonly property string baseUrl: Origin.normalizeOrigin(config.baseUrl)
  readonly property bool configured: baseUrl !== ""

  // --- connection state ---------------------------------------------------

  property string token: ""
  property string tokenOrigin: ""
  property string phase: "idle"     // idle | connecting | ready | error
  property string lastError: ""
  property var states: []
  property int stateRevision: 0
  property bool everLoaded: false

  // Panels register while open so the poll can tighten and history can run.
  property int openPanels: 0

  readonly property bool ready: configured && token !== "" && everLoaded

  function currentOrigin() { return root.baseUrl }

  // --- transport ----------------------------------------------------------

  function request(method, path, body, onDone, rawText) {
    if (!root.baseUrl || !root.token) return
    var xhr = new XMLHttpRequest()
    xhr.open(method, root.baseUrl + path)
    xhr.setRequestHeader("Authorization", "Bearer " + root.token)
    xhr.setRequestHeader("Content-Type", "application/json")
    xhr.onreadystatechange = function() {
      if (xhr.readyState !== XMLHttpRequest.DONE) return
      if (xhr.status >= 200 && xhr.status < 300) {
        root.lastError = ""
        root.phase = "ready"
        if (!onDone) return
        if (rawText) { onDone(String(xhr.responseText || "")); return }
        try { onDone(JSON.parse(xhr.responseText || "null")) }
        catch (e) { root.fail("Home Assistant sent a response we could not read.") }
      } else if (xhr.status === 401) {
        root.fail("Home Assistant rejected the access token.")
      } else if (xhr.status === 0) {
        root.fail("Cannot reach Home Assistant at " + root.baseUrl + ".")
      } else {
        root.fail("Home Assistant returned HTTP " + xhr.status + ".")
      }
    }
    xhr.send(body ? JSON.stringify(body) : "")
  }

  function fail(message) {
    root.lastError = message
    root.phase = "error"
  }

  function callService(domain, service, data) {
    if (!root.ready) return
    request("POST", "/api/services/" + domain + "/" + service, data || {}, function() {
      // Dyson acknowledges over MQTT a beat after HA returns, so refreshing on
      // the same tick would read back the stale value and undo the optimistic
      // update the panel has already drawn.
      settleTimer.restart()
    })
  }

  function refresh() {
    if (!root.baseUrl || !root.token) return
    if (root.phase === "idle") root.phase = "connecting"
    request("GET", "/api/states", null, function(data) {
      if (!Array.isArray(data)) return
      root.states = data
      root.everLoaded = true
      root.stateRevision++
    })
  }

  // The product type lives in HA's device registry, which the REST API does not
  // expose — but the template endpoint reaches it with a plain POST, rather than
  // the websocket subscription a registry read would otherwise need.
  function fetchModel(fanEntity, onName) {
    if (!fanEntity) return
    request("POST", "/api/template",
      { template: "{{ device_attr('" + fanEntity + "', 'model') }}" },
      function(text) { onName(Dyson.modelName(text)) }, true)
  }

  function fetchHistory(entity, hours, onPoints) {
    if (!entity) return
    var start = new Date(Date.now() - hours * 3600 * 1000).toISOString()
    request("GET", "/api/history/period/" + start
              + "?filter_entity_id=" + entity + "&minimal_response&no_attributes",
      null, function(data) { onPoints(Dyson.parseHistory(data)) })
  }

  // --- credentials --------------------------------------------------------

  property CredentialManager credentials: CredentialManager {
    onTokenReady: function(value, origin) {
      // A keyring operation that completes for a connection the user has since
      // changed must be discarded, not applied.
      if (origin !== root.currentOrigin()) return
      root.token = value
      root.tokenOrigin = origin
      root.lastError = ""
      root.phase = "connecting"
      root.refresh()
    }
    onCleared: function(origin) {
      if (origin !== root.currentOrigin()) return
      root.token = ""
      root.tokenOrigin = ""
      root.states = []
      root.everLoaded = false
      root.phase = "idle"
    }
    onFailed: function(message, origin) {
      if (origin && origin !== root.currentOrigin()) return
      root.fail(message)
    }
  }

  function loadToken() {
    if (!root.baseUrl) return
    // lookup() returns false without a signal when the keyring is mid-operation,
    // so a short retry is what keeps startup from stranding on "connecting".
    if (!credentials.lookup(root.baseUrl)) credentialRetry.restart()
  }

  function storeToken(value) { return credentials.store(value, root.baseUrl) }
  function forgetToken() { return credentials.clear(root.baseUrl) }

  property Timer credentialRetry: Timer {
    interval: 400
    onTriggered: root.loadToken()
  }

  onBaseUrlChanged: {
    root.token = ""
    root.states = []
    root.everLoaded = false
    root.phase = root.baseUrl ? "connecting" : "idle"
    root.lastError = ""
    if (root.baseUrl) root.loadToken()
  }

  // --- config persistence -------------------------------------------------

  function applyConfig(patch) {
    var next = Config.merge(root.config, patch)
    root.config = next
    configFile.setText(Config.serialize(next))
  }

  function pinnedFor(moduleName) { return Config.pinnedFor(root.config, moduleName) }
  function setPin(moduleName, entityId) {
    root.config = Config.withPin(root.config, moduleName, entityId)
    configFile.setText(Config.serialize(root.config))
  }

  // FileView will not create a missing parent directory, so the config dir is
  // made once at startup rather than on first write.
  property Process mkdirProcess: Process {
    command: ["mkdir", "-p", root.configDir]
    running: true
  }

  property FileView configFile: FileView {
    path: root.configPath
    watchChanges: true
    printErrors: false
    atomicWrites: true
    onLoaded: {
      var parsed = Config.parse(text())
      root.config = parsed
      if (parsed.error) root.fail(parsed.error)
    }
    onLoadFailed: root.config = Config.parse("")
    onFileChanged: reload()
  }

  // --- polling ------------------------------------------------------------

  property Timer pollTimer: Timer {
    // A closed panel only needs the bar's number current; an open one is being
    // watched, so it polls fast enough to reflect changes made from the fan's
    // own remote while you are looking at it.
    interval: root.openPanels > 0 ? 2000 : Math.max(5, root.config.pollSeconds) * 1000
    running: root.baseUrl !== "" && root.token !== ""
    repeat: true
    triggeredOnStart: true
    onTriggered: root.refresh()
  }

  property Timer settleTimer: Timer {
    interval: 700
    onTriggered: root.refresh()
  }
}
