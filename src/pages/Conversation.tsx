import React, { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Send, Search, X, Image as ImageIcon, XCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "../context/AuthContext";
import { format, formatDistanceToNow, isToday, isYesterday } from "date-fns";
import io from "socket.io-client";

export default function Conversation() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const [recipient, setRecipient] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [fullScreenImage, setFullScreenImage] = useState<string | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
  
  const socketRef = useRef<any>(null);

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
         setMessages(data);
      })
      .catch(console.error);

    const socket = io();
    socketRef.current = socket;

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
        setMessages(prev => prev.map(m => (!m.isRead && m.senderId === user?.id ? { ...m, isRead: true } : m)));
      }
    });

    socket.on("new_message", (msg) => {
      if ((msg.senderId === user?.id && msg.receiverId === id) || 
          (msg.senderId === id && msg.receiverId === user?.id)) {
        setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg]);
        if (msg.senderId === id) {
          socket.emit("message_read", { messageId: msg.id, senderId: msg.senderId });
        }
      }
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
         alert("Image must be smaller than 5MB");
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

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!newMessage.trim() && !imagePreview) || !id) return;

    try {
      const content = newMessage.trim();
      const payloadImageUrl = imagePreview;
      
      setNewMessage(""); 
      setImagePreview(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      
      if (socketRef.current) {
        socketRef.current.emit("typing_stop", id);
      }
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      
      await fetch("/api/messages/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receiverId: id, content, imageUrl: payloadImageUrl }),
      });
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-16 items-center gap-4 border-b px-4 shadow-sm bg-muted/10 shrink-0">
        <Button variant="ghost" size="icon" className="md:hidden -ml-2" onClick={() => navigate("/")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        {recipient ? (
          <div className="flex items-center gap-3 flex-1 overflow-hidden cursor-pointer hover:bg-muted/30 p-1.5 -ml-1.5 rounded-md transition-colors" onClick={() => setShowProfile(true)}>
            <div className="relative shrink-0">
              <Avatar className="h-10 w-10 border bg-background text-foreground">
                <AvatarImage src={recipient.avatar_url || ""} />
                <AvatarFallback>{recipient.username.slice(0, 2).toUpperCase()}</AvatarFallback>
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
        
        <div className="flex items-center ml-auto pl-2">
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
      
      <main className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 bg-background">
        {messages.filter(m => searchQuery.trim() === "" || m.content.toLowerCase().includes(searchQuery.toLowerCase())).map((msg, idx) => {
          const isMine = msg.senderId === user?.id;
          const prevMsg = messages[idx - 1];
          const showTime = !prevMsg || new Date(msg.createdAt).getTime() - new Date(prevMsg.createdAt).getTime() > 5 * 60000;
          return (
            <React.Fragment key={msg.id}>
              {showTime && (
                <div className="flex justify-center my-2">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider bg-muted/30 px-2 py-0.5 rounded">
                    {format(new Date(msg.createdAt), "MMM d, HH:mm")}
                  </span>
                </div>
              )}
              <div className={`flex w-full ${isMine ? 'justify-end' : 'justify-start'}`}>
                <div className={`relative max-w-[85%] sm:max-w-[70%] rounded-2xl px-3 py-1.5 shadow-sm border overflow-hidden ${
                  isMine 
                    ? 'bg-primary text-primary-foreground border-transparent rounded-br-sm' 
                    : 'bg-muted border-border/50 text-foreground rounded-bl-sm'
                }`}>
                  {msg.imageUrl && (
                    <div className="mb-1 rounded-lg overflow-hidden cursor-pointer" onClick={() => setFullScreenImage(msg.imageUrl)}>
                      <img src={msg.imageUrl} alt="Attachment" className="max-w-full max-h-64 object-contain hover:opacity-90 transition-opacity" />
                    </div>
                  )}
                  {msg.content && (
                    <p className="whitespace-pre-wrap break-words text-[14px] leading-relaxed">
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
                    <span>{format(new Date(msg.createdAt), "HH:mm")}</span>
                    {isMine && <span className={msg.isRead ? "text-cyan-200" : ""}>{msg.isRead ? "✓✓" : "✓"}</span>}
                  </div>
                </div>
              </div>
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

      <footer className="p-4 border-t bg-background shrink-0 flex flex-col gap-2">
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
          >
            <ImageIcon className="h-5 w-5" />
          </Button>
          <Input 
            placeholder="Write a message..." 
            className="flex-1 rounded-3xl px-4 bg-muted/50 border-transparent focus-visible:ring-1 focus-visible:bg-background min-h-10"
            value={newMessage}
            onChange={handleTyping}
          />
          <Button 
            type="submit" 
            size="icon" 
            disabled={!newMessage.trim() && !imagePreview} 
            className="rounded-full shrink-0 mb-0.5 shadow-sm"
          >
            <Send className="h-4 w-4 ml-0.5" />
          </Button>
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

      {showProfile && recipient && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setShowProfile(false)}
        >
          <div className="bg-background rounded-xl shadow-lg w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="h-32 bg-muted/30 relative">
               <Button 
                variant="default" 
                size="icon" 
                className="absolute top-2 right-2 rounded-full h-8 w-8 bg-black/20 hover:bg-black/40 text-white"
                onClick={() => setShowProfile(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="px-6 pb-6 relative">
               <div className="flex justify-between items-end -mt-12 mb-4">
                 <Avatar className="h-24 w-24 border-4 border-background bg-muted">
                    <AvatarImage src={recipient.avatar_url || ""} />
                    <AvatarFallback className="text-3xl">{recipient.username.slice(0, 2).toUpperCase()}</AvatarFallback>
                 </Avatar>
               </div>
               
               <div className="space-y-4">
                 <div>
                    <h2 className="text-xl font-bold">{recipient.displayName || recipient.username}</h2>
                    <p className="text-muted-foreground text-sm">@{recipient.username}</p>
                 </div>
                 
                 {recipient.bio && (
                   <div>
                     <p className="text-sm whitespace-pre-wrap">{recipient.bio}</p>
                   </div>
                 )}
                 
                 <div className="flex items-center gap-2 text-sm text-muted-foreground pt-4 border-t">
                   <div className={`w-2 h-2 rounded-full ${recipient.isOnline ? 'bg-green-500' : 'bg-muted-foreground'}`}></div>
                   <span>
                     {recipient.isOnline ? "Online now" : recipient.lastSeen ? formatLastSeen(recipient.lastSeen) : "Offline"}
                   </span>
                 </div>
                 
                 <div className="text-xs text-muted-foreground">
                   Joined {recipient.created_at ? format(new Date(recipient.created_at), "PPP") : "recently"}
                 </div>
               </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
