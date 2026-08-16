import QtQuick
import QtQuick.Controls
import Quickshell
import Quickshell.Wayland
import qs.Ui
import qs.Commons
import "Dyson.js" as Dyson
import "Origin.js" as Origin

// Settings overlay: connection on one tab, devices and display on the other.
//
// Summoned by the shell rather than by its own IPC route — the bar widget
// already owns this plugin's IPC target, and a target routes to one handler.
// The bar widget calls shell.summon(id, '{"tab":"connection"}'), which lands in
// open() below.
//
// Window structure (scrim + centred card + key catcher) follows konradk/hass
// Settings.qml (MIT, Copyright (c) 2026 Konrad Kruk). See THIRD_PARTY_NOTICES.md.
Item {
  id: root

  // Injected by the shell's panel loader.
  property var shell: null
  property var manifest: null
  property var service: null
  property var pluginRegistry: null

  property bool opened: false
  property string tab: "connection"
  property string urlDraft: ""
  property string tokenDraft: ""
  property string notice: ""

  readonly property string pluginId: manifest && manifest.id
    ? manifest.id : "io.github.allstars101-sudo.dyson-air"
  readonly property string draftOrigin: Origin.normalizeOrigin(urlDraft)
  readonly property bool draftValid: draftOrigin !== ""
  readonly property bool configured: !!service && service.configured
  readonly property bool hasToken: !!service && service.token !== ""

  function open(payloadJson) {
    var next = "connection"
    try {
      var payload = JSON.parse(payloadJson || "{}")
      if (payload.tab === "devices" || payload.tab === "connection") next = payload.tab
    } catch (e) { /* an unreadable payload just means the default tab */ }
    root.tab = next
    // Re-apply after the window builds. On the first summon the card does not
    // exist yet, and the tab selector emits its own selection as it initialises
    // — which would otherwise overwrite the tab that was actually asked for.
    Qt.callLater(function() { root.tab = next })
    root.urlDraft = service ? service.config.baseUrl : ""
    root.tokenDraft = ""
    root.notice = ""
    root.opened = true
  }

  function close() { root.opened = false }
  function dismiss() {
    root.opened = false
    if (shell && typeof shell.hide === "function") shell.hide(root.pluginId)
  }

  // --- actions ------------------------------------------------------------

  function applyConnection() {
    if (!service) return
    if (!draftValid) {
      root.notice = "That does not look like a Home Assistant address."
      return
    }
    var originChanged = draftOrigin !== Origin.normalizeOrigin(service.config.baseUrl)
    if (originChanged) service.applyConfig({ baseUrl: draftOrigin })

    if (tokenDraft) {
      // The keyring scopes tokens by origin, so the config must carry the new
      // address before the token is stored against it.
      if (service.storeToken(tokenDraft)) {
        root.tokenDraft = ""
        root.notice = "Saved."
      }
    } else if (originChanged) {
      root.notice = "Address saved. Enter a token for this server."
    } else {
      root.notice = "Nothing to change."
    }
  }

  function forgetConnection() {
    if (!service) return
    service.forgetToken()
    service.applyConfig({ baseUrl: "" })
    root.urlDraft = ""
    root.tokenDraft = ""
    root.notice = "Removed."
  }

  // --- placed widgets -----------------------------------------------------
  // Two widgets of this plugin share a module name, so a device is assigned to
  // a placement rather than to a name. This overlay is the only surface that
  // can do it: a widget cannot see its own position in the layout.

  readonly property int layoutRevision: shell && shell.barConfig ? 1 : 0
  readonly property var placements: {
    var out = []
    if (!shell || !shell.barConfig || !shell.barConfig.layout) return out
    var sections = ["left", "center", "right"]
    for (var s = 0; s < sections.length; s++) {
      var list = shell.barConfig.layout[sections[s]] || []
      for (var i = 0; i < list.length; i++) {
        var entry = list[i]
        var id = entry && entry.id ? String(entry.id) : String(entry)
        if (id !== root.pluginId) continue
        out.push({
          section: sections[s],
          index: i,
          fanEntity: entry && entry.fanEntity ? String(entry.fanEntity) : ""
        })
      }
    }
    return out
  }

  readonly property var fans: service && service.states.length
    ? Dyson.listFans(service.states) : []

  function fanOptions() {
    var out = [{ value: "", label: "Automatic" }]
    for (var i = 0; i < fans.length; i++)
      out.push({ value: fans[i].entityId, label: fans[i].serial || fans[i].name })
    return out
  }

  function assignDevice(placement, entityId) {
    if (!pluginRegistry || typeof pluginRegistry.setBarWidget !== "function") {
      root.notice = "This Omarchy build cannot write widget settings."
      return
    }
    var error = pluginRegistry.setBarWidget(root.pluginId, "fanEntity", entityId,
      { section: placement.section, index: placement.index })
    root.notice = error ? error : "Saved."
  }

  function applyDisplay(patch) {
    if (service) service.applyConfig(patch)
  }

  // --- window -------------------------------------------------------------

  PanelWindow {
    id: window
    visible: root.opened
    color: "transparent"
    WlrLayershell.namespace: "dyson-air-settings"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.Exclusive
    exclusionMode: ExclusionMode.Ignore
    anchors { top: true; bottom: true; left: true; right: true }

    Rectangle {
      anchors.fill: parent
      color: Qt.rgba(0, 0, 0, 0.45)
      MouseArea { anchors.fill: parent; onClicked: root.dismiss() }
    }

    BorderSurface {
      id: card
      anchors.centerIn: parent
      width: Math.min(Style.space(620), window.width - Style.gapsOut * 2)
      height: Math.min(Style.space(600), window.height - Style.gapsOut * 2)
      color: Color.menu.background
      radius: Style.cornerRadius
      borderSpec: Border.surfaceSpec("popups", "border", Color.popups.border,
                                     Math.max(1, Style.space(2)))

      // Swallow clicks so they do not reach the dismiss scrim behind.
      MouseArea { anchors.fill: parent }

      PanelKeyCatcher {
        anchors.fill: parent
        anchors.margins: Style.space(18)
        focus: root.opened
        onCloseRequested: root.dismiss()

        Column {
          id: body
          width: parent.width
          spacing: Style.space(14)

          Text {
            text: "Dyson Air"
            color: Color.menu.text
            font.family: Style.font.family
            font.pixelSize: Style.font.heading
          }

          ButtonGroup {
            options: [
              { value: "connection", label: "Connection" },
              { value: "devices", label: "Devices" }
            ]
            value: root.tab
            foreground: Color.menu.text
            background: Color.menu.background
            // Ignore the selection this emits while initialising; only a real
            // click on an open window should move the tab.
            onChanged: function(v) {
              if (!root.opened || v === root.tab) return
              root.tab = v
              root.notice = ""
            }
          }

          // ---------------- Connection ----------------
          Column {
            width: parent.width
            spacing: Style.space(10)
            visible: root.tab === "connection"

            PanelSectionHeader { width: parent.width; text: "Home Assistant address"; foreground: Color.menu.text }

            TextField {
              width: parent.width
              text: root.urlDraft
              placeholderText: "http://localhost:8123"
              foreground: Color.menu.text
              onTextChanged: root.urlDraft = text
            }

            Text {
              width: parent.width
              visible: Origin.isPlaintextRemote(root.draftOrigin)
              // A long-lived token is a permanent key to someone's home, and
              // http:// to another machine puts it on the wire in clear text.
              text: "This address is not encrypted. Your access token will cross the network in plain text."
              color: Color.urgent
              wrapMode: Text.WordWrap
              font.family: Style.font.family
              font.pixelSize: Style.font.caption
            }

            PanelSectionHeader {
              width: parent.width
              text: root.hasToken ? "Access token · leave blank to keep the stored one" : "Access token"
              foreground: Color.menu.text
            }

            TextField {
              width: parent.width
              text: root.tokenDraft
              password: true
              placeholderText: root.draftValid ? "Paste a long-lived access token" : "Enter the address first"
              foreground: Color.menu.text
              // The keyring stores tokens per address, so a token with no
              // address cannot be saved or found again. Refusing input here is
              // what stops the save silently doing nothing.
              enabled: root.draftValid
              opacity: root.draftValid ? 1 : 0.45
              onTextChanged: root.tokenDraft = text
            }

            Text {
              width: parent.width
              text: "Profile → Security → Long-lived access tokens → Create token. It is stored in your system keyring, never in a config file."
              color: Color.menu.text
              opacity: 0.6
              wrapMode: Text.WordWrap
              font.family: Style.font.family
              font.pixelSize: Style.font.caption
            }

            Row {
              spacing: Style.space(8)
              Button {
                text: "Save"
                bordered: true
                enabled: root.draftValid && !(root.service && root.service.credentials.busy)
                opacity: enabled ? 1 : 0.45
                onClicked: root.applyConnection()
              }
              Button {
                text: "Remove"
                bordered: true
                visible: root.configured
                onClicked: root.forgetConnection()
              }
              Button { text: "Close"; bordered: true; onClicked: root.dismiss() }
            }

            Text {
              width: parent.width
              text: {
                if (root.notice) return root.notice
                if (!root.service) return ""
                if (root.service.lastError) return root.service.lastError
                if (root.service.ready) return "Connected · " + root.fans.length
                  + (root.fans.length === 1 ? " Dyson found" : " Dysons found")
                if (root.configured) return "Connecting…"
                return "Not connected."
              }
              color: root.service && root.service.lastError ? Color.urgent : Color.menu.text
              opacity: root.service && root.service.lastError ? 1 : 0.7
              wrapMode: Text.WordWrap
              font.family: Style.font.family
              font.pixelSize: Style.font.caption
            }
          }

          // ---------------- Devices ----------------
          Column {
            width: parent.width
            spacing: Style.space(10)
            visible: root.tab === "devices"

            PanelSectionHeader { width: parent.width; text: "Widgets on the bar"; foreground: Color.menu.text }

            Text {
              width: parent.width
              visible: root.placements.length === 0
              text: "No Dyson Air widget is on the bar yet. Add one with:  omarchy bar put " + root.pluginId
              color: Color.menu.text
              opacity: 0.7
              wrapMode: Text.WordWrap
              font.family: Style.font.family
              font.pixelSize: Style.font.caption
            }

            Text {
              width: parent.width
              visible: root.placements.length > 1
              // Worth saying plainly: with several widgets, "Automatic" on more
              // than one means they all show the same device.
              text: "Each widget can show a different device. Widgets left on Automatic all follow the first Dyson found."
              color: Color.menu.text
              opacity: 0.6
              wrapMode: Text.WordWrap
              font.family: Style.font.family
              font.pixelSize: Style.font.caption
            }

            Repeater {
              model: root.placements

              Row {
                required property var modelData
                width: body.width
                spacing: Style.space(10)

                Text {
                  width: Style.space(120)
                  anchors.verticalCenter: parent.verticalCenter
                  text: parent.modelData.section + " · " + (parent.modelData.index + 1)
                  color: Color.menu.text
                  opacity: 0.7
                  font.family: Style.font.family
                  font.pixelSize: Style.font.caption
                }

                Dropdown {
                  width: body.width - Style.space(130)
                  showLabel: false
                  options: root.fanOptions()
                  value: parent.modelData.fanEntity
                  onChanged: function(v) { root.assignDevice(parent.modelData, v) }
                }
              }
            }

            PanelSeparator { width: parent.width }
            PanelSectionHeader { width: parent.width; text: "Display"; foreground: Color.menu.text }

            Row {
              spacing: Style.space(10)
              Text {
                anchors.verticalCenter: parent.verticalCenter
                text: "Bar shows"
                color: Color.menu.text
                font.family: Style.font.family
                font.pixelSize: Style.font.body
              }
              ButtonGroup {
                options: ["Fan speed", "PM2.5", "None"]
                value: root.service ? root.service.config.barMetric : "Fan speed"
                foreground: Color.menu.text
                background: Color.menu.background
                onChanged: function(v) { root.applyDisplay({ barMetric: v }) }
              }
            }

            NumberField {
              label: "Air quality graph window (hours)"
              value: root.service ? root.service.config.historyHours : 24
              from: 1; to: 240; stepSize: 1
              onModified: function(v) { root.applyDisplay({ historyHours: v }) }
            }

            NumberField {
              label: "Poll interval when closed (seconds)"
              value: root.service ? root.service.config.pollSeconds : 30
              from: 5; to: 300; stepSize: 5
              onModified: function(v) { root.applyDisplay({ pollSeconds: v }) }
            }

            NumberField {
              label: "Treat as stale after (seconds)"
              value: root.service ? root.service.config.staleSeconds : 300
              from: 60; to: 3600; stepSize: 30
              onModified: function(v) { root.applyDisplay({ staleSeconds: v }) }
            }

            Toggle {
              width: parent.width
              label: "Reconnect automatically when stale"
              description: "Home Assistant keeps serving the last state it saw after losing the device. This presses the integration's reconnect button."
              checked: root.service ? root.service.config.autoReconnect : true
              foreground: Color.menu.text
              onClicked: root.applyDisplay({
                autoReconnect: !(root.service && root.service.config.autoReconnect)
              })
            }

            Text {
              width: parent.width
              text: root.notice
              visible: root.notice !== ""
              color: Color.menu.text
              opacity: 0.7
              wrapMode: Text.WordWrap
              font.family: Style.font.family
              font.pixelSize: Style.font.caption
            }
          }
        }
      }
    }
  }
}
