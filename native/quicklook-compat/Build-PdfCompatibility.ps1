[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$SourceArchive,
    [Parameter(Mandatory = $true)][string]$QuickLookRoot,
    [Parameter(Mandatory = $true)][string]$OutputDirectory,
    [string]$ZipPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'bin\QuickLookPdfCompatibility.zip')
)

$ErrorActionPreference = 'Stop'
$expectedSourceSha = 'bfa2d2bfa00ff9ea0a44a989cacc1d9f0b5241d7ad59126d305dc45cca56616a'
$archivePrefix = 'QuickLook-b13df028f3cce1f84792f7043b57bf5cea3a3e4c/QuickLook.Plugin/QuickLook.Plugin.PDFViewer/'
$sourcePath = (Resolve-Path -LiteralPath $SourceArchive).Path
$quickLookPath = (Resolve-Path -LiteralPath $QuickLookRoot).Path
$outputPath = [IO.Path]::GetFullPath($OutputDirectory)
$zipOutputPath = [IO.Path]::GetFullPath($ZipPath)
if ((Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedSourceSha) { throw 'The source archive SHA256 does not match the pinned QuickLook 4.5.0 source.' }
if (Test-Path -LiteralPath $outputPath) { throw 'OutputDirectory must be a new directory; existing build files are never overwritten.' }

$requiredReferences = @('QuickLook.Common.dll', 'QuickLook.Plugin\QuickLook.Plugin.ImageViewer\QuickLook.Plugin.ImageViewer.dll', 'QuickLook.Plugin\QuickLook.Plugin.PDFViewer\PdfiumViewer.dll')
foreach ($relative in $requiredReferences) {
    if (-not (Test-Path -LiteralPath (Join-Path $quickLookPath $relative) -PathType Leaf)) { throw "Missing local QuickLook reference: $relative" }
}
$runtimeFramework = Join-Path $env:windir 'Microsoft.NET\Framework64\v4.0.30319'
foreach ($relative in @('mscorlib.dll', 'WPF\PresentationCore.dll', 'WPF\PresentationFramework.dll', 'WPF\WindowsBase.dll')) {
    if (-not (Test-Path -LiteralPath (Join-Path $runtimeFramework $relative) -PathType Leaf)) { throw '.NET Framework 4.8 with WPF must already be installed.' }
}
$msbuild = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\2022\BuildTools\MSBuild\Current\Bin\MSBuild.exe'
if (-not (Test-Path -LiteralPath $msbuild -PathType Leaf)) {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (-not (Test-Path -LiteralPath $vswhere -PathType Leaf)) { throw 'An existing Visual Studio MSBuild 17.14 installation is required.' }
    $installation = & $vswhere -latest -products '*' -requires Microsoft.Component.MSBuild -property installationPath
    if ($LASTEXITCODE -ne 0 -or -not $installation) { throw 'No installed Visual Studio MSBuild was found.' }
    $msbuild = Join-Path $installation 'MSBuild\Current\Bin\MSBuild.exe'
}
$compilerDirectory = Join-Path (Split-Path -Parent $msbuild) 'Roslyn'
$compiler = Join-Path $compilerDirectory 'csc.exe'
if (-not (Test-Path -LiteralPath $compiler -PathType Leaf)) { throw 'The installed MSBuild Roslyn compiler is required.' }
$msbuildVersion = [Diagnostics.FileVersionInfo]::GetVersionInfo($msbuild).FileVersion
$compilerVersion = [Diagnostics.FileVersionInfo]::GetVersionInfo($compiler).FileVersion
if ($msbuildVersion -notmatch '^17\.14\.' -or $compilerVersion -notmatch '^4\.1400\.') { throw "Expected MSBuild 17.14 and Roslyn 4.14; found MSBuild $msbuildVersion and compiler $compilerVersion. Review the pinned build before changing toolchains." }
$git = (Get-Command git.exe -ErrorAction Stop).Source
$patchPath = Join-Path $PSScriptRoot 'PdfViewerControl.xaml.cs.patch'
$manifestPath = Join-Path $PSScriptRoot 'manifest.json'
foreach ($filename in @('PdfViewerControl.xaml.cs.patch', 'CompactHtmlPlugin.cs', 'Test-CompactHtml.ps1', 'README.md', 'LICENSE-GPL.txt', 'manifest.json')) {
    if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $filename) -PathType Leaf)) { throw "Missing compatibility source file: $filename" }
}
$manifestText = [IO.File]::ReadAllText($manifestPath)
$manifest = $manifestText | ConvertFrom-Json
if ($manifest.source_archive_sha256 -ne $expectedSourceSha -or $manifest.patched_dll_sha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'The compatibility manifest must pin the source archive and patched DLL SHA256.' }
if ($manifestText -match '"[A-Za-z]:[\\/]|"\\\\') { throw 'The compatibility manifest must not contain machine-specific absolute paths.' }

