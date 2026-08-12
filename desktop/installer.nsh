; ============================================================================
; QuickForge 安装器自定义逻辑（electron-builder NSIS include）
; 行为说明（2026-08 重写，仅加诊断日志，不改既有行为）：
;   1) 升级/安装前清理运行中的旧应用进程（--quit-for-update + 15s 等待 + 强杀）
;   2) 全程写诊断日志到 $TEMP\QuickForge-installer.log（UTF-16LE，无 BOM）
;      查看方式：PowerShell: Get-Content "$env:TEMP\QuickForge-installer.log" -Encoding Unicode
;   3) customUnInstallCheck / customUnInstallCheckCurrentUser 钩子：
;      记录旧版本卸载器（uninstallOldVersion）最终退出码 $R0，并复刻模板默认
;      行为（失败时弹 $(uninstallFailed) 并中止安装），用于坐实
;      "QuickForge 无法关闭" 弹窗是否来自旧卸载器 6 次失败链路。
; ============================================================================

; --- 诊断日志宏 ------------------------------------------------------------
; 追加一行到 $TEMP\QuickForge-installer.log，带相对毫秒时间戳（GetTickCount）。
; 使用 $R1(时间戳)/$R2(句柄)/$R3(临时)，并 Push/Pop 保护，避免破坏调用点。
!macro QF_LOG _MSG
  Push $R1
  Push $R2
  Push $R3
  ; 先固化消息文本到 $R3，再取时间戳；否则消息里引用的 $R1（如轮数）会被时间戳污染。
  StrCpy $R3 "${_MSG}"
  System::Call 'kernel32::GetTickCount() i.R1'
  FileOpen $R2 "$TEMP\QuickForge-installer.log" a
  FileSeek $R2 0 END
  FileWrite $R2 "[t=$R1 ms] $R3$\r$\n"
  FileClose $R2
  Pop $R3
  Pop $R2
  Pop $R1
!macroend

; --- 初始化日志（.onInit 中 initMultiUser 之后执行） -----------------------
!macro customInit
  FileOpen $R2 "$TEMP\QuickForge-installer.log" w
  FileSeek $R2 0 END
  FileWrite $R2 "QuickForge installer diagnostic log$\r$\n"
  FileWrite $R2 "Encoding: UTF-16LE (no BOM). View with PowerShell: Get-Content -Encoding Unicode <log path below>$\r$\n"
  FileWrite $R2 "Log path: $TEMP\QuickForge-installer.log$\r$\n"
  FileWrite $R2 "==================================================================$\r$\n"
  nsExec::ExecToStack `cmd /c echo %date% %time%`
  Pop $R3
  Pop $R1
  FileWrite $R2 "Started (wall clock): $R1$\r$\n"
  System::Call 'kernel32::GetCurrentProcessId() i.R1'
  FileWrite $R2 "Installer PID: $R1$\r$\n"
  FileWrite $R2 "Product: ${PRODUCT_NAME}, version: ${VERSION}$\r$\n"
  ${If} ${UAC_IsInnerInstance}
    FileWrite $R2 "UAC inner (elevated) instance: yes$\r$\n"
  ${Else}
    FileWrite $R2 "UAC inner (elevated) instance: no$\r$\n"
  ${EndIf}
  FileWrite $R2 "Install mode: $installMode$\r$\n"
  ${If} ${Silent}
    FileWrite $R2 "Silent: yes$\r$\n"
  ${Else}
    FileWrite $R2 "Silent: no$\r$\n"
  ${EndIf}
  FileWrite $R2 "Target dir: $INSTDIR$\r$\n"
  FileWrite $R2 "==================================================================$\r$\n"
  FileClose $R2
  !insertmacro QF_LOG "customInit: diagnostic log initialized"
!macroend

