import QtQuick
import Quickshell.Io
import qs.Ui
import "BoundedField.js" as Field

// A text field that never lets Qt read the clipboard.
//
// An editable Qt text input reads the whole clipboard on its own: on every
// clipboard change (q_canPasteChanged) and whenever canPaste is asked, it calls
// mimeData()->text(), and paste does the same. That read takes everything the
// owning Wayland client sends, with no byte limit and no deadline, so a
// provider that streams without end could stall the shell and grow its memory.
// Every one of those reads is skipped while the input is read-only.
//
// So the input stays read-only to Qt, and editing happens here instead: typed
// text, Backspace/Delete and cut are applied with remove()/insert(), which keep
// a caller's `text:` binding intact, and paste goes through a short-lived child
// process capped in bytes and in time. Qt still handles focus, the caret
// position, selection by mouse and keyboard, copy, and Enter.
TextField {
  id: root

  readOnly: true
  cursorVisible: activeFocus && enabled
  maximumLength: Field.READ_LIMIT_BYTES

  readonly property bool editable: enabled

  function applyEdit(edit) {
    if (!edit) return
    if (edit.to > edit.from) remove(edit.from, edit.to)
    if (edit.insert !== "") insert(edit.from, edit.insert)
    select(edit.cursor, edit.cursor)
  }

  function pasteBounded() {
    if (!editable || clipboardRead.running) return
    clipboardRead.command = Field.readCommand()
    clipboardRead.running = true
  }

  function cut() {
    if (!editable || selectionStart === selectionEnd) return
    // copy() refuses on a password field, so a hidden token never leaves it.
    if (echoMode === TextInput.Normal) copy()
    applyEdit(Field.erasure(text, selectionStart, selectionEnd, true, false))
  }

  function isPasteKey(event) {
    if (event.matches(StandardKey.Paste)) return true
    var ctrl = (event.modifiers & Qt.ControlModifier) !== 0
    var shift = (event.modifiers & Qt.ShiftModifier) !== 0
    if (event.key === Qt.Key_V && ctrl) return true
    return event.key === Qt.Key_Insert && shift
  }

  // Runs before the input's own key handling. Anything not handled here
  // (arrows, Home/End, selection, copy, Enter) falls through to Qt, which
  // allows those on a read-only input.
  Keys.onPressed: function(event) {
    var ctrl = (event.modifiers & Qt.ControlModifier) !== 0
    if (isPasteKey(event)) {
      event.accepted = true
      root.pasteBounded()
    } else if (event.matches(StandardKey.Cut)) {
      event.accepted = true
      root.cut()
    } else if (event.key === Qt.Key_Backspace || event.key === Qt.Key_Delete) {
      event.accepted = true
      if (root.editable)
        root.applyEdit(Field.erasure(root.text, root.selectionStart, root.selectionEnd,
                                     event.key === Qt.Key_Backspace, ctrl))
    } else if (event.key === Qt.Key_Menu
               || (event.key === Qt.Key_F10 && (event.modifiers & Qt.ShiftModifier))) {
      // The keyboard route to the context menu.
      event.accepted = true
    } else if (!ctrl && (event.modifiers & Qt.AltModifier) === 0
               && event.text !== "" && event.text.charCodeAt(0) >= 0x20
               && event.text.charCodeAt(0) !== 0x7f) {
      event.accepted = true
      if (root.editable)
        root.applyEdit(Field.typed(root.text, root.selectionStart, root.selectionEnd,
                                   event.text, root.maximumLength))
    }
  }

  // Middle-click pastes the primary selection and right-click opens the
  // context menu; both are handled here. Left clicks pass through.
  MouseArea {
    anchors.fill: parent
    acceptedButtons: Qt.MiddleButton | Qt.RightButton
    cursorShape: Qt.IBeamCursor
    onPressed: function(mouse) {
      mouse.accepted = true
      root.forceActiveFocus()
      if (mouse.button === Qt.MiddleButton) root.pasteBounded()
    }
  }

  Process {
    id: clipboardRead
    command: []
    stdout: StdioCollector {
      onStreamFinished: {
        root.applyEdit(Field.pasted(root.text, root.selectionStart, root.selectionEnd,
                                    text, root.maximumLength))
      }
    }
  }
}
