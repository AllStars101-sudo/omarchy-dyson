import QtQuick
import QtQuick.Controls as Controls

// Stand-in for Omarchy's qs.Ui TextField, which is a styled Controls TextField.
Controls.TextField {
  property color foreground
  property bool password: false
  echoMode: password ? 2 : 0
}
