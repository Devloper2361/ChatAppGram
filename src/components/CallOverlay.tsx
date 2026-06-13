import React, { useEffect, useRef } from "react";
import { Phone, PhoneOff, Mic, MicOff, Video, VideoOff, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCall } from "../context/CallContext";

export function CallOverlay() {
  const { 
    activeCall, 
    incomingCall, 
    callDuration, 
    isMuted, 
    isVideoOff,
    localMediaStream,
    remoteMediaStream,
    acceptCall, 
    rejectCall, 
    endCall, 
    toggleMute,
    toggleVideo
  } = useCall();

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (localVideoRef.current && localMediaStream) {
      localVideoRef.current.srcObject = localMediaStream;
    }
  }, [localMediaStream, activeCall, isVideoOff]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteMediaStream) {
      remoteVideoRef.current.srcObject = remoteMediaStream;
    }
  }, [remoteMediaStream, activeCall]);

  if (!activeCall && !incomingCall) {
    return null;
  }

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  if (incomingCall && !activeCall) {
    return (
      <div className="fixed top-4 right-4 z-50 bg-background border shadow-lg rounded-xl p-4 w-72 flex flex-col gap-4 animate-in slide-in-from-top-4">
        <div className="flex items-center gap-3">
          <div className="bg-primary/10 p-2 rounded-full">
            <Phone className="h-6 w-6 text-primary animate-pulse" />
          </div>
          <div>
            <h3 className="font-semibold text-sm truncate">{incomingCall.callerName}</h3>
            <p className="text-xs text-muted-foreground capitalize">Incoming {incomingCall.callType} call...</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="destructive" className="flex-1" onClick={rejectCall}>
            Reject
          </Button>
          <Button variant="default" className="flex-1 bg-green-600 hover:bg-green-700 text-white" onClick={acceptCall}>
            Accept
          </Button>
        </div>
      </div>
    );
  }

  if (activeCall) {
    const isConnected = activeCall.hasAccepted;
    const isVideo = activeCall.callType === "video";

    return (
      <div className={`fixed z-50 overflow-hidden bg-background border shadow-lg flex flex-col ${(isConnected && isVideo) ? 'inset-0 md:inset-auto md:bottom-6 md:right-6 md:w-[480px] md:h-[360px] md:rounded-xl' : 'bottom-4 right-4 rounded-xl p-4 w-72'}`}>
        {isConnected ? (
          isVideo ? (
            <div className="relative w-full h-full flex items-center justify-center bg-black">
              {/* Remote Video (Main) */}
              {remoteMediaStream ? (
                <video 
                  ref={remoteVideoRef} 
                  className="w-full h-full object-cover" 
                  autoPlay 
                  playsInline 
                />
              ) : (
                <div className="flex flex-col items-center justify-center text-white/50">
                  <User className="h-16 w-16 mb-2" />
                  <span>Waiting for video...</span>
                </div>
              )}

              {/* Local Video Overlay */}
              <div className="absolute top-4 right-4 w-24 h-36 md:w-32 md:h-48 bg-zinc-800 rounded-lg overflow-hidden border-2 border-white/10 shadow-lg z-10 transition-all">
                 {!isVideoOff && localMediaStream ? (
                   <video 
                     ref={localVideoRef} 
                     className="w-full h-full object-cover" 
                     autoPlay 
                     playsInline 
                     muted 
                   />
                 ) : (
                   <div className="w-full h-full flex items-center justify-center bg-zinc-900 border border-zinc-800">
                      <VideoOff className="h-6 w-6 text-white/50" />
                   </div>
                 )}
              </div>

              {/* Call Info & Controls Overlay */}
              <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent flex justify-between items-end gap-4 z-20">
                <div className="flex flex-col text-white pb-1">
                  <span className="font-semibold text-shadow-sm">{activeCall.peerName || "Unknown Caller"}</span>
                  <span className="text-sm opacity-90 text-shadow-sm">{formatDuration(callDuration)}</span>
                </div>
                <div className="flex items-center gap-3">
                  <Button variant={isMuted ? "destructive" : "secondary"} size="icon" className="rounded-full shadow-lg opacity-90 hover:opacity-100" onClick={toggleMute}>
                    {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                  </Button>
                  <Button variant={isVideoOff ? "destructive" : "secondary"} size="icon" className="rounded-full shadow-lg opacity-90 hover:opacity-100" onClick={toggleVideo}>
                    {isVideoOff ? <VideoOff className="h-5 w-5" /> : <Video className="h-5 w-5" />}
                  </Button>
                  <Button variant="destructive" size="icon" className="rounded-full shadow-lg h-12 w-12" onClick={endCall}>
                    <PhoneOff className="h-5 w-5" />
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex justify-between items-center">
                <div className="flex flex-col">
                  <span className="font-semibold text-sm truncate">{activeCall.peerName || "Unknown Caller"}</span>
                  <span className="text-xs text-primary">{formatDuration(callDuration)}</span>
                </div>
                <div className="flex gap-2">
                  <Button variant={isMuted ? "destructive" : "secondary"} size="icon" className="rounded-full h-10 w-10" onClick={toggleMute}>
                    {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                  </Button>
                  <Button variant="destructive" size="icon" className="rounded-full h-10 w-10" onClick={endCall}>
                    <PhoneOff className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          )
        ) : (
          <div className="flex justify-between items-center p-2">
            <div className="flex flex-col">
              <span className="font-semibold text-sm truncate">{activeCall.peerName || "Unknown Caller"}</span>
              <span className="text-xs text-muted-foreground">Calling...</span>
            </div>
            <div className="flex gap-2">
              <Button variant="destructive" size="icon" className="rounded-full h-10 w-10" onClick={endCall}>
                <PhoneOff className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return null;
}
