; Ship the signed sparse identity package when the build produced one (CI
; signs Cloudreve-Identity.msix into package/ before bundling). __FILEDIR__
; must be read at parse time in this include - inside a macro it resolves to
; the invoking .nsi's directory, not this file's.
!if /FileExists "${__FILEDIR__}\..\package\Cloudreve-Identity.msix"
  !define CLOUDREVE_IDENTITY_MSIX "${__FILEDIR__}\..\package\Cloudreve-Identity.msix"
!endif
!if /FileExists "${__FILEDIR__}\..\package\cloudreve-identity.cer"
  !define CLOUDREVE_IDENTITY_CER "${__FILEDIR__}\..\package\cloudreve-identity.cer"
!endif

!macro NSIS_HOOK_PREINSTALL
  !ifdef CLOUDREVE_IDENTITY_MSIX
    File "${CLOUDREVE_IDENTITY_MSIX}"
  !endif
  !ifdef CLOUDREVE_IDENTITY_CER
    File "${CLOUDREVE_IDENTITY_CER}"
  !endif
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Register package identity so the Cloudreve Explorer context menu
  ; (windows.cloudFiles) works for non-MSIX installs. The PowerShell path runs
  ; first on purpose: a damaged leftover registration (e.g. an update that
  ; moved the install dir the sparse package's ExternalLocation pointed at)
  ; can block the exe from even starting via its embedded <msix> binding, so
  ; a repair that needs the exe would never run. register-identity.ps1 removes
  ; damaged registrations, trusts the signing cert (elevating once if needed),
  ; and installs the sparse package - all without the exe. The native
  ; --install-identity call stays as backstop. Both are best-effort; the app
  ; also retries at startup.
  nsExec::ExecToStack 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\register-identity.ps1" -InstallDir "$INSTDIR"'
  Pop $0
  Pop $1
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
