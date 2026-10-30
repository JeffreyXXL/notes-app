const { contextBridge, ipcRenderer } = require('electron');

/**
 * 只暴露一个 invoke，命令名和参数跟 Tauri 侧完全一致，
 * 这样前端存储层（src/storage/desktop.ts）两个外壳共用一份代码。
 *
 * platform 用来决定要不要画右上角的窗口按钮：macOS 保留系统红绿灯，
 * Windows / Linux 是无边框窗口，必须自己画。
 */
contextBridge.exposeInMainWorld('notesBridge', {
  platform: process.platform,
  invoke: (cmd, args) => ipcRenderer.invoke(cmd, args),
  onWinState: cb => {
    ipcRenderer.on('win_state', (_e, isMax) => cb(!!isMax));
  }
});
