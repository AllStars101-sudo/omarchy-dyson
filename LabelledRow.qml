import QtQuick
import qs.Commons

// One control on one line: caption on the left, whatever is passed in on the
// right. A PanelSectionHeader above each control reads well but costs a row
// per control, and a bar dropdown has no scroll affordance to spend rows on —
// the panel has to fit.
Item {
  id: root

  property QtObject bar: null
  property string label: ""
  property real gap: Style.space(8)
  property real captionWidth: Style.space(64)

  default property alias content: holder.data

  implicitHeight: Math.max(caption.implicitHeight, holder.implicitHeight)

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

  // A Flow, not an Item: a device with five aim presets or four sweep widths
  // runs past the panel edge otherwise, and the panel cannot widen to suit the
  // longest option list some model happens to have.
  Flow {
    id: holder
    anchors.left: caption.right
    anchors.leftMargin: root.gap
    anchors.right: parent.right
    anchors.verticalCenter: parent.verticalCenter
    spacing: Style.space(4)
  }
}
