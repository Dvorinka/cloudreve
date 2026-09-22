!macro NSIS_HOOK_PREINSTALL
  ; Ship the signed sparse identity package when the build produced one
  ; (CI signs Cloudreve-Identity.msix into package/ before bundling).
  ; Loose dev registration is the fallback inside register-identity.ps1.
  !if /FileExists "${__FILEDIR__}\..\package\Cloudreve-Identity.msix"
    File "${__FILEDIR__}\..\package\Cloudreve-Identity.msix"
  !endif
  !if /FileExists "${__FILEDIR__}\..\package\cloudreve-identity.cer"
    File "${__FILEDIR__}\..\package\cloudreve-identity.cer"
  !endif
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Register package identity so the Cloudreve Explorer context menu
  ; (windows.cloudFiles) works for non-MSIX installs. The script prefers the
  ; signed sparse package (one-time UAC for the cert trust) and falls back to
  ; unsigned loose registration under Developer Mode. Best-effort: if it
  ; fails the app retries at startup and the script can be re-run manually.
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
