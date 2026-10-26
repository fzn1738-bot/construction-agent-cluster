// mac-helper.swift: the native half of the desktop automation agent on macOS (agent/rpa-agent.mjs runs it).
// It watches what the user does on screen through the Accessibility API and a listen-only event tap, and performs
// recorded steps the same way. Every command prints JSON lines on stdout.
//
//   check                          {"accessibility": true, "screen": true}
//   watch                          one line per action until SIGTERM:
//                                    {"kind":"click","target":"Save","role":"AXButton","app":"Numbers","at":...}
//                                    {"kind":"type","target":"PO number","value":"PO-4471","app":"Safari","sensitive":false,...}
//                                    {"kind":"key","value":"Enter","app":"Mail",...}
//                                    {"kind":"app","app":"Excel",...}
//                                  and {"type":"front","app":"..."} first, {"error":...,"code":"permission-denied"} when refused
//   press   <app> <label>          press the button, link or menu item with that label
//   settext <app> <label> <text>   put text in the field with that label
//   choose  <app> <label> <item>   open the pop-up with that label and pick the item
//   key     <name>                 Enter, Tab, Escape, or cmd+<letter> / ctrl+<letter>
//
// Typing into password fields is never captured: macOS turns on Secure Input for them, so no keystrokes reach the
// tap, and a field whose role is AXSecureTextField is reported as sensitive with an empty value.
// Build: swiftc -swift-version 5 -O -o mac-helper mac-helper.swift (the agent does this once and caches the binary).
import Cocoa
import ApplicationServices

// ---------- output ----------
func emit(_ d: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: d), let s = String(data: data, encoding: .utf8) else { return }
  FileHandle.standardOutput.write((s + "\n").data(using: .utf8)!)
}
func finish(_ d: [String: Any], _ code: Int32) -> Never { emit(d); exit(code) }
func nowMs() -> Double { Date().timeIntervalSince1970 * 1000 }

// ---------- accessibility helpers ----------
func attr(_ el: AXUIElement, _ name: String) -> CFTypeRef? {
  var v: CFTypeRef?
  return AXUIElementCopyAttributeValue(el, name as CFString, &v) == .success ? v : nil
}
func str(_ el: AXUIElement, _ name: String) -> String {
  guard let v = attr(el, name), let s = v as? String else { return "" }
  return s.trimmingCharacters(in: .whitespacesAndNewlines)
}
func element(_ v: CFTypeRef?) -> AXUIElement? {
  guard let v = v, CFGetTypeID(v) == AXUIElementGetTypeID() else { return nil }
  return unsafeBitCast(v, to: AXUIElement.self)
}
func children(_ el: AXUIElement) -> [AXUIElement] {
  guard let v = attr(el, kAXChildrenAttribute as String), let arr = v as? [AnyObject] else { return [] }
  return arr.compactMap { element($0) }
}
func role(_ el: AXUIElement) -> String { str(el, kAXRoleAttribute as String) }
func clip(_ s: String) -> String { String(s.prefix(120)) }
/** What a person would call the element: its title, description, placeholder, label or text. */
func labelOf(_ el: AXUIElement) -> String {
  for a in [kAXTitleAttribute as String, kAXDescriptionAttribute as String, "AXPlaceholderValue", kAXHelpAttribute as String] {
    let s = str(el, a); if !s.isEmpty { return clip(s) }
  }
  if let t = element(attr(el, kAXTitleUIElementAttribute as String)) { let s = str(t, kAXValueAttribute as String); if !s.isEmpty { return clip(s) } }
  if role(el) == (kAXStaticTextRole as String) { let s = str(el, kAXValueAttribute as String); if !s.isEmpty { return clip(s) } }
  return ""
}
let FIELD_ROLES: Set<String> = ["AXTextField", "AXTextArea", "AXComboBox", "AXSearchField", "AXSecureTextField"]
func isSecure(_ el: AXUIElement) -> Bool { role(el) == "AXSecureTextField" || str(el, kAXSubroleAttribute as String) == "AXSecureTextField" }
func pidOf(_ el: AXUIElement) -> pid_t { var p: pid_t = 0; AXUIElementGetPid(el, &p); return p }
func appName(_ pid: pid_t) -> String { NSRunningApplication(processIdentifier: pid)?.localizedName ?? "" }
func frontName() -> String { NSWorkspace.shared.frontmostApplication?.localizedName ?? "" }

