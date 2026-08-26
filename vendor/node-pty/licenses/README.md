# Third-party licenses for vendored node-pty binaries

`node-pty` 本体与 `prebuilds/` 中的二进制按上游 `LICENSE`（MIT）再分发。
npm 发布包内不含以下第三方组件的许可文本，故在此随 vendor 目录一并分发：

- `winpty-LICENSE.txt` — 覆盖 `win32-*/winpty.dll`、`win32-*/winpty-agent.exe`
  （winpty 兜底后端，来自 [rprichard/winpty](https://github.com/rprichard/winpty)，MIT）。
- `conpty-LICENSE.txt` — 覆盖 `win32-*/conpty/conpty.dll`、`win32-*/conpty/OpenConsole.exe`
  （ConPTY 组件，来自 [microsoft/terminal](https://github.com/microsoft/terminal)，MIT）。

darwin 平台仅含 `pty.node`，由 node-pty 本体源码构建，适用上游根 `LICENSE`。
