using System;
using System.Threading;
using System.Diagnostics;
using System.Globalization;
using NAudio.Wave;
using NAudio.Dsp;
using NAudio.CoreAudioApi;
class SpectrumBridge {
 const int N=2048;static float[] samples=new float[N];static int index=0;static object gate=new object();static float[] bands=new float[8];static long lastData=0;static volatile bool stopped=false;
 static readonly double[] edges={50,120,250,500,1000,2000,4000,8000,16000};
 static void Process(int rate){Complex[] data=new Complex[N];for(int i=0;i<N;i++)data[i].X=(float)(samples[i]*FastFourierTransform.HammingWindow(i,N));FastFourierTransform.FFT(true,11,data);var values=new float[8];for(int b=0;b<8;b++){int lo=Math.Max(1,(int)(edges[b]*N/rate)),hi=Math.Min(N/2,(int)(edges[b+1]*N/rate));double peak=0;for(int i=lo;i<=hi;i++){double magnitude=Math.Sqrt(data[i].X*data[i].X+data[i].Y*data[i].Y);peak=Math.Max(peak,magnitude);}values[b]=(float)Math.Max(0,Math.Min(1,(20*Math.Log10(Math.Max(peak,0.000001))+65)/55));}lock(gate){bands=values;lastData=Stopwatch.GetTimestamp();}}
 [MTAThread] static void Main(string[] args){
  try{using(var devices=new MMDeviceEnumerator())using(var device=devices.GetDefaultAudioEndpoint(DataFlow.Render,Role.Multimedia))using(var capture=new WasapiLoopbackCapture(device)){
   int bytes=capture.WaveFormat.BitsPerSample/8,channels=capture.WaveFormat.Channels;bool floats=capture.WaveFormat.Encoding==WaveFormatEncoding.IeeeFloat;var extensible=capture.WaveFormat as WaveFormatExtensible;if(extensible!=null)floats=extensible.SubFormat==new Guid("00000003-0000-0010-8000-00aa00389b71");
   if(!floats&&bytes!=2&&bytes!=3&&bytes!=4)throw new Exception("Unsupported audio format");
   capture.DataAvailable+=(s,e)=>{for(int p=0;p+bytes*channels<=e.BytesRecorded;p+=bytes*channels){float sample=0;for(int c=0;c<channels;c++){int o=p+c*bytes;float v;if(floats)v=BitConverter.ToSingle(e.Buffer,o);else if(bytes==2)v=BitConverter.ToInt16(e.Buffer,o)/32768f;else if(bytes==4)v=BitConverter.ToInt32(e.Buffer,o)/2147483648f;else{int n=e.Buffer[o]|e.Buffer[o+1]<<8|e.Buffer[o+2]<<16;if((n&0x800000)!=0)n|=unchecked((int)0xff000000);v=n/8388608f;}if(Math.Abs(v)>Math.Abs(sample))sample=v;}samples[index++]=sample;if(index==N){Process(capture.WaveFormat.SampleRate);index=0;}}};
   capture.RecordingStopped+=(s,e)=>stopped=true;capture.StartRecording();int ticks=0,max=args.Length>0?int.Parse(args[0]):int.MaxValue;
   while(!stopped&&ticks<max){Thread.Sleep(50);ticks++;float[] current;lock(gate){current=(float[])bands.Clone();if((Stopwatch.GetTimestamp()-lastData)/(double)Stopwatch.Frequency>.2)Array.Clear(current,0,8);}string[] values=new string[8];for(int i=0;i<8;i++)values[i]=current[i].ToString("0.000",CultureInfo.InvariantCulture);Console.WriteLine("["+string.Join(",",values)+"]");Console.Out.Flush();if(ticks%40==0){using(var active=devices.GetDefaultAudioEndpoint(DataFlow.Render,Role.Multimedia)){if(active.ID!=device.ID)break;}}}
   capture.StopRecording();
  }}catch{Console.Error.WriteLine("Spectrum unavailable");Environment.ExitCode=1;}
 }
}