; --- 探测：主程序精确匹配（$INSTDIR\app.exe） ------------------------------
; 返回值（退出码）: 0 = 有匹配进程, 1 = 无；明细经 stdout 传回写入日志。
; $INSTDIR 直接内嵌为 PowerShell 单引号字面量（不依赖环境变量传递）。
!macro FIND_QUICKFORGE_APP _RETURN
  nsExec::ExecToStack `"$PowerShellPath" -NoProfile -ExecutionPolicy Bypass -Command "$$appPath = '$INSTDIR\${APP_EXECUTABLE_FILENAME}'; $$processes = @(Get-CimInstance -ClassName Win32_Process -ErrorAction SilentlyContinue | Where-Object { $$_.ExecutablePath -and [string]::Equals($$_.ExecutablePath, $$appPath, [System.StringComparison]::OrdinalIgnoreCase) }); if ($$processes.Count -gt 0) { Write-Output ((($$processes | ForEach-Object { 'pid=' + $$_.ProcessId + ' name=' + $$_.Name + ' path=' + $$_.ExecutablePath }) -join ' ; ')); exit 0 }; exit 1"`
  Pop $R2
  Pop $R3
  ${if} $R3 != ""
    !insertmacro QF_LOG "Main app probe: $R3"
  ${endIf}
  StrCpy ${_RETURN} $R2
!macroend

; --- 探测：安装目录前缀匹配的进程（含 agent 等子进程，排除安装器自身） -----
!macro FIND_QUICKFORGE_INSTALL_PROCESSES _RETURN
  System::Call 'kernel32::GetCurrentProcessId() i.R9'
  nsExec::ExecToStack `"$PowerShellPath" -NoProfile -ExecutionPolicy Bypass -Command "$$installPrefix = '$INSTDIR'.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar; $$processes = @(Get-CimInstance -ClassName Win32_Process -ErrorAction SilentlyContinue | Where-Object { $$path = $$_.ExecutablePath; $$path -and $$_.ProcessId -ne $R9 -and $$path.StartsWith($$installPrefix, [System.StringComparison]::OrdinalIgnoreCase) }); if ($$processes.Count -gt 0) { Write-Output ((($$processes | ForEach-Object { 'pid=' + $$_.ProcessId + ' name=' + $$_.Name + ' path=' + $$_.ExecutablePath }) -join ' ; ')); exit 0 }; exit 1"`
  Pop $R2
  Pop $R3
  ${if} $R3 != ""
    !insertmacro QF_LOG "Install-dir process probe: $R3"
  ${endIf}
  StrCpy ${_RETURN} $R2
!macroend

; --- 强杀：安装目录前缀匹配的进程，逐条记录结果 ----------------------------
; 注意覆盖盲区：node-pty 终端子进程（System32 下 cmd.exe/powershell.exe）
; 不在前缀匹配范围内，若日志显示无残留但旧卸载器仍失败，即指向该盲区或文件锁。
!macro KILL_QUICKFORGE_INSTALL_PROCESSES
  System::Call 'kernel32::GetCurrentProcessId() i.R9'
  nsExec::ExecToStack `"$PowerShellPath" -NoProfile -ExecutionPolicy Bypass -Command "$$installPrefix = '$INSTDIR'.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar; $$processes = @(Get-CimInstance -ClassName Win32_Process -ErrorAction SilentlyContinue | Where-Object { $$path = $$_.ExecutablePath; $$path -and $$_.ProcessId -ne $R9 -and $$path.StartsWith($$installPrefix, [System.StringComparison]::OrdinalIgnoreCase) }); $$killed = @(); $$failed = @(); foreach ($$p in $$processes) { try { Stop-Process -Id $$p.ProcessId -Force -ErrorAction Stop; $$killed += 'pid=' + $$p.ProcessId + ' name=' + $$p.Name } catch { $$failed += 'pid=' + $$p.ProcessId + ' name=' + $$p.Name + ' err=' + $$_.Exception.Message } }; $$msg = ''; if ($$killed.Count -gt 0) { $$msg += 'killed[' + $$killed.Count + ']: ' + ($$killed -join ' ; ') }; if ($$failed.Count -gt 0) { $$msg += ' failed[' + $$failed.Count + ']: ' + ($$failed -join ' ; ') }; if ($$msg -ne '') { Write-Output $$msg }"`
  Pop $R2
  Pop $R3
  ${if} $R3 != ""
    !insertmacro QF_LOG "Kill results: $R3"
  ${endIf}
!macroend

