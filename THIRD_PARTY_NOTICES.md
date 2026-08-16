# Third-party notices

## konradk/hass — Home Assistant for Omarchy

<https://github.com/konradk/hass>

Parts of this plugin are derived from `konradk/hass`, used under the MIT
licence. Specifically:

- **`CredentialManager.qml`** is adapted from its file of the same name. The
  secret-tool attribute namespace and label are changed to this plugin's, and
  the legacy unscoped-token migration probe is removed as it is specific to
  upgrading older `hass` installs.
- **`Origin.js`** adapts `preparedUrl` and `normalizeOrigin` from its
  `Connection.js`.
- **`Settings.qml`** follows the window structure of its settings overlay
  (layer-shell window, scrim, centred card, key catcher, tabbed body). The
  content and behaviour are this plugin's own.
- **`Config.js`** follows the parse/merge/serialize shape of its
  `ConfigStore.js`. The schema is this plugin's own.

```
MIT License

Copyright (c) 2026 Konrad Kruk

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Dyson product type codes

The model-name table in `Dyson.js` maps Dyson's numeric product types to
product names. The codes are those published by the
[libdyson-wg](https://github.com/libdyson-wg) project. No code is reused.

Not affiliated with, sponsored by, or endorsed by Dyson, the Home Assistant
project, or Omarchy.
