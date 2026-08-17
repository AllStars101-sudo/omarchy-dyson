import QtQuick
import qs.Ui
import qs.Commons

// Caption on the left, a wrapping row of chips on the right.
//
// Not Ui/ButtonGroup: that lays its chips out in a single Row, so a model
// offering five sweep presets pushes the last one past the panel edge and the
// panel cannot widen to suit whichever model has the longest option list. The
// chips here are direct children of a Flow, so they wrap to a second line
// instead of falling off.
Item {
  id: root

  property QtObject bar: null
  property string label: ""
  property var options: []
  property string value: ""
  property bool actionable: true
  property real gap: Style.space(8)
  // Tighter than the kit default. Five aim presets plus a caption overshoot the
  // panel by a few pixels at the default padding, and wrapping one chip onto a
  // line of its own looks like a mistake rather than a layout.
  property real chipPadding: Style.space(8)
  property real captionWidth: Style.space(64)

  signal changed(string value)

  implicitHeight: Math.max(caption.implicitHeight, chips.implicitHeight)

  Text {
    id: caption
    anchors.left: parent.left
    anchors.verticalCenter: parent.verticalCenter
    width: Math.min(root.captionWidth, implicitWidth)
    text: root.label
    color: root.bar ? root.bar.foreground : Color.foreground
    opacity: 0.7
    elide: Text.ElideRight
    font.family: root.bar ? root.bar.fontFamily : Style.font.family
    font.pixelSize: Style.font.caption
    font.bold: true
  }

  Flow {
    id: chips
    anchors.left: caption.right
    anchors.leftMargin: root.gap
    anchors.right: parent.right
    anchors.verticalCenter: parent.verticalCenter
    spacing: Style.space(4)

    Repeater {
      model: root.options

      // The Button sits inside a plain Item rather than being the delegate
      // itself. qmllint does not model Repeater's injected `modelData` for a
      // component defined in a .qml file, so a Button delegate reports its own
      // required property as unfilled and fails every use site of ChipsRow.
      // An Item delegate is the shape the linter understands.
      Item {
        required property var modelData
        implicitWidth: chip.implicitWidth
        implicitHeight: chip.implicitHeight

        Button {
          id: chip
          anchors.centerIn: parent
          text: parent.modelData.label
          bordered: true
          horizontalPadding: root.chipPadding
          selected: root.value === parent.modelData.value
          enabled: root.actionable
          opacity: root.actionable ? 1 : 0.4
          foreground: root.bar ? root.bar.foreground : Color.foreground
          background: root.bar ? root.bar.background : Color.background
          fontFamily: root.bar ? root.bar.fontFamily : Style.font.family
          onClicked: root.changed(parent.modelData.value)
        }
      }
    }
  }
}
