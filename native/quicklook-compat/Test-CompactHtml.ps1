[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$QuickLookRoot,
      [Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path -LiteralPath $QuickLookRoot).Path
$taskOutput = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $taskOutput) { throw 'OutputDirectory must be new.' }
[void][IO.Directory]::CreateDirectory($taskOutput)
$taskFramework = Join-Path $env:windir 'Microsoft.NET\Framework64\v4.0.30319'
$taskCompiler = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\2022\BuildTools\MSBuild\Current\Bin\Roslyn\csc.exe'
$taskHarness = @'
using System;
using System.Windows;
using System.Windows.Threading;
using QuickLook.Common.Plugin;
using QuickLook.Plugin.PDFViewer;
sealed class Original : IViewer {
 public int Priority => 0; public int Prepared, Cleaned;
 public void Init() {} public bool CanHandle(string path) => path.EndsWith(".html");
 public void Prepare(string path, ContextObject context) { Prepared++; context.PreferredSize = new Size(1280,720); }
 public void View(string path, ContextObject context) {} public void Cleanup() { Cleaned++; }
}
static class Check {
 static void Assert(bool value,string name) { if(!value)throw new Exception(name); Console.WriteLine("PASS " + name); }
 static void Drain() { var frame = new DispatcherFrame(); Dispatcher.CurrentDispatcher.BeginInvoke(DispatcherPriority.ContextIdle,new Action(()=>frame.Continue=false)); Dispatcher.PushFrame(frame); }
 [STAThread] static void Main() {
  var original=new Original(); var plugin=new CompactHtmlPlugin(original);
  var window=new Window {Width=1600,Height=1000,MinWidth=400,MinHeight=200};
  var context=new ContextObject {Source=window};
  Assert(plugin.CanHandle("a.html")&&!plugin.CanHandle("a.docx")&&plugin.Priority>original.Priority,"exact original routing, higher priority");
  plugin.Prepare("a.html",context);
  Assert(original.Prepared==1&&context.PreferredSize.Width<=800&&context.PreferredSize.Height<=520&&context.CanResize,"Prepare delegates and fits compact content");
  window.Width=1600; window.Height=1000; window.WindowState=WindowState.Maximized;
  Drain();
  Assert(window.WindowState==WindowState.Normal&&window.Width<=802&&window.Height<=554,"one-shot overrides reused large/maximized geometry");
  window.WindowState=WindowState.Maximized; Drain();
  Assert(window.WindowState==WindowState.Maximized,"manual maximize remains available after load");
  window.WindowState=WindowState.Normal; window.Width=1100; Drain();
  Assert(window.Width==1100,"manual resize remains unrestricted");
  window.WindowStyle=WindowStyle.None; window.ResizeMode=ResizeMode.NoResize; window.Width=1300; window.Height=900;
  Drain(); var fullscreenWidth=window.Width; var fullscreenHeight=window.Height;
  plugin.Prepare("fullscreen.html",context); Drain();
  Assert(window.WindowState==WindowState.Normal&&window.WindowStyle==WindowStyle.None&&window.ResizeMode==ResizeMode.NoResize&&window.Width==fullscreenWidth&&window.Height==fullscreenHeight&&context.PreferredSize==new Size(1280,720),"explicit F11 fullscreen keeps upstream Prepare and geometry on the next HTML preview");
  window.WindowStyle=WindowStyle.SingleBorderWindow; window.ResizeMode=ResizeMode.CanResize;
  plugin.Prepare("b.html",context); plugin.Cleanup(); window.Width=1200; Drain();
  Assert(window.Width==1200&&original.Cleaned==1,"Cleanup cancels deferred resize and delegates disposal");
  window.Close();
 }
}
'@
$taskSource = Join-Path $taskOutput 'Check.cs'
[IO.File]::WriteAllText($taskSource, $taskHarness, [Text.UTF8Encoding]::new($false))
$taskExe = Join-Path $taskOutput 'Check.exe'
$taskReferences = @('System.dll','System.Core.dll','System.Xaml.dll','System.Windows.Forms.dll') | ForEach-Object { '/r:' + (Join-Path $taskFramework $_) }
$taskReferences += @('WindowsBase.dll','PresentationCore.dll','PresentationFramework.dll') | ForEach-Object { '/r:' + (Join-Path $taskFramework ('WPF\' + $_)) }
$taskReferences += '/r:' + (Join-Path $taskRoot 'QuickLook.Common.dll')
& $taskCompiler /nologo /langversion:latest /target:exe "/out:$taskExe" @taskReferences (Join-Path $PSScriptRoot 'CompactHtmlPlugin.cs') $taskSource
if ($LASTEXITCODE -ne 0) { throw 'Compact HTML test harness failed to compile.' }
Copy-Item -LiteralPath (Join-Path $taskRoot 'QuickLook.Common.dll') -Destination $taskOutput
& $taskExe
if ($LASTEXITCODE -ne 0) { throw 'Compact HTML self-check failed.' }
