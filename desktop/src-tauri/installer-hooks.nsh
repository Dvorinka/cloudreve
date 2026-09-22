!macro NSIS_HOOK_POSTINSTALL
  ; Register sparse package identity so the Cloudreve Explorer context
  ; menu (windows.cloudFiles) works for non-MSIX installs. Best-effort:
  ; unsigned loose registration requires Developer Mode or sideloading;
  ; if it fails the app retries at startup and register-identity.ps1 can
  ; be re-run manually.
  IfFileExists "$INSTDIR\register-identity.ps1" 0 +4
  nsExec::ExecToStack 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\register-identity.ps1" -InstallDir "$INSTDIR"'
  Pop $0
  Pop $1
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Files are gone by this point, so unregister the package inline.
  nsExec::ExecToStack 'powershell.exe -NoProfile -NonInteractive -Command "Get-AppxPackage -Name 2106abslant.Cloudreve | Remove-AppxPackage"'
  Pop $0
  Pop $1
!macroend
