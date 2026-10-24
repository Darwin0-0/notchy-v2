[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Worker,
    [Parameter(Mandatory = $true)][string]$QuickLookRoot,
    [Parameter(Mandatory = $true)][string]$OfficePluginDirectory,
    [Parameter(Mandatory = $true)][string]$Fixture,
    [Parameter(Mandatory = $true)][string]$Snapshot,
    [Parameter(Mandatory = $true)][string]$Report
)
$ErrorActionPreference = 'Stop'
$start = [Diagnostics.ProcessStartInfo]::new((Resolve-Path -LiteralPath $Worker).Path)
$start.UseShellExecute = $false
$start.CreateNoWindow = $true
$start.RedirectStandardInput = $true
$start.RedirectStandardOutput = $true
$start.RedirectStandardError = $true
foreach ($argument in @((Resolve-Path -LiteralPath $QuickLookRoot).Path, (Resolve-Path -LiteralPath $OfficePluginDirectory).Path,
    (Resolve-Path -LiteralPath $Fixture).Path, [IO.Path]::GetFullPath($Snapshot), '1100', '800')) { [void]$start.ArgumentList.Add($argument) }
$process = [Diagnostics.Process]::new()
$process.StartInfo = $start
$result = [ordered]@{ passed = $false; gate = $false; messages = @(); stderr = ''; error = $null }
try {
    [void]$process.Start()
    $first = $process.StandardOutput.ReadLineAsync()
    if ($first.Wait(150)) { throw 'Worker emitted output before the supervisor start gate.' }
    $result.gate = $true
    $process.StandardInput.WriteLine('start')
    $process.StandardInput.Flush()
    if (-not $first.Wait(10000)) { throw 'The initial HWND did not arrive.' }
    $loading = $first.Result | ConvertFrom-Json
    $result.messages += $loading
    if ($loading.phase -ne 'loading' -or -not $loading.hwnd) { throw 'Expected initial loading HWND.' }
    $next = $process.StandardOutput.ReadLineAsync()
    if (-not $next.Wait(20000)) { throw 'The worker did not report ready within the smoke-test timeout.' }
    $ready = $next.Result | ConvertFrom-Json
    $result.messages += $ready
    if ($ready.phase -ne 'ready' -or $ready.hwnd -ne $loading.hwnd) { throw 'Expected the same HWND and actual ready phase.' }
    $bytes = [IO.File]::ReadAllBytes([IO.Path]::GetFullPath($Snapshot))
    if ($bytes.Length -lt 1000 -or [BitConverter]::ToString($bytes[0..7]) -ne '89-50-4E-47-0D-0A-1A-0A') { throw 'The worker did not produce a valid substantial PNG.' }
    $result.snapshotBytes = $bytes.Length
    $result.passed = $true
}
catch { $result.error = $_.Exception.Message }
finally {
    if (-not $process.HasExited) { $process.Kill(); $process.WaitForExit() }
    $result.stderr = $process.StandardError.ReadToEnd()
    $result.exitCode = $process.ExitCode
    $process.Dispose()
    [IO.File]::WriteAllText([IO.Path]::GetFullPath($Report), ($result | ConvertTo-Json -Depth 6) + "`n", [Text.UTF8Encoding]::new($false))
}
$result | ConvertTo-Json -Depth 6
if (-not $result.passed) { exit 1 }