; --- 运行进程检查（模板 CHECK_APP_RUNNING 的自定义实现，无内置弹窗） -------
!macro customCheckAppRunning
  !insertmacro QF_LOG "customCheckAppRunning: start, installDir=$INSTDIR, exe=${APP_EXECUTABLE_FILENAME}"

  !insertmacro FIND_QUICKFORGE_APP $R0
  ${if} $R0 == 0
    ${if} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
      DetailPrint "Closing ${PRODUCT_NAME}..."
      !insertmacro QF_LOG "ExecWait --quit-for-update (sync wait; if app quit hangs, installer blocks here)"
      ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --quit-for-update'
      !insertmacro QF_LOG "--quit-for-update returned"
    ${else}
      !insertmacro QF_LOG "App exe not found: $INSTDIR\${APP_EXECUTABLE_FILENAME}"
    ${endIf}
  ${else}
    !insertmacro QF_LOG "Main app not running (exact path probe found nothing)"
  ${endIf}

  ; 优雅退出等待：最多 15 轮（约 15 秒）
  StrCpy $R1 0
  quickforge_graceful_wait:
    !insertmacro FIND_QUICKFORGE_INSTALL_PROCESSES $R0
    ${if} $R0 != 0
      !insertmacro QF_LOG "All install-dir processes closed after $R1 poll(s)"
      Goto quickforge_processes_closed
    ${endIf}

    IntOp $R1 $R1 + 1
    ${if} $R1 >= 15
      !insertmacro QF_LOG "Graceful wait timed out after $R1 s; switching to force kill"
      Goto quickforge_force_close
    ${endIf}

    DetailPrint "Waiting for ${PRODUCT_NAME} to close..."
    Sleep 1000
    Goto quickforge_graceful_wait

  ; 强杀：最多 10 轮（每轮 kill + 500ms 观察）
  quickforge_force_close:
    DetailPrint "Force closing remaining ${PRODUCT_NAME} processes..."
    StrCpy $R1 0

  quickforge_force_close_loop:
    !insertmacro QF_LOG "Force-kill round (counter=$R1)"
    !insertmacro KILL_QUICKFORGE_INSTALL_PROCESSES
    Sleep 500
    !insertmacro FIND_QUICKFORGE_INSTALL_PROCESSES $R0
    ${if} $R0 != 0
      !insertmacro QF_LOG "All processes closed after force-kill round"
      Goto quickforge_processes_closed
    ${endIf}

    IntOp $R1 $R1 + 1
    ${if} $R1 < 10
      Goto quickforge_force_close_loop
    ${endIf}

    !insertmacro QF_LOG "Gave up after 10 force-kill rounds; continuing installation anyway"
    DetailPrint "Continuing after attempting to close remaining ${PRODUCT_NAME} processes."

  quickforge_processes_closed:
    !insertmacro QF_LOG "customCheckAppRunning: done"
!macroend

; --- 旧版本卸载器结果钩子（SHELL_CONTEXT） ---------------------------------
; 失败不再中止安装：旧卸载器（尤其 --updated 原子移动模式）在 Defender 扫描
; 或目录缺失时必然失败，直接改为继续覆盖安装（自愈：新包覆盖旧文件、补齐缺失目录）。
!macro customUnInstallCheck
  !insertmacro QF_LOG "handleUninstallResult(SHELL_CONTEXT): old uninstaller exit code = $R0"
  IfErrors 0 +3
  DetailPrint `Uninstall was not successful. Not able to launch uninstaller!`
  Return

  ${if} $R0 != 0
    !insertmacro QF_LOG "SHELL_CONTEXT uninstall FAILED (code $R0) -> continuing with overwrite install (self-heal); leftover files overwritten by new package, missing dirs restored by fresh install"
    DetailPrint `Old uninstaller failed (code $R0). Continuing with overwrite install...`
  ${else}
    !insertmacro QF_LOG "SHELL_CONTEXT uninstall OK"
  ${endIf}
!macroend

; --- 旧版本卸载器结果钩子（HKEY_CURRENT_USER，per-machine 双通道时使用） ----
!macro customUnInstallCheckCurrentUser
  !insertmacro QF_LOG "handleUninstallResult(HKCU): old uninstaller exit code = $R0"
  IfErrors 0 +3
  DetailPrint `Uninstall was not successful. Not able to launch uninstaller!`
  Return

  ${if} $R0 != 0
    !insertmacro QF_LOG "HKCU uninstall FAILED (code $R0) -> continuing with overwrite install (self-heal)"
    DetailPrint `Old uninstaller failed (code $R0). Continuing with overwrite install...`
  ${else}
    !insertmacro QF_LOG "HKCU uninstall OK"
  ${endIf}
!macroend
