import React, { useState, useEffect, useRef } from "react";
import { X, Camera, Image as ImageIcon, Video, Send, Loader2, ArrowLeft, Eye, Mic, Square } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "../context/AuthContext";
import { formatDistanceToNow } from "date-fns";
import io from "socket.io-client";

export function StatusOverlay({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const [statuses, setStatuses] = useState<any[]>([]);
  const [activeUserIdx, setActiveUserIdx] = useState<number | null>(null);
  const [activeStatusIdx, setActiveStatusIdx] = useState(0);
  
  const [uploadType, setUploadType] = useState<"TEXT" | "IMAGE" | "VIDEO" | "AUDIO" | null>(null);
  const [uploadContent, setUploadContent] = useState("");
  const [uploadMedia, setUploadMedia] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);

  const [showViewers, setShowViewers] = useState(false);
  const [selectedEmoji, setSelectedEmoji] = useState<string | null>(null);
  const EMOJIS = ["❤️", "👍", "😂", "😮", "😢", "🙏", "🔥"];

  const handleReact = async (emoji: string) => {
    try {
      const userGroup = statuses[activeUserIdx!];
      const currentStatus = userGroup.statuses[activeStatusIdx!];
      await fetch(`/api/status/${currentStatus.id}/react`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`
        },
        body: JSON.stringify({ emoji })
      });
      setSelectedEmoji(emoji);
      setTimeout(() => setSelectedEmoji(null), 1000);
    } catch(e) { console.error(e); }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        const reader = new FileReader();
        reader.onloadend = () => {
          setUploadMedia(reader.result as string);
          setUploadType("AUDIO");
        };
        reader.readAsDataURL(audioBlob);
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Error accessing microphone:", err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop());
      setIsRecording(false);
    }
  };

  useEffect(() => {
    fetchStatuses();
    const socket = io();
    socket.on("new_status", () => {
      fetchStatuses();
    });
    socket.on("status_updated", () => {
      fetchStatuses();
    });
    socket.on("privacy_updated", () => {
      fetchStatuses();
    });
    return () => {
      socket.disconnect();
    };
  }, []);

  const fetchStatuses = async () => {
    try {
      const res = await fetch("/api/status", {
         headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      });
      if (res.ok) {
        const data = await res.json();
        // Group by user
        const grouped = data.reduce((acc: any, status: any) => {
          if (!acc[status.user.id]) {
            acc[status.user.id] = { user: status.user, statuses: [] };
          }
          acc[status.user.id].statuses.push(status);
          return acc;
        }, {});
        // Sort each user's statuses by oldest first (to view in order)
        Object.values(grouped).forEach((group: any) => {
            group.statuses.sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        });
        setStatuses(Object.values(grouped));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleUpload = async () => {
    if (!uploadContent && !uploadMedia) return;
    try {
      const res = await fetch("/api/status", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`
        },
        body: JSON.stringify({
          type: uploadType,
          content: uploadContent,
          mediaUrl: uploadMedia
        })
      });
      if (res.ok) {
        setUploadType(null);
        setUploadContent("");
        setUploadMedia("");
        fetchStatuses();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, type: "IMAGE" | "VIDEO") => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        setUploadMedia(reader.result as string);
        setUploadType(type);
      };
      reader.readAsDataURL(file);
    }
  };

