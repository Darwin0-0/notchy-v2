[CmdletBinding()]
param([switch]$Release)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$taskRoot = $PSScriptRoot
$taskCargo = (Get-Command cargo -ErrorAction Stop).Source
$taskConfiguration = if ($Release) { 'release' } else { 'debug' }
$taskBuild = Join-Path $taskRoot ('build/' + $taskConfiguration)
$taskTarget = Join-Path $taskRoot 'src-tauri/target'
$taskTargetNote = Join-Path $taskRoot '.development/target-dir.txt'
if (Test-Path -LiteralPath $taskTargetNote -PathType Leaf) { $taskTarget = (Get-Content -LiteralPath $taskTargetNote -Raw).Trim() }
$taskNode = if ($env:NOTCHY_NODE) { $env:NOTCHY_NODE } else { (Get-Command node -ErrorAction Stop).Source }
& $taskNode (Join-Path $taskRoot 'scripts/check-storage.cjs') '--guard' '--target' $taskTarget
if ($LASTEXITCODE -ne 0) { throw 'Stockage a verifier avant compilation ; aucun nettoyage sans nouvel accord.' }
$taskNativeNames = @('MediaBridge.exe', 'SpectrumBridge.exe', 'OcrBridge.exe', 'CoverReader.dll', 'NAudio.dll', 'NAudio-LICENSE.txt', 'WeatherLocation.ps1', 'QuickLookPdfCompatibility.zip', 'NotchyOfficePreview.zip')
$taskDestinations = @((Join-Path $taskBuild 'Notchy V2.exe')) + @($taskNativeNames | ForEach-Object { Join-Path $taskBuild ('native/' + $_) })
foreach ($taskDestination in $taskDestinations) {
  if (Test-Path -LiteralPath $taskDestination) {
    try { $taskProbe = [IO.File]::Open($taskDestination, 'Open', 'ReadWrite', 'None'); $taskProbe.Dispose() }
    catch { throw 'Cette compilation est utilisée ou verrouillée. Ferme cette version de Notchy avant de la reconstruire.' }
  }
}
if (-not (Test-Path -LiteralPath (Join-Path $taskRoot 'native/bin/QuickLookPdfCompatibility.zip') -PathType Leaf)) {
  throw 'Prépare le correctif PDF avant la compilation : voir native/quicklook-compat/README.md et Build-PdfCompatibility.ps1.'
}
if (-not (Test-Path -LiteralPath (Join-Path $taskRoot 'native/bin/NotchyOfficePreview.zip') -PathType Leaf)) {
  throw 'Prépare la passerelle Office avant la compilation : voir native/office-preview/README.md et Build-OfficePreview.ps1.'
}
& (Join-Path $taskRoot 'native/Build-Native.ps1')
$taskArguments = @('build', '--locked', '--target', 'x86_64-pc-windows-msvc', '--target-dir', $taskTarget, '--manifest-path', (Join-Path $taskRoot 'src-tauri/Cargo.toml'), '--bin', 'notchy-v2')
if ($Release) { $taskArguments += '--release' }
& $taskCargo @taskArguments
if ($LASTEXITCODE -ne 0) { throw 'La compilation Rust a échoué. Installe Rust MSVC x64 et les outils C++ de Visual Studio.' }
$taskCompiled = Join-Path $taskTarget ('x86_64-pc-windows-msvc/' + $taskConfiguration + '/notchy-v2.exe')
New-Item -ItemType Directory -Force -Path (Join-Path $taskBuild 'native') | Out-Null
Copy-Item -LiteralPath $taskCompiled -Destination (Join-Path $taskBuild 'Notchy V2.exe') -Force
foreach ($taskName in $taskNativeNames) {
  Copy-Item -LiteralPath (Join-Path $taskRoot ('native/bin/' + $taskName)) -Destination (Join-Path $taskBuild ('native/' + $taskName)) -Force
}
Copy-Item -LiteralPath (Join-Path $taskRoot 'THIRD_PARTY_NOTICES.md') -Destination (Join-Path $taskBuild 'THIRD_PARTY_NOTICES.md') -Force
New-Item -ItemType Directory -Force -Path (Join-Path $taskBuild 'licenses') | Out-Null
foreach ($taskName in @('manrope-OFL.txt', 'LUCIDE-LICENSE.txt', 'duration-FONT-LICENSE.txt', 'HankenGrotesk-OFL.txt')) {
  Copy-Item -LiteralPath (Join-Path $taskRoot ('assets/' + $taskName)) -Destination (Join-Path $taskBuild ('licenses/' + $taskName)) -Force
}
Write-Output ('Notchy prêt : ' + (Join-Path $taskBuild 'Notchy V2.exe'))
& $taskNode (Join-Path $taskRoot 'scripts/check-storage.cjs') '--target' $taskTarget
if ($LASTEXITCODE -ne 0) { throw 'Compilation conservee ; bilan de stockage a verifier.' }
