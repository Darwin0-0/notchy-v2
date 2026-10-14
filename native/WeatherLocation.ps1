$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$weatherWatcher = $null
try {
    Add-Type -AssemblyName System.Device
    $weatherWatcher = New-Object -TypeName System.Device.Location.GeoCoordinateWatcher -ArgumentList ([System.Device.Location.GeoPositionAccuracy]::Default)
    # Read the Windows provider only. Never show a hidden helper permission dialog.
    $weatherClock = [System.Diagnostics.Stopwatch]::StartNew()
    $weatherStarted = $weatherWatcher.TryStart($true, [TimeSpan]::FromMilliseconds(500))
    while ($weatherWatcher.Position.Location.IsUnknown -and $weatherWatcher.Permission -ne 'Denied' -and $weatherWatcher.Status -ne 'Disabled' -and $weatherClock.ElapsedMilliseconds -lt 12000) {
        Start-Sleep -Milliseconds 150
    }
    $weatherPermission = [string]$weatherWatcher.Permission
    $weatherStatus = [string]$weatherWatcher.Status
    $weatherCoordinate = $weatherWatcher.Position.Location
    if ($weatherPermission -eq 'Denied') {
        $weatherResult = @{status='denied'}
    } elseif (-not $weatherCoordinate.IsUnknown) {
        $weatherTime = $weatherWatcher.Position.Timestamp.ToUniversalTime()
        $weatherAccuracy = $weatherCoordinate.HorizontalAccuracy
        if ([double]::IsNaN($weatherAccuracy) -or [double]::IsInfinity($weatherAccuracy)) { $weatherAccuracy = $null }
        $weatherResult = @{status='ready';latitude=[math]::Round($weatherCoordinate.Latitude,2);longitude=[math]::Round($weatherCoordinate.Longitude,2);accuracy=$weatherAccuracy;timestamp=$weatherTime.ToUnixTimeMilliseconds()}
    } elseif ($weatherStatus -eq 'Disabled') {
        $weatherResult = @{status='disabled'}
    } elseif (-not $weatherStarted -or $weatherClock.ElapsedMilliseconds -ge 12000) {
        $weatherResult = @{status='timeout'}
    } else {
        $weatherResult = @{status='unavailable'}
    }
} catch {
    $weatherResult = @{status='unavailable'}
} finally {
    if ($null -ne $weatherWatcher) { $weatherWatcher.Stop(); $weatherWatcher.Dispose() }
}
$weatherResult | ConvertTo-Json -Compress
