import { when } from 'mobx'
import { registerAction } from 'utils/actions'
import FileTreeState from 'components/FileTree/state'
import config from 'config'
import dispatchCommand from 'commands/dispatchCommand'
import { createTab, activateTab } from 'components/Tab/actions'
import { openFile } from 'commands/commandBindings/file'
import TabState from 'components/Tab/state'
import LanguageState, { LanguageClient } from './LanguageClientState'

import { supportLangServer } from './utils/languages'

const INMEMORY = 'inmemory'
const CSHARP_METADATE = 'omnisharp-metadata'
const JDT = 'jdt'

when(() => config.spaceKey !== '', () => {
  config.__WORKSPACE_URI__ = `/data/coding-ide-home/workspace/${config.spaceKey}/working-dir`
})

export const toDefinition = registerAction('monaco:goto_definition', (params) => {
  const { resource } = params
  const { path, scheme } = resource
  if (scheme === INMEMORY) return false
  const languageClient = LanguageState.clients.get(config.mainLanguage)
  if (scheme === JDT) {
    const fileName = resource.path.split('/').pop()
    const name = fileName.endsWith('class') ? `${fileName.substr(0, fileName.length - 5)}java` : fileName
    const tabItem = TabState.tabs.get(`fake_${name}`)
    let formattedUri
    if (!resource._formatted) {
      formattedUri = resource.toString()
    } else {
      formattedUri = resource._formatted
    }
    if (tabItem) {
      tabItem.activate()
    } else {
      languageClient.fetchJavaClassContent({ uri: formattedUri })
        .then((data) => {
          createTab({
            title: name,
            id: `fake_${name}`,
            icon: 'fa fa-file-o',
            editor: {
              selection: params.options.selection,
              content: data,
              readOnly: true,
              filePath: name,
            },
          })
        })
    }
  } else if (scheme === CSHARP_METADATE) {
    const uri = decodeURIComponent(resource.toString()).replace('[metadata] ', '').replace('omnisharp-metadata://', '')
    const fileName = resource.path.split('/').pop()
    const tabItem = TabState.tabs.get(`fake_${fileName}`)
    if (tabItem) {
      tabItem.activate()
    } else {
      languageClient.fetchOmnisharpMetadata({ uri })
        .then((data) => {
          createTab({
            title: fileName,
            id: `fake_${fileName}`,
            icon: 'fa fa-file-o',
            editor: {
              selection: params.options.selection,
              content: data,
              readOnly: true,
              filePath: resource.toString(),
            },
          })
        })
    }
  } else {
    const relativePath = path.substring(config.__WORKSPACE_URI__.length)
    openFile({
      path: relativePath,
      editor: { filePath: relativePath, selection: params.options && params.options.selection },
    })
  }

  return new Promise((resolve, reject) => {
    resolve({
      getControl: () => null
    })
  })
})

/**
 * @param language 指定创建语言服务的语言类型 （java/javascript等）
 * @TODO：后续加入指定代码目录
 * 一个项目下，同一个语言只能开启一个语言服务。
 * 目前一个项目一共只能开启一个语言服务。
 * 如果手动设置了项目语言，创建并启动新的语言服务后，首先会发送 initialize，消息在服务器端对语言服务进行初始化。
 * 打开新 tab (新文件)，编辑器会首先判断已打开文件语言类型是否为已设置的项目语言，是则发送 document/didOpen 消息，正确响应后开始提供语言服务。
 */
export const createLanguageClient = registerAction('language:create_client', (language) => {
  const currentClient = LanguageState.clients.get(language)
  if ((currentClient && !currentClient.DESTROYED) || !supportLangServer.some(l => l.lang === language)) {
    return false
  }

  const newClient = new LanguageClient(language)
  LanguageState.clients.set(language, newClient)
})

export const toDefinitionForDebugger = registerAction('monaco:todefinitionfordebugger', (params) => {
  return new Promise((resolve, reject) => {
    const { path, line, name, stoppedReason } = params
    if (path.startsWith('jdt')) {
      const languageClient = LanguageState.clients.get(config.mainLanguage)
      const tabItem = TabState.tabs.get(`fake_${name}`)
      if (tabItem && tabItem.editorInfo) {
        // for debugger
        tabItem.editorInfo.debug = true
        tabItem.editorInfo.line = line
        tabItem.editorInfo.stoppedReason = stoppedReason
        tabItem.activate()

        tabItem.editorInfo.setDebugDeltaDecorations()
        resolve(`fake_${name}`)
      } else {
        languageClient.fetchJavaClassContent({ uri: path })
          .then((data) => {
            createTab({
              title: name,
              id: `fake_${name}`,
              icon: 'fa fa-file-o',
              editor: {
                // selection,
                line,
                stoppedReason,
                debug: true,
                content: data,
                readOnly: true,
                filePath: path,
              },
            })
            resolve(`fake_${name}`)
          })
      }
    } else {
      const relativePath = path.substring((path.startsWith('file://') ? `file://${config.__WORKSPACE_URI__}` : config.__WORKSPACE_URI__).length)
      openFile({ path: relativePath, editor: { filePath: relativePath, line, debug: true, stoppedReason } }, resolve)
    }
  })
})

export const cleardeltaDecorations = registerAction('monaco:cleardeltaDecorations', () => {
  const tabs = TabState.tabs.toJS()

  Object.keys(tabs).forEach((key) => {
    if (tabs[key].editorInfo) {
      tabs[key].editorInfo.clearDebugDeltaDecorations()
    }
  })
})

export const setBreakPoint = registerAction('monaco:setbreakpoints', (params) => {
  const tabs = TabState.tabs.toJS()
  Object.keys(tabs).forEach((key) => {
    const editor = tabs[key].editorInfo
    if (editor && editor.model) {
      const { model } = tabs[key].editorInfo
      if (model.uri.toString() === params.path) {
        tabs[key].editorInfo.setDebuggerBreakPoint(params)
      }
    }
  })
})

export const removeBreakPoint = registerAction('monaco:removeBreakPoint', (params) => {
  const tabs = TabState.tabs.toJS()
  Object.keys(tabs).forEach((key) => {
    const editor = tabs[key].editorInfo
    if (editor && editor.model) {
      const { model } = tabs[key].editorInfo
      if (model.uri.toString() === params.path) {
        tabs[key].editorInfo.removeDebuggerBreakPoint(params)
      }
    }
  })
})

export const updateProgressMessage = registerAction('monaco:progressMessage', (params) => {
  const { message, delay } = params
  LanguageState.message = message
  setTimeout(() => {
    LanguageState.message = ''
  }, delay || 1000)
})

export const resolveAdvancedDebuggerExpression = registerAction('monaco:debuggerexpression', (params) => {
  return new Promise((resolve, reject) => {
    toDefinitionForDebugger(params)
      .then((tabId) => {
        if (tabId) {
          const fileTab = TabState.tabs.get(tabId)
          if (!fileTab) {
            reject(null)
            return false
          }

          const { editorInfo } = fileTab
          editorInfo.setViewZoneForBreakPoint(params)
            .then(resolve)
        }
      })
  })
})
