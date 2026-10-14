using System;
using System.Threading;
using Windows.Storage.Streams;
using Windows.Foundation;
public static class CoverReader {
 static string ImageType(byte[] bytes) {
  if(bytes.Length>=8&&bytes[0]==137&&bytes[1]==80&&bytes[2]==78&&bytes[3]==71&&bytes[4]==13&&bytes[5]==10&&bytes[6]==26&&bytes[7]==10)return "image/png";
  if(bytes.Length>=3&&bytes[0]==255&&bytes[1]==216&&bytes[2]==255)return "image/jpeg";
  if(bytes.Length>=12&&bytes[0]==82&&bytes[1]==73&&bytes[2]==70&&bytes[3]==70&&bytes[8]==87&&bytes[9]==69&&bytes[10]==66&&bytes[11]==80)return "image/webp";
  return null;
 }
 public static string Read(IRandomAccessStreamReference reference) {
  var op=reference.OpenReadAsync();
  int count=0;while(op.Status==AsyncStatus.Started){Thread.Sleep(20);if(++count>250){op.Cancel();throw new TimeoutException();}}
  var stream=op.GetResults();
  try {
   if(stream.Size==0 || stream.Size>4000000)return null;
   var reader=new DataReader(stream.GetInputStreamAt(0));
   try{var load=reader.LoadAsync((uint)stream.Size);count=0;while(load.Status==AsyncStatus.Started){Thread.Sleep(20);if(++count>250){load.Cancel();throw new TimeoutException();}}var bytes=new byte[load.GetResults()];reader.ReadBytes(bytes);var type=ImageType(bytes);return type==null?null:"data:"+type+";base64,"+Convert.ToBase64String(bytes);}
   finally{reader.Dispose();}
  }finally{stream.Dispose();}
 }
}
