# Dyson Air for Omarchy

Control Dyson purifiers, fans, heaters and humidifiers from the Omarchy bar,
through Home Assistant.

A fan icon that spins at the real speed, Off/Fan/Heat as one control, a PM2.5
graph, and oscillation/night/auto grouped where you expect them.

> Not affiliated with, sponsored by, or endorsed by Dyson, the Home Assistant
> project, or Omarchy.

## Why not just use a generic Home Assistant plugin

[`konradk/hass`](https://github.com/konradk/hass) already controls any Home
Assistant entity, and controls it well. What a generic entity list cannot give
you is a device-shaped panel. This plugin is meant to sit **alongside** it, not
replace it.

## Requirements

- Omarchy 4 (`schemaVersion: 1` plugin API)
- Home Assistant with the [hass-dyson](https://github.com/cmgrayb/hass-dyson)
  integration (install through HACS, search "Dyson")
- `secret-tool` (libsecret) with a running keyring daemon — Omarchy ships
  gnome-keyring, so this is normally already true

No Python, no vendored libraries, no helper process. The plugin talks to Home
Assistant's REST API directly and shares one poll across every widget on the
bar.

## Install

```bash
omarchy plugin add https://github.com/AllStars101-sudo/omarchy-dyson.git --enable
omarchy bar put io.github.allstars101-sudo.dyson-air
```

Then click the fan icon and enter your Home Assistant address and a long-lived
access token (Profile → Security → Long-lived access tokens → Create token).
The token goes to your system keyring, never to a config file.

The address is whatever you use in a browser — `http://homeassistant.local:8123`,
`http://192.168.1.20:8123`, `https://ha.example.com`, or `http://localhost:8123`
if Home Assistant runs on this machine. **Include the scheme**: an address typed
without one is assumed to be `https`, and a default Home Assistant serves plain
`http` on port 8123.

## Remove

```bash
omarchy bar remove io.github.allstars101-sudo.dyson-air
omarchy plugin remove io.github.allstars101-sudo.dyson-air
secret-tool clear service io.github.allstars101-sudo.dyson-air origin <your-ha-url>
rm -rf ~/.config/omarchy/io.github.allstars101-sudo.dyson-air
```

The `secret-tool clear` line is the one that matters — removing the plugin does
not remove your token from the keyring.

## Controls

| Where | Action |
|-------|--------|
| Bar, left click | Open the panel (or settings, if not yet connected) |
| Bar, middle click | Toggle power |
| Bar, scroll | Speed up / down |
| Panel | Off / Fan / Heat, target temperature, humidity, speed |
| Panel | Oscillation, night mode, auto mode |
| Panel | PM2.5 graph, air quality readings, filter life |

Over IPC, for keybindings:

```bash
omarchy-shell dyson-air toggle     # open/close the panel
omarchy-shell dyson-air power      # toggle power
omarchy-shell dyson-air settings
omarchy-shell dyson-air devices
```

## Several devices

Add the widget once per device and give each one a device in **Settings →
Devices**. Widgets left on *Automatic* follow the first Dyson found, so a
one-device household never has to configure anything.

Assignment lives in Settings rather than on the widget because two widgets of
one plugin share a module name — only their position on the bar tells them
apart, and the settings overlay is the only surface that can see positions.

## How it decides what to show

Nothing is hardcoded per model. `hass-dyson` creates entities conditionally
from each device's capability list, so **entity presence is the capability
map** and the panel renders only what it finds. A cool-only tower shows no heat
control; a Humidify+Cool shows a humidity target; a device with no formaldehyde
sensor shows no formaldehyde reading.

Two matching rules are load-bearing, and both exist because the obvious
approach was wrong:

- **Companion switches match on an exact suffix, never a substring.** A
  substring match resolved "auto mode" to `switch.<device>_firmware_auto_update`,
  so pressing Auto toggled firmware updates.
- **Air quality sensors match on `device_class`, not on name.** Older models
  call PM2.5 `particulates` and newer ones call it `pm25`; the declared class is
  right on both. Formaldehyde is the sole exception — Home Assistant has no
  HCHO device class — so it is the one reading matched by name.

## Staleness

Home Assistant keeps serving the last state it saw after a device's MQTT
session dies. Nothing errors; the data just stops moving. Suspending the
machine Home Assistant runs on does exactly this, and on resume the widget
would otherwise report a fan that was turned off hours ago.

A live Dyson reports continuously, so the newest timestamp across *all* its
entities is used as a heartbeat. (The fan entity alone is no good: its
`last_updated` only moves when the fan changes, so an untouched fan is
indistinguishable from a dead session.) After `staleSeconds` the bar icon dims
and drops its number rather than showing a stale one, and — if enabled — the
integration's reconnect button is pressed, at most once every two minutes.

## Model support

Verified against real hardware:

| Model | Type | Status |
|---|---|---|
| Pure Hot+Cool Link (HP02) | 455 | Tested |

Everything else is **inferred** from the hass-dyson entity contract and tested
against fixtures built from it, not against a physical device. That covers
TP/DP cool models, HP heaters, PH humidifiers and BP Big+Quiet — but "should
work" is the honest claim, not "supported". If your device misbehaves, please
open an issue with the output of:

```bash
curl -s -H "Authorization: Bearer $TOKEN" "$HA_URL/api/states" \
  | jq '[.[] | select(.entity_id|test("dyson"))]'
```

Air treatment only. Dyson robot vacuums and lights are out of scope.

## Development

```bash
npm test          # 123 tests
npm run coverage  # tests + the 100% gate
npm run lint      # QML parse, manifest, entry points
npm run check     # all three, as CI runs them
```

There are no dependencies; `package.json` exists only for the scripts.

### What is and is not covered

The logic and view layers are held at **100% line, branch and function
coverage**, enforced per file by `scripts/check-coverage.js`:

| File | What it holds |
|---|---|
| `Dyson.js` | Entity discovery, capability mapping, speed, air quality, model names, history, liveness, reconnect policy |
| `View.js` | Every view decision — bar label, status text, which rows exist, reading list, control options, error messages |
| `Config.js` | Config parsing, clamping, serialization |
| `Origin.js` | URL normalisation, the identity the keyring scopes tokens by |

The QML is **not** covered, and the coverage number does not claim otherwise.
`Panel.qml`, `Settings.qml`, `Service.qml` and `CredentialManager.qml` hold
polling, HTTP, the keyring, IPC and rendering — none of which can run outside a
live Omarchy shell. They are checked structurally by `scripts/check-qml.sh`
(parse, entry points, schema/default agreement) and verified by hand against
real hardware. View *logic* was deliberately moved out of `Panel.qml` into
`View.js` precisely so it could be tested; what remains in QML is layout and
plumbing.

### Fixtures

`tests/fixtures/hp02-455.json` is a real `/api/states` dump from a Dyson Pure
Hot+Cool Link. `tests/fixtures/synthetic.js` holds hand-built dumps for models
not available here, written from hass-dyson's entity definitions — they
constrain the code, but they are not evidence that a real TP09 or PH01 behaves
this way.

After editing, restart the shell rather than trusting hot reload:

```bash
omarchy restart shell
```

## Licence

MIT. Portions derived from `konradk/hass` — see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
