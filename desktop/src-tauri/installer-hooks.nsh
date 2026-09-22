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
  ; (windows.cloudFiles) works for non-MSIX installs. The exe does this
  ; natively via PackageManager: installs the shipped signed sparse package,
  ; self-elevating a hidden child for the one-time cert trust (a single UAC
  ; prompt, no console window), and falls back to loose Developer Mode
  ; registration. Best-effort: the app retries at startup and
  ; register-identity.ps1 can be run manually.
  nsExec::ExecToStack '"$INSTDIR\cloudreve-desktop.exe" --install-identity'
  Pop $0
  Pop $1
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Files are gone by this point, so unregister the package inline.
  nsExec::ExecToStack 'powershell.exe -NoProfile -NonInteractive -Command "Get-AppxPackage -Name 2106abslant.Cloudreve | Remove-AppxPackage"'
  Pop $0
  Pop $1
!macroend
