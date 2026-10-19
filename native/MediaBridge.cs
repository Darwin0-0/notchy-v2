using System;
using System.Threading;
using System.Collections.Generic;
using System.Globalization;
using System.Web.Script.Serialization;
using Windows.Foundation;
using Windows.Media.Control;
using Windows.Media;

class MediaBridge {
 static readonly object outputLock = new object();
 static readonly List<GlobalSystemMediaTransportControlsSession> watched = new List<GlobalSystemMediaTransportControlsSession>();
 static long mediaRevision;

 static void Write(string value) { lock(outputLock) { Console.WriteLine(value); Console.Out.Flush(); } }
 static void Changed() { Write("{\"event\":\"changed\"}"); }
 static void MediaChanged(GlobalSystemMediaTransportControlsSession s, MediaPropertiesChangedEventArgs e) { Interlocked.Increment(ref mediaRevision); Changed(); }
 static void PlaybackChanged(GlobalSystemMediaTransportControlsSession s, PlaybackInfoChangedEventArgs e) { Changed(); }
 static void TimelineChanged(GlobalSystemMediaTransportControlsSession s, TimelinePropertiesChangedEventArgs e) { Changed(); }
 static void SessionsChanged(GlobalSystemMediaTransportControlsSessionManager s, SessionsChangedEventArgs e) { Changed(); }
 static void CurrentChanged(GlobalSystemMediaTransportControlsSessionManager s, CurrentSessionChangedEventArgs e) { Changed(); }

 static bool SameSession(GlobalSystemMediaTransportControlsSession a, GlobalSystemMediaTransportControlsSession b) {
  return Object.ReferenceEquals(a, b) || a != null && a.Equals(b);
 }
 static int SessionIndex(List<GlobalSystemMediaTransportControlsSession> sessions, GlobalSystemMediaTransportControlsSession value) {
  if(value != null) for(int i=0; i<sessions.Count; i++) if(SameSession(sessions[i], value)) return i;
  return -1;
 }
 static void Watch(List<GlobalSystemMediaTransportControlsSession> sessions) {
  for(int i=watched.Count-1; i>=0; i--) if(SessionIndex(sessions, watched[i]) < 0) {
   var old = watched[i];
   try { old.MediaPropertiesChanged -= MediaChanged; old.PlaybackInfoChanged -= PlaybackChanged; old.TimelinePropertiesChanged -= TimelineChanged; } catch { }
   watched.RemoveAt(i);
  }
  foreach(var session in sessions) if(SessionIndex(watched, session) < 0) {
   try {
    session.MediaPropertiesChanged += MediaChanged;
    session.PlaybackInfoChanged += PlaybackChanged;
    session.TimelinePropertiesChanged += TimelineChanged;
    watched.Add(session);
   } catch { }
  }
 }
 static void ResetManager(ref GlobalSystemMediaTransportControlsSessionManager manager) {
  Watch(new List<GlobalSystemMediaTransportControlsSession>());
  if(manager != null) {
   try { manager.SessionsChanged -= SessionsChanged; manager.CurrentSessionChanged -= CurrentChanged; } catch { }
   manager = null;
  }
 }

