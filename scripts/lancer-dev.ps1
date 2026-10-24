param(
    [switch]$BuildHost,
    [switch]$Offline,
    [string]$TargetDirectory
)

$ErrorActionPreference = 'Stop'
$taskRepo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskDevelopment = Join-Path $taskRepo '.development'
$taskTargetNote = Join-Path $taskDevelopment 'target-dir.txt'
$taskHostNote = Join-Path $taskDevelopment 'host-sha256.txt'

function Assert-PlainPath([string]$Path) {
    $taskCurrent = [IO.Path]::GetFullPath($Path)
    while ($taskCurrent) {
        if (Test-Path -LiteralPath $taskCurrent) {
            $taskItem = Get-Item -LiteralPath $taskCurrent -Force
            if (($taskItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "Un lien ou une jonction est interdit pour la version d'essai : $taskCurrent"
            }
        }
        $taskParent = [IO.Path]::GetDirectoryName($taskCurrent)
        if ($taskParent -eq $taskCurrent) { break }
        $taskCurrent = $taskParent
    }
}

function Get-TrialHash([string]$Path) {
    $taskStream = [IO.File]::OpenRead($Path)
    $taskDigest = [Security.Cryptography.SHA256]::Create()
    try { [BitConverter]::ToString($taskDigest.ComputeHash($taskStream)).Replace('-', '') }
    finally { $taskDigest.Dispose(); $taskStream.Dispose() }
}

Assert-PlainPath $taskRepo
Assert-PlainPath $taskDevelopment
Assert-PlainPath $taskTargetNote
Assert-PlainPath $taskHostNote
if (-not $TargetDirectory) {
    if ($env:CARGO_TARGET_DIR) { $TargetDirectory = $env:CARGO_TARGET_DIR }
    elseif (Test-Path -LiteralPath $taskTargetNote) { $TargetDirectory = (Get-Content -LiteralPath $taskTargetNote -Raw).Trim() }
    else { $TargetDirectory = Join-Path $taskRepo 'src-tauri/target' }
}
$taskTarget = [IO.Path]::GetFullPath($(if ([IO.Path]::IsPathRooted($TargetDirectory)) { $TargetDirectory } else { Join-Path $taskRepo $TargetDirectory }))
$taskDebug = Join-Path $taskTarget 'debug'
$taskExecutable = Join-Path $taskDebug 'notchy-v2.exe'
Assert-PlainPath $taskDebug

$taskNode = if ($env:NOTCHY_NODE) { $env:NOTCHY_NODE } else { (Get-Command node -ErrorAction Stop).Source }
Push-Location -LiteralPath $taskRepo
try {
    & $taskNode 'scripts/build-frontend.cjs'
    if ($LASTEXITCODE -ne 0) { throw "La preparation de l'interface a echoue." }
    if ($BuildHost) {
        & $taskNode 'scripts/check-storage.cjs' '--guard' '--target' $taskTarget
        if ($LASTEXITCODE -ne 0) { throw 'Le controle stockage doit etre resolu avant une nouvelle compilation. Aucun fichier ne sera supprime sans nouvel accord.' }
        $env:CARGO_TARGET_DIR = $taskTarget
        $taskCargoArguments = @('build', '--manifest-path', 'src-tauri/Cargo.toml', '--locked', '--bin', 'notchy-v2')
        if ($Offline) { $taskCargoArguments += '--offline' }
        & (Get-Command cargo -ErrorAction Stop).Source @taskCargoArguments
        if ($LASTEXITCODE -ne 0) { throw 'La compilation initiale du noyau natif a echoue.' }
        Assert-PlainPath $taskExecutable
        New-Item -ItemType Directory -Path $taskDevelopment -Force | Out-Null
        Set-Content -LiteralPath $taskTargetNote -Value $taskTarget -Encoding UTF8
        Set-Content -LiteralPath $taskHostNote -Value (Get-TrialHash $taskExecutable) -Encoding UTF8
        & $taskNode 'scripts/check-storage.cjs' '--target' $taskTarget
        if ($LASTEXITCODE -ne 0) { throw 'La compilation est conservee, mais le bilan de stockage doit etre verifie.' }
    }
    if (-not (Test-Path -LiteralPath $taskExecutable -PathType Leaf) -or -not (Test-Path -LiteralPath $taskHostNote -PathType Leaf)) {
        throw "Le noyau natif d'essai doit etre prepare une premiere fois : .\Lancer-Notchy-Essai.cmd -BuildHost. Rust et les outils Windows sont requis uniquement pour cette preparation."
    }
    Assert-PlainPath $taskExecutable
    if ((Get-Content -LiteralPath $taskHostNote -Raw).Trim() -ne (Get-TrialHash $taskExecutable)) {
        throw "Le noyau natif a change. Relance .\Lancer-Notchy-Essai.cmd -BuildHost pour preparer la version d'essai isolee."
    }
    # Cargo does not create an installer. Copy only the declared native helpers and notices.
    $taskConfig = Get-Content -LiteralPath (Join-Path $taskRepo 'src-tauri/tauri.conf.json') -Raw | ConvertFrom-Json
    foreach ($taskResource in $taskConfig.bundle.resources.PSObject.Properties) {
        $taskSource = [IO.Path]::GetFullPath((Join-Path (Join-Path $taskRepo 'src-tauri') $taskResource.Name))
        $taskDestination = [IO.Path]::GetFullPath((Join-Path $taskDebug ([string]$taskResource.Value)))
        if (-not $taskSource.StartsWith($taskRepo + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
            -not $taskDestination.StartsWith($taskDebug + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Une ressource native sort du projet ou du repertoire debug.'
        }
        Assert-PlainPath $taskSource
        Assert-PlainPath $taskDestination
        New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($taskDestination)) -Force | Out-Null
        if (-not (Test-Path -LiteralPath $taskDestination -PathType Leaf) -or
            (Get-TrialHash $taskSource) -ne (Get-TrialHash $taskDestination)) {
            Copy-Item -LiteralPath $taskSource -Destination $taskDestination -Force
        }
    }
    Start-Process -FilePath $taskExecutable -ArgumentList '--reload-ui' -WorkingDirectory $taskRepo | Out-Null
    Write-Host "Notchy Essai est ouvert sur le bureau. Relance ce fichier pour charger les modifications de l'interface."
    Write-Host ('Profil isole : ' + (Join-Path $taskDevelopment 'profile'))
}
finally { Pop-Location }
