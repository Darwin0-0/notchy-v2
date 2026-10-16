!macro NSIS_HOOK_POSTUNINSTALL
  ; Updates keep startup enabled; removing a different portable copy must not change it.
  ${If} $UpdateMode != 1
    Push $0
    ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Notchy V2"
    ${If} $0 == '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" --autostart'
      DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Notchy V2"
    ${EndIf}
    Pop $0
  ${EndIf}
!macroend
