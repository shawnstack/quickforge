!macro FIND_QUICKFORGE_APP _RETURN
  nsExec::Exec `"$PowerShellPath" -NoProfile -ExecutionPolicy Bypass -Command "$$installDir = [System.IO.Path]::GetFullPath($$env:QUICKFORGE_INSTALL_DIR); $$appPath = Join-Path $$installDir '${APP_EXECUTABLE_FILENAME}'; $$processes = @(Get-CimInstance -ClassName Win32_Process -ErrorAction SilentlyContinue | Where-Object { $$_.ExecutablePath -and [string]::Equals($$_.ExecutablePath, $$appPath, [System.StringComparison]::OrdinalIgnoreCase) }); if ($$processes.Count -gt 0) { exit 0 }; exit 1"`
  Pop ${_RETURN}
!macroend

!macro FIND_QUICKFORGE_INSTALL_PROCESSES _RETURN
  nsExec::Exec `"$PowerShellPath" -NoProfile -ExecutionPolicy Bypass -Command "$$installDir = [System.IO.Path]::GetFullPath($$env:QUICKFORGE_INSTALL_DIR); $$appPath = Join-Path $$installDir '${APP_EXECUTABLE_FILENAME}'; $$agentRoot = (Join-Path $$installDir 'resources\agent') + [System.IO.Path]::DirectorySeparatorChar; $$processes = @(Get-CimInstance -ClassName Win32_Process -ErrorAction SilentlyContinue | Where-Object { $$path = $$_.ExecutablePath; $$path -and ([string]::Equals($$path, $$appPath, [System.StringComparison]::OrdinalIgnoreCase) -or ($$_.Name -ieq 'qf-agent.exe' -and $$path.StartsWith($$agentRoot, [System.StringComparison]::OrdinalIgnoreCase))) }); if ($$processes.Count -gt 0) { exit 0 }; exit 1"`
  Pop ${_RETURN}
!macroend

!macro KILL_QUICKFORGE_INSTALL_PROCESSES
  nsExec::Exec `"$PowerShellPath" -NoProfile -ExecutionPolicy Bypass -Command "$$installDir = [System.IO.Path]::GetFullPath($$env:QUICKFORGE_INSTALL_DIR); $$appPath = Join-Path $$installDir '${APP_EXECUTABLE_FILENAME}'; $$agentRoot = (Join-Path $$installDir 'resources\agent') + [System.IO.Path]::DirectorySeparatorChar; Get-CimInstance -ClassName Win32_Process -ErrorAction SilentlyContinue | Where-Object { $$path = $$_.ExecutablePath; $$path -and ([string]::Equals($$path, $$appPath, [System.StringComparison]::OrdinalIgnoreCase) -or ($$_.Name -ieq 'qf-agent.exe' -and $$path.StartsWith($$agentRoot, [System.StringComparison]::OrdinalIgnoreCase))) } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
  Pop $R0
!macroend

!macro customCheckAppRunning
  System::Call 'kernel32::SetEnvironmentVariable(t, t) i("QUICKFORGE_INSTALL_DIR", "$INSTDIR").r0'

  !insertmacro FIND_QUICKFORGE_APP $R0
  ${if} $R0 == 0
    ${if} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
      DetailPrint "Closing ${PRODUCT_NAME}..."
      ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --quit-for-update'
    ${endIf}
  ${endIf}

  StrCpy $R1 0
  quickforge_graceful_wait:
    !insertmacro FIND_QUICKFORGE_INSTALL_PROCESSES $R0
    ${if} $R0 != 0
      Goto quickforge_processes_closed
    ${endIf}

    IntOp $R1 $R1 + 1
    ${if} $R1 >= 15
      Goto quickforge_force_close
    ${endIf}

    DetailPrint "Waiting for ${PRODUCT_NAME} to close..."
    Sleep 1000
    Goto quickforge_graceful_wait

  quickforge_force_close:
    DetailPrint "Force closing ${PRODUCT_NAME} and qf-agent..."
    StrCpy $R1 0

  quickforge_force_close_loop:
    !insertmacro KILL_QUICKFORGE_INSTALL_PROCESSES
    Sleep 500
    !insertmacro FIND_QUICKFORGE_INSTALL_PROCESSES $R0
    ${if} $R0 != 0
      Goto quickforge_processes_closed
    ${endIf}

    IntOp $R1 $R1 + 1
    ${if} $R1 < 10
      Goto quickforge_force_close_loop
    ${endIf}

    DetailPrint "Continuing after attempting to close remaining ${PRODUCT_NAME} processes."

  quickforge_processes_closed:
!macroend
