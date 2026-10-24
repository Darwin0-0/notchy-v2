// Copyright (C) 2026 Notchy contributors. GPL-3.0-or-later; see LICENSE-GPL.txt.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Pipes;
using System.Linq;
using Expression = System.Linq.Expressions.Expression;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Security.Principal;
using System.Text;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using QuickLook.Common.Plugin;

namespace Notchy.OfficePreview
{
    internal static class Worker
    {
        private static string quickLookRoot, officeRoot;
        private static Dictionary<string, string> references;
        [STAThread]
        private static int Main(string[] args)
        {
            Console.OutputEncoding = new UTF8Encoding(false);
            try
            {
                if (args.Length != 6) return 64;
                quickLookRoot = Path.GetFullPath(args[0]);
                officeRoot = Path.GetFullPath(args[1]);
                // No renderer or document is touched until the Rust broker has attached its Job Object.
                if (!string.Equals(Console.ReadLine(), "start", StringComparison.Ordinal)) return 65;
                references = TrustedReferences();
                AppDomain.CurrentDomain.AssemblyResolve += Resolve;
                var pdfNative = Path.Combine(quickLookRoot, @"QuickLook.Plugin\QuickLook.Plugin.PDFViewer\x64");
                if (Directory.Exists(pdfNative)) Native.SetDllDirectory(pdfNative);
                return Run(args);
            }
            catch (Exception error)
            {
                ReportError(error);
                return 1;
            }
        }

        [MethodImpl(MethodImplOptions.NoInlining)]
        private static int Run(string[] args)
        {
            var width = ParseDimension(args[4], 240, 1920);
            var height = ParseDimension(args[5], 160, 1440);
            var path = Path.GetFullPath(args[2]);
            var snapshot = Path.GetFullPath(args[3]);
            if (!File.Exists(path) || !Directory.Exists(Path.GetDirectoryName(snapshot))) return 66;
            var app = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
            app.Resources["SegoeFluent"] = new FontFamily("Segoe Fluent Icons");
            app.Resources["SegoeMDL2"] = new FontFamily("Segoe MDL2 Assets");
            app.Resources["SymbolThemeFontFamily"] = new FontFamily("Segoe Fluent Icons");
            app.Resources.MergedDictionaries.Add(new ResourceDictionary { Source = new Uri("/QuickLook.Common;component/Styles/MainWindowStyles.xaml", UriKind.Relative) });
            System.Threading.SynchronizationContext.SetSynchronizationContext(new DispatcherSynchronizationContext(Dispatcher.CurrentDispatcher));
            app.DispatcherUnhandledException += delegate(object sender, DispatcherUnhandledExceptionEventArgs e)
            {
                ReportError(e.Exception);
                e.Handled = true;
                app.Shutdown(1);
            };
            var surface = new Grid { Background = Brushes.White };
            var window = new Window { Width = width, Height = height, Left = -30000, Top = -30000,
                ShowInTaskbar = false, ShowActivated = false, WindowStyle = WindowStyle.None,
                ResizeMode = ResizeMode.NoResize, Content = surface, Background = Brushes.White,
                Title = "Notchy Office Worker", Focusable = false };
            window.PreviewKeyDown += delegate(object sender, KeyEventArgs e)
            {
                if (e.Key == Key.Escape || (e.Key == Key.Space && Keyboard.Modifiers == ModifierKeys.None))
                {
                    e.Handled = true;
                    RequestQuickLookClose();
                }
            };
            window.Show();
            var handle = new WindowInteropHelper(window).Handle;
            Emit("loading", handle, null);
            window.Dispatcher.BeginInvoke(new Action(delegate
            {
                try
                {
                    var assembly = Assembly.LoadFrom(Path.Combine(officeRoot, "QuickLook.Plugin.OfficeViewer.dll"));
                    var plugin = (IViewer)Activator.CreateInstance(assembly.GetType("QuickLook.Plugin.OfficeViewer.Plugin", true));
                    plugin.Init();
                    if (!plugin.CanHandle(path)) throw new InvalidOperationException("Ce format n'est pas pris en charge par le moteur Office.");
                    var context = new ContextObject { Source = window, IsBusy = true };
                    plugin.Prepare(path, context);
                    plugin.View(path, context);
                    var content = context.ViewerContent as FrameworkElement;
                    if (content == null) throw new InvalidOperationException("Le document n'a pas produit d'aperçu.");
                    surface.Children.Add(content);
                    var readiness = new Readiness(content, context, path);
                    var timer = new DispatcherTimer(DispatcherPriority.Background, window.Dispatcher) { Interval = TimeSpan.FromMilliseconds(80) };
                    var consecutive = 0;
                    timer.Tick += delegate
                    {
                        try
                        {
                            surface.UpdateLayout();
                            if (!readiness.Ready() || surface.ActualWidth <= 0 || surface.ActualHeight <= 0) { consecutive = 0; return; }
                            // Two separate dispatcher/render turns prevent publishing an unlaid-out first frame.
                            if (++consecutive < 2) return;
                            timer.Stop();
                            window.Dispatcher.BeginInvoke(new Action(delegate
                            {
                                try
                                {
                                    surface.UpdateLayout();
                                    var actualWidth = Protocol.Dimension(surface.ActualWidth, 1, 4096);
                                    var actualHeight = Protocol.Dimension(surface.ActualHeight, 1, 4096);
                                    var image = new RenderTargetBitmap(actualWidth, actualHeight, 96, 96, PixelFormats.Pbgra32);
                                    image.Render(surface);
                                    var encoder = new PngBitmapEncoder();
                                    encoder.Frames.Add(BitmapFrame.Create(image));
                                    var temporary = snapshot + ".writing-" + Guid.NewGuid().ToString("N");
                                    try
                                    {
                                        using (var output = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None)) encoder.Save(output);
                                        if (File.Exists(snapshot)) throw new IOException("Le fichier temporaire d'aperçu existe déjà.");
                                        File.Move(temporary, snapshot);
                                    }
                                    finally { if (File.Exists(temporary)) File.Delete(temporary); }
                                    Emit("ready", handle, null);
                                }
                                catch (Exception error) { ReportError(error); app.Shutdown(1); }
                            }), DispatcherPriority.ContextIdle);
                        }
                        catch (Exception error) { timer.Stop(); ReportError(error); app.Shutdown(1); }
                    };
                    timer.Start();
                }
                catch (Exception error) { ReportError(error); app.Shutdown(1); }
            }), DispatcherPriority.ContextIdle);
            app.Run();
            return 0;
        }

