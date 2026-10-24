[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$QuickLookRoot,
    [Parameter(Mandatory = $true)][string]$Proxy,
    [Parameter(Mandatory = $true)][string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
$testRoot = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $testRoot) { throw 'Use a new directory for the disposable process test.' }
[void][IO.Directory]::CreateDirectory($testRoot)
$framework = Join-Path $env:windir 'Microsoft.NET\Framework64\v4.0.30319'
$compiler = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\2022\BuildTools\MSBuild\Current\Bin\Roslyn\csc.exe'
$options = @('/nologo', '/noconfig', '/nostdlib+', '/target:exe', '/platform:x64', '/langversion:latest') +
    (@('mscorlib.dll', 'System.dll', 'System.Core.dll', 'System.Xaml.dll', 'WPF\WindowsBase.dll', 'WPF\PresentationCore.dll', 'WPF\PresentationFramework.dll') | ForEach-Object { '/reference:' + (Join-Path $framework $_) })
$childSource = @'
using System;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
class Child {
 [STAThread] static void Main() {
  var app = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
  var window = new Window { Width=500, Height=300, Left=-30000, Top=-30000, ShowActivated=false, ShowInTaskbar=false, Content=new TextBlock {Text="Disposable owned worker"} };
  window.Show();
  Console.WriteLine(new WindowInteropHelper(window).Handle.ToInt64()); Console.Out.Flush();
  Task.Run(() => { if (Console.ReadLine()=="block") window.Dispatcher.BeginInvoke(new Action(() => { Console.WriteLine("blocked"); Console.Out.Flush(); Thread.Sleep(60000); })); });
  app.Run();
 }
}
'@
$hostSource = @'
using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Threading;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Threading;
class Test {
 static Process child; static Timer watchdog;
 [STAThread] static int Main(string[] args) {
  AppDomain.CurrentDomain.AssemblyResolve += (sender, request) => { var path=Path.Combine(args[0],new AssemblyName(request.Name).Name+".dll"); return File.Exists(path)?Assembly.LoadFrom(path):null; };
  try {
   child = Process.Start(new ProcessStartInfo(args[2]) { UseShellExecute=false,CreateNoWindow=true,RedirectStandardInput=true,RedirectStandardOutput=true,RedirectStandardError=true });
   watchdog = new Timer(_ => { try { if(!child.HasExited)child.Kill(); }catch{} Console.WriteLine("FAIL watchdog"); Environment.Exit(124); }, null, 10000, Timeout.Infinite);
   var hwnd=new IntPtr(long.Parse(child.StandardOutput.ReadLine(),CultureInfo.InvariantCulture));
   var assembly=Assembly.LoadFrom(args[1]); var type=assembly.GetType("QuickLook.Plugin.NotchyOfficeIsolation.WorkerHost",true);
   var wrong=Path.Combine(Path.GetDirectoryName(args[2]),"wrong","NotchyOfficeWorker.exe");
   var rejected=false;
   try { Activator.CreateInstance(type,BindingFlags.Instance|BindingFlags.NonPublic,null,new object[]{hwnd,(uint)child.Id,wrong,(Action)(()=>{})},null); }
   catch(TargetInvocationException) { rejected=true; }
   if(!rejected || child.HasExited)throw new Exception("Unverified path was accepted or process was affected.");
   var app=new Application{ShutdownMode=ShutdownMode.OnExplicitShutdown};
   var closed=false;
   var content=(HwndHost)Activator.CreateInstance(type,BindingFlags.Instance|BindingFlags.NonPublic,null,new object[]{hwnd,(uint)child.Id,args[2],(Action)(()=>{closed=true;})},null);
   var grid=new Grid();grid.Children.Add(content);
   var window=new Window{Width=500,Height=300,Left=-30000,Top=-30000,ShowInTaskbar=false,ShowActivated=false,Content=grid};
   window.Show(); Pump(120);
   child.StandardInput.WriteLine("block");child.StandardInput.Flush();
   if(child.StandardOutput.ReadLine()!="blocked")throw new Exception("The test child did not become busy.");
   var stopwatch=Stopwatch.StartNew();
   grid.Children.Clear();content.Dispose();window.UpdateLayout();
   stopwatch.Stop();
   if(!child.WaitForExit(500) || !closed || stopwatch.ElapsedMilliseconds>600)throw new Exception("Busy worker disposal blocked or did not notify the broker: "+stopwatch.ElapsedMilliseconds);
   Console.WriteLine("PASS unverified path rejected; busy owned worker stopped; disposalMs="+stopwatch.ElapsedMilliseconds);
   window.Close();app.Shutdown();watchdog.Dispose();return 0;
  } catch(Exception error) { Console.WriteLine("FAIL "+error);return 1; }
  finally { if(child!=null){try{if(!child.HasExited)child.Kill();}catch{} child.Dispose();} }
 }
 static void Pump(int milliseconds){var frame=new DispatcherFrame();var timer=new DispatcherTimer{Interval=TimeSpan.FromMilliseconds(milliseconds)};timer.Tick+=(s,e)=>{timer.Stop();frame.Continue=false;};timer.Start();Dispatcher.PushFrame(frame);}
}
'@
$utf8 = [Text.UTF8Encoding]::new($false)
$childFile = Join-Path $testRoot 'Child.cs'; $hostFile = Join-Path $testRoot 'Host.cs'
[IO.File]::WriteAllText($childFile, $childSource, $utf8); [IO.File]::WriteAllText($hostFile, $hostSource, $utf8)
$worker = Join-Path $testRoot 'NotchyOfficeWorker.exe'; $hostExe = Join-Path $testRoot 'TestHost.exe'
& $compiler @options "/out:$worker" $childFile
if ($LASTEXITCODE -ne 0) { throw 'The disposable child fixture did not compile.' }
& $compiler @options "/out:$hostExe" $hostFile
if ($LASTEXITCODE -ne 0) { throw 'The host component test did not compile.' }
& $hostExe (Resolve-Path -LiteralPath $QuickLookRoot).Path (Resolve-Path -LiteralPath $Proxy).Path $worker
if ($LASTEXITCODE -ne 0) { throw 'The busy worker host-disposal test failed.' }