// ---------- watch ----------
final class Watcher {
  let sys = AXUIElementCreateSystemWide()
  var tap: CFMachPort?
  var typingEl: AXUIElement?
  var typingLabel = ""
  var typingApp = ""
  var typingSecure = false
  var buffer = ""
  var lastKey = 0.0

  /** One typing step per field: emitted when the user leaves it, presses Enter or Tab, or pauses. */
  func flush() {
    guard let el = typingEl else { return }
    var value = typingSecure ? "" : str(el, kAXValueAttribute as String)
    if value.isEmpty && !typingSecure { value = buffer }
    if typingSecure || !value.isEmpty {
      emit(["kind": "type", "target": typingLabel, "value": value, "app": typingApp, "sensitive": typingSecure, "inputType": typingSecure ? "password" : "text", "field": typingLabel, "at": nowMs()])
    }
    typingEl = nil; buffer = ""
  }
  func mouseDown(_ loc: CGPoint) {
    flush()
    var hit: AXUIElement?
    guard AXUIElementCopyElementAtPosition(sys, Float(loc.x), Float(loc.y), &hit) == .success, var el = hit else { return }
    if FIELD_ROLES.contains(role(el)) { return }   // clicking into a field: the typing that follows is the step
    let app = appName(pidOf(el))
    var label = labelOf(el)
    var hops = 0
    while label.isEmpty && hops < 4, let parent = element(attr(el, kAXParentAttribute as String)) { el = parent; label = labelOf(el); hops += 1 }
    emit(["kind": "click", "target": label.isEmpty ? role(el) : label, "role": role(el), "app": app, "x": Int(loc.x), "y": Int(loc.y), "at": nowMs()])
  }
  func keyDown(_ event: CGEvent) {
    let code = event.getIntegerValueField(.keyboardEventKeycode)
    let flags = event.flags
    if flags.contains(.maskCommand) || flags.contains(.maskControl) {
      var len = 0
      var chars = [UniChar](repeating: 0, count: 4)
      event.keyboardGetUnicodeString(maxStringLength: 4, actualStringLength: &len, unicodeString: &chars)
      let ch = String(utf16CodeUnits: chars, count: len).lowercased()
      if !ch.isEmpty { flush(); emit(["kind": "key", "value": (flags.contains(.maskCommand) ? "cmd+" : "ctrl+") + ch, "app": frontName(), "at": nowMs()]) }
      return
    }
    let named: [Int64: String] = [36: "Enter", 76: "Enter", 48: "Tab", 53: "Escape"]
    if let n = named[code] { flush(); emit(["kind": "key", "value": n, "app": frontName(), "at": nowMs()]); return }
    guard let focused = element(attr(sys, kAXFocusedUIElementAttribute as String)) else { return }
    if typingEl == nil || !CFEqual(typingEl!, focused) {
      flush()
      typingEl = focused; typingLabel = labelOf(focused); typingApp = appName(pidOf(focused)); typingSecure = isSecure(focused); buffer = ""
    }
    if code == 51 { if !buffer.isEmpty { buffer.removeLast() } }
    else if !typingSecure {
      var len = 0
      var chars = [UniChar](repeating: 0, count: 8)
      event.keyboardGetUnicodeString(maxStringLength: 8, actualStringLength: &len, unicodeString: &chars)
      buffer += String(utf16CodeUnits: chars, count: len)
    }
    lastKey = nowMs()
  }
}
let watcher = Watcher()
var keepAlive: [AnyObject] = []

