/**
 * 渲染进程 → 主进程「开机自启动」窄桥的请求解析与登录项参数推导（纯函数）。
 *
 * 与 browser/ipc-contract.mjs 同一条安全线：渲染进程里任何代码都能调桥，所以按白名单
 * 逐字段校验 —— 多一个键、少一个键、类型不对一律丢弃，主进程只处理解析成功的请求。
 *
 * 登录项的「读」和「写」必须由同一个函数产出同一份 path/args，这不是风格问题：
 * Electron 在 Windows 上按 path + 参数匹配注册表启动项，用默认参数（path=execPath、
 * args=[]）去读一条带 --hidden 的项永远读到 false，开关就会点完自己弹回去；
 * 关闭时用默认参数也删不掉带参数的项，用户关不掉自启动。把两边收在一处，测试才挡得住。
 *
 * 单独成模块的原因与 browser/ipc-contract.mjs 相同：electron-main.mjs 依赖 electron，
 * 无法被单测直接导入。
 */

/** 只有这两个平台的系统登录项能由 Electron 读写（Linux 上 setLoginItemSettings 是空实现）。 */
export const AUTOSTART_SUPPORTED_PLATFORMS = ['win32', 'darwin']

/** 开机自启动拉起时带上的参数：本次只驻留托盘，不弹主窗口。 */
export const AUTOSTART_HIDDEN_ARGUMENT = '--hidden'

export function isAutostartSupported(platform = process.platform) {
  return AUTOSTART_SUPPORTED_PLATFORMS.includes(platform)
}

export function parseAutostartRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const keys = Object.keys(value)
  if (value.type === 'get-state') {
    return keys.length === 1 ? { type: 'get-state' } : null
  }
  if (value.type !== 'set-enabled') return null
  if (keys.length !== 2 || typeof value.enabled !== 'boolean') return null
  return { type: 'set-enabled', enabled: value.enabled }
}

/**
 * 登录项要指向哪个可执行文件。
 *
 * portable 版每次启动都解包到新的临时目录，process.execPath 指向那个临时文件，写进
 * 登录项后下次开机就失效了；electron-builder 在 portable 模式把原始 exe 路径放在
 * PORTABLE_EXECUTABLE_FILE 环境变量里。
 */
export function resolveLoginItemPath({ executablePath, portableExecutableFile } = {}) {
  if (typeof portableExecutableFile === 'string' && portableExecutableFile.trim() !== '') return portableExecutableFile
  return typeof executablePath === 'string' && executablePath.trim() !== '' ? executablePath : ''
}

/** 读取登录项状态时要传的匹配参数（必须与 buildLoginItemSettings 写入的一致）。 */
export function buildLoginItemQuery({ platform = process.platform, executablePath, portableExecutableFile } = {}) {
  if (platform !== 'win32') return {}
  const path = resolveLoginItemPath({ executablePath, portableExecutableFile })
  if (!path) return {}
  return { path, args: [AUTOSTART_HIDDEN_ARGUMENT] }
}

/** 写入登录项时要传的参数；关闭时同样带上 path/args，否则删不掉先前写入的那一项。 */
export function buildLoginItemSettings({ enabled, platform = process.platform, executablePath, portableExecutableFile } = {}) {
  const openAtLogin = enabled === true
  if (platform !== 'win32') return { openAtLogin }
  const path = resolveLoginItemPath({ executablePath, portableExecutableFile })
  if (!path) return { openAtLogin }
  return { openAtLogin, path, args: [AUTOSTART_HIDDEN_ARGUMENT] }
}

/**
 * 本次启动是否由「开机自启动」拉起、应只驻留托盘。
 *
 * Windows 靠我们写进登录项的命令行参数判断；macOS 登录项不接受自定义参数，
 * 改用 getLoginItemSettings() 的 wasOpenedAtLogin。
 */
export function shouldStartHidden({ platform = process.platform, argv = [], loginItemSettings = null } = {}) {
  if (Array.isArray(argv) && argv.includes(AUTOSTART_HIDDEN_ARGUMENT)) return true
  if (platform === 'darwin' && loginItemSettings?.wasOpenedAtLogin === true) return true
  return false
}
