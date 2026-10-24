// Copyright (C) 2026 Notchy contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Uses the unchanged HTML renderer from QL-Win/QuickLook (GPL-3.0-or-later).
using QuickLook.Common.Helpers;
using QuickLook.Common.Plugin;
using QuickLook.Common.Plugin.MoreMenu;
using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Windows;
using System.Windows.Threading;

namespace QuickLook.Plugin.PDFViewer;

/// <summary>Compact initial HTML bounds; rendering and manual window controls remain upstream.</summary>
public sealed class CompactHtmlPlugin : IViewer, IMoreMenu
{
    private IViewer _original;
    private DispatcherOperation _resize;
    private int _generation;

    public CompactHtmlPlugin() { }
    internal CompactHtmlPlugin(IViewer original) { _original = original; }

    private IViewer Original => _original ??= (IViewer)Activator.CreateInstance(
        Assembly.LoadFrom(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,
            "QuickLook.Plugin", "QuickLook.Plugin.HtmlViewer", "QuickLook.Plugin.HtmlViewer.dll"))
        .GetType("QuickLook.Plugin.HtmlViewer.Plugin", true));

    public int Priority => 1;
    public IEnumerable<IMenuItem> MenuItems => (Original as IMoreMenu)?.MenuItems ?? Array.Empty<IMenuItem>();
    public void Init() { Original.Init(); }
    public bool CanHandle(string path) => Original.CanHandle(path);

    public void Prepare(string path, ContextObject context)
    {
        CancelResize();
        Original.Prepare(path, context);
        // F11 is an explicit user choice; its upstream window remains Normal but borderless and non-resizable.
        if (context.Source is Window fullscreen && fullscreen.ResizeMode == ResizeMode.NoResize && fullscreen.WindowStyle == WindowStyle.None) return;
        context.SetPreferredSizeFit(new Size(800, 520), .70);
        context.CanResize = true;
        if (context.Source is not Window window) return;
        window.WindowState = WindowState.Normal;
        var generation = _generation;
        // BeginShow can override PreferredSize with a previous manual size. Correct once, before rendering.
        _resize = window.Dispatcher.BeginInvoke(new Action(() =>
        {
            _resize = null;
            if (generation != _generation || !ReferenceEquals(context.Source, window)) return;
            ApplyInitialBounds(window, context);
        }), DispatcherPriority.Send);
    }

    internal static void ApplyInitialBounds(Window window, ContextObject context)
    {
        window.WindowState = WindowState.Normal;
        var area = WindowHelper.GetDesktopRectFromWindowInPixel(window);
        var scale = DisplayDeviceHelper.GetScaleFactorFromWindow(window);
        var caption = window.FindName("windowCaptionContainer") as FrameworkElement;
        var captionHeight = context.TitlebarOverlap ? 0 : caption?.Height ?? 32;
        if (double.IsNaN(captionHeight) || double.IsInfinity(captionHeight)) captionHeight = 32;
        var width = Math.Max(window.MinWidth, Math.Min(context.PreferredSize.Width + window.BorderThickness.Left + window.BorderThickness.Right, area.Width / scale.Horizontal * .70));
        var height = Math.Max(window.MinHeight, Math.Min(context.PreferredSize.Height + window.BorderThickness.Top + window.BorderThickness.Bottom + captionHeight, area.Height / scale.Vertical * .70));
        window.Width = width;
        window.Height = height;
        window.MoveWindow(area.Left + (area.Width - width * scale.Horizontal) / 2,
            area.Top + (area.Height - height * scale.Vertical) / 2, width, height);
    }

    public void View(string path, ContextObject context) { Original.View(path, context); }
    private void CancelResize() { _generation++; _resize?.Abort(); _resize = null; }
    public void Cleanup() { CancelResize(); _original?.Cleanup(); }
}