func runWatch() -> Never {
  let prompt = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
  if !AXIsProcessTrustedWithOptions(prompt) {
    finish(["error": "accessibility", "code": "permission-denied", "message": "Accessibility permission was denied. Allow the automation agent in System Settings > Privacy & Security > Accessibility, then record again."], 3)
  }
  if !CGPreflightScreenCaptureAccess() {
    _ = CGRequestScreenCaptureAccess()
    finish(["error": "screen", "code": "permission-denied", "message": "Screen recording permission was denied. Allow the automation agent in System Settings > Privacy & Security > Screen & System Audio Recording, then record again."], 3)
  }
  let mask = CGEventMask((1 << CGEventType.leftMouseDown.rawValue) | (1 << CGEventType.keyDown.rawValue))
  guard let tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly, eventsOfInterest: mask, callback: { _, type, event, _ in
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
      if let t = watcher.tap { CGEvent.tapEnable(tap: t, enable: true) }
      return Unmanaged.passUnretained(event)
    }
    if type == .leftMouseDown { watcher.mouseDown(event.location) } else if type == .keyDown { watcher.keyDown(event) }
    return Unmanaged.passUnretained(event)
  }, userInfo: nil) else {
    finish(["error": "tap", "code": "permission-denied", "message": "macOS refused to let the agent watch the mouse and keyboard. Allow it under Privacy & Security > Input Monitoring and Accessibility."], 3)
  }
  watcher.tap = tap
  let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
  CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .commonModes)
  CGEvent.tapEnable(tap: tap, enable: true)
  let observer = NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { note in
    let app = (note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication)?.localizedName ?? ""
    watcher.flush()
    emit(["kind": "app", "app": app, "at": nowMs()])
  }
  let idle = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { _ in
    if watcher.typingEl != nil && nowMs() - watcher.lastKey > 1500 { watcher.flush() }
  }
  signal(SIGTERM, SIG_IGN)
  let term = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
  term.setEventHandler { watcher.flush(); exit(0) }
  term.resume()
  keepAlive = [observer as AnyObject, idle, term as AnyObject]
  emit(["type": "front", "app": frontName()])
  RunLoop.main.run()
  exit(0)
}

// ---------- perform ----------
func runningApp(_ name: String) -> NSRunningApplication? {
  if name.isEmpty { return NSWorkspace.shared.frontmostApplication }
  return NSWorkspace.shared.runningApplications.first { ($0.localizedName ?? "").caseInsensitiveCompare(name) == .orderedSame }
}
/** Breadth-first search of an app's windows and menus: an exact label first, else the first label containing it. */
func find(_ root: AXUIElement, _ label: String, roles: Set<String>? = nil) -> AXUIElement? {
  let want = label.lowercased()
  var queue = [root]
  var i = 0
  var partial: AXUIElement?
  while i < queue.count && i < 12000 {
    let el = queue[i]; i += 1
    let l = labelOf(el).lowercased()
    if !l.isEmpty && (roles == nil || roles!.contains(role(el))) {
      if l == want { return el }
      if partial == nil && l.contains(want) { partial = el }
    }
    queue.append(contentsOf: children(el))
  }
  return partial
}
func centre(_ el: AXUIElement) -> CGPoint? {
  guard let p = attr(el, kAXPositionAttribute as String), let s = attr(el, kAXSizeAttribute as String) else { return nil }
  var pos = CGPoint.zero
  var size = CGSize.zero
  guard AXValueGetValue(unsafeBitCast(p, to: AXValue.self), .cgPoint, &pos), AXValueGetValue(unsafeBitCast(s, to: AXValue.self), .cgSize, &size) else { return nil }
  return CGPoint(x: pos.x + size.width / 2, y: pos.y + size.height / 2)
}
func clickAt(_ p: CGPoint) {
  CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
  CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
}
func typeText(_ text: String) {
  for unit in text.utf16 {
    var u = unit
    let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true)
    down?.keyboardSetUnicodeString(stringLength: 1, unicodeString: &u)
    down?.post(tap: .cghidEventTap)
    let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false)
    up?.keyboardSetUnicodeString(stringLength: 1, unicodeString: &u)
    up?.post(tap: .cghidEventTap)
  }
}
let KEYCODES: [String: CGKeyCode] = [
  "enter": 36, "return": 36, "tab": 48, "escape": 53, "esc": 53, "space": 49, "delete": 51,
  "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11, "q": 12, "w": 13, "e": 14, "r": 15,
  "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23, "9": 25, "7": 26, "8": 28, "0": 29, "o": 31, "u": 32,
  "i": 34, "p": 35, "l": 37, "j": 38, "k": 40, "n": 45, "m": 46
]
func pressKey(_ name: String) -> Bool {
  let parts = name.lowercased().split(separator: "+").map(String.init)
  guard let last = parts.last, let code = KEYCODES[last] else { return false }
  var flags = CGEventFlags()
  if parts.contains("cmd") || parts.contains("command") { flags.insert(.maskCommand) }
  if parts.contains("ctrl") || parts.contains("control") { flags.insert(.maskControl) }
  if parts.contains("shift") { flags.insert(.maskShift) }
  if parts.contains("alt") || parts.contains("option") { flags.insert(.maskAlternate) }
  let down = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: true)
  down?.flags = flags; down?.post(tap: .cghidEventTap)
  let up = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false)
  up?.flags = flags; up?.post(tap: .cghidEventTap)
  return true
}
func target(_ appArg: String, _ label: String, roles: Set<String>? = nil) -> (AXUIElement, String, AXUIElement) {
  guard let app = runningApp(appArg) else { finish(["ok": false, "code": "app-missing", "message": "\(appArg.isEmpty ? "No app" : appArg) is not open"], 1) }
  let name = app.localizedName ?? appArg
  if !app.isActive { app.activate(); usleep(400_000) }
  let root = AXUIElementCreateApplication(app.processIdentifier)
  let found = (roles != nil ? find(root, label, roles: roles) : nil) ?? find(root, label)
  guard let el = found else { finish(["ok": false, "code": "target-missing", "message": "Could not find \"\(label)\" in \(name)"], 1) }
  return (el, name, root)
}