 // Prefer real playback over a paused system selection, while keeping paused controls available.
 static int SelectSessionIndex(bool[] usable, bool[] playing, int current, int previous) {
  if(usable.Length != playing.Length) throw new ArgumentException();
  if(current >= 0 && current < usable.Length && usable[current] && playing[current]) return current;
  if(previous >= 0 && previous < usable.Length && usable[previous] && playing[previous]) return previous;
  for(int i=0; i<usable.Length; i++) if(usable[i] && playing[i]) return i;
  if(current >= 0 && current < usable.Length && usable[current]) return current;
  if(previous >= 0 && previous < usable.Length && usable[previous]) return previous;
  for(int i=0; i<usable.Length; i++) if(usable[i]) return i;
  return -1;
 }
 static string SourceName(string sourceId) {
  string value = (sourceId ?? "").ToLowerInvariant();
  if(value.Contains("spotify")) return "Spotify";
  if(value.Contains("vlc")) return "VLC";
  if(value.Contains("msedge") || value.Contains("microsoftedge")) return "Microsoft Edge";
  if(value.Contains("chrome")) return "Google Chrome";
  if(value.Contains("firefox")) return "Firefox";
  if(value.Contains("brave")) return "Brave";
  if(value.Contains("opera")) return "Opera";
  if(value.Contains("applemusic")) return "Apple Music";
  if(value.Contains("amazonmusic")) return "Amazon Music";
  if(value.Contains("deezer")) return "Deezer";
  if(value.Contains("tidal")) return "TIDAL";
  if(value.Contains("foobar2000")) return "foobar2000";
  if(value.Contains("zunemusic") || value.Contains("wmplayer") || value.Contains("windowsmedia")) return "Windows Media Player";
  return "Windows Media";
 }
 static bool CanToggle(bool playing, bool toggle, bool play, bool pause) {
  return toggle || (playing ? pause : play);
 }
 static bool SeekSourceMatches(string expected, string actual) {
  return !String.IsNullOrEmpty(expected) && String.Equals(expected, actual, StringComparison.Ordinal);
 }
 static bool ShouldReadCover(string key, string nextKey, string cover, long cachedRevision, long revision, DateTime attempted, DateTime now) {
  return key != nextKey || cachedRevision != revision || String.IsNullOrEmpty(cover) && (now-attempted).TotalSeconds > 30;
 }
 static T Await<T>(IAsyncOperation<T> op) {
  int n=0;
  while(op.Status == AsyncStatus.Started) { Thread.Sleep(5); if(++n > 1200) throw new TimeoutException(); }
  return op.GetResults();
 }
 static long SeekTicks(long start, long end, double seconds) {
  long duration = checked(end-start);
  if(duration <= 0 || Double.IsNaN(seconds) || Double.IsInfinity(seconds) || seconds < 0 || seconds > duration/(double)TimeSpan.TicksPerSecond) throw new ArgumentException();
  long offset = Convert.ToInt64(Math.Round(seconds*TimeSpan.TicksPerSecond, MidpointRounding.AwayFromZero));
  if(offset < 0 || offset > duration) throw new ArgumentException();
  return checked(start+offset);
 }

