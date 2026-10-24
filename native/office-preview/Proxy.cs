// Copyright (C) 2026 Notchy contributors. GPL-3.0-or-later; see LICENSE-GPL.txt.
using QuickLook.Common.Plugin;
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.IO.Pipes;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Notchy.OfficePreview;

namespace QuickLook.Plugin.NotchyOfficeIsolation
{
    public sealed class Plugin : IViewer
    {
        private static readonly HashSet<string> Extensions = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        { ".doc", ".docm", ".docx", ".rtf", ".xls", ".xlsx", ".xlsm", ".pptx", ".pptm", ".potx", ".potm" };
        private CancellationTokenSource lifetime;
        private string id;
        private BrokerConfig configuration;
        public int Priority { get { return int.MaxValue; } }
        public void Init() { }
        public bool CanHandle(string path)
        {
            var config = !string.IsNullOrEmpty(path) && Extensions.Contains(Path.GetExtension(path)) && File.Exists(path) ? BrokerConfig.Read() : null;
            return config != null && config.IsAvailable();
        }
        public void Prepare(string path, ContextObject context)
        {
            context.SetPreferredSizeFit(new Size(1160, 800), 0.80);
            context.Title = Path.GetFileName(path);
        }
        public void View(string path, ContextObject context)
        {
            Cleanup();
            configuration = BrokerConfig.Read();
            if (configuration == null) throw new InvalidOperationException("Le moteur d'aperçu Notchy n'est pas disponible.");
            lifetime = new CancellationTokenSource();
            id = Guid.NewGuid().ToString("N");
            var cancellation = lifetime.Token;
            var session = id;
            var broker = configuration;
            var shell = new Grid { Background = Brushes.White, Focusable = false };
            var message = new TextBlock { Text = "Préparation de l'aperçu…", FontSize = 15, Foreground = Brushes.DimGray,
                HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center,
                TextWrapping = TextWrapping.Wrap, Margin = new Thickness(24), Focusable = false };
            shell.Children.Add(message);
            context.ViewerContent = shell;
            context.IsBusy = false;
            Task.Run(async delegate
            {
                try
                {
                    var opened = await broker.Request(new Dictionary<string, object> {
                        { "operation", "open" }, { "id", session }, { "path", path },
                        { "width", Protocol.Dimension(context.PreferredSize.Width, 240, 1920) },
                        { "height", Protocol.Dimension(context.PreferredSize.Height, 160, 1440) }
                    }, cancellation).ConfigureAwait(false);
                    var shownCache = false;
                    var attached = false;
                    while (!cancellation.IsCancellationRequested)
                    {
                        var state = opened ?? await broker.Request(new Dictionary<string, object> { { "operation", "status" }, { "id", session } }, cancellation).ConfigureAwait(false);
                        opened = null;
                        var phase = Protocol.Text(state, "phase");
                        var cachedPath = Protocol.Text(state, "cachePath");
                        if (!attached && !shownCache && !string.IsNullOrEmpty(cachedPath))
                        {
                            var image = LoadCache(cachedPath);
                            if (image != null)
                            {
                                shownCache = true;
                                await shell.Dispatcher.InvokeAsync(delegate
                                {
                                    if (cancellation.IsCancellationRequested) return;
                                    shell.Children.Clear();
                                    shell.Children.Add(new Image { Source = image, Stretch = Stretch.Uniform, Focusable = false });
                                    shell.Children.Add(new TextBlock { Text = "Aperçu enregistré · préparation de la navigation…", FontSize = 12,
                                        Foreground = Brushes.DimGray, Background = Brushes.White, Padding = new Thickness(8),
                                        HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Bottom });
                                });
                            }
                        }
                        if (phase == "ready")
                        {
                            if (attached)
                            {
                                await Task.Delay(250, cancellation).ConfigureAwait(false);
                                continue;
                            }
                            long value;
                            if (!long.TryParse(Protocol.Text(state, "hwnd"), NumberStyles.None, CultureInfo.InvariantCulture, out value) || value <= 0)
                                throw new InvalidOperationException("La fenêtre de l'aperçu n'est pas disponible.");
                            var handle = new IntPtr(value);
                            if (!Native.IsWindow(handle)) throw new InvalidOperationException("La fenêtre de l'aperçu a été fermée.");
                            uint processId;
                            if (!uint.TryParse(Protocol.Text(state, "pid"), NumberStyles.None, CultureInfo.InvariantCulture, out processId) || processId == 0)
                                throw new InvalidOperationException("Le processus de l'aperçu n'est pas disponible.");
                            var workerPath = Protocol.Text(state, "workerPath");
                            await shell.Dispatcher.InvokeAsync(delegate
                            {
                                if (cancellation.IsCancellationRequested) return;
                                shell.Children.Clear();
                                shell.Children.Add(new WorkerHost(handle, processId, workerPath, delegate { SendClose(broker, session); }));
                            });
                            attached = true;
                            await Task.Delay(250, cancellation).ConfigureAwait(false);
                            continue;
                        }
                        if (phase == "error" || phase == "closed")
                            throw new InvalidOperationException(Protocol.Text(state, "error") ?? "Cet aperçu a été interrompu.");
                        await Task.Delay(80, cancellation).ConfigureAwait(false);
                    }
                }
                catch (OperationCanceledException) { }
                catch (Exception error)
                {
                    if (cancellation.IsCancellationRequested) return;
                    await shell.Dispatcher.InvokeAsync(delegate
                    {
                        if (cancellation.IsCancellationRequested) return;
                        shell.Children.Clear();
                        message.Text = error is IOException || error is TimeoutException ? "Le moteur d'aperçu ne répond pas. Réessaie ou ouvre ce fichier dans ton application." : error.Message;
                        shell.Children.Add(message);
                    });
                }
            });
        }
        public void Cleanup()
        {
            var old = lifetime;
            lifetime = null;
            if (old != null) { old.Cancel(); old.Dispose(); }
            var session = id;
            id = null;
            var broker = configuration;
            configuration = null;
            if (session != null && broker != null) SendClose(broker, session);
        }
        private static void SendClose(BrokerConfig broker, string session)
        {
            Task.Run(async delegate
            {
                try { await broker.Request(new Dictionary<string, object> { { "operation", "close" }, { "id", session } }, CancellationToken.None).ConfigureAwait(false); }
                catch { }
            });
        }
        private static BitmapSource LoadCache(string path)
        {
            try
            {
                var file = new FileInfo(path);
                if (!file.Exists || file.Length > 32 * 1024 * 1024 || !string.Equals(file.Extension, ".png", StringComparison.OrdinalIgnoreCase)) return null;
                using (var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete))
                {
                    var bitmap = BitmapFrame.Create(stream, BitmapCreateOptions.PreservePixelFormat, BitmapCacheOption.OnLoad);
                    if (bitmap.PixelWidth > 4096 || bitmap.PixelHeight > 4096) return null;
                    bitmap.Freeze();
                    return bitmap;
                }
            }
            catch { return null; }
        }
    }

    internal sealed class BrokerConfig
    {
        private string pipe, secret;
        private static string lastPipe;
        private static long lastProbe;
        private static bool lastAvailable;
        private static readonly object ProbeLock = new object();
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool WaitNamedPipe(string name, uint timeout);
        internal bool IsAvailable()
        {
            lock (ProbeLock)
            {
                var now = Stopwatch.GetTimestamp();
                if (pipe == lastPipe && now - lastProbe < Stopwatch.Frequency / 2) return lastAvailable;
                lastAvailable = WaitNamedPipe(@"\\.\pipe\" + pipe, 1);
                var error = Marshal.GetLastWin32Error();
                // A busy existing broker must not fall back to the blocking original Office viewer.
                if (!lastAvailable && (error == 121 || error == 231)) lastAvailable = true;
                lastPipe = pipe;
                lastProbe = now;
                return lastAvailable;
            }
        }
        internal static BrokerConfig Read()
        {
            try
            {
                var file = Path.Combine(Path.GetDirectoryName(typeof(Plugin).Assembly.Location), "NotchyBroker.json");
                var info = new FileInfo(file);
                if (!info.Exists || info.Length > 4096) return null;
                var json = Protocol.Decode(File.ReadAllText(file));
                var pipe = Protocol.Text(json, "pipe");
                var secret = Protocol.Text(json, "secret");
                if (string.IsNullOrEmpty(pipe) || !pipe.StartsWith(@"\\.\pipe\", StringComparison.OrdinalIgnoreCase) || pipe.Length > 240 ||
                    string.IsNullOrEmpty(secret) || secret.Length != 64 || !IsHex(secret)) return null;
                var pidText = Protocol.Text(json, "pid");
                int pid;
                if (!string.IsNullOrEmpty(pidText) && (!int.TryParse(pidText, out pid) || Process.GetProcessById(pid).HasExited)) return null;
                return new BrokerConfig { pipe = pipe.Substring(9), secret = secret };
            }
            catch { return null; }
        }
        private static bool IsHex(string value)
        {
            foreach (var c in value) if (!(c >= '0' && c <= '9') && !(c >= 'a' && c <= 'f') && !(c >= 'A' && c <= 'F')) return false;
            return true;
        }
        internal async Task<Dictionary<string, object>> Request(Dictionary<string, object> message, CancellationToken cancellation)
        {
            message["secret"] = secret;
            using (var connection = new NamedPipeClientStream(".", pipe, PipeDirection.InOut, PipeOptions.Asynchronous, TokenImpersonationLevel.Identification))
            using (var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellation))
            {
                timeout.CancelAfter(1200);
                using (timeout.Token.Register(delegate { connection.Dispose(); }))
                {
                    await connection.ConnectAsync(400, timeout.Token).ConfigureAwait(false);
                    using (var writer = new StreamWriter(connection, new System.Text.UTF8Encoding(false), 1024, true))
                    using (var reader = new StreamReader(connection, System.Text.Encoding.UTF8, false, 1024, true))
                    {
                        await writer.WriteLineAsync(Protocol.Encode(message)).ConfigureAwait(false);
                        await writer.FlushAsync().ConfigureAwait(false);
                        return Protocol.Decode(await reader.ReadLineAsync().ConfigureAwait(false));
                    }
                }
            }
        }
    }

    internal sealed class WorkerHost : HwndHost
    {
        private readonly IntPtr worker;
        private readonly uint workerPid;
        private readonly string workerPath;
        private readonly Action closing;
        private IntPtr process;
        private IntPtr host;
        internal WorkerHost(IntPtr worker, uint pid, string path, Action closing)
        {
            this.worker = worker;
            workerPid = pid;
            workerPath = Canonical(path);
            this.closing = closing;
            Focusable = false;
            if (!string.Equals(Path.GetFileName(workerPath), "NotchyOfficeWorker.exe", StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("Le moteur d'aperçu n'a pas pu être vérifié.");
            process = Native.OpenProcess(0x00100000 | 0x1000 | 0x0001, false, workerPid);
            if (process == IntPtr.Zero || !OwnsWorker())
            {
                if (process != IntPtr.Zero) Native.CloseHandle(process);
                process = IntPtr.Zero;
                throw new InvalidOperationException("Le moteur d'aperçu n'a pas pu être vérifié.");
            }
        }
        private static string Canonical(string path)
        {
            if (string.IsNullOrEmpty(path)) throw new InvalidOperationException("Le chemin du moteur d'aperçu est absent.");
            if (path.StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase)) path = @"\\" + path.Substring(8);
            else if (path.StartsWith(@"\\?\", StringComparison.OrdinalIgnoreCase)) path = path.Substring(4);
            return Path.GetFullPath(path);
        }
        private bool OwnsWorker()
        {
            uint pid;
            if (!Native.IsWindow(worker) || Native.GetWindowThreadProcessId(worker, out pid) == 0 || pid != workerPid) return false;
            var path = new System.Text.StringBuilder(32768);
            var count = (uint)path.Capacity;
            return Native.QueryFullProcessImageName(process, 0, path, ref count) && string.Equals(Canonical(path.ToString()), workerPath, StringComparison.OrdinalIgnoreCase);
        }
        protected override HandleRef BuildWindowCore(HandleRef parent)
        {
            host = Native.CreateWindowEx(0, "static", "Notchy Office Preview Host", unchecked((int)(Native.Child | Native.Visible | 0x02000000L)),
                0, 0, 1, 1, parent.Handle, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
            if (host == IntPtr.Zero) throw new System.ComponentModel.Win32Exception();
            Native.Style(worker, (Native.Style(worker) & ~(Native.Popup | Native.Caption | Native.ThickFrame)) | Native.Child | Native.Visible);
            Native.SetParent(worker, host);
            Resize();
            return new HandleRef(this, host);
        }
        protected override void OnWindowPositionChanged(Rect rectangle) { base.OnWindowPositionChanged(rectangle); Resize(); }
        private void Resize()
        {
            if (host == IntPtr.Zero || !Native.IsWindow(worker)) return;
            var scale = VisualTreeHelper.GetDpi(this);
            Native.SetWindowPos(worker, IntPtr.Zero, 0, 0, Protocol.Dimension(ActualWidth * scale.DpiScaleX, 1, 4096),
                Protocol.Dimension(ActualHeight * scale.DpiScaleY, 1, 4096), 0x4000 | 0x0010 | 0x0004 | 0x0020 | 0x0040);
        }
        protected override void DestroyWindowCore(HandleRef handle)
        {
            // Upstream resets ViewerContent before Cleanup. Stop our verified worker before
            // destroying its parent, since a busy child renderer must not block QuickLook's UI.
            if (closing != null) closing();
            if (process != IntPtr.Zero)
            {
                if (OwnsWorker()) Native.TerminateProcess(process, 0);
                Native.WaitForSingleObject(process, 100);
                Native.CloseHandle(process);
                process = IntPtr.Zero;
            }
            var oldHost = host;
            host = IntPtr.Zero;
            if (oldHost == IntPtr.Zero) return;
            if (!Native.IsWindow(worker) || Native.GetParent(worker) != oldHost) { Native.DestroyWindow(oldHost); return; }
            // Fail closed if ownership changed or kernel termination has not completed. Only our
            // own static container may be destroyed later, after its live foreign child is gone.
            var attempts = 0;
            var cleanup = new DispatcherTimer(DispatcherPriority.Background, Dispatcher) { Interval = TimeSpan.FromMilliseconds(50) };
            cleanup.Tick += delegate
            {
                uint pid;
                if (!Native.IsWindow(oldHost) || Native.GetWindowThreadProcessId(oldHost, out pid) == 0 || pid != (uint)Process.GetCurrentProcess().Id)
                { cleanup.Stop(); return; }
                if (!Native.IsWindow(worker) || Native.GetParent(worker) != oldHost) { cleanup.Stop(); Native.DestroyWindow(oldHost); return; }
                if (++attempts >= 40) cleanup.Stop();
            };
            cleanup.Start();
        }
    }
}