        private sealed class Readiness
        {
            private readonly FrameworkElement content;
            private readonly ContextObject context;
            private readonly string extension;
            private bool documentChanged;
            private bool hasDocumentEvent;
            private bool loadFailed;
            internal Readiness(FrameworkElement content, ContextObject context, string path)
            {
                this.content = content; this.context = context; extension = Path.GetExtension(path).ToLowerInvariant();
                hasDocumentEvent = Observe(content, "DocumentChanged", delegate { documentChanged = true; });
                Observe(content, "FileLoadingFailed", delegate { loadFailed = true; });
            }
            internal bool Ready()
            {
                if (context.IsBusy || !content.IsLoaded || content.ActualWidth <= 0 || content.ActualHeight <= 0) return false;
                if (loadFailed) throw new InvalidOperationException("Le document Office n'a pas pu être chargé.");
                // The official plugin has no document-ready event on IViewer. Read-only state inspection
                // avoids caching its asynchronous Word/PDF control before a document has arrived.
                if (extension == ".pptx" || extension == ".pptm" || extension == ".potx" || extension == ".potm")
                    return Property(content, "PdfDocumentWrapper") != null && Number(Property(content, "TotalPages")) > 0 &&
                        Property(content.FindName("pagePanel"), "Source") is BitmapSource;
                if (extension == ".xls" || extension == ".xlsx" || extension == ".xlsm")
                    return Count(Property(Property(content, "Workbook"), "Worksheets")) > 0;
                var loading = Property(content, "IsLoading");
                if (loading is bool && (bool)loading) return false;
                return (!hasDocumentEvent || documentChanged) && !ContainsLoadingVisual(content) && Count(Property(Property(content, "Document"), "Sections")) > 0;
            }
            private static bool Observe(object target, string name, Action action)
            {
                var eventInfo = target.GetType().GetEvent(name, BindingFlags.Public | BindingFlags.Instance);
                if (eventInfo == null) return false;
                var invoke = eventInfo.EventHandlerType.GetMethod("Invoke");
                var parameters = invoke.GetParameters().Select(p => Expression.Parameter(p.ParameterType, p.Name)).ToArray();
                var handler = Expression.Lambda(eventInfo.EventHandlerType, Expression.Call(Expression.Constant(action), typeof(Action).GetMethod("Invoke")), parameters).Compile();
                eventInfo.AddEventHandler(target, handler);
                return true;
            }
            private static bool ContainsLoadingVisual(DependencyObject node)
            {
                var text = node as TextBlock;
                if (text != null && text.IsVisible && (text.Text.StartsWith("Loading", StringComparison.OrdinalIgnoreCase) || text.Text.StartsWith("Chargement", StringComparison.OrdinalIgnoreCase))) return true;
                for (var i = 0; i < VisualTreeHelper.GetChildrenCount(node); i++)
                    if (ContainsLoadingVisual(VisualTreeHelper.GetChild(node, i))) return true;
                return false;
            }
            private static object Property(object target, string name)
            {
                if (target == null) return null;
                var property = target.GetType().GetProperty(name, BindingFlags.Public | BindingFlags.Instance);
                return property == null ? null : property.GetValue(target, null);
            }
            private static long Count(object collection) { return Number(Property(collection, "Count")); }
            private static long Number(object value) { return value == null ? 0 : Convert.ToInt64(value, CultureInfo.InvariantCulture); }
        }

