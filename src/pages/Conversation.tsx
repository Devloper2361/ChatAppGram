import React, { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Send, Search, X, Image as ImageIcon, XCircle, Reply, Mic, Play, Pause, Trash2, Pin, Forward, CheckSquare, Square } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "../context/AuthContext";
import { format, formatDistanceToNow, isToday, isYesterday } from "date-fns";
import io from "socket.io-client";
import { PublicProfileViewer } from "../components/PublicProfileViewer";
import { useCall } from "../context/CallContext";
import { Phone, Video as VideoIcon } from "lucide-react";
import { toast } from "sonner";

function VoiceMessagePlayer({ audioUrl, duration }: { audioUrl: string; duration: number }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio(audioUrl);
      audioRef.current.addEventListener('timeupdate', () => {
        if (audioRef.current) {
          setProgress(audioRef.current.currentTime);
        }
      });
      audioRef.current.addEventListener('ended', () => {
        setIsPlaying(false);
        setProgress(0);
        if (audioRef.current) audioRef.current.currentTime = 0;
      });
    }
  }, [audioUrl]);

  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = Number(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setProgress(time);
    }
  };

  const formatTime = (seconds: number) => {
    const s = Math.floor(seconds);
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex items-center gap-2 bg-black/5 dark:bg-white/5 rounded-full px-3 py-1.5 min-w-[200px]" onClick={e => e.stopPropagation()}>
      <button onClick={togglePlay} className="h-8 w-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground shrink-0 hover:bg-primary/90 transition-colors">
        {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
      </button>
      <div className="flex flex-col flex-grow gap-0.5 mt-1">
        <input 
          type="range" 
          min="0" 
          max={duration || 1} 
          value={progress} 
          onChange={handleSeek} 
          className="w-full accent-primary h-1.5 cursor-pointer block" 
        />
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>{formatTime(progress)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>
    </div>
  );
}

export default function Conversation() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { initiateCall } = useCall();
  
  const [recipient, setRecipient] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [pinnedMessage, setPinnedMessage] = useState<any>(null);
  const [newMessage, setNewMessage] = useState("");
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [fullScreenImage, setFullScreenImage] = useState<string | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [replyingTo, setReplyingTo] = useState<any>(null);
  const [editingMessage, setEditingMessage] = useState<any>(null);
  const [messageInfoId, setMessageInfoId] = useState<string | null>(null);
  const [forwardingMessage, setForwardingMessage] = useState<any>(null);
  const [forwardConversations, setForwardConversations] = useState<any[]>([]);
  const [forwardSelection, setForwardSelection] = useState<Set<string>>(new Set());
  const [forwardSearchQuery, setForwardSearchQuery] = useState("");
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const [showReactionPicker, setShowReactionPicker] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const startXRef = useRef<number | null>(null);
  const longPressRef = useRef<NodeJS.Timeout | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [dragOffset, setDragOffset] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const startRecordingXRef = useRef<number | null>(null);

  const socketRef = useRef<any>(null);

  useEffect(() => {
    console.log("isRecording changed:", isRecording);
  }, [isRecording]);

  const SUPPORTED_REACTIONS = ["❤️", "👍", "😂", "😮", "😢", "🙏", "🔥"];

  useEffect(() => {
    console.log("replyingTo changed", replyingTo);
  }, [replyingTo]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullScreenImage(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const formatLastSeen = (dateString: string) => {
    const date = new Date(dateString);
    if (isToday(date)) return `Last seen today at ${format(date, "HH:mm")}`;
    if (isYesterday(date)) return `Last seen yesterday at ${format(date, "HH:mm")}`;
    return `Last seen ${format(date, "MMM d")}`;
  };

  useEffect(() => {
    if (!id) return;

    fetch(`/api/users/${id}`)
      .then(res => res.json())
      .then(data => setRecipient(data))
      .catch(console.error);

    fetch(`/api/messages/${id}`)
      .then(res => res.json())
      .then(data => {
         setMessages(data.messages || data);
         setPinnedMessage(data.pinnedMessage || null);
      })
      .catch(console.error);

    const socket = io();
    socketRef.current = socket;

    socket.on("message_pinned", (msg) => {
      setPinnedMessage(msg);
    });

    socket.on("message_unpinned", () => {
      setPinnedMessage(null);
    });

    socket.on("user_status", (status) => {
      if (status.userId === id) {
        setRecipient((prev: any) => prev ? { ...prev, isOnline: status.isOnline, lastSeen: status.lastSeen } : prev);
      }
    });

    socket.on("profile_updated", (updatedUser) => {
      if (updatedUser.id === id) {
        setRecipient((prev: any) => prev ? { ...prev, ...updatedUser } : prev);
      }
    });

    socket.on("typing_start", (senderId) => {
      if (senderId === id) setIsTyping(true);
    });

    socket.on("typing_stop", (senderId) => {
      if (senderId === id) setIsTyping(false);
    });

    socket.on("message_read", (status) => {
      if (status.receiverId === id) {
        setMessages(prev => prev.map(m => {
          if (!m.isRead && m.senderId === user?.id) {
            return { ...m, isRead: true, readAt: status.readAt, deliveredAt: m.deliveredAt || status.deliveredAt || status.readAt };
          }
          if (m.isRead && m.senderId === user?.id && !m.readAt && status.readAt) {
            return { ...m, readAt: status.readAt };
          }
          return m;
        }));
      }
    });

    socket.on("message_delivered", (status) => {
      if (status.receiverId === id) {
        setMessages(prev => prev.map(m => (!m.deliveredAt && m.senderId === user?.id ? { ...m, deliveredAt: status.deliveredAt } : m)));
      }
    });

    socket.on("new_message", (msg) => {
      if ((msg.senderId === user?.id && msg.receiverId === id) || 
          (msg.senderId === id && msg.receiverId === user?.id)) {
        setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg]);
        if (msg.senderId === id) {
          socket.emit("message_delivered", { messageId: msg.id, senderId: msg.senderId });
          socket.emit("message_read", { messageId: msg.id, senderId: msg.senderId });
        }
      }
    });

    socket.on("message_updated", (updatedMsg) => {
      if ((updatedMsg.senderId === user?.id && updatedMsg.receiverId === id) || 
          (updatedMsg.senderId === id && updatedMsg.receiverId === user?.id)) {
        setMessages(prev => prev.map(m => m.id === updatedMsg.id ? updatedMsg : m));
      }
    });

    socket.on("privacy_updated", () => {
      fetch(`/api/users/${id}`, { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } })
        .then(res => res.json())
        .then(setRecipient)
        .catch(console.error);
    });

    return () => {
      socket.disconnect();
    };
  }, [id, user?.id]);

  useEffect(() => {
    if (!isSearching) {
      endRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isTyping, isSearching]);

  const handleTyping = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setNewMessage(val);
    
    if (socketRef.current && id) {
      socketRef.current.emit("typing_start", id);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      
      typingTimeoutRef.current = setTimeout(() => {
        socketRef.current.emit("typing_stop", id);
      }, 2000);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
         toast.error("Image must be smaller than 5MB");
         return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const removeImage = () => {
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleReact = async (messageId: string, emoji: string) => {
    setShowReactionPicker(null);
    setActiveMessageId(null);
    try {
      await fetch(`/api/messages/${messageId}/react`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emoji })
      });
    } catch (e) {
      console.error("Failed to react", e);
    }
  };

  const startEditing = (msg: any) => {
    setActiveMessageId(null);
    setEditingMessage(msg);
    setNewMessage(msg.content);
    setTimeout(() => {
      inputRef.current?.focus();
    }, 10);
  };

  const cancelEditing = () => {
    setEditingMessage(null);
    setNewMessage("");
  };

  const handleDelete = async (messageId: string, type: "me" | "everyone") => {
    setActiveMessageId(null);
    try {
      const res = await fetch(`/api/messages/${messageId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type })
      });
      if (res.ok && type === "me") {
         setMessages(prev => prev.filter(m => m.id !== messageId));
      }
    } catch(e) {
      console.error("Failed to delete", e);
    }
  };

  const isPressingMicRef = useRef(false);

  const handleStartRecording = async (e: React.TouchEvent | React.MouseEvent) => {
    try {
      if (e.cancelable) e.preventDefault(); // Prevent default text selection during long press on some devices
      console.log("START RECORDING CLICKED");
      
      isPressingMicRef.current = true;
      console.log("SETTING RECORDING TRUE immediately");
      setIsRecording(true);
      setRecordingTime(0);
      setDragOffset(0);
      
      let clientX = 0;
      if ('touches' in e) {
        clientX = e.touches[0].clientX;
      } else {
        clientX = (e as React.MouseEvent).clientX;
      }
      startRecordingXRef.current = clientX;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log("MIC PERMISSION GRANTED");
      
      if (!isPressingMicRef.current) {
         // User already released the mic before permission was granted
         console.log("ABORTING: user released early");
         stream.getTracks().forEach(t => t.stop());
         setIsRecording(false);
         return;
      }

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorder.start();

      recordingTimerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

    } catch (err) {
      console.log("MIC PERMISSION FAILED", err);
      console.error("Microphone access denied", err);
      setIsRecording(false);
      isPressingMicRef.current = false;
      // alert("Microphone access is required for voice messages.");
    }
  };

  const handleRecordingMove = (e: React.TouchEvent | React.MouseEvent) => {
    if (!isRecording || startRecordingXRef.current === null) return;
    let clientX = 0;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
    } else {
      clientX = (e as React.MouseEvent).clientX;
    }
    const diff = startRecordingXRef.current - clientX;
    if (diff > 0) {
      setDragOffset(-diff);
      if (diff > 100) {
        handleStopRecording(true);
      }
    }
  };

  const handleStopRecording = async (cancel: boolean = false) => {
    isPressingMicRef.current = false;
    if (!isRecording) return;
    
    console.log("SETTING RECORDING FALSE");
    setIsRecording(false);
    setDragOffset(0);
    startRecordingXRef.current = null;
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    
    if (!mediaRecorderRef.current) {
        return;
    }

    const finalTime = recordingTime;

    mediaRecorderRef.current.onstop = async () => {
      mediaRecorderRef.current?.stream.getTracks().forEach(t => t.stop());
      mediaRecorderRef.current = null;
      if (!cancel && audioChunksRef.current.length > 0 && finalTime > 0) { // Don't send 0s messages if perfectly clicked
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onloadend = async () => {
          const audioUrl = reader.result as string;
          try {
            await fetch("/api/messages/send", {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${localStorage.getItem("token") || ""}` },
              body: JSON.stringify({ 
                receiverId: id, 
                audioUrl, 
                audioDuration: finalTime,
                replyToId: replyingTo?.id 
              })
            });
            setReplyingTo(null);
            if (socketRef.current) socketRef.current.emit("typing_stop", id);
          } catch (e) {
            console.error("Failed to send audio message", e);
          }
        };
        reader.readAsDataURL(audioBlob);
      }
      audioChunksRef.current = [];
    };
    
    if (mediaRecorderRef.current.state === "recording" || mediaRecorderRef.current.state === "paused") {
      mediaRecorderRef.current.stop();
    }
  };

  const formatRecordingTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    if (forwardingMessage) {
      // Fetch users or conversations to forward to
      fetch("/api/conversations", {
        headers: { "Authorization": `Bearer ${localStorage.getItem("token") || ""}` }
      })
      .then(res => res.json())
      .then(data => setForwardConversations(data))
      .catch(console.error);
    } else {
      setForwardSelection(new Set());
      setForwardSearchQuery("");
    }
  }, [forwardingMessage]);

  const handleForwardMessage = async () => {
    if (!forwardingMessage || forwardSelection.size === 0) return;
    
    try {
      await fetch("/api/messages/forward", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${localStorage.getItem("token") || ""}` },
        body: JSON.stringify({
          messageId: forwardingMessage.id,
          receiverIds: Array.from(forwardSelection)
        })
      });
      setForwardingMessage(null);
    } catch (e) {
      console.error("Failed to forward msg", e);
    }
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!newMessage.trim() && !imagePreview && !editingMessage) || !id) return;

    try {
      const content = newMessage.trim();
      const payloadImageUrl = imagePreview;
      const replyId = replyingTo?.id;
      
      setNewMessage(""); 
      setImagePreview(null);
      setReplyingTo(null);
      
      if (fileInputRef.current) fileInputRef.current.value = "";
      
      if (socketRef.current) {
        socketRef.current.emit("typing_stop", id);
      }
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      
      setTimeout(() => {
        inputRef.current?.focus();
      }, 10);
      
      if (editingMessage) {
        setEditingMessage(null);
        await fetch(`/api/messages/${editingMessage.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        });
        return;
      }

      await fetch("/api/messages/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receiverId: id, content, imageUrl: payloadImageUrl, replyToId: replyId }),
      });
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="flex h-full flex-col bg-transparent relative w-full h-full overflow-hidden">
      {user?.wallpaperLight && (
        <div 
          className={`absolute inset-0 z-0 bg-cover bg-center bg-no-repeat dark:hidden pointer-events-none transition-all duration-300 ${user.wallpaperBlur ? 'blur-sm scale-110' : ''}`} 
          style={{ backgroundImage: `url(${user.wallpaperLight})` }} 
        />
      )}
      {user?.wallpaperDark && (
        <div 
          className={`absolute inset-0 z-0 bg-cover bg-center bg-no-repeat hidden dark:block pointer-events-none transition-all duration-300 ${user.wallpaperBlur ? 'blur-sm scale-110' : ''}`} 
          style={{ backgroundImage: `url(${user.wallpaperDark})` }} 
        />
      )}
      <header className="flex h-16 items-center gap-4 border-b border-black/5 dark:border-white/5 px-4 shadow-sm bg-white/60 dark:bg-black/60 backdrop-blur-xl shrink-0 z-10 w-full relative">
        <Button variant="ghost" size="icon" className="md:hidden -ml-2" onClick={() => navigate("/")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        {recipient ? (
          <div className="flex items-center gap-3 flex-1 overflow-hidden cursor-pointer hover:bg-muted/30 p-1.5 -ml-1.5 rounded-md transition-colors" onClick={() => setShowProfile(true)}>
            <div className="relative shrink-0">
              <Avatar className="h-10 w-10 border bg-background text-foreground">
                <AvatarImage src={recipient.avatar_url || ""} />
                <AvatarFallback>{recipient.username?.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              {recipient.isOnline && (
                <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-green-500 border-2 border-background"></span>
              )}
            </div>
            <div className="flex flex-col flex-1 overflow-hidden">
              <span className="font-semibold leading-tight truncate">{recipient.displayName || recipient.username}</span>
              <span className={`text-xs truncate ${recipient.isOnline ? 'text-primary' : 'text-muted-foreground'}`}>
                {recipient.isOnline ? "Online" : recipient.lastSeen ? formatLastSeen(recipient.lastSeen) : recipient.bio || "Offline"}
              </span>
            </div>
          </div>
        ) : (
          <div className="animate-pulse flex items-center gap-3 flex-1">
            <div className="h-10 w-10 bg-muted rounded-full"></div>
            <div className="flex flex-col gap-1">
              <div className="h-4 w-24 bg-muted rounded"></div>
              <div className="h-3 w-16 bg-muted rounded"></div>
            </div>
          </div>
        )}
        
        <div className="flex items-center ml-auto pl-2 gap-1">
          {recipient && (
            <>
              <Button variant="ghost" size="icon" className="text-muted-foreground" onClick={() => initiateCall(recipient.id, recipient.displayName || recipient.username, "voice")}>
                <Phone className="h-5 w-5" />
              </Button>
              <Button variant="ghost" size="icon" className="text-muted-foreground mr-1" onClick={() => initiateCall(recipient.id, recipient.displayName || recipient.username, "video")}>
                <VideoIcon className="h-5 w-5" />
              </Button>
            </>
          )}
          {isSearching ? (
             <div className="flex items-center bg-background rounded-full border px-2 h-9">
                <Search className="w-4 h-4 text-muted-foreground ml-1" />
                <Input 
                   autoFocus
                   placeholder="Search..." 
                   className="border-none bg-transparent h-8 w-32 md:w-48 focus-visible:ring-0 shadow-none text-sm px-2"
                   value={searchQuery}
                   onChange={(e) => setSearchQuery(e.target.value)}
                />
                <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full" onClick={() => { setIsSearching(false); setSearchQuery(""); }}>
                   <X className="w-3 h-3" />
                </Button>
             </div>
          ) : (
             <Button variant="ghost" size="icon" onClick={() => setIsSearching(true)} className="text-muted-foreground">
                <Search className="h-5 w-5" />
             </Button>
          )}
        </div>
      </header>
      
      {pinnedMessage && (
        <div 
          className="bg-background/90 backdrop-blur-md border-b border-black/5 dark:border-white/5 px-4 py-2 flex items-center gap-3 cursor-pointer hover:bg-muted/30 transition-colors z-[5]"
          onClick={() => {
            const elm = document.querySelector(`[data-message-id="${pinnedMessage.id}"]`);
            if (elm) {
              elm.scrollIntoView({ behavior: 'smooth', block: 'center' });
              elm.classList.add('bg-yellow-500/20', 'animate-pulse');
              setTimeout(() => {
                elm.classList.remove('bg-yellow-500/20', 'animate-pulse');
              }, 2000);
            }
          }}
        >
          <Pin className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="flex flex-col flex-1 overflow-hidden">
            <span className="text-xs font-semibold text-primary">Pinned Message</span>
            <span className="text-sm text-foreground truncate">
              {pinnedMessage.isDeleted ? "This message was deleted" : 
               pinnedMessage.content ? pinnedMessage.content : 
               pinnedMessage.imageUrl ? "📷 Photo" : 
               pinnedMessage.audioUrl ? "🎤 Voice message" : ""}
            </span>
          </div>
          {pinnedMessage.senderId === user?.id && (
             <Button 
               variant="ghost" 
               size="icon" 
               className="h-6 w-6 text-muted-foreground hover:text-foreground shrink-0"
               onClick={(e) => {
                 e.stopPropagation();
                 fetch(`/api/conversations/${id}/unpin`, { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem("token") || ""}` } });
               }}
             >
               <X className="h-4 w-4" />
             </Button>
          )}
        </div>
      )}

      <main className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 bg-transparent">
        {messages.filter(m => searchQuery.trim() === "" || m.content.toLowerCase().includes(searchQuery.toLowerCase())).map((msg, idx) => {
          const isMine = msg.senderId === user?.id;
          const prevMsg = messages[idx - 1];
          const showTime = !prevMsg || new Date(msg.createdAt).getTime() - new Date(prevMsg.createdAt).getTime() > 5 * 60000;
          return (
            <React.Fragment key={msg.id}>
              {showTime && (
                <div className="flex justify-center my-2">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider bg-black/5 dark:bg-white/10 px-3 py-1 rounded-full font-medium shadow-sm backdrop-blur-sm">
                    {format(new Date(msg.createdAt), "MMM d, HH:mm")}
                  </span>
                </div>
              )}
              <div data-message-id={msg.id} className={`flex w-full ${isMine ? 'justify-end' : 'justify-start'} group items-end gap-1 transition-all duration-300 rounded-lg`}>
                {isMine && !msg.isDeleted && (
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity hidden md:flex items-center">
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-8 w-8 shrink-0" 
                      onClick={() => setReplyingTo(msg)}
                    >
                      <Reply className="h-4 w-4 text-muted-foreground" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-8 w-8 shrink-0" 
                      onClick={() => setActiveMessageId(msg.id)}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground"><path d="M12 20a16 16 0 0 1-9-10c0-4 3-7 7-7 2.5 0 4.5 1 6 3 1.5-2 3.5-3 6-3 4 0 7 3 7 7 0 6-6 10-17 15"/></svg>
                    </Button>
                  </div>
                )}
                <div 
                  id={`message-${msg.id}`}
                  className={`relative max-w-[85%] sm:max-w-[70%] px-4 py-2 shadow-sm z-10 overflow-hidden break-words cursor-pointer transition-opacity hover:opacity-90 ${
                    isMine 
                      ? 'bg-[#007AFF] text-white border-transparent rounded-[24px] rounded-br-[4px]' 
                      : 'bg-white dark:bg-[#2C2C2E] border border-black/5 dark:border-white/5 text-foreground rounded-[24px] rounded-bl-[4px]'
                  }`}
                  onTouchStart={(e) => {
                    if (msg.isDeleted) return;
                    console.log("TOUCH START", msg.id);
                    startXRef.current = e.touches[0].clientX;
                    if (longPressRef.current) clearTimeout(longPressRef.current);
                    longPressRef.current = setTimeout(() => {
                      setActiveMessageId(msg.id);
                    }, 500);
                  }}
                  onTouchMove={() => {
                    if (msg.isDeleted) return;
                    if (longPressRef.current) clearTimeout(longPressRef.current);
                  }}
                  onTouchEnd={(e) => {
                    if (msg.isDeleted) return;
                    if (startXRef.current !== null) {
                      const diff = e.changedTouches[0].clientX - startXRef.current;
                      console.log("TOUCH END", msg.id, diff);
                      if (diff > 60) {
                        console.log("REPLY TRIGGERED", msg.id);
                        setReplyingTo(msg);
                        navigator.vibrate?.(20);
                      }
                      startXRef.current = null;
                    }
                    if (longPressRef.current) clearTimeout(longPressRef.current);
                  }}
                  onTouchCancel={() => {
                    if (msg.isDeleted) return;
                    startXRef.current = null;
                    if (longPressRef.current) clearTimeout(longPressRef.current);
                  }}
                  onMouseDown={(e) => {
                    if (msg.isDeleted) return;
                    console.log("MOUSE DOWN", msg.id);
                    startXRef.current = e.clientX;
                  }}
                  onMouseUp={(e) => {
                    if (msg.isDeleted) return;
                    if (startXRef.current !== null) {
                      const diff = e.clientX - startXRef.current;
                      console.log("MOUSE UP", msg.id, diff);
                      if (diff > 60) {
                        console.log("REPLY TRIGGERED", msg.id);
                        setReplyingTo(msg);
                        navigator.vibrate?.(20);
                      }
                      startXRef.current = null;
                    }
                  }}
                  onMouseLeave={() => {
                    startXRef.current = null;
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    if (msg.isDeleted) return;
                    setActiveMessageId(msg.id);
                  }}
                >
                  {msg.isDeleted ? (
                    <div className="flex items-center gap-1 text-muted-foreground italic text-sm py-1">
                      <XCircle className="w-4 h-4" />
                      {isMine ? "You deleted this message" : "This message was deleted"}
                    </div>
                  ) : (
                    <>
                      {msg.isForwarded && (
                        <div className="flex items-center gap-1 text-[11px] mb-1 opacity-80 uppercase tracking-wide font-medium">
                          <Forward className="w-3 h-3" />
                          Forwarded
                        </div>
                      )}
                      {msg.replyTo && (
                        <div 
                          className="block bg-black/10 dark:bg-white/10 p-2 rounded-md mb-2 text-xs opacity-90 cursor-default border-l-[3px] border-primary min-w-[100px]" 
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="font-semibold truncate">
                            {msg.replyTo.sender?.displayName || msg.replyTo.sender?.username}
                          </div>
                          <div className="opacity-80 mt-0.5 truncate">
                            {msg.replyTo.imageUrl && !msg.replyTo.content ? "Photo" : msg.replyTo.content}
                          </div>
                        </div>
                      )}
                      {msg.replyToStatus && (
                        <div 
                          className="block bg-black/10 dark:bg-white/10 p-2 rounded-md mb-2 text-xs opacity-90 cursor-default border-l-[3px] border-purple-500 min-w-[100px]" 
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center gap-1 font-semibold truncate text-purple-600 dark:text-purple-400 mb-0.5">
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
                            Replied to Status
                          </div>
                          <div className="font-semibold truncate">
                            {msg.replyToStatus.user?.displayName || msg.replyToStatus.user?.username}
                          </div>
                          <div className="opacity-80 mt-0.5 flex items-center gap-1">
                            {msg.replyToStatus.type === "IMAGE" && <span className="truncate">📷 Photo</span>}
                            {msg.replyToStatus.type === "VIDEO" && <span className="truncate">📹 Video</span>}
                            {msg.replyToStatus.type === "AUDIO" && <span className="truncate">🎤 Voice</span>}
                            {msg.replyToStatus.type === "TEXT" && <span className="truncate">{msg.replyToStatus.content}</span>}
                            {(msg.replyToStatus.type !== "TEXT" && msg.replyToStatus.content) && <span className="truncate"> - {msg.replyToStatus.content}</span>}
                          </div>
                        </div>
                      )}
                      {msg.imageUrl && (
                        <div className="mb-1 rounded-lg overflow-hidden cursor-pointer" onClick={() => setFullScreenImage(msg.imageUrl)}>
                          <img src={msg.imageUrl} alt="Attachment" className="max-w-full max-h-64 object-contain hover:opacity-90 transition-opacity" />
                        </div>
                      )}
                      {msg.audioUrl && (
                        <div className="my-1 cursor-default" onContextMenu={e => e.stopPropagation()}>
                          <VoiceMessagePlayer audioUrl={msg.audioUrl} duration={msg.audioDuration} />
                        </div>
                      )}
                      {msg.content && msg.content !== "" && (
                        <p className="whitespace-pre-wrap break-words text-[14px] leading-relaxed relative z-20">
                           {searchQuery && msg.content.toLowerCase().includes(searchQuery.toLowerCase()) ? (
                             <>
                               {msg.content.split(new RegExp(`(${searchQuery})`, 'gi')).map((part: string, i: number) => 
                                 part.toLowerCase() === searchQuery.toLowerCase() ? <mark key={i} className="bg-yellow-300/80 text-black rounded px-0.5">{part}</mark> : part
                               )}
                             </>
                           ) : msg.content}
                        </p>
                      )}
                      <div className={`text-[10px] mt-0.5 flex items-center justify-end gap-1 float-right clear-both -mb-0.5 ml-2 ${isMine ? 'opacity-80' : 'text-muted-foreground'}`}>
                        {msg.editedAt && <span className="italic opacity-80 mr-1">(edited)</span>}
                        <span>{format(new Date(msg.createdAt), "HH:mm")}</span>
                        {isMine && <span className={msg.isRead ? "text-cyan-200" : ""}>{msg.isRead ? "✓✓" : "✓"}</span>}
                      </div>
                    </>
                  )}
                </div>
                {!isMine && !msg.isDeleted && (
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity hidden md:flex items-center">
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-8 w-8 shrink-0" 
                      onClick={() => setReplyingTo(msg)}
                    >
                      <Reply className="h-4 w-4 text-muted-foreground" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-8 w-8 shrink-0" 
                      onClick={() => setActiveMessageId(msg.id)}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground"><path d="M12 20a16 16 0 0 1-9-10c0-4 3-7 7-7 2.5 0 4.5 1 6 3 1.5-2 3.5-3 6-3 4 0 7 3 7 7 0 6-6 10-17 15"/></svg>
                    </Button>
                  </div>
                )}
              </div>
              
              {/* Reactions display underneath bubble */}
              {!msg.isDeleted && msg.reactions && msg.reactions.length > 0 && (
                <div className={`flex w-full ${isMine ? 'justify-end' : 'justify-start'} -mt-3.5 mb-1 z-20 px-8 pointer-events-none`}>
                  <div className="flex gap-1 flex-wrap pointer-events-auto shadow-sm">
                    {Object.entries(
                      msg.reactions.reduce((acc: any, r: any) => {
                        acc[r.emoji] = (acc[r.emoji] || 0) + 1;
                        return acc;
                      }, {})
                    ).map(([emoji, count]: [string, any]) => {
                      const userReacted = msg.reactions.some((r: any) => r.userId === user?.id && r.emoji === emoji);
                      return (
                        <button
                          key={emoji}
                          onClick={() => handleReact(msg.id, emoji)}
                          className={`flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium border ${userReacted ? 'bg-primary/20 border-primary/30 text-primary' : 'bg-background hover:bg-muted border-black/10 dark:border-white/10'}`}
                        >
                          <span>{emoji}</span>
                          <span className="opacity-80">{count}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Show context actions on mobile (if activeMessageId) or desktop (group-hover/context menu) */}
              {activeMessageId === msg.id && (
                <div 
                   className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
                   onClick={() => {
                      setActiveMessageId(null);
                      setShowReactionPicker(null);
                   }}
                >
                   <div 
                      className="bg-background rounded-2xl shadow-xl border overflow-hidden min-w-[250px] max-w-sm flex flex-col"
                      onClick={(e) => e.stopPropagation()}
                   >
                     {/* Reaction Picker in Context Menu */}
                     {!msg.isDeleted && (
                       <div className="flex gap-2 p-3 justify-center border-b bg-muted/30">
                         {SUPPORTED_REACTIONS.map(emoji => (
                           <button
                             key={emoji}
                             className="text-2xl hover:scale-125 transition-transform"
                             onClick={() => handleReact(msg.id, emoji)}
                           >
                             {emoji}
                           </button>
                         ))}
                       </div>
                     )}

                     {!msg.isDeleted && (
                       <button className="flex items-center gap-3 p-4 hover:bg-muted font-medium border-b" onClick={() => { setReplyingTo(msg); setActiveMessageId(null); inputRef.current?.focus(); }}>
                         Reply
                       </button>
                     )}

                     {!msg.isDeleted && (
                       <button className="flex items-center gap-3 p-4 hover:bg-muted font-medium border-b" onClick={() => { setForwardingMessage(msg); setActiveMessageId(null); }}>
                         Forward
                       </button>
                     )}

                     {!msg.isDeleted && isMine && (
                       <button className="flex items-center gap-3 p-4 hover:bg-muted font-medium border-b" onClick={() => { setMessageInfoId(msg.id); setActiveMessageId(null); }}>
                         Info
                       </button>
                     )}

                     {!msg.isDeleted && isMine && msg.content && (new Date().getTime() - new Date(msg.createdAt).getTime() <= 15 * 60 * 1000) && (
                       <button className="flex items-center gap-3 p-4 hover:bg-muted font-medium border-b" onClick={() => startEditing(msg)}>
                         Edit Message
                       </button>
                     )}
                     
                     {!msg.isDeleted && (
                       <button 
                         className="flex items-center gap-3 p-4 hover:bg-muted font-medium border-b" 
                         onClick={() => {
                           if (pinnedMessage?.id === msg.id) {
                             fetch(`/api/conversations/${id}/unpin`, { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem("token") || ""}` } });
                           } else {
                             fetch(`/api/messages/${msg.id}/pin`, { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem("token") || ""}` } });
                           }
                           setActiveMessageId(null);
                         }}
                       >
                         {pinnedMessage?.id === msg.id ? "Unpin Message" : "Pin Message"}
                       </button>
                     )}

                     <button className="flex items-center gap-3 p-4 hover:bg-muted font-medium text-destructive border-b" onClick={() => handleDelete(msg.id, "me")}>
                       Delete for me
                     </button>
                     
                     {isMine && !msg.isDeleted && (new Date().getTime() - new Date(msg.createdAt).getTime() <= 24 * 60 * 60 * 1000) && (
                       <button className="flex items-center gap-3 p-4 hover:bg-muted font-medium text-destructive" onClick={() => handleDelete(msg.id, "everyone")}>
                         Delete for everyone
                       </button>
                     )}
                   </div>
                </div>
              )}
            </React.Fragment>
          );
        })}
        {isTyping && (
          <div className="flex w-full justify-start mt-2">
            <div className="bg-muted text-muted-foreground text-xs rounded-2xl px-4 py-2 border border-border/50 rounded-bl-sm flex items-center gap-1">
              <span className="flex gap-1 items-center h-4">
                <span className="w-1.5 h-1.5 bg-muted-foreground/60 rounded-full animate-bounce" />
                <span className="w-1.5 h-1.5 bg-muted-foreground/60 rounded-full animate-bounce delay-75" />
                <span className="w-1.5 h-1.5 bg-muted-foreground/60 rounded-full animate-bounce delay-150" />
              </span>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </main>

      <footer className="p-4 border-t border-black/5 dark:border-white/5 bg-white/60 dark:bg-black/60 backdrop-blur-xl shrink-0 flex flex-col gap-2 relative z-10">
        {replyingTo && (
          <div className="relative mx-auto w-full max-w-4xl px-2 mb-1">
            <div className="flex flex-col bg-muted/40 border-l-4 border-primary rounded-r-md p-2 text-sm">
              <div className="flex justify-between items-center mb-1">
                <span className="font-semibold text-primary text-xs">
                   Reply to {replyingTo.senderId === user?.id ? "yourself" : (recipient?.displayName || recipient?.username)}
                </span>
                <Button 
                   variant="ghost" 
                   size="icon" 
                   className="h-5 w-5 text-muted-foreground hover:bg-muted" 
                   onClick={() => setReplyingTo(null)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
              <span className="truncate text-muted-foreground">
                {replyingTo.imageUrl && !replyingTo.content ? "Photo" : replyingTo.content}
              </span>
            </div>
          </div>
        )}
        {editingMessage && (
          <div className="relative mx-auto w-full max-w-4xl px-2 mb-1">
            <div className="flex flex-col bg-muted/40 border-l-4 border-yellow-500 rounded-r-md p-2 text-sm">
              <div className="flex justify-between items-center mb-1">
                <span className="font-semibold text-yellow-600 dark:text-yellow-500 text-xs">
                   Editing Message
                </span>
                <Button 
                   variant="ghost" 
                   size="icon" 
                   className="h-5 w-5 text-muted-foreground hover:bg-muted" 
                   onClick={cancelEditing}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
              <span className="truncate text-muted-foreground">
                {editingMessage.content}
              </span>
            </div>
          </div>
        )}
        {imagePreview && (
          <div className="relative mx-auto w-full max-w-4xl px-2">
            <div className="relative inline-block border rounded-xl overflow-hidden bg-muted/20">
              <img src={imagePreview} alt="Preview" className="max-h-40 max-w-full object-contain" />
              <Button 
                variant="destructive" 
                size="icon" 
                className="absolute top-1 right-1 h-6 w-6 rounded-full" 
                onClick={removeImage}
              >
                <XCircle className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
        <form onSubmit={sendMessage} className="mx-auto w-full max-w-4xl flex gap-2 items-end">
          <input 
            type="file" 
            ref={fileInputRef} 
            className="hidden" 
            accept="image/jpeg, image/png, image/webp, image/gif" 
            onChange={handleImageUpload} 
          />
          <Button 
            type="button" 
            variant="ghost" 
            size="icon" 
            className="shrink-0 mb-0.5 rounded-full text-muted-foreground hover:text-foreground"
            onClick={() => fileInputRef.current?.click()}
            onMouseDown={(e) => e.preventDefault()}
          >
            <ImageIcon className="h-5 w-5" />
          </Button>
          {isRecording ? (
            <div className="flex-1 rounded-3xl px-4 bg-red-500/10 border-transparent min-h-10 flex items-center justify-between text-red-500 overflow-hidden">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse shrink-0" />
                <span className="font-medium whitespace-nowrap">{formatRecordingTime(recordingTime)}</span>
              </div>
              <div className="text-muted-foreground text-xs animate-pulse opacity-70 whitespace-nowrap pl-2">
                &lt; Slide to cancel
              </div>
            </div>
          ) : (
            <Input 
              ref={inputRef}
              placeholder="Write a message..." 
              className="flex-1 rounded-3xl px-4 bg-muted/50 border-transparent focus-visible:ring-1 focus-visible:bg-background min-h-10"
              value={newMessage}
              onChange={handleTyping}
            />
          )}
          {(!newMessage.trim() && !imagePreview && !editingMessage) ? (
            <div 
               className="relative shrink-0 mb-0.5 z-20"
               onMouseMove={handleRecordingMove}
               onTouchMove={handleRecordingMove}
               onMouseUp={() => handleStopRecording(false)}
               onTouchEnd={() => handleStopRecording(false)}
               onMouseLeave={() => isRecording && handleStopRecording(true)}
               onTouchCancel={() => isRecording && handleStopRecording(true)}
            >
              <Button 
                type="button"
                size="icon" 
                className={`rounded-full shadow-sm transition-all select-none ${isRecording ? 'bg-red-500 hover:bg-red-600' : 'bg-primary'}`}
                style={{ transform: `translateX(${dragOffset}px) ${isRecording ? 'scale(1.25)' : ''}` }}
                onMouseDown={handleStartRecording}
                onTouchStart={handleStartRecording}
              >
                <Mic className="h-5 w-5 text-white" />
              </Button>
            </div>
          ) : (
            <Button 
              type="submit" 
              size="icon" 
              disabled={!newMessage.trim() && !imagePreview && !editingMessage} 
              className="rounded-full shrink-0 mb-0.5 shadow-sm"
              onMouseDown={(e) => { e.preventDefault(); }}
            >
              <Send className="h-4 w-4 ml-0.5" />
            </Button>
          )}
        </form>
      </footer>

      {fullScreenImage && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          onClick={() => setFullScreenImage(null)}
        >
          <div className="relative max-w-full max-h-full">
            <Button 
              variant="ghost" 
              size="icon" 
              className="absolute top-2 right-2 text-white bg-black/50 hover:bg-black/70 rounded-full h-8 w-8 z-10"
              onClick={(e) => { e.stopPropagation(); setFullScreenImage(null); }}
            >
              <X className="h-4 w-4" />
            </Button>
            <img 
              src={fullScreenImage} 
              alt="Full screen" 
              className="max-w-full max-h-[90vh] object-contain rounded-md" 
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}

      {forwardingMessage && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-background w-full max-w-md rounded-2xl shadow-xl flex flex-col overflow-hidden max-h-[80vh]">
            <div className="p-4 border-b flex items-center justify-between bg-muted/30">
              <h3 className="font-semibold">Forward Message</h3>
              <Button variant="ghost" size="icon" onClick={() => setForwardingMessage(null)} className="h-8 w-8">
                <X className="h-4 w-4" />
              </Button>
            </div>
            
            <div className="p-3 border-b">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search contacts..."
                  className="pl-9 bg-muted/50 border-none rounded-xl h-10"
                  value={forwardSearchQuery}
                  onChange={(e) => setForwardSearchQuery(e.target.value)}
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2">
              {forwardConversations
                .filter(c => 
                  c.user?.displayName?.toLowerCase().includes(forwardSearchQuery.toLowerCase()) ||
                  c.user?.username?.toLowerCase().includes(forwardSearchQuery.toLowerCase())
                )
                .map((c) => {
                  const u = c.user;
                  const isSelected = forwardSelection.has(u.id);
                  return (
                    <div 
                      key={u.id}
                      onClick={() => {
                        const newSelection = new Set(forwardSelection);
                        if (isSelected) {
                          newSelection.delete(u.id);
                        } else {
                          newSelection.add(u.id);
                        }
                        setForwardSelection(newSelection);
                      }}
                      className="flex gap-3 items-center p-2 rounded-xl hover:bg-muted/50 cursor-pointer transition-colors"
                    >
                      <div className="flex-1 flex items-center gap-3">
                        <Avatar className="h-10 w-10">
                          <AvatarImage src={u.avatar_url || ""} />
                          <AvatarFallback>{u.username?.slice(0, 2).toUpperCase() || "?"}</AvatarFallback>
                        </Avatar>
                        <div className="flex flex-col">
                          <span className="font-semibold text-sm">{u.displayName || u.username}</span>
                          <span className="text-xs text-muted-foreground">@{u.username}</span>
                        </div>
                      </div>
                      <div className="shrink-0 text-primary">
                        {isSelected ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5 opacity-30" />}
                      </div>
                    </div>
                  );
              })}
              {forwardConversations.length === 0 && (
                <div className="p-8 text-center text-muted-foreground text-sm">
                  No recent conversations.
                </div>
              )}
            </div>
            
            <div className="p-4 border-t bg-muted/10 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setForwardingMessage(null)}>Cancel</Button>
              <Button disabled={forwardSelection.size === 0} onClick={handleForwardMessage} className="gap-2">
                <Send className="w-4 h-4" />
                Forward {forwardSelection.size > 0 && `(${forwardSelection.size})`}
              </Button>
            </div>
          </div>
        </div>
      )}

      {messageInfoId && (() => {
        const messageInfo = messages.find(m => m.id === messageInfoId);
        if (!messageInfo) return null;
        return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-background w-full max-w-sm rounded-2xl shadow-xl flex flex-col overflow-hidden max-h-[80vh]">
            <div className="p-4 border-b flex items-center justify-between bg-muted/30">
              <h3 className="font-semibold">Message Info</h3>
              <Button variant="ghost" size="icon" onClick={() => setMessageInfoId(null)} className="h-8 w-8">
                <X className="h-4 w-4" />
              </Button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="bg-muted p-3 rounded-xl text-sm">
                {messageInfo.content ? messageInfo.content : 
                 messageInfo.imageUrl ? "📷 Photo" : 
                 messageInfo.audioUrl ? "🎤 Voice message" : "Message"}
              </div>

              <div className="space-y-4 text-sm mt-4">
                <div className="flex gap-3">
                  <div className="text-muted-foreground w-20">Sent</div>
                  <div>
                    {format(new Date(messageInfo.createdAt), "MMM d, HH:mm")}
                  </div>
                </div>

                <div className="flex gap-3">
                  <div className="text-muted-foreground w-20">Delivered</div>
                  <div>
                    {messageInfo.deliveredAt 
                      ? <div className="flex flex-col">
                          <span>{format(new Date(messageInfo.deliveredAt), "MMM d, HH:mm")}</span>
                          <span className="text-xs text-muted-foreground">To: {recipient?.displayName || recipient?.username || "Recipient"}</span>
                        </div>
                      : <span className="opacity-50">—</span>}
                  </div>
                </div>

                <div className="flex gap-3">
                  <div className="text-muted-foreground w-20">Read</div>
                  <div>
                    {messageInfo.readAt 
                      ? <div className="flex flex-col">
                          <span>{format(new Date(messageInfo.readAt), "MMM d, HH:mm")}</span>
                          <span className="text-xs text-muted-foreground">By: {recipient?.displayName || recipient?.username || "Recipient"}</span>
                        </div>
                      : <span className="opacity-50">—</span>}
                  </div>
                </div>

                {messageInfo.editedAt && (
                  <div className="flex gap-3">
                    <div className="text-muted-foreground w-20">Edited</div>
                    <div>{format(new Date(messageInfo.editedAt), "MMM d, HH:mm")}</div>
                  </div>
                )}
              </div>

              {messageInfo.reactions && messageInfo.reactions.length > 0 && (
                <div className="mt-6 pt-4 border-t">
                  <div className="text-muted-foreground text-xs font-semibold uppercase tracking-wider mb-3">Reactions</div>
                  <div className="space-y-2">
                    {messageInfo.reactions.map((r: any) => (
                      <div key={r.id} className="flex items-center gap-2">
                        <span className="text-xl">{r.emoji}</span>
                        <span className="text-sm">{r.userId === user?.id ? "You" : recipient?.displayName || recipient?.username}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        );
      })()}

      {showProfile && recipient && id && (
        <PublicProfileViewer userId={id} onClose={() => setShowProfile(false)} />
      )}
    </div>
  );
}
