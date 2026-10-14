import QtQuick
import QtTest
import "../.." as Plugin

// Drives the real BoundedTextField with key events, wired the way Settings.qml
// wires it: `text:` bound to a draft and the draft written back on change.
Item {
  id: root
  width: 400
  height: 100

  property string draft: ""

  Plugin.BoundedTextField {
    id: field
    width: 300
    text: root.draft
    onTextChanged: root.draft = text
  }

  TestCase {
    name: "BoundedTextField"
    when: windowShown


    function findProcess() {
      for (var i = 0; i < field.data.length; i++)
        if (field.data[i] && field.data[i].hasOwnProperty("command")) return field.data[i]
      return null
    }

    function init() {
      root.draft = ""
      field.enabled = true
      field.forceActiveFocus()
      var p = findProcess()
      p.running = false
      p.command = []
    }

    function test_qt_never_sees_an_editable_input() {
      compare(field.readOnly, true)
      // Qt answers canPaste without reading the clipboard only when read-only.
      compare(field.canPaste, false)
      compare(field.maximumLength, 4096)
    }

    function test_typing_backspace_and_delete() {
      keyClick("a"); keyClick("b"); keyClick("c")
      compare(field.text, "abc")
      compare(root.draft, "abc")
      keyClick(Qt.Key_Backspace)
      compare(field.text, "ab")
      keyClick(Qt.Key_Home)
      keyClick(Qt.Key_Delete)
      compare(field.text, "b")
      compare(field.cursorPosition, 0)
    }

    function test_spaces_and_shifted_characters() {
      keyClick("a"); keyClick(Qt.Key_Space); keyClick(Qt.Key_Colon, Qt.ShiftModifier)
      compare(field.text, "a :")
    }

    function test_caller_binding_survives_editing() {
      keyClick("x")
      compare(root.draft, "x")
      root.draft = "reset"
      compare(field.text, "reset")
      keyClick(Qt.Key_End)
      keyClick("!")
      compare(root.draft, "reset!")
    }

    function test_typing_replaces_a_selection() {
      root.draft = "hello"
      field.select(1, 4)
      keyClick("Z")
      compare(field.text, "hZo")
      compare(field.cursorPosition, 2)
    }

    function test_ctrl_backspace_removes_a_word() {
      root.draft = "http://homeassistant.local"
      field.cursorPosition = field.text.length
      keyClick(Qt.Key_Backspace, Qt.ControlModifier)
      compare(field.text, "http://homeassistant.")
    }

    function test_paste_goes_through_the_bounded_read() {
      root.draft = "http://"
      field.cursorPosition = 7
      keyClick(Qt.Key_V, Qt.ControlModifier)
      var p = findProcess()
      verify(p.running)
      compare(p.command[0], "sh")
      verify(p.command[2].indexOf("head -c") !== -1)
      // The child delivers its (already capped) output.
      p.stdout.text = "ha.local:8123\nsecond line"
      p.stdout.streamFinished()
      compare(field.text, "http://ha.local:8123")
      compare(root.draft, "http://ha.local:8123")
      compare(field.cursorPosition, 20)
    }

    function test_shift_insert_and_middle_click_paste_bounded() {
      keyClick(Qt.Key_Insert, Qt.ShiftModifier)
      verify(findProcess().running)
      findProcess().running = false
      mouseClick(field, 10, field.height / 2, Qt.MiddleButton)
      verify(findProcess().running)
    }

    function test_cut_removes_the_selection() {
      root.draft = "abcdef"
      field.select(2, 4)
      keyClick(Qt.Key_X, Qt.ControlModifier)
      compare(field.text, "abef")
    }

    function test_a_disabled_field_takes_no_edits() {
      root.draft = "keep"
      field.enabled = false
      keyClick("x")
      keyClick(Qt.Key_Backspace)
      keyClick(Qt.Key_V, Qt.ControlModifier)
      compare(field.text, "keep")
      compare(findProcess().running, false)
    }
  }
}