        private static int ParseDimension(string value, int minimum, int maximum)
        {
            int number;
            if (!int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out number) || number < minimum || number > maximum)
                throw new ArgumentException("Dimensions d'aperçu invalides.");
            return number;
        }
        private static Dictionary<string, string> TrustedReferences()
        {
            var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var directory in new[] { quickLookRoot, Path.Combine(quickLookRoot, "QuickLook.Plugin"), officeRoot })
            {
                if (!Directory.Exists(directory)) continue;
                foreach (var path in Directory.GetFiles(directory, "*.dll", directory == quickLookRoot ? SearchOption.TopDirectoryOnly : SearchOption.AllDirectories))
                {
                    var name = Path.GetFileName(path);
                    // Explicit office directory wins over another installed plugin's dependency copy.
                    if (!result.ContainsKey(name) || directory == officeRoot) result[name] = path;
                }
            }
            return result;
        }
        private static Assembly Resolve(object sender, ResolveEventArgs args)
        {
            var requested = new AssemblyName(args.Name);
            string path;
            if (references == null || !references.TryGetValue(requested.Name + ".dll", out path)) return null;
            var actual = AssemblyName.GetAssemblyName(path);
            if (!string.Equals(actual.Name, requested.Name, StringComparison.OrdinalIgnoreCase)) return null;
            var token = requested.GetPublicKeyToken();
            if (token != null && token.Length != 0 && !token.SequenceEqual(actual.GetPublicKeyToken() ?? new byte[0])) return null;
            return Assembly.LoadFrom(path);
        }
        private static void RequestQuickLookClose()
        {
            Task.Run(delegate
            {
                try
                {
                    var pipe = "QuickLook.App.Pipe." + WindowsIdentity.GetCurrent().User.Value;
                    using (var connection = new NamedPipeClientStream(".", pipe, PipeDirection.Out))
                    {
                        connection.Connect(400);
                        using (var writer = new StreamWriter(connection, new UTF8Encoding(false)))
                            writer.WriteLine("QuickLook.App.PipeMessages.Close||");
                    }
                }
                catch { }
            });
        }
        private static void Emit(string phase, IntPtr hwnd, string error)
        {
            Console.WriteLine(Protocol.Encode(new { phase = phase, hwnd = hwnd == IntPtr.Zero ? null : hwnd.ToInt64().ToString(CultureInfo.InvariantCulture), error = error }));
            Console.Out.Flush();
        }
        private static void ReportError(Exception error)
        {
            while (error is TargetInvocationException && error.InnerException != null) error = error.InnerException;
            Console.Error.WriteLine(error.GetType().FullName + " HRESULT=" + error.HResult.ToString("X8", CultureInfo.InvariantCulture));
            Emit("error", IntPtr.Zero, "Ce document n'a pas pu être préparé. Ouvre-le dans ton application pour continuer.");
        }
    }
}
