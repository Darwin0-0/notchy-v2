[CmdletBinding()]
param([switch]$Release)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$taskRoot = $PSScriptRoot
$taskCargo = (Get-Command cargo -ErrorAction Stop).Source
$taskConfiguration = if ($Release) { 'release' } else { 'debug' }
$taskBuild = Join-Path $taskRoot ('build/' + $taskConfiguration)
$taskNativeNames = @('MediaBridge.exe', 'SpectrumBridge.exe', 'OcrBridge.exe', 'CoverReader.dll', 'NAudio.dll', 'NAudio-LICENSE.txt', 'WeatherLocation.ps1')
$taskDestinations = @((Join-Path $taskBuild 'Notchy V2.exe')) + @($taskNativeNames | ForEach-Object { Join-Path $taskBuild ('native/' + $_) })
foreach ($taskDestination in $taskDestinations) {
  if (Test-Path -LiteralPath $taskDestination) {
    try { $taskProbe = [IO.File]::Open($taskDestination, 'Open', 'ReadWrite', 'None'); $taskProbe.Dispose() }
    catch { throw 'Cette compilation est utilisée ou verrouillée. Ferme cette version de Notchy avant de la reconstruire.' }
  }
}
& (Join-Path $taskRoot 'native/Build-Native.ps1')
$taskArguments = @('build', '--locked', '--target', 'x86_64-pc-windows-msvc', '--target-dir', (Join-Path $taskRoot 'src-tauri/target'), '--manifest-path', (Join-Path $taskRoot 'src-tauri/Cargo.toml'), '--bin', 'notchy-v2')
if ($Release) { $taskArguments += '--release' }
& $taskCargo @taskArguments
if ($LASTEXITCODE -ne 0) { throw 'La compilation Rust a échoué. Installe Rust MSVC x64 et les outils C++ de Visual Studio.' }
$taskCompiled = Join-Path $taskRoot ('src-tauri/target/x86_64-pc-windows-msvc/' + $taskConfiguration + '/notchy-v2.exe')
New-Item -ItemType Directory -Force -Path (Join-Path $taskBuild 'native') | Out-Null
Copy-Item -LiteralPath $taskCompiled -Destination (Join-Path $taskBuild 'Notchy V2.exe') -Force
foreach ($taskName in $taskNativeNames) {
  Copy-Item -LiteralPath (Join-Path $taskRoot ('native/bin/' + $taskName)) -Destination (Join-Path $taskBuild ('native/' + $taskName)) -Force
}
Copy-Item -LiteralPath (Join-Path $taskRoot 'THIRD_PARTY_NOTICES.md') -Destination (Join-Path $taskBuild 'THIRD_PARTY_NOTICES.md') -Force
New-Item -ItemType Directory -Force -Path (Join-Path $taskBuild 'licenses') | Out-Null
foreach ($taskName in @('manrope-OFL.txt', 'LUCIDE-LICENSE.txt')) {
  Copy-Item -LiteralPath (Join-Path $taskRoot ('assets/' + $taskName)) -Destination (Join-Path $taskBuild ('licenses/' + $taskName)) -Force
}
Write-Output ('Notchy prêt : ' + (Join-Path $taskBuild 'Notchy V2.exe'))
