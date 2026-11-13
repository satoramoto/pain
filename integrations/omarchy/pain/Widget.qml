import QtQuick
import QtQuick.Controls
import Quickshell
import Quickshell.Io
import qs.Ui
import qs.Commons
import qs.Commons as Commons
import "Model.js" as Model
import "Panel.mjs" as View
import ".generated" as Zen

// PAIN bar widget: one glyph in the bar, a KeyboardPanel popup with the same
// telemetry paintop draws (inference slot, RAM split against the GTT ceiling,
// APU load) plus engine controls. Data comes from bridge.py as one JSON blob.
Panel {
  id: root
  moduleName: "local.pain"
  ipcTarget: "local.pain"
  // manageIpc: false so this panel owns the single IpcHandler the target
  // permits — needed for the refresh/status methods below.
  manageIpc: false

  property var status: ({})
  property string selectedBackend: ""
  property string screen: "dashboard"
  property string managerCursor: ""
  property string removeId: ""
  property string busyModel: ""
  property int toolIndex: 0

  // Keyboard cursor. Sections: "backend" (chip row, h/l walks backends) and
  // "actions" (button row, h/l walks actions). j/k moves between sections.
  property bool cursorActive: false
  property string focusSection: "backend"
  property int actionIndex: 0

  // Generation speed is derived from n_decoded deltas between polls, exactly
  // as paintop does; the server does not report tok/s on /slots.
  property real liveSpeed: 0
  property int prevDecoded: 0
  property real prevSampleMs: 0

  // Start/Stop run the adapter in the background; the hero shows its last
  // output line while it works and the caption keeps a failure until the next action.
  property string busyAction: ""
  property string busyBackend: ""
  property string controlLine: ""
  property string controlError: ""
  readonly property bool busy: busyAction !== ""

  readonly property string bridge: decodeURIComponent(Qt.resolvedUrl("bridge.py").toString().replace(/^file:\/\//, ""))
  readonly property color foreground: bar ? bar.foreground : Commons.Color.foreground
  readonly property color accent: Commons.Color.accent
  readonly property color urgent: bar ? bar.urgent : Commons.Color.urgent
  readonly property color dim: Qt.darker(foreground, 1.4)
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family
  readonly property color trackColor: Qt.rgba(foreground.r, foreground.g, foreground.b, 0.12)

  readonly property bool online: status.online === true
  readonly property bool modelLoaded: !!status.model_alias
  readonly property var inference: status.inference || ({})
  readonly property var hw: status.hardware || ({})
  readonly property var mem: status.memory || ({})
  readonly property var split: status.memory_split || ({})
  readonly property var swap: status.swap || ({})
  readonly property bool generating: online && inference.processing === true
  readonly property var backends: status.backends || ["rocm", "vulkan", "llamacpp-vulkan", "llamacpp-cpu"]
  readonly property real gttRatio: Model.clamp01(split.gtt_ratio)
  readonly property real gttCap: Model.gttCapFraction(hw, mem)
  readonly property var presentation: Model.panelState(status, {
    platform: "omarchy", busyAction: busyAction, busyBackend: busyBackend,
    controlLine: controlLine, speed: liveSpeed
  })
  readonly property var actions: presentation.actions
  readonly property string metaText: presentation.meta
  readonly property string heroDetail: presentation.detail
  readonly property var managerStatus: Object.assign({}, status, {
    busy: busyAction, fetching: busyAction === "fetch" ? busyModel : "",
    controlLine: controlLine, error: controlError || status.error || ""
  })
  readonly property var managerTree: screen === "guide"
    ? View.guide(managerStatus, {platform: "omarchy", cursor: managerCursor})
    : View.view(managerStatus, {platform: "omarchy", cursor: managerCursor, removeId: removeId})
  readonly property var managerControls: View.controlRows(managerTree)

  function refresh() { if (!poll.running) poll.running = true }

  function launch(action) {
    var args = ["omarchy", "launch", "terminal", "python3", bridge, action]
    if (action === "up") args.push(selectedBackend)
    Quickshell.execDetached(args)
  }

  function showScreen(next) {
    screen = next
    removeId = ""
    managerCursor = ""
    managerFlick.contentY = 0
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
    if (next === "models") refresh()
  }

  function modelFor(id) {
    return (status.models || []).find(function(model) { return model.id === id })
  }

  function managerDispatch(action, payload) {
    if (action === "dashboard" || action === "models") { showScreen(action); return }
    if (action === "getting-started") { showScreen("guide"); return }
    if (action === "refresh") { refresh(); return }
    if (action === "cancel-remove") { removeId = ""; managerCursor = "request-remove:" + payload; return }
    if (action === "request-remove" || action === "confirm-remove") {
      var model = modelFor(payload)
      if (busy || !model || Model.removalReason(model, status)) return
      if (action === "request-remove") { removeId = payload; managerCursor = "cancel-remove:" + payload }
      else if (removeId === payload) { removeId = ""; runAction("remove", payload) }
      return
    }
    runAction(action, payload)
  }

  function managerPosition() {
    for (var r = 0; r < managerControls.length; r++)
      for (var c = 0; c < managerControls[r].length; c++)
        if (managerControls[r][c].focusKey === managerCursor) return {row:r, col:c}
    return {row:-1, col:-1}
  }

  function moveManager(dx, dy) {
    if (!managerControls.length) return
    var p = managerPosition()
    var r = p.row < 0 ? 0 : Math.max(0, Math.min(managerControls.length - 1, p.row + dy))
    var c = p.col < 0 ? 0 : Math.max(0, Math.min(managerControls[r].length - 1, p.col + dx))
    var target = managerControls[r][c]
    managerCursor = target.focusKey
    Qt.callLater(function() {
      var control = managerView.findControl(target.action, target.payload)
      if (!control) return
      var point = control.mapToItem(managerView, 0, 0)
      if (point.y < managerFlick.contentY) managerFlick.contentY = point.y
      else if (point.y + control.height > managerFlick.contentY + managerFlick.height)
        managerFlick.contentY = Math.max(0, point.y + control.height - managerFlick.height)
    })
  }

  function activateManager() {
    var p = managerPosition()
    if (p.row >= 0) managerDispatch(managerControls[p.row][p.col].action, managerControls[p.row][p.col].payload)
  }

  function runAction(key, value) {
    if (key === "top" || key === "logs") { launch(key); return }
    if (busy) return
    if (["up", "down", "fetch", "use", "remove"].indexOf(key) < 0) return
    if (key === "up" && backends.indexOf(selectedBackend) < 0) return
    controlError = ""
    controlLine = ""
    busyBackend = selectedBackend
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

  function backendIndex() {
    var idx = backends.indexOf(selectedBackend)
    return idx < 0 ? 0 : idx
  }

  function moveCursor(dx, dy) {
    cursorActive = true
    if (dy !== 0) {
      var sections = ["backend", "actions", "tools"]
      focusSection = sections[Math.max(0, Math.min(2, sections.indexOf(focusSection) + dy))]
      return
    }
    if (dx === 0) return
    if (focusSection === "backend") {
      var next = Math.max(0, Math.min(backends.length - 1, backendIndex() + dx))
      selectedBackend = backends[next]
    } else if (focusSection === "actions") {
      actionIndex = Math.max(0, Math.min(actions.length - 1, actionIndex + dx))
    } else toolIndex = Math.max(0, Math.min(1, toolIndex + dx))
  }

  function activateCursor() {
    if (!cursorActive) return
    if (focusSection === "actions") runAction(actions[actionIndex].key)
    else if (focusSection === "tools") showScreen(toolIndex === 0 ? "models" : "guide")
    // Enter on a backend chip only selects it; Start applies the change.
  }

  function ingest(text) {
    var next
    try {
      next = JSON.parse(text)
    } catch (e) {
      next = { online: false, error: "Unable to read PAIN status" }
    }
    var inf = next.inference || {}
    var now = Date.now()
    var decoded = Model.num(inf.decoded)
    if (inf.processing && root.prevSampleMs > 0 && decoded > root.prevDecoded && now > root.prevSampleMs)
      root.liveSpeed = (decoded - root.prevDecoded) / ((now - root.prevSampleMs) / 1000)
    else if (!inf.processing)
      root.liveSpeed = 0
    root.prevDecoded = decoded
    root.prevSampleMs = now
    root.status = next
    if (!root.selectedBackend || root.backends.indexOf(root.selectedBackend) < 0)
      root.selectedBackend = next.backend || root.backends[0]
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  Component.onCompleted: refresh()
  onOpenedChanged: {
    if (opened) {
      refresh()
      cursorActive = false
      focusSection = "backend"
      actionIndex = 0
      showScreen("dashboard")
    }
  }

  // Poll slowly for the bar glyph while closed; the open panel tracks the slot.
  Timer {
    interval: root.opened ? 2000 : 10000
    running: true
    repeat: true
    onTriggered: root.refresh()
  }

  Process {
    id: poll
    command: ["python3", root.bridge, "status"]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.ingest(text)
    }
  }

  // Background Start/Stop. The adapter detects the missing tty, escalates with
  // pkexec if Docker needs it, and posts a desktop notification with the result.
  Process {
    id: control
    stdout: SplitParser { onRead: function(data) { root.controlOutput(data) } }
    stderr: SplitParser { onRead: function(data) { root.controlOutput(data) } }
    onExited: function(exitCode, exitStatus) {
      var failed = exitCode !== 0 || exitStatus !== 0
      var verb = root.busyAction === "down" ? "Stop" : root.busyAction === "up" ? "Start" : root.busyAction
      if (failed) root.controlError = verb + " failed: " + (root.controlLine || ("exit " + exitCode))
      root.busyAction = ""
      root.busyBackend = ""
      root.busyModel = ""
      root.controlLine = ""
      root.refresh()
      settle.restart()
    }
  }

  // The engine reports healthy before the preset finishes loading; poll again shortly.
  Timer {
    id: settle
    interval: 3000
    onTriggered: root.refresh()
  }

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
    contentHeight: panel.fittedContentHeight(root.screen === "dashboard" ? column.implicitHeight : managerView.height, Style.space(720))

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      onMoveRequested: function(dx, dy) {
        if (root.screen !== "dashboard") { root.moveManager(dx, dy); return }
        if (!root.cursorActive) { root.cursorActive = true; return }
        root.moveCursor(dx, dy)
      }
      onActivateRequested: { if (root.screen === "dashboard") root.activateCursor(); else root.activateManager() }
      onCloseRequested: {
        if (root.removeId) { root.managerCursor = "request-remove:" + root.removeId; root.removeId = "" }
        else if (root.screen !== "dashboard") root.showScreen("dashboard")
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
        visible: root.screen === "dashboard"
        anchors.fill: parent
        contentWidth: width
        contentHeight: column.implicitHeight
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        flickableDirection: Flickable.VerticalFlick
        interactive: contentHeight > height
        ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }

        Column {
          id: column
          width: panelFlick.width
          spacing: Style.space(14)

          // ---------- Hero: glyph · title/engine · state pill ----------
          PanelHero {
            width: parent.width
            title: "PAIN"
            meta: root.metaText
            detail: root.heroDetail
            foreground: root.foreground
            fontFamily: root.fontFamily
            iconOpacity: root.online || root.busy ? 1.0 : 0.5
            iconComponent: Component {
              Text {
                textFormat: Text.PlainText
                text: "󰧑"
                color: root.generating || root.busy ? root.accent : root.foreground
                font.family: root.fontFamily
                font.pixelSize: Style.font.display
                Behavior on color { ColorAnimation { duration: 200 } }
              }
            }
            trailingControl: Component {
              PanelActionButton {
                iconText: "󰑐"
                tooltipText: "Refresh"
                foreground: root.foreground
                fontFamily: root.fontFamily
                onClicked: root.refresh()
              }
            }
          }

          // ---------- Engine controls ----------
          Column {
            width: parent.width
            spacing: Style.space(10)

            PanelSectionHeader {
              text: "BACKEND"
              foreground: root.foreground
              fontFamily: root.fontFamily
            }

            ButtonGroup {
              width: parent.width
              options: root.backends
              value: root.selectedBackend
              foreground: root.foreground
              background: Commons.Color.background
              accent: root.accent
              fontFamily: root.fontFamily
              fontSize: Style.font.bodySmall
              focusable: false
              cursorIndex: root.cursorActive && root.focusSection === "backend" ? root.backendIndex() : -1
              onChanged: function(value) { root.selectedBackend = value }
              onHovered: function(index, isHovered) {
                if (isHovered) { root.cursorActive = true; root.focusSection = "backend" }
              }
            }

            Row {
              id: actionRow
              width: parent.width
              spacing: Style.space(6)
              readonly property real cellWidth: (width - spacing * (root.actions.length - 1)) / root.actions.length

              Repeater {
                model: root.actions
                Button {
                  required property var modelData
                  required property int index
                  width: actionRow.cellWidth
                  iconText: modelData.icon
                  iconSize: Style.font.title
                  text: modelData.label
                  tooltipText: modelData.tip
                  fontSize: Style.font.bodySmall
                  foreground: modelData.key === "down" && root.online ? root.urgent : root.foreground
                  fontFamily: root.fontFamily
                  verticalPadding: Style.spacing.controlPaddingY + Style.space(2)
                  bordered: true
                  enabled: modelData.enabled
                  opacity: enabled ? 1 : 0.45
                  hasCursor: root.cursorActive && root.focusSection === "actions" && root.actionIndex === index
                  onClicked: root.runAction(modelData.key)
                  onHovered: function(h) {
                    if (h) { root.cursorActive = true; root.focusSection = "actions"; root.actionIndex = index }
                  }
                }
              }
            }

            Text {
              width: parent.width
              textFormat: Text.PlainText
              text: root.controlError.length ? root.controlError
                : (root.online ? "Restart replaces the running engine and interrupts requests. " : "")
                  + "S start · D stop · M monitor · G logs · R refresh"
              color: root.controlError.length ? root.urgent : root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              wrapMode: Text.WordWrap
            }
          }

          PanelSeparator { foreground: root.foreground }

          // ---------- Inference ----------
          Column {
            width: parent.width
            spacing: Style.space(10)
            visible: root.online

            PanelSectionHeader {
              text: "INFERENCE"
              foreground: root.foreground
              fontFamily: root.fontFamily
            }

            Column {
              width: parent.width
              spacing: Style.spacing.labelGap
              InfoPair { label: "Model"; value: root.status.model_alias || "none loaded" }
              InfoPair { label: "Prompt"; value: root.inference.has_slot ? (Model.kTokens(root.inference.prompt) + " tokens · KV " + Model.cacheHitText(root.inference)) : "—" }
              InfoPair { label: "Draft"; value: root.modelLoaded ? Model.draftText(root.inference, root.status) : "—" }
              InfoPair { label: "Speed"; value: root.generating ? Model.speedText(root.liveSpeed) : (root.modelLoaded ? "idle" : "—") }
            }

            Meter {
              label: "Context"
              value: Model.contextText(root.inference)
              fraction: Model.contextFraction(root.inference)
              fillColor: root.foreground
              pulsing: root.generating
            }
          }

          PanelSeparator { foreground: root.foreground }

          // ---------- Memory: RAM split against the GTT ceiling ----------
          Column {
            width: parent.width
            spacing: Style.space(10)

            PanelSectionHeader {
              text: "MEMORY"
              foreground: root.foreground
              fontFamily: root.fontFamily
            }

            Column {
              width: parent.width
              spacing: Style.space(6)

              InfoPair { label: "RAM"; value: Model.gibPair(root.mem.used_gib, root.mem.total_gib) }

              // GPU-resident pages (weights, draft, KV/compute) are system RAM
              // pinned through GTT, so they share one bar with everything else.
              // The accent tick marks how far the iGPU is allowed to pin.
              StackedBar {
                segments: Model.ramSegments(root.split, root.modelLoaded)
                total: Model.num(root.mem.total_gib, 1)
                colors: [root.accent, Qt.rgba(root.accent.r, root.accent.g, root.accent.b, 0.55),
                         Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.75),
                         Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.3)]
                tick: root.gttCap
              }

              Flow {
                width: parent.width
                spacing: Style.space(10)
                Repeater {
                  model: Model.ramSegments(root.split, root.modelLoaded)
                  Row {
                    required property var modelData
                    required property int index
                    spacing: Style.space(4)
                    visible: modelData.value > 0 || modelData.key === "sys"
                    Rectangle {
                      width: Style.space(8); height: Style.space(8); radius: Style.space(2)
                      anchors.verticalCenter: parent.verticalCenter
                      color: [root.accent, Qt.rgba(root.accent.r, root.accent.g, root.accent.b, 0.55),
                              Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.75),
                              Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.3)][index]
                    }
                    InfoLabel { text: modelData.label + " " + modelData.value.toFixed(1) }
                  }
                }
                Row {
                  spacing: Style.space(4)
                  visible: root.gttCap > 0
                  Rectangle { width: Style.space(2); height: Style.space(10); color: root.accent; anchors.verticalCenter: parent.verticalCenter }
                  InfoLabel { text: "GTT cap " + Model.num(root.hw.gtt_total_gib).toFixed(0) + " GiB (" + Model.num(root.split.gtt_share_pct) + "% of RAM)" }
                }
              }
            }

            Meter {
              label: "GTT"
              value: Model.gibPair(root.hw.gtt_used_gib, root.hw.gtt_total_gib)
              fraction: root.gttRatio
              fillColor: root.gttRatio >= 0.9 ? root.urgent : root.foreground
            }

            InfoPair { label: "Swap"; value: Model.swapText(root.swap) }
          }

          PanelSeparator { foreground: root.foreground }

          // ---------- APU ----------
          Column {
            width: parent.width
            spacing: Style.space(10)

            PanelSectionHeader {
              text: "APU"
              foreground: root.foreground
              fontFamily: root.fontFamily
            }

            Meter {
              label: "GPU"
              value: Math.round(Model.num(root.hw.gpu_busy_pct)) + "%"
              fraction: Model.clamp01(Model.num(root.hw.gpu_busy_pct) / 100)
              fillColor: Model.num(root.hw.gpu_busy_pct) >= 80 ? root.accent : root.foreground
            }

            Meter {
              label: "Power"
              value: Model.num(root.hw.ppt_w).toFixed(1) + " W"
              fraction: Model.clamp01(Model.num(root.hw.ppt_w) / 70)
              fillColor: root.foreground
            }

            InfoPair { label: "Thermals"; value: Model.tempsText(root.hw) }
          }

          Row {
            width: parent.width
            spacing: Style.space(6)
            Repeater {
              model: [{label:"Models", screen:"models"}, {label:"Getting Started", screen:"guide"}]
              Button {
                required property var modelData
                required property int index
                text: modelData.label
                fontSize: Style.font.caption
                foreground: root.foreground
                fontFamily: root.fontFamily
                bordered: false
                hasCursor: root.cursorActive && root.focusSection === "tools" && root.toolIndex === index
                onClicked: root.showScreen(modelData.screen)
                onHovered: function(h) { if (h) { root.cursorActive = true; root.focusSection = "tools"; root.toolIndex = index } }
              }
            }
          }
        }
      }

      Flickable {
        id: managerFlick
        visible: root.screen !== "dashboard"
        anchors.fill: parent
        contentWidth: width
        contentHeight: managerView.height
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        flickableDirection: Flickable.VerticalFlick
        interactive: contentHeight > height
        ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }
        Zen.Theme { id: managerTheme; followPalette: true }
        Zen.Tree {
          id: managerView
          width: managerFlick.width
          node: root.managerTree
          theme: managerTheme.snapshot
          onDispatched: function(action, payload, value) { root.managerDispatch(action, payload) }
          onCursorRequested: function(key) { root.managerCursor = key }
        }
      }
    }
  }

  // ---------- Local components (same idiom as the Power panel) ----------
  component InfoPair: Row {
    property string label: ""
    property string value: ""
    width: parent.width
    spacing: Style.space(8)
    InfoLabel { text: label }
    Item { width: Math.max(0, parent.width - parent.children[0].implicitWidth - parent.children[2].implicitWidth - parent.spacing * 2); height: 1 }
    InfoValue { text: value }
  }

  component InfoLabel: Text {
    textFormat: Text.PlainText
    color: root.foreground
    opacity: 0.6
    font.family: root.fontFamily
    font.pixelSize: Style.font.bodySmall
  }

  component InfoValue: Text {
    textFormat: Text.PlainText
    color: root.foreground
    font.family: root.fontFamily
    font.pixelSize: Style.font.bodySmall
    elide: Text.ElideLeft
  }

  // Label row over a rounded progress track, the Power panel's battery bar.
  component Meter: Column {
    id: meter
    property string label: ""
    property string value: ""
    property real fraction: 0
    property color fillColor: root.foreground
    property bool pulsing: false
    width: parent.width
    spacing: Style.space(4)

    InfoPair { label: meter.label; value: meter.value }

    Item {
      width: parent.width
      implicitHeight: Style.space(6)

      Rectangle {
        id: meterTrack
        anchors.fill: parent
        radius: height / 2
        color: root.trackColor
      }

      Rectangle {
        anchors.left: meterTrack.left
        anchors.verticalCenter: meterTrack.verticalCenter
        height: meterTrack.height
        radius: meterTrack.radius
        color: meter.fillColor
        width: meter.fraction > 0 ? Math.max(meterTrack.height, meterTrack.width * Model.clamp01(meter.fraction)) : 0
        Behavior on width { NumberAnimation { duration: 320; easing.type: Easing.OutCubic } }
        Behavior on color { ColorAnimation { duration: 220 } }

        SequentialAnimation on opacity {
          running: meter.pulsing && root.opened
          loops: Animation.Infinite
          alwaysRunToEnd: true
          NumberAnimation { from: 1.0; to: 0.55; duration: 950; easing.type: Easing.InOutSine }
          NumberAnimation { from: 0.55; to: 1.0; duration: 950; easing.type: Easing.InOutSine }
        }
      }
    }
  }

  // Segmented bar with an optional ceiling tick (the GTT limit on the RAM bar).
  component StackedBar: Item {
    id: stacked
    property var segments: []
    property var colors: []
    property real total: 1
    property real tick: -1
    width: parent.width
    implicitHeight: Style.space(8)

    Rectangle {
      id: stackedTrack
      anchors.fill: parent
      radius: height / 2
      color: root.trackColor
      clip: true

      Row {
        anchors.fill: parent
        spacing: 0
        Repeater {
          model: stacked.segments
          Rectangle {
            required property var modelData
            required property int index
            height: parent.height
            width: stacked.total > 0 ? Math.round(stackedTrack.width * Model.clamp01(modelData.value / stacked.total)) : 0
            color: index < stacked.colors.length ? stacked.colors[index] : root.foreground
            Behavior on width { NumberAnimation { duration: 320; easing.type: Easing.OutCubic } }
          }
        }
      }
    }

    Rectangle {
      visible: stacked.tick > 0 && stacked.tick < 1
      x: Math.round(stackedTrack.width * stacked.tick) - width / 2
      anchors.verticalCenter: parent.verticalCenter
      width: Math.max(2, Style.space(2))
      height: parent.height + Style.space(6)
      radius: width / 2
      color: root.accent
    }
  }
}