[void](New-Item -ItemType Directory -Path $outputPath)
$stage = Join-Path $outputPath 'source'
[void](New-Item -ItemType Directory -Path $stage)
$stagePrefix = $stage.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($sourcePath)
try {
    $extracted = 0
    foreach ($entry in $archive.Entries) {
        if (-not $entry.FullName.StartsWith($archivePrefix, [StringComparison]::Ordinal)) { continue }
        $relative = $entry.FullName.Substring($archivePrefix.Length)
        if (-not $relative -or $relative.EndsWith('/')) { continue }
        $destination = [IO.Path]::GetFullPath((Join-Path $stage $relative.Replace('/', '\')))
        if (-not $destination.StartsWith($stagePrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'The source ZIP contains a path outside the PDFViewer staging directory.' }
        [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination))
        $inputStream = $entry.Open()
        $outputStream = [IO.File]::Open($destination, [IO.FileMode]::CreateNew)
        try { $inputStream.CopyTo($outputStream) } finally { $outputStream.Dispose(); $inputStream.Dispose() }
        $extracted++
    }
    if ($extracted -eq 0 -or -not (Test-Path -LiteralPath (Join-Path $stage 'PdfViewerControl.xaml.cs'))) { throw 'The pinned PDFViewer source folder was not found in the archive.' }
} finally { $archive.Dispose() }
& $git -C $stage apply --check --whitespace=nowarn $patchPath
if ($LASTEXITCODE -ne 0) { throw 'The compatibility patch does not apply to the pinned upstream source.' }
& $git -C $stage apply --whitespace=nowarn $patchPath
if ($LASTEXITCODE -ne 0) { throw 'Applying the compatibility patch failed.' }
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'CompactHtmlPlugin.cs') -Destination $stage

$project = @'
<Project ToolsVersion="Current" DefaultTargets="Build" xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <PropertyGroup>
    <OutputType>Library</OutputType>
    <AssemblyName>QuickLook.Plugin.PDFViewer</AssemblyName>
    <RootNamespace>QuickLook.Plugin.PDFViewer</RootNamespace>
    <TargetFrameworkVersion>v4.8</TargetFrameworkVersion>
    <GenerateTargetFrameworkAttribute>false</GenerateTargetFrameworkAttribute>
    <ProjectTypeGuids>{60DC8134-EBA5-43B8-BCC9-BB4BC16C2548};{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}</ProjectTypeGuids>
    <LangVersion>latest</LangVersion>
    <Deterministic>true</Deterministic>
    <PathMap>$(MSBuildProjectDirectory)=/notchy-pdf-compat</PathMap>
    <Optimize>true</Optimize>
    <OutputPath>bin\</OutputPath>
    <IntermediateOutputPath>obj\</IntermediateOutputPath>
    <RuntimeFramework>$(windir)\Microsoft.NET\Framework64\v4.0.30319</RuntimeFramework>
    <FrameworkPathOverride>$(RuntimeFramework)</FrameworkPathOverride>
    <_TargetFrameworkDirectories>$(RuntimeFramework)</_TargetFrameworkDirectories>
    <_FullFrameworkReferenceAssemblyPaths>$(RuntimeFramework)</_FullFrameworkReferenceAssemblyPaths>
    <WinFXAssemblyDirectory>$(RuntimeFramework)\WPF</WinFXAssemblyDirectory>
  </PropertyGroup>
  <ItemGroup>
    <Reference Include="System" />
    <Reference Include="System.Core" />
    <Reference Include="System.Drawing" />
    <Reference Include="System.Xaml" />
    <Reference Include="System.Windows.Forms" />
    <Reference Include="WindowsBase"><HintPath>$(RuntimeFramework)\WPF\WindowsBase.dll</HintPath></Reference>
    <Reference Include="PresentationCore"><HintPath>$(RuntimeFramework)\WPF\PresentationCore.dll</HintPath></Reference>
    <Reference Include="PresentationFramework"><HintPath>$(RuntimeFramework)\WPF\PresentationFramework.dll</HintPath></Reference>
    <Reference Include="QuickLook.Common"><HintPath>$(QuickLookRoot)\QuickLook.Common.dll</HintPath><Private>false</Private></Reference>
    <Reference Include="QuickLook.Plugin.ImageViewer"><HintPath>$(QuickLookRoot)\QuickLook.Plugin\QuickLook.Plugin.ImageViewer\QuickLook.Plugin.ImageViewer.dll</HintPath><Private>false</Private></Reference>
    <Reference Include="PdfiumViewer"><HintPath>$(QuickLookRoot)\QuickLook.Plugin\QuickLook.Plugin.PDFViewer\PdfiumViewer.dll</HintPath><Private>false</Private></Reference>
    <Compile Include="*.cs" />
    <Compile Include="Properties\AssemblyInfo.cs" />
    <Page Include="*.xaml" />
    <Resource Include="Resources\loading.png" />
  </ItemGroup>
  <Import Project="$(MSBuildToolsPath)\Microsoft.CSharp.targets" />
</Project>
'@
$versionSource = @'
using System.Reflection;
[assembly: AssemblyVersion("4.5.0.0")]
[assembly: AssemblyFileVersion("4.5.0.2")]
[assembly: AssemblyInformationalVersion("4.5.0-notchy-pdf-html-compat.2")]
[assembly: AssemblyMetadata("NotchyCompatibility", "pdf-layout-disposal-v1;html-compact-v1")]
'@
$utf8 = [Text.UTF8Encoding]::new($false)
$projectPath = Join-Path $stage 'Compatibility.csproj'
[IO.File]::WriteAllText($projectPath, $project.Replace("`r`n", "`n") + "`n", $utf8)
[IO.File]::WriteAllText((Join-Path $stage 'CompatibilityVersion.cs'), $versionSource.Replace("`r`n", "`n") + "`n", $utf8)
& $msbuild $projectPath /nologo /t:Build /m:1 /nr:false /p:Configuration=Release /p:UseSharedCompilation=false "/p:CscToolPath=$compilerDirectory" /p:CscToolExe=csc.exe "/p:QuickLookRoot=$quickLookPath"
if ($LASTEXITCODE -ne 0) { throw 'The local PDFViewer compatibility build failed. No ZIP was replaced.' }
$dll = Join-Path $stage 'bin\QuickLook.Plugin.PDFViewer.dll'
$builtSha = (Get-FileHash -LiteralPath $dll -Algorithm SHA256).Hash.ToLowerInvariant()
if ($builtSha -cne $manifest.patched_dll_sha256) { throw "Patched DLL SHA256 mismatch: expected $($manifest.patched_dll_sha256), got $builtSha. Review the source/toolchain and manifest; no ZIP was replaced." }

$files = @{
    'QuickLook.Plugin.PDFViewer.dll' = $dll
    'PdfViewerControl.xaml.cs.patch' = $patchPath
    'Build-PdfCompatibility.ps1' = $PSCommandPath
    'CompactHtmlPlugin.cs' = (Join-Path $PSScriptRoot 'CompactHtmlPlugin.cs')
    'Test-CompactHtml.ps1' = (Join-Path $PSScriptRoot 'Test-CompactHtml.ps1')
    'README.md' = (Join-Path $PSScriptRoot 'README.md')
    'LICENSE-GPL.txt' = (Join-Path $PSScriptRoot 'LICENSE-GPL.txt')
    'manifest.json' = $manifestPath
}
$names = [string[]]$files.Keys
[Array]::Sort($names, [StringComparer]::Ordinal)
$stagedZip = Join-Path $outputPath 'QuickLookPdfCompatibility.zip'
$zipStream = [IO.File]::Open($stagedZip, [IO.FileMode]::CreateNew)
$package = [IO.Compression.ZipArchive]::new($zipStream, [IO.Compression.ZipArchiveMode]::Create, $false)
try {
    foreach ($name in $names) {
        $entry = $package.CreateEntry($name, [IO.Compression.CompressionLevel]::Optimal)
        $entry.LastWriteTime = [DateTimeOffset]::new(1980, 1, 1, 0, 0, 0, [TimeSpan]::Zero)
        $entryStream = $entry.Open()
        $fileStream = [IO.File]::OpenRead($files[$name])
        try { $fileStream.CopyTo($entryStream) } finally { $fileStream.Dispose(); $entryStream.Dispose() }
    }
} finally { $package.Dispose(); $zipStream.Dispose() }
if (-not $stagedZip.Equals($zipOutputPath, [StringComparison]::OrdinalIgnoreCase)) {
    [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($zipOutputPath))
    Move-Item -LiteralPath $stagedZip -Destination $zipOutputPath -Force
}
[ordered]@{ zip = $zipOutputPath; sha256 = (Get-FileHash -LiteralPath $zipOutputPath -Algorithm SHA256).Hash.ToLowerInvariant(); patched_dll_sha256 = $builtSha; entries = $names; msbuild = $msbuildVersion; compiler = $compilerVersion } | ConvertTo-Json -Depth 3