 [MTAThread] static void Main() {
  Console.OutputEncoding = new System.Text.UTF8Encoding(false);
  var json = new JavaScriptSerializer(); json.MaxJsonLength = 6000000;
  GlobalSystemMediaTransportControlsSessionManager manager = null;
  GlobalSystemMediaTransportControlsSession previous = null;
  string key=null, cover=null, sent=null, line;
  long coverRevision=-1;
  DateTime coverAttempt = DateTime.MinValue;
  while((line=Console.ReadLine()) != null) {
   int id=0;
   try {
    if(line.Length > 1024) throw new ArgumentException();
    var request = json.Deserialize<Dictionary<string,object>>(line);
    if(request == null || !request.ContainsKey("id") || !(request["id"] is int || request["id"] is long)) throw new ArgumentException();
    id = Convert.ToInt32(request["id"]); if(id <= 0) throw new ArgumentException();
    string command = (string)request["command"];
    if(command != "get" && command != "toggle" && command != "next" && command != "previous" && command != "shuffle" && command != "repeat" && command != "seek") throw new ArgumentException();
    if(request.Count != (command == "seek" ? 4 : 2)) throw new ArgumentException();
    double seekPosition=0;
    string expectedSourceId=null;
    if(command == "seek") {
     object value = request["position"];
     if(!(value is int || value is long || value is double || value is decimal)) throw new ArgumentException();
     seekPosition = Convert.ToDouble(value, CultureInfo.InvariantCulture);
     if(Double.IsNaN(seekPosition) || Double.IsInfinity(seekPosition) || seekPosition < 0) throw new ArgumentException();
     expectedSourceId=request["sourceId"] as string;
     if(String.IsNullOrEmpty(expectedSourceId) || expectedSourceId.Length > 256) throw new ArgumentException();
     foreach(char character in expectedSourceId) if(Char.IsControl(character)) throw new ArgumentException();
    }
    if(manager == null) {
     manager = Await(GlobalSystemMediaTransportControlsSessionManager.RequestAsync());
     manager.SessionsChanged += SessionsChanged; manager.CurrentSessionChanged += CurrentChanged;
    }
    var sessions = new List<GlobalSystemMediaTransportControlsSession>(manager.GetSessions());
    Watch(sessions);
    var usable = new bool[sessions.Count]; var playingStates = new bool[sessions.Count];
    for(int i=0; i<sessions.Count; i++) {
     try {
      var status = sessions[i].GetPlaybackInfo().PlaybackStatus;
      usable[i] = status != GlobalSystemMediaTransportControlsSessionPlaybackStatus.Closed;
      playingStates[i] = status == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing;
     } catch { }
    }
    int selected = SelectSessionIndex(usable, playingStates, SessionIndex(sessions, manager.GetCurrentSession()), SessionIndex(sessions, previous));
    if(selected < 0) { previous=null; key=null; cover=null; sent=null; Write(json.Serialize(new {id=id, available=false})); continue; }
    var session = sessions[selected];
    string sourceId=session.SourceAppUserModelId ?? "";
    if(!SameSession(previous, session)) { key=null; cover=null; sent=null; }
    previous = session;
    bool ok=true;
    var before = session.GetPlaybackInfo();
    switch(command) {
     case "get": break;
     case "toggle":
      bool wasPlaying = before.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing;
      if(wasPlaying && before.Controls.IsPauseEnabled) ok=Await(session.TryPauseAsync());
      else if(!wasPlaying && before.Controls.IsPlayEnabled) ok=Await(session.TryPlayAsync());
      else ok=before.Controls.IsPlayPauseToggleEnabled && Await(session.TryTogglePlayPauseAsync());
      break;
     case "next": ok=before.Controls.IsNextEnabled && Await(session.TrySkipNextAsync()); break;
     case "previous": ok=before.Controls.IsPreviousEnabled && Await(session.TrySkipPreviousAsync()); break;
     case "shuffle": ok=before.Controls.IsShuffleEnabled && before.IsShuffleActive.HasValue && Await(session.TryChangeShuffleActiveAsync(!before.IsShuffleActive.Value)); break;
     case "repeat":
      var mode=before.AutoRepeatMode;
      ok=before.Controls.IsRepeatEnabled && mode.HasValue && Await(session.TryChangeAutoRepeatModeAsync(mode.Value == MediaPlaybackAutoRepeatMode.None ? MediaPlaybackAutoRepeatMode.List : mode.Value == MediaPlaybackAutoRepeatMode.List ? MediaPlaybackAutoRepeatMode.Track : MediaPlaybackAutoRepeatMode.None));
      break;
     case "seek":
      if(!SeekSourceMatches(expectedSourceId, sourceId)) { ok=false; break; }
      var seekTimeline=session.GetTimelineProperties();
      if(!before.Controls.IsPlaybackPositionEnabled || seekTimeline.EndTime <= seekTimeline.StartTime) { ok=false; break; }
      ok=Await(session.TryChangePlaybackPositionAsync(SeekTicks(seekTimeline.StartTime.Ticks, seekTimeline.EndTime.Ticks, seekPosition)));
      break;
     default: throw new ArgumentException();
    }
    // Capture before the async read: a newer event during the read must remain pending.
    long revision=Interlocked.Read(ref mediaRevision);
    var props=Await(session.TryGetMediaPropertiesAsync()); var info=session.GetPlaybackInfo(); var timeline=session.GetTimelineProperties();
    bool playing=info.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing;
    double duration=Math.Max(0, (timeline.EndTime-timeline.StartTime).TotalSeconds), position=(timeline.Position-timeline.StartTime).TotalSeconds;
    if(playing) position+=Math.Max(0, (DateTimeOffset.UtcNow-timeline.LastUpdatedTime).TotalSeconds);
    position=Math.Max(0, Math.Min(duration, position));
    string nextKey=sourceId+"|"+props.Title+"|"+props.Artist+"|"+props.AlbumTitle;
    if(ShouldReadCover(key, nextKey, cover, coverRevision, revision, coverAttempt, DateTime.UtcNow)) {
     key=nextKey; cover=null; sent=null; coverAttempt=DateTime.UtcNow; coverRevision=revision;
     try { if(props.Thumbnail != null) cover=CoverReader.Read(props.Thumbnail); } catch { }
    }
    var reply=new Dictionary<string,object> {
     {"id",id}, {"available",true}, {"ok",ok}, {"title",props.Title}, {"artist",props.Artist}, {"source",SourceName(sourceId)}, {"sourceId",sourceId},
     {"playing",playing}, {"position",position}, {"duration",duration}, {"canSeek",info.Controls.IsPlaybackPositionEnabled && duration > 0},
     {"canToggle",CanToggle(playing, info.Controls.IsPlayPauseToggleEnabled, info.Controls.IsPlayEnabled, info.Controls.IsPauseEnabled)},
     {"canNext",info.Controls.IsNextEnabled}, {"canPrevious",info.Controls.IsPreviousEnabled}, {"canShuffle",info.Controls.IsShuffleEnabled}, {"canRepeat",info.Controls.IsRepeatEnabled},
     {"shuffle",info.IsShuffleActive}, {"repeat",info.AutoRepeatMode.HasValue ? info.AutoRepeatMode.Value.ToString().ToLowerInvariant() : null}
    };
    if(sent != key) { reply["cover"]=cover; sent=key; } else if(cover == null) { reply["cover"]=null; sent=null; }
    Write(json.Serialize(reply));
   } catch {
    Write(json.Serialize(new {id=id, error="Lecteur Windows indisponible"}));
    ResetManager(ref manager); previous=null; key=null; cover=null; sent=null;
   }
  }
  ResetManager(ref manager);
 }
}
