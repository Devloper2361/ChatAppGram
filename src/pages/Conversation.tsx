import React, { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Send } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "../context/AuthContext";
import { format, formatDistanceToNow } from "date-fns";
import io from "socket.io-client";

export default function Conversation() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const [recipient, setRecipient] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout>();
  
  const socketRef = useRef<any>();

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
        setMessages(prev => [...prev, msg]);
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
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

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

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !id) return;

    try {
      const content = newMessage.trim();
      setNewMessage(""); 
      if (socketRef.current) {
        socketRef.current.emit("typing_stop", id);
      }
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      
      await fetch("/api/messages/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receiverId: id, content }),
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
          <div className="flex items-center gap-3">
            <div className="relative">
              <Avatar className="h-10 w-10 border bg-background text-foreground">
                <AvatarImage src={recipient.avatar_url || ""} />
                <AvatarFallback>{recipient.username.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              {recipient.isOnline && (
                <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-green-500 border-2 border-background"></span>
              )}
            </div>
            <div className="flex flex-col">
              <span className="font-semibold leading-tight">{recipient.username}</span>
              <span className={`text-xs ${recipient.isOnline ? 'text-primary' : 'text-muted-foreground'}`}>
                {recipient.isOnline ? "Online" : recipient.lastSeen ? `Last seen ${formatDistanceToNow(new Date(recipient.lastSeen), { addSuffix: true })}` : recipient.bio || "Offline"}
              </span>
            </div>
          </div>
        ) : (
          <div className="animate-pulse flex items-center gap-3">
            <div className="h-10 w-10 bg-muted rounded-full"></div>
            <div className="flex flex-col gap-1">
              <div className="h-4 w-24 bg-muted rounded"></div>
              <div className="h-3 w-16 bg-muted rounded"></div>
            </div>
          </div>
        )}
      </header>
      
      <main className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 bg-background">
        {messages.map((msg, idx) => {
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
                <div className={`relative max-w-[85%] sm:max-w-[70%] rounded-2xl px-3 py-1.5 shadow-sm border ${
                  isMine 
                    ? 'bg-primary text-primary-foreground border-transparent rounded-br-sm' 
                    : 'bg-muted border-border/50 text-foreground rounded-bl-sm'
                }`}>
                  <p className="whitespace-pre-wrap break-words text-[14px] leading-relaxed">{msg.content}</p>
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

      <footer className="p-4 border-t bg-background shrink-0">
        <form onSubmit={sendMessage} className="mx-auto max-w-4xl flex gap-2">
          <Input 
            placeholder="Write a message..." 
            className="flex-1 rounded-full px-4 bg-muted/50 border-transparent focus-visible:ring-1 focus-visible:bg-background"
            value={newMessage}
            onChange={handleTyping}
          />
          <Button 
            type="submit" 
            size="icon" 
            disabled={!newMessage.trim()} 
            className="rounded-full shrink-0"
          >
            <Send className="h-4 w-4 ml-0.5" />
          </Button>
        </form>
      </footer>
    </div>
  );
}
