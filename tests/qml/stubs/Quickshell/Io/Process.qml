import QtQml

// Records what would have been run; the test plays the role of the child.
QtObject {
  property var command: []
  property bool running: false
  property QtObject stdout: null
}
