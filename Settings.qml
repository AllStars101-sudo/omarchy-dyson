import QtQuick
import QtQuick.Controls
import Quickshell
import Quickshell.Wayland
import qs.Ui
import qs.Commons
import "Dyson.js" as Dyson
import "Origin.js" as Origin
import "View.js" as View

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
    var next = View.settingsTab(payloadJson)
    if (!next) {
      // Not a settings request. Omarchy's bar hotkey and `omarchy-shell shell
      // toggle <id>` route here rather than to the bar widget, because
      // declaring an overlay kind opts this plugin out of the bar-widget summon
      // path. Hand it back to the panel the user actually asked for.
      root.showPanelInstead()
      return
    }
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

  function showPanelInstead() {
    var bar = shell && shell.bar ? shell.bar : null
    if (bar && typeof bar.isBarWidgetOpen === "function"
        && typeof bar.summonBarWidget === "function"
        && typeof bar.hideBarWidget === "function") {
      // Toggle, so the hotkey keeps closing what it opened.
      if (bar.isBarWidgetOpen(root.pluginId)) bar.hideBarWidget(root.pluginId)
      else bar.summonBarWidget(root.pluginId)
    }
    root.opened = false
    if (shell && typeof shell.hide === "function") shell.hide(root.pluginId)
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
  readonly property var placements: shell && shell.barConfig
    ? View.placements(shell.barConfig.layout, root.pluginId) : []

  readonly property var fans: service && service.entityStates.length
    ? Dyson.listFans(service.entityStates) : []

  function fanOptions() { return View.deviceOptions(root.fans, true) }

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
              placeholderText: "http://homeassistant.local:8123"
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
              // Worth saying: an address typed without a scheme is assumed to
              // be https, and a default Home Assistant serves plain http on
              // 8123 — so the http:// matters more often than people expect.
              text: "Include http:// or https://. An address with neither is assumed to be https."
              color: Color.menu.text
              opacity: 0.6
              wrapMode: Text.WordWrap
              font.family: Style.font.family
              font.pixelSize: Style.font.caption
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
              readonly property var status: View.connectionStatus({
                notice: root.notice,
                hasService: !!root.service,
                lastError: root.service ? root.service.lastError : "",
                ready: !!root.service && root.service.ready,
                configured: root.configured,
                fanCount: root.fans.length
              })
              text: status.text
              color: status.error ? Color.urgent : Color.menu.text
              opacity: status.error ? 1 : 0.7
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

                // Only there to tell two of this plugin's widgets apart, so a
                // single widget gets the dropdown and no label.
                Text {
                  width: Style.space(120)
                  visible: root.placements.length > 1
                  anchors.verticalCenter: parent.verticalCenter
                  text: parent.modelData.label
                  color: Color.menu.text
                  opacity: 0.7
                  font.family: Style.font.family
                  font.pixelSize: Style.font.caption
                }

                Dropdown {
                  width: root.placements.length > 1
                    ? body.width - Style.space(130) : body.width
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
