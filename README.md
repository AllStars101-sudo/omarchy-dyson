# Dyson Air for Omarchy

Control Dyson purifiers, fans, heaters and humidifiers from the Omarchy bar,
through Home Assistant.

<p align="center">
  <img src="preview.png" alt="The Dyson Air panel showing mode, speed, oscillation, night mode, auto mode, a PM2.5 graph and air quality readings" width="420">
</p>

A fan icon that spins at the real speed, Off/Fan/Heat as one control, a PM2.5
graph, and oscillation, night mode and auto grouped where you expect them.

> Not affiliated with, sponsored by, or endorsed by Dyson, the Home Assistant
> project, or Omarchy.

## Why not just use a generic Home Assistant plugin

[`konradk/hass`](https://github.com/konradk/hass) already controls any Home
Assistant entity, and controls it well. What a generic entity list cannot give
you is a device-shaped panel. This plugin is meant to sit alongside it rather
than replace it.

## Requirements

- Omarchy 4 (`schemaVersion: 1` plugin API)
- Home Assistant with the [hass-dyson](https://github.com/cmgrayb/hass-dyson)
  integration (install through HACS, search "Dyson")
- `secret-tool` (libsecret) with a running keyring daemon. Omarchy ships
  gnome-keyring, so this is normally already true.

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

The address is whatever you use in a browser: `http://homeassistant.local:8123`,
`http://192.168.1.20:8123`, `https://ha.example.com`, or `http://localhost:8123`
if Home Assistant runs on this machine. Include the scheme. An address typed
without one is assumed to be `https`, and a default Home Assistant serves plain
`http` on port 8123.

## Remove

```bash
omarchy bar remove io.github.allstars101-sudo.dyson-air
omarchy plugin remove io.github.allstars101-sudo.dyson-air
secret-tool clear service io.github.allstars101-sudo.dyson-air origin <your-ha-url>
rm -rf ~/.config/omarchy/io.github.allstars101-sudo.dyson-air
```

The `secret-tool clear` line is the one that matters. Removing the plugin does
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

Add the widget once per device and give each one a device in Settings →
Devices. Widgets left on *Automatic* follow the first Dyson found, so a
one-device household never has to configure anything.

Assignment lives in Settings rather than on the widget itself. Two widgets of
one plugin share a module name, so only their position on the bar tells them
apart, and the settings overlay is the only surface that can see positions.

## How it decides what to show

Nothing is hardcoded per model. `hass-dyson` creates entities conditionally from
each device's capability list, so entity presence is itself the capability map,
and the panel renders only what it finds. A cool-only tower shows no heat
control. A Humidify+Cool shows a humidity target. A device with no formaldehyde
sensor shows no formaldehyde reading.

Two matching rules carry a lot of weight, and both exist because the obvious
approach was wrong.

Companion switches match on an exact suffix, never a substring. A substring
match resolved "auto mode" to `switch.<device>_firmware_auto_update`, so
pressing Auto toggled firmware updates.

Air quality sensors match on `device_class` rather than on name. Older models
call PM2.5 `particulates` and newer ones call it `pm25`, and the declared class
is right on both. Formaldehyde is the sole exception, because Home Assistant has
no HCHO device class, so it is the one reading matched by name.

## Staleness

Home Assistant keeps serving the last state it saw after a device's MQTT session
dies. Nothing errors. The data just stops moving. Suspending the machine Home
Assistant runs on does exactly this, and on resume the widget would otherwise
report a fan that was turned off hours ago.

A live Dyson reports continuously, so the newest timestamp across all of its
entities is used as a heartbeat. The fan entity alone is no good: its
`last_updated` only moves when the fan changes, so an untouched fan is
indistinguishable from a dead session. After `staleSeconds` the bar icon dims
and drops its number rather than showing a stale one, and if you have left auto
reconnect on, the integration's reconnect button is pressed at most once every
two minutes.

## Model support

### Verified against real hardware

| Model | Type | What was exercised |
|---|---|---|
| Pure Hot+Cool Link (HP02) | 455 | Everything: heat, speed, oscillation, night mode, air quality, graph, staleness, settings |

### Untested, should work

Each of these has a mock device in `tests/fixtures/synthetic.js` built from
hass-dyson's entity definitions, so the plugin is asserted to render the right
controls for it. No physical unit has ever been connected.

| Model | Type | What the mock covers |
|---|---|---|
| Purifier Cool Formaldehyde (TP09) | 438E | Cool-only, auto as a *switch*, formaldehyde, PM10/NO₂, oscillation angle, both filters |
| Purifier Hot+Cool (HP07) | 527K | Heat via a climate entity, heating-mode select |
| Pure Humidify+Cool (PH01) | 358 | Humidifier entity, humidity target, water hardness, no heat |
| Purifier Big+Quiet (BP) | 664 | A non-ten-speed dial (12.5% steps, so 8 speeds) |
| A minimal Link-era device | n/a | Near-empty: every optional control must stay hidden rather than render dead |

### Recognised but not modelled

These product codes resolve to a proper name, and capability discovery should
handle them the same way, but no fixture represents them: 358E, 358K, 438, 438K,
469, 475, 520, 527, 527E.

Anything missing from the tables entirely still works. An unknown code shows as
`Dyson <code>` instead of a product name, and every control is discovered from
the entities Home Assistant exposes rather than from the model.

Since none of the above is hardware-verified, "should work" is the honest claim,
not "supported". If your device misbehaves, please open an issue with:

```bash
curl -s -H "Authorization: Bearer $TOKEN" "$HA_URL/api/states" \
  | jq '[.[] | select(.entity_id|test("dyson"))]'
```

That dump is enough to add your device as a fixture and fix it blind, which is
how every model above got its coverage.

Air treatment only. Dyson robot vacuums and lights are out of scope.

## Contributing

Contributions are welcome, and a states dump from a model nobody here owns is
the most useful one of all. See just above for the command. Everything else:

- `npm run check` runs what CI runs: tests, the per-file 100% coverage gate, and
  the manifest, symbol and QML checks. It should pass before you open a pull
  request.
- Logic goes in `Dyson.js`, `View.js`, `Config.js` or `Origin.js` rather than in
  the QML. That is not a style preference. Those four are the only files that can
  be tested outside a running Omarchy shell, and the coverage gate refuses to let
  them slip below 100%, so anything left in QML is effectively unverifiable.
- New device support means a fixture, not a special case. If a model needs a
  branch on its product code, that is usually a sign the capability should be
  discovered from an entity instead.
- Write tests that would fail against a wrong implementation. This suite once
  asserted that `auto_mode` does not match `firmware_auto_update`, which is true
  under every possible matching strategy and therefore could never fail.
  Fixtures like `nearMiss` and `prefixSiblings` exist to stress the matchers
  rather than agree with them.
- Run `npm run lint:strict` if you have Omarchy. It catches QML problems CI
  cannot see, since a CI runner has no Quickshell to resolve types against.

Bug reports are easiest to act on when they include what you expected, what
happened, and the tooltip text from the bar icon. The tooltip names which of the
several possible failures occurred.

## Development

```bash
npm test          # 123 tests
npm run coverage  # tests + the 100% gate
npm run lint        # manifest, cross-file symbols, QML syntax
npm run lint:strict # the above plus full qmllint semantics (needs Omarchy)
npm run check     # all three, as CI runs them
```

There are no dependencies. `package.json` exists only for the scripts.

### What is and is not covered

The logic and view layers are held at 100% line, branch and function coverage,
enforced per file by `scripts/check-coverage.js`:

| File | What it holds |
|---|---|
| `Dyson.js` | Entity discovery, capability mapping, speed, air quality, model names, history, liveness, reconnect policy |
| `View.js` | Every view decision: bar label, status text, which rows exist, reading list, control options, error messages |
| `Config.js` | Config parsing, clamping, serialization |
| `Origin.js` | URL normalisation, the identity the keyring scopes tokens by |

The QML is not covered, and the coverage number does not claim otherwise.
`Panel.qml`, `Settings.qml`, `Service.qml` and `CredentialManager.qml` hold
polling, HTTP, the keyring, IPC and rendering, none of which can run outside a
live Omarchy shell. What they get instead is `scripts/check-qml.sh`: the
manifest and its entry points, cross-file symbol references, and QML syntax. The
symbol check exists because nothing else can see a QML file calling a JS
function that no longer exists. `--strict` adds full qmllint semantics but needs
the Omarchy shell present to resolve `qs.Ui`, so CI runs syntax mode and the
strict pass is a local step. Beyond that, the QML is verified by hand against
real hardware.

View logic lives in `View.js` rather than in `Panel.qml` so that the states a
screenshot would show can be asserted without a compositor. What remains in QML
is layout and plumbing.

### Fixtures

`tests/fixtures/hp02-455.json` is a real `/api/states` dump from a Dyson Pure
Hot+Cool Link. `tests/fixtures/synthetic.js` holds hand-built dumps for models
not available here, written from hass-dyson's entity definitions. They constrain
the code, but they are not evidence that a real TP09 or PH01 behaves this way.

Several fixtures exist to stress the matchers rather than satisfy them.
`nearMiss` carries names that extend a wanted suffix, such as
`_night_mode_schedule`. `prefixSiblings` holds two devices whose slugs overlap.
`unavailable` holds the non-numeric states a reconnecting device emits, and
`bigQuiet` uses a non-ten-speed dial. Without those, a substring matcher passes
every test.

After editing, restart the shell rather than trusting hot reload:

```bash
omarchy restart shell
```

## Licence

MIT. Portions derived from `konradk/hass`. See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
