using System;
using System.Threading;
using System.Collections.Generic;
using System.Globalization;
using System.Web.Script.Serialization;
using Windows.Foundation;
using Windows.Media.Control;
using Windows.Media;
class MediaBridge {
 static GlobalSystemMediaTransportControlsSession watched;

 static void Changed(){Console.WriteLine("{\"event\":\"changed\"}");Console.Out.Flush();}
 static void MediaChanged(GlobalSystemMediaTransportControlsSession s,MediaPropertiesChangedEventArgs e){Changed();}
 static void PlaybackChanged(GlobalSystemMediaTransportControlsSession s,PlaybackInfoChangedEventArgs e){Changed();}
 static void TimelineChanged(GlobalSystemMediaTransportControlsSession s,TimelinePropertiesChangedEventArgs e){Changed();}
 static void Watch(GlobalSystemMediaTransportControlsSession session){
 if(Object.ReferenceEquals(watched,session))return;
 if(watched!=null){watched.MediaPropertiesChanged-=MediaChanged;watched.PlaybackInfoChanged-=PlaybackChanged;watched.TimelinePropertiesChanged-=TimelineChanged;}
 watched=session;
 if(watched!=null){watched.MediaPropertiesChanged+=MediaChanged;watched.PlaybackInfoChanged+=PlaybackChanged;watched.TimelinePropertiesChanged+=TimelineChanged;}
 }

 static T Await<T>(IAsyncOperation<T> op){int n=0;while(op.Status==AsyncStatus.Started){Thread.Sleep(5);if(++n>1200)throw new TimeoutException();}return op.GetResults();}
 static long SeekTicks(long start,long end,double seconds){
 long duration=checked(end-start);
 if(duration<=0||Double.IsNaN(seconds)||Double.IsInfinity(seconds)||seconds<0||seconds>duration/(double)TimeSpan.TicksPerSecond)throw new ArgumentException();
 long offset=Convert.ToInt64(Math.Round(seconds*TimeSpan.TicksPerSecond,MidpointRounding.AwayFromZero));
 if(offset<0||offset>duration)throw new ArgumentException();
 return checked(start+offset);
 }
 [MTAThread] static void Main(){Console.OutputEncoding=new System.Text.UTF8Encoding(false);var json=new JavaScriptSerializer();json.MaxJsonLength=6000000;GlobalSystemMediaTransportControlsSessionManager manager=null;string key=null,cover=null,sent=null;DateTime coverAttempt=DateTime.MinValue;string line;
 while((line=Console.ReadLine())!=null){int id=0;try{if(line.Length>1024)throw new ArgumentException();var request=json.Deserialize<Dictionary<string,object>>(line);if(request==null||!request.ContainsKey("id")||!(request["id"] is int||request["id"] is long))throw new ArgumentException();id=Convert.ToInt32(request["id"]);if(id<=0)throw new ArgumentException();string command=(string)request["command"];if(command!="get"&&command!="toggle"&&command!="next"&&command!="previous"&&command!="shuffle"&&command!="repeat"&&command!="seek")throw new ArgumentException();if(request.Count!=(command=="seek"?3:2))throw new ArgumentException();double seekPosition=0;if(command=="seek"){object value=request["position"];if(!(value is int||value is long||value is double||value is decimal))throw new ArgumentException();seekPosition=Convert.ToDouble(value,CultureInfo.InvariantCulture);if(Double.IsNaN(seekPosition)||Double.IsInfinity(seekPosition)||seekPosition<0)throw new ArgumentException();}if(manager==null){manager=Await(GlobalSystemMediaTransportControlsSessionManager.RequestAsync());manager.SessionsChanged+=(s,e)=>Changed();}GlobalSystemMediaTransportControlsSession session=null;foreach(var candidate in manager.GetSessions()){if(candidate.SourceAppUserModelId.IndexOf("Spotify",StringComparison.OrdinalIgnoreCase)>=0){session=candidate;break;}}
 Watch(session);if(session==null){sent=null;Console.WriteLine(json.Serialize(new {id=id,available=false}));continue;}
 bool ok=true;switch(command){case "get":break;case "toggle":ok=Await(session.TryTogglePlayPauseAsync());break;case "next":ok=Await(session.TrySkipNextAsync());break;case "previous":ok=Await(session.TrySkipPreviousAsync());break;case "shuffle":{var current=session.GetPlaybackInfo();ok=current.Controls.IsShuffleEnabled&&current.IsShuffleActive.HasValue&&Await(session.TryChangeShuffleActiveAsync(!current.IsShuffleActive.Value));break;}
 case "repeat":{var current=session.GetPlaybackInfo();var mode=current.AutoRepeatMode;ok=current.Controls.IsRepeatEnabled&&mode.HasValue&&Await(session.TryChangeAutoRepeatModeAsync(mode.Value==MediaPlaybackAutoRepeatMode.None?MediaPlaybackAutoRepeatMode.List:mode.Value==MediaPlaybackAutoRepeatMode.List?MediaPlaybackAutoRepeatMode.Track:MediaPlaybackAutoRepeatMode.None));break;}
 case "seek":{var current=session.GetPlaybackInfo();var seekTimeline=session.GetTimelineProperties();if(!current.Controls.IsPlaybackPositionEnabled||seekTimeline.EndTime<=seekTimeline.StartTime){ok=false;break;}long target=SeekTicks(seekTimeline.StartTime.Ticks,seekTimeline.EndTime.Ticks,seekPosition);ok=Await(session.TryChangePlaybackPositionAsync(target));break;}
 default:throw new ArgumentException();}
 var props=Await(session.TryGetMediaPropertiesAsync());var info=session.GetPlaybackInfo();var timeline=session.GetTimelineProperties();bool playing=info.PlaybackStatus==GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing;double duration=Math.Max(0,(timeline.EndTime-timeline.StartTime).TotalSeconds),position=(timeline.Position-timeline.StartTime).TotalSeconds;if(playing)position+=Math.Max(0,(DateTimeOffset.UtcNow-timeline.LastUpdatedTime).TotalSeconds);position=Math.Max(0,Math.Min(duration,position));string nextKey=props.Title+"|"+props.Artist+"|"+props.AlbumTitle;
 if(nextKey!=key||cover==null&&(DateTime.UtcNow-coverAttempt).TotalSeconds>30){key=nextKey;cover=null;coverAttempt=DateTime.UtcNow;try{if(props.Thumbnail!=null)cover=CoverReader.Read(props.Thumbnail);}catch{}}
 var reply=new Dictionary<string,object>{{"id",id},{"available",true},{"ok",ok},{"title",props.Title},{"artist",props.Artist},{"playing",playing},{"position",position},{"duration",duration},{"canSeek",info.Controls.IsPlaybackPositionEnabled&&duration>0},{"canToggle",info.Controls.IsPlayPauseToggleEnabled},{"canNext",info.Controls.IsNextEnabled},{"canPrevious",info.Controls.IsPreviousEnabled},{"canShuffle",info.Controls.IsShuffleEnabled},{"canRepeat",info.Controls.IsRepeatEnabled},{"shuffle",info.IsShuffleActive},{"repeat",info.AutoRepeatMode.HasValue?info.AutoRepeatMode.Value.ToString().ToLowerInvariant():null}};
 if(sent!=key){reply["cover"]=cover;sent=key;}else if(cover==null){reply["cover"]=null;sent=null;}
 Console.WriteLine(json.Serialize(reply));
 }catch{Console.WriteLine(json.Serialize(new{id=id,error="Spotify indisponible"}));manager=null;}Console.Out.Flush();}
 }
}
