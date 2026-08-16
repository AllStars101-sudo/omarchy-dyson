// Pure URL identity helpers. The keyring scopes every token by origin, so this
// has to agree exactly with itself across sessions: a URL that normalizes two
// different ways would store a token the next lookup cannot find.
//
// normalizeOrigin and preparedUrl are adapted from konradk/hass Connection.js
// (MIT, Copyright (c) 2026 Konrad Kruk) — see THIRD_PARTY_NOTICES.md. The
// websocket schemes are kept: a user pasting the ws:// URL from some other
// Home Assistant guide should land on the same origin as the http:// one
// rather than being told their address is invalid.

function preparedUrl(value) {
  var text = String(value || "").trim()
  if (!text) return ""
  if (text.indexOf("://") === -1) text = "https://" + text.replace(/^\/+/, "")
  return text
}

function normalizeOrigin(value) {
  var text = preparedUrl(value)
  if (!text || /\s/.test(text)) return ""

  var schemeEnd = text.indexOf("://")
  if (schemeEnd <= 0) return ""
  var inputScheme = text.slice(0, schemeEnd).toLowerCase()
  var secure = inputScheme === "https" || inputScheme === "wss"
  var plain = inputScheme === "http" || inputScheme === "ws"
  if (!secure && !plain) return ""

  var rest = text.slice(schemeEnd + 3)
  var boundary = rest.search(/[\/?#]/)
  var authority = boundary === -1 ? rest : rest.slice(0, boundary)
  if (!authority || authority.indexOf("@") !== -1) return ""

  // Host syntax is validated per form rather than by one permissive character
  // class. A class that allowed brackets anywhere accepted half-pasted URLs
  // like "https://ha.local:8123]" as ordinary hostnames, producing a
  // plausible-looking origin that no server would answer.
  var host = ""
  var portText = ""
  if (authority.charAt(0) === "[") {
    var close = authority.indexOf("]")
    if (close <= 1) return ""
    host = authority.slice(0, close + 1).toLowerCase()
    // Inside the brackets: IPv6, optionally with a trailing IPv4 tail. The
    // colon is required — "[8123]" is a mis-pasted port, not an address.
    if (!/^\[[0-9a-f:.]+\]$/.test(host) || host.indexOf(":") === -1) return ""
    var suffix = authority.slice(close + 1)
    if (suffix) {
      if (suffix.charAt(0) !== ":") return ""
      portText = suffix.slice(1)
      if (!portText) return ""
    }
  } else {
    if (authority.indexOf(":") !== authority.lastIndexOf(":")) return ""
    var colon = authority.lastIndexOf(":")
    host = (colon === -1 ? authority : authority.slice(0, colon)).toLowerCase()
    portText = colon === -1 ? "" : authority.slice(colon + 1)
    if (colon !== -1 && !portText) return ""
    if (!/^[a-z0-9._\-]+$/.test(host)) return ""
  }

  if (!host) return ""
  var port = portText ? Number(portText) : (secure ? 443 : 80)
  if (!/^\d*$/.test(portText) || !Number.isInteger(port) || port < 1 || port > 65535) {
    return ""
  }

  return (secure ? "https" : "http") + "://" + host + ":" + port
}

// Whether a plaintext origin leaves this machine. A long-lived token is a
// permanent key to someone's house, so http:// to another host deserves a
// warning — but warning about http://localhost would be noise, and localhost is
// where most people run Home Assistant.
function isPlaintextRemote(origin) {
  var text = String(origin || "")
  if (text.indexOf("http://") !== 0) return false
  var host = text.slice(7).split(":")[0]
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return false
  if (/^127\./.test(host)) return false
  return true
}
