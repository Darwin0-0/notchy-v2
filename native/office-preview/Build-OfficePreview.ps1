[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$QuickLookRoot,
    [Parameter(Mandatory = $true)][string]$OutputDirectory,
    [string]$ZipPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'bin\NotchyOfficePreview.zip')
)
$ErrorActionPreference = 'Stop'
$qlRoot = (Resolve-Path -LiteralPath $QuickLookRoot).Path
$buildRoot = [IO.Path]::GetFullPath($OutputDirectory)
$zipOutput = [IO.Path]::GetFullPath($ZipPath)
if (Test-Path -LiteralPath $buildRoot) { throw 'Use a new output directory; no existing build files are overwritten.' }
$common = Join-Path $qlRoot 'QuickLook.Common.dll'
if (-not (Test-Path -LiteralPath $common -PathType Leaf)) { throw 'QuickLook.Common.dll from the existing QuickLook runtime is required.' }
$version = [Reflection.AssemblyName]::GetAssemblyName($common).Version.ToString()
if ($version -ne '4.5.0.0') { throw "Expected the supported QuickLook 4.5.0.0 common ABI, found $version." }
$framework = Join-Path $env:windir 'Microsoft.NET\Framework64\v4.0.30319'
$compiler = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\2022\BuildTools\MSBuild\Current\Bin\Roslyn\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (-not (Test-Path -LiteralPath $vswhere)) { throw 'An installed Visual Studio MSBuild with Roslyn is required.' }
    $installation = & $vswhere -latest -products '*' -requires Microsoft.Component.MSBuild -property installationPath
    if ($LASTEXITCODE -ne 0 -or -not $installation) { throw 'No installed compiler was found.' }
    $compiler = Join-Path $installation 'MSBuild\Current\Bin\Roslyn\csc.exe'
}
if (-not (Test-Path -LiteralPath $compiler)) { throw 'The existing Roslyn C# compiler was not found.' }
$references = @('mscorlib.dll', 'System.dll', 'System.Core.dll', 'System.Web.Extensions.dll', 'System.Xaml.dll',
    'WPF\WindowsBase.dll', 'WPF\PresentationCore.dll', 'WPF\PresentationFramework.dll') | ForEach-Object { Join-Path $framework $_ }
foreach ($reference in $references) { if (-not (Test-Path -LiteralPath $reference)) { throw "Missing installed .NET 4.8 reference: $reference" } }
foreach ($source in @('Shared.cs', 'Proxy.cs', 'Worker.cs', 'README.md', 'LICENSE-GPL.txt')) {
    if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $source))) { throw "Missing source $source" }
}
[void][IO.Directory]::CreateDirectory($buildRoot)
$options = @('/nologo', '/noconfig', '/nostdlib+', '/optimize+', '/deterministic+', '/langversion:latest', '/platform:x64', '/utf8output',
    "/pathmap:$PSScriptRoot=/notchy-office-preview") + ($references | ForEach-Object { "/reference:$_" }) + "/reference:$common"
$proxy = Join-Path $buildRoot 'QuickLook.Plugin.NotchyOfficeIsolation.dll'
$worker = Join-Path $buildRoot 'NotchyOfficeWorker.exe'
& $compiler @options /target:library "/out:$proxy" (Join-Path $PSScriptRoot 'Shared.cs') (Join-Path $PSScriptRoot 'Proxy.cs')
if ($LASTEXITCODE -ne 0) { throw 'The QuickLook proxy build failed.' }
& $compiler @options /target:exe "/out:$worker" (Join-Path $PSScriptRoot 'Shared.cs') (Join-Path $PSScriptRoot 'Worker.cs')
if ($LASTEXITCODE -ne 0) { throw 'The isolated Office worker build failed.' }
$utf8 = [Text.UTF8Encoding]::new($false)
$config = Join-Path $buildRoot 'NotchyOfficeWorker.exe.config'
[IO.File]::WriteAllText($config, '<?xml version="1.0" encoding="utf-8"?><configuration><startup useLegacyV2RuntimeActivationPolicy="true"><supportedRuntime version="v4.0" sku=".NETFramework,Version=v4.8"/></startup><runtime><loadFromRemoteSources enabled="false"/></runtime></configuration>' + "`n", $utf8)
$files = [ordered]@{
    'QuickLook.Plugin.NotchyOfficeIsolation.dll' = $proxy
    'NotchyOfficeWorker.exe' = $worker
    'NotchyOfficeWorker.exe.config' = $config
}
foreach ($source in @('Shared.cs', 'Proxy.cs', 'Worker.cs', 'Build-OfficePreview.ps1', 'README.md', 'LICENSE-GPL.txt')) { $files["source/$source"] = Join-Path $PSScriptRoot $source }
$hashes = [ordered]@{}
foreach ($entry in $files.GetEnumerator()) { $hashes[$entry.Key] = (Get-FileHash -LiteralPath $entry.Value -Algorithm SHA256).Hash.ToLowerInvariant() }
$manifest = Join-Path $buildRoot 'manifest.json'
$manifestText = [ordered]@{ format = 1; version = '1.0.0'; license = 'GPL-3.0-or-later'; quicklook_abi = $version; sha256 = $hashes } | ConvertTo-Json -Depth 4
[IO.File]::WriteAllText($manifest, $manifestText.Replace("`r`n", "`n") + "`n", $utf8)
$files['manifest.json'] = $manifest
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$stage = Join-Path $buildRoot 'NotchyOfficePreview.zip'
$stream = [IO.File]::Open($stage, [IO.FileMode]::CreateNew)
$archive = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create, $false)
try {
    $names = [string[]]$files.Keys
    [Array]::Sort($names, [StringComparer]::Ordinal)
    foreach ($name in $names) {
        $entry = $archive.CreateEntry($name, [IO.Compression.CompressionLevel]::Optimal)
        $entry.LastWriteTime = [DateTimeOffset]::new(1980, 1, 1, 0, 0, 0, [TimeSpan]::Zero)
        $output = $entry.Open(); $inputFile = [IO.File]::OpenRead($files[$name])
        try { $inputFile.CopyTo($output) } finally { $inputFile.Dispose(); $output.Dispose() }
    }
} finally { $archive.Dispose(); $stream.Dispose() }
if (-not $stage.Equals($zipOutput, [StringComparison]::OrdinalIgnoreCase)) {
    [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($zipOutput))
    Copy-Item -LiteralPath $stage -Destination $zipOutput -Force
}
[ordered]@{ zip = $zipOutput; sha256 = (Get-FileHash -LiteralPath $zipOutput -Algorithm SHA256).Hash.ToLowerInvariant(); entries = $hashes; compiler = [Diagnostics.FileVersionInfo]::GetVersionInfo($compiler).FileVersion } | ConvertTo-Json -Depth 4
