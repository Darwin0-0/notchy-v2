[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not [Environment]::Is64BitOperatingSystem -or -not [Environment]::Is64BitProcess) {
  throw 'Utilise PowerShell 64 bits sur Windows x64 pour compiler les composants Windows.'
}

$taskFramework = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319'
$taskMetadata = Join-Path $env:WINDIR 'System32/WinMetadata'
$taskCompiler = Join-Path $taskFramework 'csc.exe'
$taskOutput = Join-Path $PSScriptRoot 'bin'
$taskBase = @('mscorlib.dll', 'System.dll', 'System.Core.dll') | ForEach-Object { Join-Path $taskFramework $_ }
$taskWinRT = @('System.Runtime.dll', 'System.Runtime.WindowsRuntime.dll', 'System.Runtime.InteropServices.WindowsRuntime.dll') | ForEach-Object { Join-Path $taskFramework $_ }
$taskBuilds = @(
  @{ Name = 'CoverReader.dll'; Source = 'CoverReader.cs'; Target = 'library'; References = @($taskWinRT) + @((Join-Path $taskMetadata 'Windows.Foundation.winmd'), (Join-Path $taskMetadata 'Windows.Storage.winmd')) },
  @{ Name = 'MediaBridge.exe'; Source = 'MediaBridge.cs'; Target = 'exe'; References = @($taskWinRT) + @((Join-Path $taskFramework 'System.Web.Extensions.dll'), (Join-Path $taskMetadata 'Windows.Foundation.winmd'), (Join-Path $taskMetadata 'Windows.Media.winmd'), (Join-Path $taskMetadata 'Windows.Storage.winmd'), (Join-Path $taskMetadata 'Windows.ApplicationModel.winmd')); BuiltReferences = @((Join-Path $taskOutput 'CoverReader.dll')) },
  @{ Name = 'SpectrumBridge.exe'; Source = 'SpectrumBridge.cs'; Target = 'exe'; References = @((Join-Path $PSScriptRoot 'NAudio.dll')) },
  @{ Name = 'OcrBridge.exe'; Source = 'OcrBridge.cs'; Target = 'exe'; References = @($taskWinRT) + @((Join-Path $taskFramework 'System.Web.Extensions.dll'), (Join-Path $taskMetadata 'Windows.Foundation.winmd'), (Join-Path $taskMetadata 'Windows.Storage.winmd'), (Join-Path $taskMetadata 'Windows.Media.winmd'), (Join-Path $taskMetadata 'Windows.Graphics.winmd'), (Join-Path $taskMetadata 'Windows.Globalization.winmd'), (Join-Path $taskMetadata 'Windows.Data.winmd')) }
)
$taskInputs = @($taskCompiler, (Join-Path $PSScriptRoot 'NAudio.dll'), (Join-Path $PSScriptRoot 'NAudio-LICENSE.txt'), (Join-Path $PSScriptRoot 'WeatherLocation.ps1')) + @($taskBase)
foreach ($taskBuild in $taskBuilds) {
  $taskInputs += @(Join-Path $PSScriptRoot $taskBuild.Source) + @($taskBuild.References)
}
foreach ($taskInput in ($taskInputs | Select-Object -Unique)) {
  if (-not (Test-Path -LiteralPath $taskInput -PathType Leaf)) {
    throw "Prérequis de compilation manquant : $taskInput. Installe Windows 10/11 x64 et .NET Framework 4.x."
  }
}
# A running application keeps its binaries intact; close it before rebuilding this folder.
foreach ($taskName in @('CoverReader.dll', 'MediaBridge.exe', 'SpectrumBridge.exe', 'OcrBridge.exe', 'NAudio.dll')) {
  $taskDestination = Join-Path $taskOutput $taskName
  if (Test-Path -LiteralPath $taskDestination) {
    try { $taskProbe = [IO.File]::Open($taskDestination, 'Open', 'ReadWrite', 'None'); $taskProbe.Dispose() }
    catch { throw "Composant utilisé ou verrouillé : $taskName. Ferme cette version de Notchy avant de la recompiler." }
  }
}
New-Item -ItemType Directory -Force -Path $taskOutput | Out-Null
foreach ($taskName in @('NAudio.dll', 'NAudio-LICENSE.txt', 'WeatherLocation.ps1')) {
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot $taskName) -Destination (Join-Path $taskOutput $taskName) -Force
}
foreach ($taskBuild in $taskBuilds) {
  $taskReferences = @($taskBase) + @($taskBuild.References)
  if ($taskBuild.ContainsKey('BuiltReferences')) { $taskReferences += @($taskBuild.BuiltReferences) }
  $taskArguments = @('/noconfig', '/nologo', ('/target:' + $taskBuild.Target), '/platform:x64', '/optimize+', '/debug-', ('/out:' + (Join-Path $taskOutput $taskBuild.Name)))
  $taskArguments += @($taskReferences | ForEach-Object { '/reference:' + $_ })
  $taskArguments += (Join-Path $PSScriptRoot $taskBuild.Source)
  & $taskCompiler @taskArguments
  if ($LASTEXITCODE -ne 0) { throw ('Compilation Windows échouée : ' + $taskBuild.Name) }
  if (-not (Test-Path -LiteralPath (Join-Path $taskOutput $taskBuild.Name) -PathType Leaf)) {
    throw ('Fichier non produit par le compilateur : ' + $taskBuild.Name)
  }
}
Write-Output ('Composants Windows prêts : ' + $taskOutput)
