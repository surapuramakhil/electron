import { ipcRendererInternal } from '@electron/internal/renderer/ipc-renderer-internal'
import { webFrame } from 'electron'

const v8Util = process.atomBinding('v8_util')

const IsolatedWorldIDs = {
  /**
   * Start of extension isolated world IDs, as defined in
   * atom_render_frame_observer.h
   */
  ISOLATED_WORLD_EXTENSIONS: 1 << 20
}

let isolatedWorldIds = IsolatedWorldIDs.ISOLATED_WORLD_EXTENSIONS
const extensionWorldId: {[key: string]: number | undefined} = {}

// https://cs.chromium.org/chromium/src/extensions/renderer/script_injection.cc?type=cs&sq=package:chromium&g=0&l=52
const getIsolatedWorldIdForInstance = () => {
  // TODO(samuelmaddock): allocate and cleanup IDs
  return isolatedWorldIds++
}

// Check whether pattern matches.
// https://developer.chrome.com/extensions/match_patterns
const matchesPattern = function (pattern: string) {
  if (pattern === '<all_urls>') return true
  const regexp = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`)
  const url = `${location.protocol}//${location.host}${location.pathname}`
  return url.match(regexp)
}

// Run the code with chrome API integrated.
const runContentScript = function (this: any, extensionId: string, url: string, code: string) {
  // Assign unique world ID to each extension
  const worldId = extensionWorldId[extensionId] ||
    (extensionWorldId[extensionId] = getIsolatedWorldIdForInstance())

  // store extension ID for content script to read in isolated world
  v8Util.setHiddenValue(global, `extension-${worldId}`, extensionId)

  webFrame.setIsolatedWorldInfo(worldId, {
    name: `${extensionId} [${worldId}]`
    // TODO(samuelmaddock): read `content_security_policy` from extension manifest
    // csp: manifest.content_security_policy,
  })

  const sources = [{ code, url }]
  webFrame.executeJavaScriptInIsolatedWorld(worldId, sources)
}

const runAllContentScript = function (scripts: Array<Electron.InjectionBase>, extensionId: string) {
  for (const { url, code } of scripts) {
    runContentScript.call(window, extensionId, url, code)
  }
}

const runStylesheet = function (this: any, url: string, code: string) {
  webFrame.insertCSS(code)
}

const runAllStylesheet = function (css: Array<Electron.InjectionBase>) {
  for (const { url, code } of css) {
    runStylesheet.call(window, url, code)
  }
}

// Run injected scripts.
// https://developer.chrome.com/extensions/content_scripts
const injectContentScript = function (extensionId: string, script: Electron.ContentScript) {
  if (!process.isMainFrame && !script.allFrames) return
  if (!script.matches.some(matchesPattern)) return

  if (script.js) {
    const fire = runAllContentScript.bind(window, script.js, extensionId)
    if (script.runAt === 'document_start') {
      process.once('document-start', fire)
    } else if (script.runAt === 'document_end') {
      process.once('document-end', fire)
    } else {
      document.addEventListener('DOMContentLoaded', fire)
    }
  }

  if (script.css) {
    const fire = runAllStylesheet.bind(window, script.css)
    if (script.runAt === 'document_start') {
      process.once('document-start', fire)
    } else if (script.runAt === 'document_end') {
      process.once('document-end', fire)
    } else {
      document.addEventListener('DOMContentLoaded', fire)
    }
  }
}

// Handle the request of chrome.tabs.executeJavaScript.
ipcRendererInternal.on('CHROME_TABS_EXECUTESCRIPT', function (
  event: Electron.Event,
  senderWebContentsId: number,
  requestId: number,
  extensionId: string,
  url: string,
  code: string
) {
  const result = runContentScript.call(window, extensionId, url, code)
  ipcRendererInternal.sendToAll(senderWebContentsId, `CHROME_TABS_EXECUTESCRIPT_RESULT_${requestId}`, result)
})

module.exports = (getRenderProcessPreferences: typeof process.getRenderProcessPreferences) => {
  // Read the renderer process preferences.
  const preferences = getRenderProcessPreferences()
  if (preferences) {
    for (const pref of preferences) {
      if (pref.contentScripts) {
        for (const script of pref.contentScripts) {
          injectContentScript(pref.extensionId, script)
        }
      }
    }
  }
}
