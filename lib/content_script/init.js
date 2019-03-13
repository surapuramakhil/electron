'use strict'

/* global nodeProcess, isolatedWorld, worldId */

const { EventEmitter } = require('events')

process.atomBinding = require('@electron/internal/common/atom-binding-setup').atomBindingSetup(nodeProcess.binding, 'renderer')

const v8Util = process.atomBinding('v8_util')
// The `lib/renderer/ipc-renderer-internal.js` module looks for the ipc object in the
// "ipc-internal" hidden value
v8Util.setHiddenValue(global, 'ipc-internal', new EventEmitter())
// The process object created by browserify is not an event emitter, fix it so
// the API is more compatible with non-sandboxed renderers.
for (const prop of Object.keys(EventEmitter.prototype)) {
  if (process.hasOwnProperty(prop)) {
    delete process[prop]
  }
}
Object.setPrototypeOf(process, EventEmitter.prototype)

const isolatedWorldArgs = v8Util.getHiddenValue(isolatedWorld, 'isolated-world-args')

if (isolatedWorldArgs) {
  const { ipcRendererInternal, guestInstanceId, isHiddenPage, openerId, usesNativeWindowOpen } = isolatedWorldArgs
  const { windowSetup } = require('@electron/internal/renderer/window-setup')
  windowSetup(ipcRendererInternal, guestInstanceId, openerId, isHiddenPage, usesNativeWindowOpen)
}

const extensionId = v8Util.getHiddenValue(isolatedWorld, `extension-${worldId}`)

if (extensionId) {
  const chromeAPI = require('@electron/internal/renderer/chrome-api')
  chromeAPI.injectTo(extensionId, false, window)
}
