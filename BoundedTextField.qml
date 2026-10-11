import QtQuick
import Quickshell.Io
import qs.Ui
import "Paste.js" as Paste

// A text field whose paste goes through a bounded clipboard read.
//
// Qt's own paste reads the whole selection from whichever client owns the
// clipboard before the field's length limit applies, with no byte limit and no
// deadline. A provider that streams without end can therefore stall the shell
// and grow its memory. Every route to that native read is closed here (paste
// shortcuts, middle-click primary paste, the context menu) and paste is done
// instead by a short-lived child process that is capped in bytes and in time.
TextField {
  id: root

  maximumLength: Paste.READ_LIMIT_BYTES

  function pasteBounded() {
    if (readOnly || !enabled || clipboardRead.running) return
    clipboardRead.command = Paste.readCommand()
    clipboardRead.running = true
  }

  function isPasteKey(event) {
    if (event.matches(StandardKey.Paste)) return true
    var ctrl = (event.modifiers & Qt.ControlModifier) !== 0
    var shift = (event.modifiers & Qt.ShiftModifier) !== 0
    if (event.key === Qt.Key_V && ctrl) return true
    return event.key === Qt.Key_Insert && shift
  }

  // Runs before the field's own key handling, so the native paste never starts.
  Keys.onPressed: function(event) {
    if (isPasteKey(event)) {
      event.accepted = true
      root.pasteBounded()
    } else if (event.key === Qt.Key_Menu
               || (event.key === Qt.Key_F10 && (event.modifiers & Qt.ShiftModifier))) {
      // The keyboard route to the context menu, which offers a native Paste.
      event.accepted = true
    }
  }

  // Middle-click pastes the primary selection and right-click opens the
  // context menu; both would reach the native read. Left clicks pass through.
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
        var next = Paste.spliced(root.text, root.selectionStart, root.selectionEnd,
                                 text, root.maximumLength)
        if (next.text === root.text) return
        root.text = next.text
        root.cursorPosition = next.cursor
      }
    }
  }
}
