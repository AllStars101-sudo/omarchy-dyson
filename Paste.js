// Clipboard text is foreign input: it arrives from whichever client owns the
// selection, with no promise about size or content. These helpers decide what
// part of it a single-line field will take.

// Bytes asked of the clipboard owner, and how long it gets to deliver them.
// A Home Assistant long-lived token is a JWT of a few hundred characters and an
// address is shorter still, so the cap is generous without being open-ended.
var READ_LIMIT_BYTES = 4096
var READ_TIMEOUT_SECONDS = 1.5

// Shell command for a bounded clipboard read. `timeout` ends a provider that
// stalls, and `head -c` stops reading (and closes the pipe on wl-paste) once
// the byte limit is reached, so a provider that streams forever cannot hold
// the caller or grow its memory. Limits travel as positional arguments rather
// than being spliced into the script.
function readCommand() {
  return ["sh", "-c",
          "timeout \"$1\" wl-paste --no-newline --type text 2>/dev/null | head -c \"$2\"",
          "sh", String(READ_TIMEOUT_SECONDS), String(READ_LIMIT_BYTES)]
}

// What a single-line field accepts from pasted text: the first line only, with
// control characters dropped and surrounding whitespace trimmed.
function singleLine(text) {
  var value = String(text === undefined || text === null ? "" : text)
  var newline = value.search(/[\r\n]/)
  if (newline !== -1) value = value.slice(0, newline)
  return value.replace(/[\u0000-\u001f\u007f]/g, "").trim()
}

// The field's text after pasting `pasted` over the selection [start, end),
// never longer than `maxLength`. Returns the new text and where the cursor
// lands. Out-of-range positions are clamped rather than trusted.
function spliced(current, start, end, pasted, maxLength) {
  var text = String(current || "")
  var from = Math.max(0, Math.min(text.length, Math.min(start, end) || 0))
  var to = Math.max(from, Math.min(text.length, Math.max(start, end) || 0))
  var limit = maxLength > 0 ? maxLength : READ_LIMIT_BYTES
  var room = Math.max(0, limit - (text.length - (to - from)))
  var insert = singleLine(pasted).slice(0, room)
  return {
    text: text.slice(0, from) + insert + text.slice(to),
    cursor: from + insert.length
  }
}

// QML imports this file directly and never defines `module`; the guard lets
// node require() the same source so coverage instrumentation can see it.
if (typeof module !== "undefined") module.exports = { READ_LIMIT_BYTES: READ_LIMIT_BYTES, READ_TIMEOUT_SECONDS: READ_TIMEOUT_SECONDS, readCommand: readCommand, singleLine: singleLine, spliced: spliced }
