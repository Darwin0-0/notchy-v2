// Copyright (C) 2026 Notchy contributors. GPL-3.0-or-later; see LICENSE-GPL.txt.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;

namespace Notchy.OfficePreview
{
    internal static class Protocol
    {
        internal static string Encode(object value) { return new JavaScriptSerializer().Serialize(value); }
        internal static Dictionary<string, object> Decode(string json)
        {
            if (json == null || json.Length > 65536) throw new InvalidOperationException("Réponse du moteur invalide.");
            var result = new JavaScriptSerializer { MaxJsonLength = 65536 }.DeserializeObject(json) as Dictionary<string, object>;
            if (result == null) throw new InvalidOperationException("Réponse du moteur invalide.");
            return result;
        }
        internal static string Text(Dictionary<string, object> value, string name)
        {
            object item;
            return value.TryGetValue(name, out item) && item != null ? Convert.ToString(item, CultureInfo.InvariantCulture) : null;
        }
        internal static int Dimension(double value, int minimum, int maximum)
        {
            return double.IsNaN(value) || double.IsInfinity(value) ? minimum : Math.Max(minimum, Math.Min(maximum, (int)Math.Round(value)));
        }
    }

    internal static class Native
    {
        internal const int GwlStyle = -16;
        internal const long Child = 0x40000000L, Visible = 0x10000000L, Popup = 0x80000000L;
        internal const long Caption = 0x00c00000L, ThickFrame = 0x00040000L;
        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        internal static extern IntPtr CreateWindowEx(int exStyle, string className, string title, int style, int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr data);
        [DllImport("user32.dll", SetLastError = true)] internal static extern bool DestroyWindow(IntPtr hwnd);
        [DllImport("user32.dll", SetLastError = true)] internal static extern IntPtr SetParent(IntPtr child, IntPtr parent);
        [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] private static extern IntPtr GetWindowLongPtr64(IntPtr hwnd, int index);
        [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] private static extern int GetWindowLong32(IntPtr hwnd, int index);
        [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")] private static extern IntPtr SetWindowLongPtr64(IntPtr hwnd, int index, IntPtr value);
        [DllImport("user32.dll", EntryPoint = "SetWindowLongW")] private static extern int SetWindowLong32(IntPtr hwnd, int index, int value);
        internal static long Style(IntPtr hwnd) { return IntPtr.Size == 8 ? GetWindowLongPtr64(hwnd, GwlStyle).ToInt64() : (uint)GetWindowLong32(hwnd, GwlStyle); }
        internal static void Style(IntPtr hwnd, long style)
        {
            if (IntPtr.Size == 8) SetWindowLongPtr64(hwnd, GwlStyle, new IntPtr(style));
            else SetWindowLong32(hwnd, GwlStyle, unchecked((int)style));
        }
        [DllImport("user32.dll", SetLastError = true)] internal static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int width, int height, uint flags);
        [DllImport("user32.dll")] internal static extern bool IsWindow(IntPtr hwnd);
        [DllImport("user32.dll")] internal static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint process);
        [DllImport("user32.dll")] internal static extern IntPtr GetParent(IntPtr hwnd);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern IntPtr OpenProcess(uint access, bool inherit, uint process);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern bool QueryFullProcessImageName(IntPtr process, uint flags, System.Text.StringBuilder path, ref uint length);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool TerminateProcess(IntPtr process, uint exitCode);
        [DllImport("kernel32.dll")] internal static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
        [DllImport("kernel32.dll")] internal static extern bool CloseHandle(IntPtr handle);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern bool SetDllDirectory(string path);
    }
}
