using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using Windows.Data.Pdf;
using Windows.Foundation;
using Windows.Globalization;
using Windows.Graphics.Imaging;
using Windows.Media.Ocr;
using Windows.Storage;
using Windows.Storage.Streams;
using FileAttributes = System.IO.FileAttributes;

// Local, one-shot OCR. No network, language installation, clipboard access or
// file writes. PDF text extraction is attempted by the main-process service
// before this helper is asked to render only the pages requiring recognition.
// APIs: https://learn.microsoft.com/en-us/uwp/api/windows.media.ocr.ocrengine
// https://learn.microsoft.com/en-us/uwp/api/windows.data.pdf.pdfpage.rendertostreamasync
class OcrBridge {
 const long MaxFileBytes = 64L * 1024 * 1024;
 const int MaxPages = 20, MaxText = 512000, MaxInput = 16000;
 const uint RenderDimension = 3200;
 static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 4000000, RecursionLimit = 12 };
 static readonly Stopwatch JobClock = Stopwatch.StartNew();
 static string DiagnosticStage = "startup";
 sealed class OcrFailure : Exception {
  public readonly string Code;
  public OcrFailure(string code) { Code = code; }
 }
 static void Reply(object frame) { Console.WriteLine(Json.Serialize(frame)); Console.Out.Flush(); }
 static void CheckTime() { if (JobClock.ElapsedMilliseconds > 230000) throw new OcrFailure("timeout"); }
 static T Wait<T>(IAsyncOperation<T> operation) {
  Stopwatch clock = Stopwatch.StartNew();
  try {
   while (operation.Status == AsyncStatus.Started) {
    CheckTime(); if (clock.ElapsedMilliseconds > 60000) throw new OcrFailure("timeout"); Thread.Sleep(10);
   }
   return operation.GetResults();
  } finally { if (operation.Status == AsyncStatus.Started) operation.Cancel(); operation.Close(); }
 }
 static void Wait(IAsyncAction operation) {
  Stopwatch clock = Stopwatch.StartNew();
  try {
   while (operation.Status == AsyncStatus.Started) {
    CheckTime(); if (clock.ElapsedMilliseconds > 60000) throw new OcrFailure("timeout"); Thread.Sleep(10);
   }
   operation.GetResults();
  } finally { if (operation.Status == AsyncStatus.Started) operation.Cancel(); operation.Close(); }
 }
 static object GetCapabilities() {
  var languages = new List<object>();
  foreach (Language language in OcrEngine.AvailableRecognizerLanguages)
   languages.Add(new { tag = language.LanguageTag, name = language.DisplayName });
  OcrEngine engine = CreateEngine(null, false);
  return new { type = "capabilities", available = engine != null, languages = languages,
   defaultLanguage = engine == null ? null : engine.RecognizerLanguage.LanguageTag,
   maxImageDimension = OcrEngine.MaxImageDimension, renderDimension = Math.Min(RenderDimension, OcrEngine.MaxImageDimension),
   maxPages = MaxPages, maxFileBytes = MaxFileBytes, code = engine == null ? "language-unavailable" : null };
 }
 static OcrEngine CreateEngine(string requested, bool required) {
  OcrEngine engine = null;
  if (!String.IsNullOrEmpty(requested)) {
   if (requested.Length > 64) throw new OcrFailure("invalid-language");
   try { engine = OcrEngine.TryCreateFromLanguage(new Language(requested)); }
   catch (ArgumentException) { throw new OcrFailure("invalid-language"); }
  } else {
   engine = OcrEngine.TryCreateFromUserProfileLanguages();
   if (engine == null) foreach (Language language in OcrEngine.AvailableRecognizerLanguages) {
    engine = OcrEngine.TryCreateFromLanguage(language); if (engine != null) break;
   }
  }
  if (engine == null && required) throw new OcrFailure("language-unavailable");
  return engine;
 }
 static string ValidateFile(string supplied) {
  if (String.IsNullOrWhiteSpace(supplied) || supplied.Length > 4096 || supplied.Length < 3 ||
      !Char.IsLetter(supplied[0]) || supplied[1] != ':' || (supplied[2] != '\\' && supplied[2] != '/')) throw new OcrFailure("invalid-file");
  foreach (char character in supplied) if (character < 32 || character == 127) throw new OcrFailure("invalid-file");
  if (supplied.Substring(2).IndexOf(':') >= 0 || supplied.IndexOfAny(Path.GetInvalidPathChars()) >= 0) throw new OcrFailure("invalid-file");
  string file = Path.GetFullPath(supplied);
  FileInfo info = new FileInfo(file);
  if (!info.Exists) throw new OcrFailure("file-unavailable");
  if ((info.Attributes & (FileAttributes.Directory | FileAttributes.ReparsePoint)) != 0) throw new OcrFailure("invalid-file");
  string parent = info.DirectoryName;
  while (!String.IsNullOrEmpty(parent)) {
   if ((File.GetAttributes(parent) & FileAttributes.ReparsePoint) != 0) throw new OcrFailure("invalid-file");
   string next = Path.GetDirectoryName(parent); if (next == parent) break; parent = next;
  }
  if (info.Length == 0 || info.Length > MaxFileBytes) throw new OcrFailure("file-too-large");
  string extension = Path.GetExtension(file).ToLowerInvariant();
  if (extension != ".pdf" && extension != ".png" && extension != ".jpg" && extension != ".jpeg" && extension != ".webp" && extension != ".bmp" && extension != ".tif" && extension != ".tiff") throw new OcrFailure("unsupported-format");
  return file;
 }
 static string RecognizeBitmap(OcrEngine engine, IRandomAccessStream stream) {
  DiagnosticStage = "decode";
  stream.Seek(0);
  BitmapDecoder decoder = Wait(BitmapDecoder.CreateAsync(stream));
  uint width = decoder.PixelWidth, height = decoder.PixelHeight;
  if (width == 0 || height == 0 || width > 16000 || height > 16000 || (long)width * height > 64000000) throw new OcrFailure("image-too-large");
  uint maximum = Math.Min(RenderDimension, OcrEngine.MaxImageDimension);
  double scale = Math.Min(1.0, (double)maximum / Math.Max(width, height));
  BitmapTransform transform = new BitmapTransform {
   ScaledWidth = Math.Max(1U, (uint)Math.Floor(width * scale)), ScaledHeight = Math.Max(1U, (uint)Math.Floor(height * scale)),
   InterpolationMode = BitmapInterpolationMode.Fant
  };
  DiagnosticStage = "bitmap";
  using (SoftwareBitmap bitmap = Wait(decoder.GetSoftwareBitmapAsync(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Ignore,
   transform, ExifOrientationMode.RespectExifOrientation, ColorManagementMode.DoNotColorManage))) {
   DiagnosticStage = "recognition";
   OcrResult result = Wait(engine.RecognizeAsync(bitmap));
   var lines = new List<string>(); foreach (OcrLine line in result.Lines) lines.Add(line.Text);
   string text = String.Join("\n", lines);
   if (text.Length > MaxText) throw new OcrFailure("text-too-large");
   return text;
  }
 }
 static List<int> PageNumbers(object selection, uint totalPages) {
  var pages = new List<int>();
  if (selection == null) {
   for (int page = 1; page <= Math.Min((int)totalPages, MaxPages); page++) pages.Add(page);
  } else {
   var list = selection as IEnumerable;
   if (list == null || selection is string) throw new OcrFailure("invalid-pages");
   var unique = new HashSet<int>();
   foreach (object value in list) {
    if (!(value is int)) throw new OcrFailure("invalid-pages");
    int page = (int)value;
    if (page < 1 || page > totalPages || !unique.Add(page) || pages.Count >= MaxPages) throw new OcrFailure("invalid-pages");
    pages.Add(page);
   }
   if (pages.Count == 0) throw new OcrFailure("invalid-pages");
   pages.Sort();
  }
  return pages;
 }
 static void Recognize(Dictionary<string, object> input) {
  object rawPath, rawLanguage, selection;
  if (!input.TryGetValue("path", out rawPath) || !(rawPath is string)) throw new OcrFailure("invalid-file");
  string path = ValidateFile((string)rawPath);
  input.TryGetValue("language", out rawLanguage);
  if (rawLanguage != null && !(rawLanguage is string)) throw new OcrFailure("invalid-language");
  OcrEngine engine = CreateEngine(rawLanguage as string, true);
  StorageFile file = Wait(StorageFile.GetFileFromPathAsync(path));
  bool pdf = Path.GetExtension(path).Equals(".pdf", StringComparison.OrdinalIgnoreCase);
  uint total = 1;
  PdfDocument document = null;
  if (pdf) { document = Wait(PdfDocument.LoadFromFileAsync(file)); total = document.PageCount; }
  if (total == 0 || total > 2000) throw new OcrFailure("invalid-pages");
  input.TryGetValue("pages", out selection);
  List<int> pages = PageNumbers(selection, total);
  var pageTexts = new List<object>();
  var texts = new List<string>(); int textLength = 0;
  for (int index = 0; index < pages.Count; index++) {
   CheckTime(); int number = pages[index]; string text;
   Reply(new { type = "progress", stage = "recognizing", page = number, completed = index, total = pages.Count });
   if (pdf) {
    using (PdfPage page = document.GetPage((uint)(number - 1)))
    using (var stream = new InMemoryRandomAccessStream()) {
     double width = page.Size.Width, height = page.Size.Height;
     if (width <= 0 || height <= 0 || Double.IsNaN(width) || Double.IsNaN(height) || Double.IsInfinity(width) || Double.IsInfinity(height)) throw new OcrFailure("invalid-pages");
     double scale = Math.Min(3.125, Math.Min(RenderDimension, OcrEngine.MaxImageDimension) / Math.Max(width, height));
     var options = new PdfPageRenderOptions { DestinationWidth = Math.Max(1U, (uint)(width * scale)), DestinationHeight = Math.Max(1U, (uint)(height * scale)) };
     Wait(page.RenderToStreamAsync(stream, options));
     text = RecognizeBitmap(engine, stream);
    }
   } else {
    using (IRandomAccessStream stream = Wait(file.OpenAsync(FileAccessMode.Read))) text = RecognizeBitmap(engine, stream);
   }
   textLength += text.Length;
   if (textLength > MaxText) throw new OcrFailure("text-too-large");
   texts.Add(text); pageTexts.Add(new { page = number, text = text });
   Reply(new { type = "progress", stage = "page-completed", page = number, completed = index + 1, total = pages.Count });
  }
  Reply(new { type = "result", text = String.Join("\n\n", texts), pageTexts = pageTexts, pages = pages,
   totalPages = total, truncated = selection == null && total > MaxPages, language = engine.RecognizerLanguage.LanguageTag });
 }
 [MTAThread]
 static int Main() {
  Console.InputEncoding = new UTF8Encoding(false); Console.OutputEncoding = new UTF8Encoding(false);
  try {
   var builder = new StringBuilder(); int character;
   while ((character = Console.Read()) >= 0 && character != '\n') { if (builder.Length >= MaxInput) throw new OcrFailure("invalid-request"); builder.Append((char)character); }
   var input = Json.Deserialize<Dictionary<string, object>>(builder.ToString()); object command;
   if (input == null || !input.TryGetValue("command", out command) || !(command is string)) throw new OcrFailure("invalid-request");
   if ((string)command == "capabilities") Reply(GetCapabilities());
   else if ((string)command == "recognize") Recognize(input);
   else throw new OcrFailure("invalid-request");
   return 0;
  } catch (OcrFailure error) { Reply(new { type = "error", code = error.Code }); }
    catch (FileNotFoundException) { Reply(new { type = "error", code = "file-unavailable" }); }
    catch (UnauthorizedAccessException) { Reply(new { type = "error", code = "access-denied" }); }
    catch (Exception error) {
     Console.Error.WriteLine(DiagnosticStage + " " + error.GetType().FullName + " 0x" + error.HResult.ToString("X8"));
     string code = error.HResult == unchecked((int)0x80040154) || error is TypeLoadException || error is DllNotFoundException ? "ocr-unavailable" : "recognition-failed";
     Reply(new { type = "error", code = code });
    }
  return 1;
 }
}
