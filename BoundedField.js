// Editing for BoundedTextField, as pure functions over the field's text and
// selection. The field is read-only to Qt (see BoundedTextField.qml), so every
// change a user makes is planned here and applied with TextInput's own
// remove()/insert(), which keep a caller's `text:` binding intact.
//
// An edit is { from, to, insert, cursor }: remove [from, to), insert `insert`
// at `from`, then put the cursor at `cursor`.

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

function stripControl(value) {
  return value.replace(/[\u0000-\u001f\u007f]/g, "")
}

// What a single-line field accepts from pasted text: the first line only, with
// control characters dropped and surrounding whitespace trimmed.
function singleLine(text) {
  var value = String(text === undefined || text === null ? "" : text)
  var newline = value.search(/[\r\n]/)
  if (newline !== -1) value = value.slice(0, newline)
  return stripControl(value).trim()
}

// The selection as an ordered, in-range pair.
function bounds(current, start, end) {
  var length = String(current || "").length
  var a = Math.max(0, Math.min(length, Math.min(start, end) || 0))
  var b = Math.max(a, Math.min(length, Math.max(start, end) || 0))
  return { from: a, to: b }
}

// Replace the selection with `text`, never growing past `maxLength`.
function replacement(current, start, end, text, maxLength) {
  var value = String(current || "")
  var sel = bounds(value, start, end)
  var limit = maxLength > 0 ? maxLength : READ_LIMIT_BYTES
  var room = Math.max(0, limit - (value.length - (sel.to - sel.from)))
  var insert = text.slice(0, room)
  return { from: sel.from, to: sel.to, insert: insert, cursor: sel.from + insert.length }
}

// Pasting `pasted` over the selection.
function pasted(current, start, end, text, maxLength) {
  return replacement(current, start, end, singleLine(text), maxLength)
}

// Typing `text` (a key event's text) over the selection. Unlike a paste,
// spaces are kept: they are what the user pressed.
function typed(current, start, end, text, maxLength) {
  var value = String(text === undefined || text === null ? "" : text)
  return replacement(current, start, end, stripControl(value), maxLength)
}

function isSeparator(ch) {
  return /[\s\/:.?&=#@_-]/.test(ch)
}

// Backspace or Delete. With a selection, that is what goes; otherwise one
// character, or with `word` the run back (or forward) to the previous word
// boundary. Returns null when there is nothing to remove.
function erasure(current, start, end, backward, word) {
  var value = String(current || "")
  var sel = bounds(value, start, end)
  if (sel.to > sel.from) return { from: sel.from, to: sel.to, insert: "", cursor: sel.from }

  var at = sel.from
  if (backward) {
    if (at === 0) return null
    var from = at - 1
    if (word) {
      while (from > 0 && isSeparator(value.charAt(from))) from--
      while (from > 0 && !isSeparator(value.charAt(from - 1))) from--
    }
    return { from: from, to: at, insert: "", cursor: from }
  }

  if (at === value.length) return null
  var to = at + 1
  if (word) {
    while (to < value.length && isSeparator(value.charAt(to))) to++
    while (to < value.length && !isSeparator(value.charAt(to))) to++
  }
  return { from: at, to: to, insert: "", cursor: at }
}

// QML imports this file directly and never defines `module`; the guard lets
// node require() the same source so coverage instrumentation can see it.
if (typeof module !== "undefined") module.exports = { READ_LIMIT_BYTES: READ_LIMIT_BYTES, READ_TIMEOUT_SECONDS: READ_TIMEOUT_SECONDS, readCommand: readCommand, singleLine: singleLine, pasted: pasted, typed: typed, erasure: erasure }
