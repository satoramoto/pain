import QtQuick
import QtQuick.Controls
import Quickshell
import Quickshell.Io
import qs.Ui
import qs.Commons as Commons
import "Model.js" as Model
import "App.mjs" as View
import "AppState.mjs" as State
import ".generated" as Zen

// Native host only: window, IPC, telemetry polling and action execution.
Panel {
  id: root
  moduleName: "local.pain"
  ipcTarget: "local.pain"
  manageIpc: false
  property var status: ({})
  property var ui: State.initialState()
  property var logs: ({state:"idle",content:"",error:""})
  property string busyAction: ""
  property string busyBackend: ""
  property string busyModel: ""
  property string controlLine: ""
  property string controlError: ""
  property real liveSpeed: 0
  property int prevDecoded: 0
  property real prevSampleMs: 0
  readonly property bool busy: busyAction !== ""
  readonly property bool online: status.online === true
  readonly property bool generating: online && !!(status.inference || {}).processing
  readonly property string bridge: decodeURIComponent(Qt.resolvedUrl("bridge.py").toString().replace(/^file:\/\//, ""))
  readonly property var viewStatus: Object.assign({},status,{runtimeReady:!!status.backend,busy:busyAction,fetching:busyAction === "fetch"?busyModel:"",controlLine:controlLine,error:controlError || status.error || "",speed:liveSpeed})
  readonly property var tree: View.appView(viewStatus,ui,logs,{backendSelection:true,guide:true})
  function refresh() { if (!poll.running) poll.running=true }
  function launch(action) { Quickshell.execDetached(["omarchy","launch","terminal","python3",bridge,action]) }
  function dispatch(action,payload,value) {
    var next=State.transition(ui,viewStatus,action,value===undefined?payload:value,logs)
    ui=next.state
    for(var effect of next.effects) {
      if(effect.action === "refresh") refresh()
      else if(effect.action === "close" || effect.action === "quit") close()
      else if(effect.action === "logs") {
        if(!logProcess.running) { logs=Object.assign({},logs,{state:"loading",error:""}); logProcess.running=true }
      } else runAction(effect.action,effect.payload)
    }
  }
  function runAction(key,value) {
    if(busy) return
    controlError=""; controlLine=""; busyAction=key; busyBackend=ui.backend; busyModel=value || ""
    var args=["python3",bridge,key === "fetch"?"pull":key]
    if(value) args.push(value)
    control.command=args; control.running=true
  }
  function controlOutput(data) { var line=String(data).trim(); if(line.length) controlLine=line }
  function ingest(text) {
    var next
    try { next=JSON.parse(text) } catch(e) { next={online:false,error:"Unable to read PAIN status"} }
    var inf=next.inference || {}, now=Date.now(), decoded=Model.num(inf.decoded)
    if(inf.processing && prevSampleMs>0 && decoded>prevDecoded && now>prevSampleMs) liveSpeed=(decoded-prevDecoded)/((now-prevSampleMs)/1000)
    else if(!inf.processing) liveSpeed=0
    prevDecoded=decoded; prevSampleMs=now
    var patch={}
    if(!ui.backend || !(next.backends || []).includes(ui.backend)) patch.backend=(next.backends || []).includes(next.backend)?next.backend:(next.backends || [""])[0]
    if(status.modelsDir!==next.modelsDir) patch.folder=next.modelsDir || ""
    ui=Object.assign({},ui,patch); status=next
  }
  implicitWidth:button.implicitWidth
  implicitHeight:button.implicitHeight
  Component.onCompleted:refresh()
  onOpenedChanged:if(opened) { refresh(); Qt.callLater(()=>application.forceActiveFocus()) }
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


  Process {
    id:logProcess
    command:["python3",root.bridge,"logs"]
    stdout:StdioCollector { id:logOutput; waitForEnd:true }
    stderr:StdioCollector { id:logError; waitForEnd:true }
    onExited:function(code,status) {
      root.logs=code===0 && status===0?{state:"ready",content:logOutput.text,error:""}:Object.assign({},root.logs,{state:"error",error:logError.text || "Unable to read engine logs"})
    }
  }
  KeyboardPanel {
    id:panel; anchorItem:button; owner:root; bar:root.bar; open:root.opened
    padding:0
    focusTarget:application
    contentWidth:panel.fittedContentWidth(460)
    contentHeight:panel.fittedContentHeight(application.implicitHeight,720)
    Zen.Application {
      id:application; anchors.fill:parent; tree:root.tree
      onDispatched:function(action,payload,value) { root.dispatch(action,payload,value) }
      Keys.onPressed:function(event) {
        if(event.modifiers & (Qt.ControlModifier | Qt.AltModifier | Qt.MetaModifier)) return
        var command=State.keyAction(root.ui,event.key===Qt.Key_Escape?"Escape":event.text)
        if(command) { root.dispatch(command); event.accepted=true }
      }
    }
  }
}
