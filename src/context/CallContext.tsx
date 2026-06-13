import React, { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { useAuth } from "./AuthContext";
import io, { Socket } from "socket.io-client";

export type CallType = "voice" | "video";

export interface CallContextType {
  activeCall: {
    peerId: string;
    peerName?: string;
    isIncoming: boolean;
    hasAccepted: boolean;
    callType: CallType;
  } | null;
  incomingCall: {
    callerId: string;
    callerName: string;
    callType: CallType;
  } | null;
  callDuration: number;
  isMuted: boolean;
  localMediaStream: MediaStream | null;
  remoteMediaStream: MediaStream | null;
  isVideoOff: boolean;
  initiateCall: (recipientId: string, recipientName: string, callType: CallType) => void;
  acceptCall: () => void;
  rejectCall: () => void;
  endCall: () => void;
  toggleMute: () => void;
  toggleVideo: () => void;
}

const CallContext = createContext<CallContextType | undefined>(undefined);

export function CallProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  
  const [socket, setSocket] = useState<Socket | null>(null);
  const [incomingCall, setIncomingCall] = useState<{ callerId: string; callerName: string; callType: CallType } | null>(null);
  const [activeCall, setActiveCall] = useState<{ peerId: string; peerName?: string; isIncoming: boolean; hasAccepted: boolean; callType: CallType } | null>(null);
  const [callDuration, setCallDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  
  const [localMediaStream, setLocalMediaStream] = useState<MediaStream | null>(null);
  const [remoteMediaStream, setRemoteMediaStream] = useState<MediaStream | null>(null);

  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const localStream = useRef<MediaStream | null>(null);
  const remoteStream = useRef<MediaStream | null>(null);
  const remoteAudioHelper = useRef<HTMLAudioElement | null>(null);
  const durationInterval = useRef<NodeJS.Timeout | null>(null);
  const iceCandidatesQueue = useRef<RTCIceCandidateInit[]>([]);

  useEffect(() => {
    if (!user) {
      if (socket) {
        socket.disconnect();
        setSocket(null);
      }
      return;
    }

    const newSocket = io();
    setSocket(newSocket);
    console.log("[CALL] Socket connected", newSocket.id);

    newSocket.on("incoming_call", async ({ callerId, callerName, callType }) => {
      console.log("[CALL] Incoming call from", callerName, callType);
      setIncomingCall({ callerId, callerName, callType });
    });

    newSocket.on("call_accepted", async ({ from }) => {
      console.log("[CALL] Call accepted from", from);
      setActiveCall(prev => prev ? { ...prev, hasAccepted: true } : null);
      startDuration();
      
      await setupPeerConnection(from, newSocket);
      console.log("[CALL] Calling createOffer");
      const offer = await peerConnection.current!.createOffer();
      await peerConnection.current!.setLocalDescription(offer);
      console.log("[CALL] Emitting offer");
      newSocket.emit("offer", { to: from, offer });
    });

    newSocket.on("call_rejected", ({ from }) => {
      console.log("[CALL] Call rejected");
      cleanupCall();
    });

    newSocket.on("offer", async ({ from, offer }) => {
      console.log("[CALL] Received offer from", from);
      if (!peerConnection.current) await setupPeerConnection(from, newSocket);
      try {
        await peerConnection.current!.setRemoteDescription(new RTCSessionDescription(offer));
        console.log("[CALL] Calling createAnswer");
        const answer = await peerConnection.current!.createAnswer();
        await peerConnection.current!.setLocalDescription(answer);
        console.log("[CALL] Emitting answer");
        newSocket.emit("answer", { to: from, answer });
        
        // Process queued ICE candidates
        while (iceCandidatesQueue.current.length > 0) {
          const candidate = iceCandidatesQueue.current.shift();
          if (candidate) {
            await peerConnection.current!.addIceCandidate(new RTCIceCandidate(candidate));
          }
        }
      } catch (err) {
        console.error("[CALL] Error handling offer", err);
      }
    });

    newSocket.on("answer", async ({ from, answer }) => {
      console.log("[CALL] Received answer from", from);
      try {
        if (peerConnection.current) {
          await peerConnection.current.setRemoteDescription(new RTCSessionDescription(answer));
          
          while (iceCandidatesQueue.current.length > 0) {
            const candidate = iceCandidatesQueue.current.shift();
            if (candidate) {
              await peerConnection.current.addIceCandidate(new RTCIceCandidate(candidate));
            }
          }
        }
      } catch (err) {
        console.error("[CALL] Error handling answer", err);
      }
    });

    newSocket.on("ice_candidate", async ({ from, candidate }) => {
      console.log("[CALL] Received ice candidate");
      try {
        if (peerConnection.current && peerConnection.current.remoteDescription) {
          await peerConnection.current.addIceCandidate(new RTCIceCandidate(candidate));
        } else {
          iceCandidatesQueue.current.push(candidate);
        }
      } catch (err) {
        console.error("[CALL] Error adding ice candidate", err);
      }
    });

    newSocket.on("end_call", () => {
      console.log("[CALL] Received end_call");
      cleanupCall();
    });

    return () => {
      console.log("[CALL] useEffect cleanup");
      cleanupCall();
      newSocket.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const startDuration = () => {
    setCallDuration(0);
    durationInterval.current = setInterval(() => {
      setCallDuration(prev => prev + 1);
    }, 1000);
  };

  const setupMedia = async (callType: CallType) => {
    try {
      if (!localStream.current) {
        console.log("[CALL] Requesting local media:", callType);
        localStream.current = await navigator.mediaDevices.getUserMedia({ 
          audio: true, 
          video: callType === "video" 
        });
        setLocalMediaStream(localStream.current);
        console.log("[CALL] Local media obtained");
      }
      return true;
    } catch (err) {
      console.error("[CALL] Failed to get local media", err);
      return false;
    }
  };

  const setupPeerConnection = async (peerId: string, currentSocket: Socket) => {
    console.log("[CALL] Setting up RTCPeerConnection for peer:", peerId);
    peerConnection.current = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" }
      ]
    });

    peerConnection.current.onicecandidate = (event) => {
      if (event.candidate) {
        currentSocket.emit("ice_candidate", { to: peerId, candidate: event.candidate });
      }
    };

    peerConnection.current.onconnectionstatechange = () => {
      console.log("[CALL] Connection state:", peerConnection.current?.connectionState);
      if (peerConnection.current?.connectionState === 'failed' || peerConnection.current?.connectionState === 'disconnected') {
        // cleanupCall(); // let's not auto-cleanup immediately 
      }
    };

    peerConnection.current.oniceconnectionstatechange = () => {
      console.log("[CALL] ICE Connection state:", peerConnection.current?.iceConnectionState);
    };

    peerConnection.current.ontrack = (event) => {
      console.log("[CALL] Received remote track:", event.track.kind);
      remoteStream.current = event.streams[0];
      setRemoteMediaStream(remoteStream.current);
      
      if (!remoteAudioHelper.current) {
        remoteAudioHelper.current = new Audio();
        remoteAudioHelper.current.autoplay = true;
      }
      remoteAudioHelper.current.srcObject = remoteStream.current;
    };

    if (localStream.current) {
      console.log("[CALL] Adding local tracks to peer connection");
      localStream.current.getTracks().forEach(track => {
        peerConnection.current?.addTrack(track, localStream.current!);
      });
    } else {
      console.warn("[CALL] localStream was null during setupPeerConnection!");
    }
  };

  const initiateCall = async (recipientId: string, recipientName: string, callType: CallType) => {
    if (!socket) return;
    
    const mediaReady = await setupMedia(callType);
    if (!mediaReady) {
      alert("Microphone/Camera access is required to make a call.");
      return;
    }

    setActiveCall({ peerId: recipientId, peerName: recipientName, isIncoming: false, hasAccepted: false, callType });
    socket.emit("call_user", { recipientId, callerName: user?.displayName || user?.username || "Someone", callType });
  };

  const acceptCall = async () => {
    if (!socket || !incomingCall) return;
    
    const mediaReady = await setupMedia(incomingCall.callType);
    if (!mediaReady) {
      rejectCall();
      return;
    }

    const callerId = incomingCall.callerId;
    const callerName = incomingCall.callerName;
    const callType = incomingCall.callType;
    
    socket.emit("call_accepted", { to: callerId });
    setIncomingCall(null);
    setActiveCall({ peerId: callerId, peerName: callerName, isIncoming: true, hasAccepted: true, callType });
    startDuration();
  };

  const rejectCall = () => {
    if (socket && incomingCall) {
      socket.emit("call_rejected", { to: incomingCall.callerId });
    }
    setIncomingCall(null);
  };

  const endCall = () => {
    if (socket && activeCall) {
      socket.emit("end_call", { to: activeCall.peerId });
    } else if (socket && incomingCall) {
      socket.emit("end_call", { to: incomingCall.callerId });
    }
    cleanupCall();
  };

  const cleanupCall = () => {
    setIncomingCall(null);
    setActiveCall(null);
    setCallDuration(0);
    setIsMuted(false);
    setIsVideoOff(false);
    
    if (durationInterval.current) {
      clearInterval(durationInterval.current);
      durationInterval.current = null;
    }

    if (peerConnection.current) {
      peerConnection.current.close();
      peerConnection.current = null;
    }

    if (localStream.current) {
      localStream.current.getTracks().forEach(track => track.stop());
      localStream.current = null;
      setLocalMediaStream(null);
    }

    if (remoteAudioHelper.current) {
      remoteAudioHelper.current.pause();
      remoteAudioHelper.current.srcObject = null;
    }
    remoteStream.current = null;
    setRemoteMediaStream(null);
  };

  const toggleMute = () => {
    if (localStream.current) {
      const audioTracks = localStream.current.getAudioTracks();
      if (audioTracks.length > 0) {
        const newMutedState = !isMuted;
        audioTracks[0].enabled = !newMutedState;
        setIsMuted(newMutedState);
      }
    }
  };

  const toggleVideo = () => {
    if (localStream.current) {
      const videoTracks = localStream.current.getVideoTracks();
      if (videoTracks.length > 0) {
        const newVideoOffState = !isVideoOff;
        videoTracks[0].enabled = !newVideoOffState;
        setIsVideoOff(newVideoOffState);
      }
    }
  };

  // Basic cleanup when user navigates away or unmounts completely is handled by useEffect return

  return (
    <CallContext.Provider value={{ activeCall, incomingCall, callDuration, isMuted, isVideoOff, localMediaStream, remoteMediaStream, initiateCall, acceptCall, rejectCall, endCall, toggleMute, toggleVideo }}>
      {children}
    </CallContext.Provider>
  );
}

export function useCall() {
  const context = useContext(CallContext);
  if (context === undefined) {
    throw new Error("useCall must be used within a CallProvider");
  }
  return context;
}
