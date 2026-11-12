import QtQuick
import QtQuick.Controls
import Quickshell
import Quickshell.Io
import qs.Ui
import qs.Commons
import "Model.js" as Model
import "Panel.mjs" as View
import ".generated" as Zen

// PAIN bar widget. The shell owns IPC, processes, and keyboard focus; Panel.mjs
// owns the same full panel tree rendered by Zen on both Omarchy and macOS.
Panel {
  id: root
  moduleName: "local.pain"
  ipcTarget: "local.pain"
  manageIpc: false

  property var status: ({})
  property string selectedBackend: ""
  property string cursor: ""
  property string removeId: ""
  property real liveSpeed: 0
  property int prevDecoded: 0
  property real prevSampleMs: 0
  property string prevModel: ""
  property string busyAction: ""
  property string busyModel: ""
  property string controlLine: ""
  property string controlError: ""
  readonly property bool busy: busyAction !== ""
  readonly property bool online: status.online === true
  readonly property bool generating: online && (status.inference || {}).processing === true
  readonly property var backends: status.backends || ["rocm", "vulkan", "llamacpp-vulkan", "llamacpp-cpu"]
  readonly property string bridge: decodeURIComponent(Qt.resolvedUrl("bridge.py").toString().replace(/^file:\/\//, ""))
  readonly property var panelTree: View.view(Object.assign({}, status, {
    backends: backends, speed: liveSpeed, busy: busyAction,
    fetching: busyAction === "fetch" ? busyModel : "",
    controlLine: controlLine, error: controlError || status.error || ""
  }), { platform: "omarchy", selectedBackend: selectedBackend, cursor: cursor, removeId: removeId })
  readonly property var controls: View.controlRows(panelTree)

  function refresh() { if (!poll.running) poll.running = true }

  function launch(action) {
    Quickshell.execDetached(["omarchy", "launch", "terminal", "python3", bridge, action])
  }

  function modelFor(id) {
    return (status.models || []).find(function(model) { return model.id === id })
  }

  function dispatch(action, payload) {
    if (action === "backend") { if (!busy) selectedBackend = payload; return }
    if (action === "refresh") { refresh(); return }
    if (action === "cancel-remove") { removeId = ""; cursor = "request-remove:" + payload; return }
    if (action === "request-remove") {
      var model = modelFor(payload)
      if (busy || !model || Model.removalReason(model, status)) return
      removeId = payload
      cursor = "cancel-remove:" + payload
      return
    }
    if (action === "confirm-remove") {
      var model = modelFor(payload)
      if (busy || removeId !== payload || !model || Model.removalReason(model, status)) return
      removeId = ""
      runAction("remove", payload)
      return
    }
    runAction(action, payload)
  }

  function runAction(key, value) {
    if (key === "top" || key === "logs") { launch(key); return }
    if (busy) return
    if (["up", "down", "fetch", "use", "remove"].indexOf(key) < 0) return
    if (key === "up" && backends.indexOf(selectedBackend) < 0) return
    if (key === "down" && !online) return
    controlError = ""
    controlLine = ""
    busyAction = key
    busyModel = value || ""
    var args = ["python3", bridge, key === "fetch" ? "pull" : key]
    if (key === "up") args.push(selectedBackend)
    else if (value) args.push(value)
    control.command = args
    control.running = true
  }

  function controlOutput(data) {
    var line = String(data).trim()
    if (line.length) controlLine = line
  }

  function cursorPosition() {
    for (var row = 0; row < controls.length; row++)
      for (var col = 0; col < controls[row].length; col++)
        if (controls[row][col].focusKey === cursor) return {row: row, col: col}
    return {row: -1, col: -1}
  }

  function moveCursor(dx, dy) {
    if (!controls.length) return
    var position = cursorPosition()
    if (position.row < 0) {
      cursor = controls[0][0].focusKey
      Qt.callLater(ensureCursorVisible)
      return
    }
    var row = Math.max(0, Math.min(controls.length - 1, position.row + dy))
    var col = Math.max(0, Math.min(controls[row].length - 1, position.col + dx))
    cursor = controls[row][col].focusKey
    Qt.callLater(ensureCursorVisible)
  }

  function ensureCursorVisible() {
    if (!cursor || !controls.length) return
    var position = cursorPosition()
    if (position.row < 0) return
    var item = controls[position.row][position.col]
    var control = panelView.findControl(item.action, item.payload)
    if (!control) return
    var point = control.mapToItem(panelView, 0, 0)
    if (point.y < panelFlick.contentY) panelFlick.contentY = point.y
    else if (point.y + control.height > panelFlick.contentY + panelFlick.height)
      panelFlick.contentY = Math.min(panelFlick.contentHeight - panelFlick.height, point.y + control.height - panelFlick.height)
  }

  function activateCursor() {
    if (!cursor || !controls.length) return
    var position = cursorPosition()
    if (position.row < 0) return
    var item = controls[position.row][position.col]
    dispatch(item.action, item.payload)
  }

  function ingest(text) {
    var next
    try { next = JSON.parse(text) }
    catch (e) { next = { online: false, error: "Unable to read PAIN status" } }
    var inf = next.inference || {}
    var now = Date.now()
    var decoded = Model.num(inf.decoded)
    liveSpeed = inf.processing && prevSampleMs > 0 && prevModel === (next.model_alias || "") && decoded >= prevDecoded && now > prevSampleMs
      ? (decoded - prevDecoded) / ((now - prevSampleMs) / 1000) : 0
    prevDecoded = decoded
    prevSampleMs = now
    prevModel = next.model_alias || ""
    status = next
    if (!selectedBackend || backends.indexOf(selectedBackend) < 0)
      selectedBackend = next.backend || backends[0]
    if (removeId && !modelFor(removeId)) removeId = ""
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight
  Component.onCompleted: refresh()
  onOpenedChanged: {
    if (opened) { refresh(); cursor = ""; removeId = "" }
  }

  Timer {
    interval: root.opened ? 2000 : 10000
    running: true
    repeat: true
    onTriggered: root.refresh()
  }
  Process {
    id: poll
    command: ["python3", root.bridge, "status"]
    stdout: StdioCollector { waitForEnd: true; onStreamFinished: root.ingest(text) }
  }
  Process {
    id: control
    stdout: SplitParser { onRead: function(data) { root.controlOutput(data) } }
    stderr: SplitParser { onRead: function(data) { root.controlOutput(data) } }
    onExited: function(exitCode, exitStatus) {
      if (exitCode !== 0 || exitStatus !== 0)
        root.controlError = root.busyAction + " failed: " + (root.controlLine || ("exit " + exitCode))
      root.busyAction = ""
      root.busyModel = ""
      root.controlLine = ""
      root.refresh()
      settle.restart()
    }
  }
  Timer { id: settle; interval: 3000; onTriggered: root.refresh() }

  IpcHandler {
    target: "local.pain"
    function open(): void { root.open() }
    function close(): void { root.close() }
    function show(): void { root.open() }
    function hide(): void { root.close() }
    function toggle(): void { root.toggle() }
    function refresh(): string { root.refresh(); return "ok" }
    function status(): string { return JSON.stringify(root.status) }
  }

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: "󰧑"
    active: root.generating || root.busy
    dimmed: !root.online && !root.busy
    tooltipText: root.online
      ? ("PAIN · " + (root.status.model_alias || "no model") + (root.generating ? " · " + Model.speedText(root.liveSpeed) : ""))
      : "PAIN · offline"
    onPressed: function(b) {
      if (b === Qt.MiddleButton) root.refresh()
      else if (b === Qt.RightButton) root.launch("top")
      else root.toggle()
    }
  }

  KeyboardPanel {
    id: panel
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(400))
    contentHeight: panel.fittedContentHeight(panelView.height, Style.space(720))

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      onMoveRequested: function(dx, dy) { root.moveCursor(dx, dy) }
      onActivateRequested: root.activateCursor()
      onCloseRequested: {
        if (root.removeId) { root.cursor = "request-remove:" + root.removeId; root.removeId = "" }
        else root.close()
      }
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onTextKey: function(t) {
        if (t === "s" || t === "S") root.runAction("up")
        else if (t === "d" || t === "D") root.runAction("down")
        else if (t === "m" || t === "M") root.runAction("top")
        else if (t === "g" || t === "G") root.runAction("logs")
        else if (t === "r" || t === "R") root.refresh()
      }
      Flickable {
        id: panelFlick
        anchors.fill: parent
        contentWidth: width
        contentHeight: panelView.height
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        flickableDirection: Flickable.VerticalFlick
        interactive: contentHeight > height
        ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }
        Zen.Theme { id: nativeTheme; followPalette: true }
        Zen.Tree {
          id: panelView
          width: panelFlick.width
          node: root.panelTree
          theme: nativeTheme.snapshot
          onDispatched: function(action, payload, value) { root.dispatch(action, payload) }
          onCursorRequested: function(key) { root.cursor = key }
        }
      }
    }
  }
}