// ---------- main ----------
let args = CommandLine.arguments
let cmd = args.count > 1 ? args[1] : ""
func arg(_ i: Int) -> String { args.count > i ? args[i] : "" }

switch cmd {
case "check":
  finish(["accessibility": AXIsProcessTrusted(), "screen": CGPreflightScreenCaptureAccess()], 0)
case "watch":
  runWatch()
case "press":
  if !AXIsProcessTrusted() { finish(["ok": false, "code": "permission-denied", "message": "Accessibility permission is needed to press buttons"], 3) }
  let (el, name, _) = target(arg(2), arg(3))
  if AXUIElementPerformAction(el, kAXPressAction as CFString) != .success {
    guard let p = centre(el) else { finish(["ok": false, "code": "not-pressable", "message": "\"\(arg(3))\" in \(name) cannot be pressed"], 1) }
    clickAt(p)
  }
  finish(["ok": true, "message": "Pressed \"\(arg(3))\" in \(name)"], 0)
case "settext":
  if !AXIsProcessTrusted() { finish(["ok": false, "code": "permission-denied", "message": "Accessibility permission is needed to type"], 3) }
  let (el, name, _) = target(arg(2), arg(3), roles: FIELD_ROLES)
  _ = AXUIElementSetAttributeValue(el, kAXFocusedAttribute as CFString, kCFBooleanTrue)
  let secure = isSecure(el)
  if AXUIElementSetAttributeValue(el, kAXValueAttribute as CFString, arg(4) as CFString) != .success || (!secure && str(el, kAXValueAttribute as String) != arg(4)) {
    if let p = centre(el) { clickAt(p); usleep(150_000) }
    _ = pressKey("cmd+a")
    typeText(arg(4))
  }
  finish(["ok": true, "message": "Filled \"\(arg(3))\" in \(name)"], 0)
case "choose":
  if !AXIsProcessTrusted() { finish(["ok": false, "code": "permission-denied", "message": "Accessibility permission is needed to choose from lists"], 3) }
  let (el, name, root) = target(arg(2), arg(3), roles: ["AXPopUpButton", "AXComboBox", "AXMenuButton"])
  if role(el) == "AXComboBox", AXUIElementSetAttributeValue(el, kAXValueAttribute as CFString, arg(4) as CFString) == .success {
    finish(["ok": true, "message": "Chose \"\(arg(4))\" in \(arg(3))"], 0)
  }
  _ = AXUIElementPerformAction(el, kAXPressAction as CFString)
  usleep(350_000)
  guard let item = find(root, arg(4), roles: ["AXMenuItem"]) else {
    _ = pressKey("escape")
    finish(["ok": false, "code": "target-missing", "message": "\"\(arg(4))\" is not in the list \"\(arg(3))\" in \(name)"], 1)
  }
  _ = AXUIElementPerformAction(item, kAXPressAction as CFString)
  finish(["ok": true, "message": "Chose \"\(arg(4))\" in \(arg(3))"], 0)
case "key":
  if !AXIsProcessTrusted() { finish(["ok": false, "code": "permission-denied", "message": "Accessibility permission is needed to press keys"], 3) }
  if !pressKey(arg(2)) { finish(["ok": false, "code": "bad-key", "message": "Unknown key \"\(arg(2))\""], 1) }
  finish(["ok": true, "message": "Pressed \(arg(2))"], 0)
default:
  finish(["ok": false, "code": "usage", "message": "Use: check | watch | press <app> <label> | settext <app> <label> <text> | choose <app> <label> <item> | key <name>"], 2)
}