// StatusOverlay modifications to allow reply
  const [replyText, setReplyText] = useState("");
  const [isReplying, setIsReplying] = useState(false);

  useEffect(() => {
    if (activeUserIdx !== null && !isReplying && !showViewers) {
      const currentActiveStatus = statuses[activeUserIdx]?.statuses[activeStatusIdx];
      if (currentActiveStatus) {
        // Mark as viewed
        fetch(`/api/status/${currentActiveStatus.id}/view`, {
           method: "POST",
           headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
        });
      }
      
      const timer = setTimeout(() => {
        nextStatus();
      }, 5000); // 5 seconds per status map
      return () => clearTimeout(timer);
    }
  }, [activeUserIdx, activeStatusIdx, isReplying, showViewers, statuses]);

  const handleReplyStatus = async (receiverId: string) => {
    if (!replyText.trim()) return;
    try {
      const userGroup = statuses[activeUserIdx!];
      const currentStatus = userGroup.statuses[activeStatusIdx!];

      await fetch("/api/messages/send", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`
        },
        body: JSON.stringify({
          receiverId,
          content: replyText,
          replyToStatusId: currentStatus.id
        })
      });
      setReplyText("");
      setIsReplying(false);
      nextStatus();
    } catch(e) { console.error(e); }
  };

  const nextStatus = () => {
    if (activeUserIdx === null) return;
    const userGroup = statuses[activeUserIdx];
    if (activeStatusIdx < userGroup.statuses.length - 1) {
      setActiveStatusIdx(prev => prev + 1);
    } else {
      if (activeUserIdx < statuses.length - 1) {
        setActiveUserIdx(prev => prev! + 1);
        setActiveStatusIdx(0);
      } else {
        setActiveUserIdx(null);
      }
    }
  };

  const prevStatus = () => {
    if (activeUserIdx === null) return;
    if (activeStatusIdx > 0) {
      setActiveStatusIdx(prev => prev - 1);
    } else {
      if (activeUserIdx > 0) {
        setActiveUserIdx(prev => prev! - 1);
        setActiveStatusIdx(statuses[activeUserIdx - 1].statuses.length - 1);
      }
    }
  };

  // Organize updates
  const myStatusGroup = statuses.find((group: any) => group.user.id === user?.id);
  const otherStatuses = statuses.filter((group: any) => group.user.id !== user?.id);

  // Determine which are viewed and recent updates. 
  // A group is viewed if ALL its statuses are viewed by current user.
  const viewedGroups = otherStatuses.filter((group: any) => 
      group.statuses.every((s: any) => s.views?.some((v: any) => v.viewerId === user?.id))
  );
  const recentGroups = otherStatuses.filter((group: any) => 
      !group.statuses.every((s: any) => s.views?.some((v: any) => v.viewerId === user?.id))
  );


  // Render fullscreen viewer
  if (activeUserIdx !== null) {
    const userGroup = statuses[activeUserIdx];
    if (!userGroup || !userGroup.statuses[activeStatusIdx]) {
      // If privacy settings changed while viewing and they were removed
      setTimeout(() => setActiveUserIdx(null), 0);
      return null;
    }
    const currentStatus = userGroup.statuses[activeStatusIdx];

    return (
      <div className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center">
        {/* Progress bars */}
        <div className="absolute top-0 left-0 right-0 p-4 pt-6 flex gap-1 z-20">
          {userGroup.statuses.map((s: any, idx: number) => (
            <div key={s.id} className="h-1 flex-1 bg-white/30 rounded-full overflow-hidden">
                <div 
                   className="h-full bg-white transition-all" 
                   style={{ 
                     width: idx < activeStatusIdx ? '100%' : (idx === activeStatusIdx ? '100%' : '0%'),
                     transitionDuration: idx === activeStatusIdx ? '5s' : '0s',
                     transitionTimingFunction: 'linear'
                   }}
                />
            </div>
          ))}
        </div>
        
        {/* Header content */}
        <div className="absolute top-10 left-0 right-0 p-4 flex items-center justify-between z-20 text-white shadow-[0_50px_50px_rgba(0,0,0,0.5)_inset]">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="text-white hover:bg-white/20" onClick={() => setActiveUserIdx(null)}>
              <ArrowLeft />
            </Button>
            <Avatar className="h-10 w-10">
              <AvatarImage src={userGroup.user.avatar_url} />
              <AvatarFallback>{userGroup.user.displayName?.[0] || userGroup.user.username[0]}</AvatarFallback>
            </Avatar>
            <div className="flex flex-col">
              <span className="font-semibold">{userGroup.user.id === user?.id ? "My Status" : (userGroup.user.displayName || userGroup.user.username)}</span>
              <span className="text-xs text-white/70">{formatDistanceToNow(new Date(currentStatus.createdAt))} ago</span>
            </div>
          </div>
        </div>

        {/* Content Viewer container */}
        <div className="relative w-full h-full max-w-md mx-auto flex items-center justify-center overflow-hidden">
           {currentStatus.type === "IMAGE" && <img src={currentStatus.mediaUrl} className="w-full h-full object-contain" alt="Status" />}
           {currentStatus.type === "VIDEO" && <video src={currentStatus.mediaUrl} autoPlay loop muted playsInline className="w-full h-full object-contain" />}
           {currentStatus.type === "AUDIO" && (
              <div 
                className="w-full h-full p-8 flex flex-col items-center justify-center text-center text-white break-words"
                style={{ backgroundColor: ['#FF5252', '#448AFF', '#4CAF50', '#FFC107', '#9C27B0', '#607D8B'][currentStatus.id.charCodeAt(0) % 6] }}
              >
                <div className="bg-black/30 p-6 rounded-2xl backdrop-blur-md mb-4 shadow-xl">
                  <Mic className="w-12 h-12 mb-4 animate-pulse mx-auto" />
                  <audio src={currentStatus.mediaUrl} controls autoPlay className="w-full max-w-[250px]" />
                </div>
              </div>
           )}
           {currentStatus.type === "TEXT" && (
              <div 
                className="w-full h-full p-8 flex items-center justify-center text-center text-3xl font-bold text-white break-words"
                style={{ backgroundColor: ['#FF5252', '#448AFF', '#4CAF50', '#FFC107', '#9C27B0', '#607D8B'][currentStatus.id.charCodeAt(0) % 6] }}
              >
                {currentStatus.content}
              </div>
           )}

           {/* Tap zones for nav */}
           <div className="absolute inset-y-0 left-0 w-1/3 z-10" onClick={prevStatus} />
           <div className="absolute inset-y-0 right-0 w-2/3 z-10" onClick={nextStatus} />

           {/*Caption*/}
           {currentStatus.type !== "TEXT" && currentStatus.content && (
              <div className="absolute bottom-[90px] left-0 right-0 p-4 text-center text-white bg-black/40 z-20 pointer-events-none">
                {currentStatus.content}
              </div>
           )}

           {/* Views (If my status) */}
           {userGroup.user.id === user?.id && (
             <div className="absolute bottom-4 left-0 right-0 z-30">
                {!showViewers ? (
                  <div className="flex justify-center">
                    <div 
                      className="flex flex-col items-center cursor-pointer hover:bg-white/10 p-2 rounded-lg text-white"
                      onClick={() => setShowViewers(true)}
                    >
                      <Eye className="w-5 h-5 mb-1" />
                      <span className="text-xs">{currentStatus.views?.length || 0}</span>
                    </div>
                  </div>
                ) : (
                  <div className="bg-background text-foreground rounded-t-2xl shadow-2xl h-[400px] w-full max-w-md mx-auto flex flex-col pointer-events-auto">
                     <div className="p-4 border-b flex justify-between items-center bg-muted/30">
                        <h3 className="font-semibold text-lg flex items-center gap-2">
                           <Eye className="w-5 h-5" />
                           {currentStatus.views?.length || 0} Views
                        </h3>
                        <Button variant="ghost" size="icon" onClick={() => setShowViewers(false)}><X className="w-5 h-5" /></Button>
                     </div>
                     <div className="flex-1 overflow-y-auto p-4 space-y-4">
                        {currentStatus.reactions?.length > 0 && (
                          <div className="flex flex-wrap gap-2 mb-4 p-3 bg-muted/50 rounded-xl">
                             {Array.from(new Set(currentStatus.reactions.map((r: any) => r.emoji))).map((emoji: any) => (
                               <div key={emoji} className="flex items-center gap-1 bg-background px-2 py-1 rounded-full text-sm shadow-sm">
                                 <span>{emoji}</span>
                                 <span className="font-medium">{currentStatus.reactions.filter((r: any) => r.emoji === emoji).length}</span>
                               </div>
                             ))}
                          </div>
                        )}
                        {currentStatus.views?.length === 0 && <p className="text-center text-muted-foreground py-10">No views yet</p>}
                        {currentStatus.views?.map((v: any) => {
                           const userReaction = currentStatus.reactions?.find((r: any) => r.viewerId === v.viewerId);
                           return (
                             <div key={v.viewerId} className="flex items-center justify-between">
                               <div className="flex items-center gap-3">
                                  <Avatar>
                                    <AvatarImage src={v.viewer.avatar_url} />
                                    <AvatarFallback>{v.viewer.displayName?.[0] || v.viewer.username[0]}</AvatarFallback>
                                  </Avatar>
                                  <div className="flex flex-col">
                                     <span className="font-medium">{v.viewer.displayName || v.viewer.username}</span>
                                     <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(v.viewedAt))} ago</span>
                                  </div>
                               </div>
                               {userReaction && <span className="text-xl">{userReaction.emoji}</span>}
                             </div>
                           );
                        })}
                     </div>
                  </div>
                )}
             </div>
           )}

           {/* Reply Input & Reactions (If other's status) */}
           {userGroup.user.id !== user?.id && (
             <div className="absolute bottom-4 left-0 right-0 p-4 z-30 flex flex-col gap-2">
                {/* Reactions */}
                <div className="flex justify-center gap-2 mb-2">
                   {EMOJIS.map(emoji => (
                      <button 
                         key={emoji} 
                         className="text-2xl hover:scale-125 transition-transform drop-shadow-md"
                         onClick={(e) => { e.stopPropagation(); handleReact(emoji); }}
                      >
                         {emoji}
                      </button>
                   ))}
                </div>
                {/* Reply */}
                <form 
                  onSubmit={(e) => { e.preventDefault(); handleReplyStatus(userGroup.user.id); }}
                  className="flex items-center gap-2"
                >
                  <Input 
                    placeholder="Reply..." 
                    className="bg-black/50 text-white border-white/20 backdrop-blur-md placeholder:text-white/50"
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    onFocus={() => setIsReplying(true)}
                    onBlur={() => setIsReplying(false)}
                  />
                  {replyText && (
                    <Button type="submit" size="icon" className="shrink-0 bg-primary text-primary-foreground rounded-full">
                      <Send className="w-4 h-4" />
                    </Button>
                  )}
                </form>
             </div>
           )}
           
           {selectedEmoji && (
             <div className="absolute inset-0 flex items-center justify-center z-50 pointer-events-none">
                <div className="text-8xl animate-out fade-out zoom-out duration-1000">
                   {selectedEmoji}
                </div>
             </div>
           )}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur flex justify-center">
      <div className="w-full max-w-md bg-background border-x flex flex-col h-full shadow-2xl animate-in slide-in-from-bottom-8">
        <header className="flex h-16 items-center border-b px-4 shrink-0 bg-muted/40 justify-between">
          <div className="flex items-center gap-3">
             <Button variant="ghost" size="icon" onClick={onClose} className="-ml-2"><ArrowLeft className="w-5 h-5"/></Button>
             <h2 className="font-semibold text-lg">Status</h2>
          </div>
          <div className="flex items-center">
             <input type="file" accept="image/*,video/*" className="hidden" ref={fileInputRef} onChange={e => {
                const file = e.target.files?.[0];
                if (file) {
                  const type = file.type.startsWith("video/") ? "VIDEO" : "IMAGE";
                  handleFileChange(e, type);
                }
             }} />
             <Button variant="ghost" size="icon" onClick={() => (isRecording ? stopRecording() : startRecording())} className={isRecording ? "text-destructive animate-pulse" : ""}>
               {isRecording ? <Square className="w-5 h-5 fill-destructive"/> : <Mic className="w-5 h-5"/>}
             </Button>
             <Button variant="ghost" size="icon" onClick={() => setUploadType("TEXT")}><Camera className="w-5 h-5"/></Button>
             <Button variant="ghost" size="icon" onClick={() => fileInputRef.current?.click()}><ImageIcon className="w-5 h-5"/></Button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
           {uploadType && (
              <div className="bg-muted rounded-xl p-4 space-y-4">
                 <h3 className="font-semibold">New {uploadType} Status</h3>
                 {uploadMedia && uploadType === "IMAGE" && <img src={uploadMedia} alt="Preview" className="w-full h-40 object-cover rounded-md" />}
                 {uploadMedia && uploadType === "VIDEO" && <video src={uploadMedia} controls className="w-full h-40 object-cover rounded-md" />}
                 {uploadMedia && uploadType === "AUDIO" && <audio src={uploadMedia} controls className="w-full" />}
                 <Input 
                   placeholder={uploadType === "TEXT" ? "Type a status..." : "Add a caption..."}
                   value={uploadContent}
                   onChange={e => setUploadContent(e.target.value)}
                 />
                 <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={() => { setUploadType(null); setUploadMedia(""); setUploadContent(""); }}>Cancel</Button>
                    <Button onClick={handleUpload}><Send className="w-4 h-4 mr-2" /> Send</Button>
                 </div>
              </div>
           )}

           <div>
              <div 
                 className="flex items-center gap-4 cursor-pointer hover:bg-muted p-2 -mx-2 rounded-xl transition-colors"
                 onClick={() => {
                   if (myStatusGroup) {
                      setActiveUserIdx(statuses.indexOf(myStatusGroup));
                      setActiveStatusIdx(0);
                   } else {
                      fileInputRef.current?.click();
                   }
                 }}
              >
                  <div className="relative">
                     <Avatar className="h-12 w-12 border-2 border-primary overflow-hidden">
                       <AvatarImage src={user?.avatar_url || ""} />
                       <AvatarFallback>{user?.displayName?.[0] || user?.username[0]}</AvatarFallback>
                     </Avatar>
                     {!myStatusGroup && (
                       <div className="absolute bottom-0 right-0 bg-primary text-primary-foreground h-5 w-5 rounded-full flex items-center justify-center border-2 border-background text-xs font-bold">+</div>
                     )}
                  </div>
                  <div className="flex flex-col">
                     <span className="font-semibold">My status</span>
                     <span className="text-sm text-muted-foreground">{myStatusGroup ? "Tap to view your status update" : "Tap to add status update"}</span>
                  </div>
              </div>
           </div>

           {recentGroups.length > 0 && (
             <div>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Recent updates</h3>
                <div className="space-y-1">
                   {recentGroups.map((group: any) => (
                      <div 
                        key={group.user.id} 
                        className="flex items-center gap-4 cursor-pointer hover:bg-muted p-2 -mx-2 rounded-xl transition-colors"
                        onClick={() => {
                           setActiveUserIdx(statuses.indexOf(group));
                           setActiveStatusIdx(0);
                        }}
                      >
                         <Avatar className="h-12 w-12 border-2 border-primary overflow-hidden p-[2px]">
                           <div className="w-full h-full rounded-full overflow-hidden">
                             <AvatarImage src={group.user.avatar_url} />
                             <AvatarFallback>{group.user.displayName?.[0] || group.user.username[0]}</AvatarFallback>
                           </div>
                         </Avatar>
                         <div className="flex flex-col">
                            <span className="font-semibold">{group.user.displayName || group.user.username}</span>
                            <span className="text-sm text-muted-foreground">
                               {formatDistanceToNow(new Date(group.statuses[group.statuses.length - 1].createdAt))} ago
                            </span>
                         </div>
                      </div>
                   ))}
                </div>
             </div>
           )}

           {viewedGroups.length > 0 && (
             <div>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 mt-6">Viewed updates</h3>
                <div className="space-y-1">
                   {viewedGroups.map((group: any) => (
                      <div 
                        key={group.user.id} 
                        className="flex items-center gap-4 cursor-pointer hover:bg-muted p-2 -mx-2 rounded-xl transition-colors opacity-70"
                        onClick={() => {
                           setActiveUserIdx(statuses.indexOf(group));
                           setActiveStatusIdx(0);
                        }}
                      >
                         <Avatar className="h-12 w-12 border-2 border-muted-foreground overflow-hidden p-[2px]">
                           <div className="w-full h-full rounded-full overflow-hidden">
                             <AvatarImage src={group.user.avatar_url} />
                             <AvatarFallback>{group.user.displayName?.[0] || group.user.username[0]}</AvatarFallback>
                           </div>
                         </Avatar>
                         <div className="flex flex-col">
                            <span className="font-semibold">{group.user.displayName || group.user.username}</span>
                            <span className="text-sm text-muted-foreground">
                               {formatDistanceToNow(new Date(group.statuses[group.statuses.length - 1].createdAt))} ago
                            </span>
                         </div>
                      </div>
                   ))}
                </div>
             </div>
           )}
        </div>
      </div>
    </div>
  );
}
