[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$taskBridge = Join-Path $PSScriptRoot '../native/bin/MediaBridge.exe'
if (-not (Test-Path -LiteralPath $taskBridge -PathType Leaf)) { throw 'Build the Windows helpers with native/Build-Native.ps1 first.' }
$taskType = [Reflection.Assembly]::LoadFrom((Resolve-Path -LiteralPath $taskBridge).Path).GetType('MediaBridge', $true)
$taskFlags = [Reflection.BindingFlags]'NonPublic, Static'
function Invoke-TaskMediaMethod([string]$Name, [object[]]$Arguments) {
  return $taskType.GetMethod($Name, $taskFlags).Invoke($null, $Arguments)
}
function Assert-TaskMediaEqual($Actual, $Expected, [string]$Context) {
  if ($Actual -cne $Expected) { throw "$Context failed: expected '$Expected', received '$Actual'." }
}
function Assert-TaskMediaSelection([bool[]]$Usable, [bool[]]$Playing, [int]$Current, [int]$Previous, [int]$Expected, [string]$Context) {
  Assert-TaskMediaEqual (Invoke-TaskMediaMethod 'SelectSessionIndex' @($Usable, $Playing, $Current, $Previous)) $Expected $Context
}

Assert-TaskMediaSelection @($true, $true) @($false, $true) 0 0 1 'Playing browser replaces paused Spotify'
Assert-TaskMediaSelection @($true, $true) @($true, $true) 1 0 1 'Playing Windows current session wins'
Assert-TaskMediaSelection @($true, $true, $true) @($true, $false, $true) 1 2 2 'Stable playing selection survives unrelated events'
Assert-TaskMediaSelection @($true, $false) @($true, $true) 1 1 0 'Disappeared or closed selected player falls back'
Assert-TaskMediaSelection @($true, $true) @($false, $false) 1 0 1 'Current paused session can resume'
Assert-TaskMediaSelection @($true, $true) @($false, $false) -1 1 1 'Previous paused session is retained without Windows current'
Assert-TaskMediaSelection @($false) @($true) 0 0 -1 'Closed sessions never become available'
Assert-TaskMediaSelection @() @() -1 -1 -1 'No session stays empty'

foreach ($taskCase in @(
  @('SpotifyAB.SpotifyMusic_example!Spotify', 'Spotify'),
  @('C:\Program Files\VideoLAN\VLC\vlc.exe', 'VLC'),
  @('MSEdge', 'Microsoft Edge'),
  @('chrome.exe', 'Google Chrome'),
  @('Microsoft.ZuneMusic_example!Microsoft.ZuneMusic', 'Windows Media Player'),
  @('UnknownPlayer.example', 'Windows Media')
)) {
  Assert-TaskMediaEqual (Invoke-TaskMediaMethod 'SourceName' @($taskCase[0])) $taskCase[1] 'Actual application identity'
}
Assert-TaskMediaEqual (Invoke-TaskMediaMethod 'CanToggle' @($true, $false, $false, $true)) $true 'Pause-only player is controllable'
Assert-TaskMediaEqual (Invoke-TaskMediaMethod 'CanToggle' @($false, $false, $true, $false)) $true 'Play-only player is controllable'
Assert-TaskMediaEqual (Invoke-TaskMediaMethod 'CanToggle' @($true, $false, $true, $false)) $false 'Play capability cannot fake Pause'
Assert-TaskMediaEqual (Invoke-TaskMediaMethod 'CanToggle' @($false, $true, $false, $false)) $true 'Native toggle remains supported'
Assert-TaskMediaEqual (Invoke-TaskMediaMethod 'SeekSourceMatches' @('Spotify.exe', 'Spotify.exe')) $true 'Seek keeps its original player'
Assert-TaskMediaEqual (Invoke-TaskMediaMethod 'SeekSourceMatches' @('Spotify.exe', 'MSEdge')) $false 'Seek rejects another player even for the same song'
Assert-TaskMediaEqual (Invoke-TaskMediaMethod 'SeekSourceMatches' @('Spotify.exe', 'spotify.exe')) $false 'Seek identity comparison is exact'
Assert-TaskMediaEqual (Invoke-TaskMediaMethod 'SeekSourceMatches' @('', '')) $false 'Unknown identity cannot authorize a seek'
Assert-TaskMediaEqual (Invoke-TaskMediaMethod 'SeekTicks' @([long]50000000, [long]150000000, [double]2.5)) ([long]75000000) 'Seeking respects a nonzero timeline origin'
foreach ($taskInvalidPosition in @([double]-1, [double]11, [double]::NaN, [double]::PositiveInfinity)) {
  $taskRejected = $false
  try { [void](Invoke-TaskMediaMethod 'SeekTicks' @([long]50000000, [long]150000000, $taskInvalidPosition)) }
  catch { $taskRejected = $_.Exception.InnerException -is [ArgumentException] }
  if (-not $taskRejected) { throw 'Invalid seek position was not rejected.' }
}
Write-Output 'Native media checks passed: 27 cases, no playback commands or account access.'
