import React, { useState, useEffect } from "react";
import { useNavigate, useLocation, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Search, LogOut, Package, MessageSquare } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatDistanceToNow } from "date-fns";
import io from "socket.io-client";

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [conversations, setConversations] = useState<any[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<Record<string, { isOnline: boolean; lastSeen: string }>>({});

  const fetchConversations = async () => {
    try {
      const res = await fetch("/api/conversations");
      if (res.ok) {
        setConversations(await res.json());
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchConversations();

    const socket = io();
    socket.on("new_message", () => {
      fetchConversations();
    });

    socket.on("user_status", (status) => {
      setOnlineUsers(prev => ({
        ...prev,
        [status.userId]: { isOnline: status.isOnline, lastSeen: status.lastSeen }
      }));
    });

    socket.on("message_read", () => {
       fetchConversations();
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    const fetchSearch = async () => {
      if (!searchQuery.trim()) {
        setSearchResults([]);
        return;
      }
      try {
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(searchQuery)}`);
        if (res.ok) {
          const data = await res.json();
          setSearchResults(data.filter((u: any) => u.id !== user?.id));
        }
      } catch (err) {
        console.error(err);
      }
    };
    const debounce = setTimeout(fetchSearch, 300);
    return () => clearTimeout(debounce);
  }, [searchQuery, user?.id]);

  const isMessageView = location.pathname.startsWith("/messages/");

  const isUserOnline = (u: any) => {
     if (onlineUsers[u.id]) return onlineUsers[u.id].isOnline;
     return u.isOnline;
  };

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {/* Sidebar */}
      <div className={`flex flex-col w-full md:w-80 border-r bg-muted/10 ${isMessageView ? 'hidden md:flex' : 'flex'}`}>
        <div className="p-4 border-b flex items-center justify-between gap-2 shadow-sm">
          <div className="flex items-center gap-2 font-semibold">
            <Package className="h-5 w-5" />
            <span>Messages</span>
          </div>
          <Button variant="ghost" size="icon" onClick={() => logout()}>
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
        <div className="p-4 border-b">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Search users..." 
              className="pl-9 bg-background"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
        <ScrollArea className="flex-1">
          {searchQuery.trim() ? (
            <div className="p-2 space-y-1">
              <div className="text-xs font-semibold text-muted-foreground px-2 py-1">Search Results</div>
              {searchResults.length === 0 && <div className="text-sm px-2 text-muted-foreground">No users found</div>}
              {searchResults.map((u) => (
                <button
                  key={u.id}
                  onClick={() => {
                    setSearchQuery("");
                    navigate(`/messages/${u.id}`);
                  }}
                  className="w-full flex items-center gap-3 p-2 hover:bg-accent rounded-md transition-colors text-left"
                >
                  <div className="relative">
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={u.avatar_url || ""} />
                      <AvatarFallback>{u.username.slice(0, 2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    {isUserOnline(u) && (
                      <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-green-500 border-2 border-background"></span>
                    )}
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <div className="font-medium truncate">{u.username}</div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="p-2 space-y-1">
              <div className="text-xs font-semibold text-muted-foreground px-2 py-1">Conversations</div>
              {conversations.length === 0 && (
                 <div className="text-center p-4 text-muted-foreground flex flex-col items-center gap-2">
                   <MessageSquare className="h-8 w-8 opacity-20" />
                   <span className="text-sm">No recent conversations. Search for users to start chatting!</span>
                 </div>
              )}
              {conversations.map((c) => {
                const isSelected = location.pathname === `/messages/${c.user.id}`;
                return (
                  <button
                    key={c.user.id}
                    onClick={() => navigate(`/messages/${c.user.id}`)}
                    className={`w-full flex items-center gap-3 p-2 rounded-md transition-colors text-left ${isSelected ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
                  >
                    <div className="relative">
                      <Avatar className="h-10 w-10 border bg-background text-foreground">
                        <AvatarImage src={c.user.avatar_url || ""} />
                        <AvatarFallback>{c.user.username.slice(0, 2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      {isUserOnline(c.user) && (
                        <span className={`absolute bottom-0 right-0 h-3 w-3 rounded-full bg-green-500 border-2 ${isSelected ? 'border-primary' : 'border-background'}`}></span>
                      )}
                    </div>
                    <div className="flex-1 overflow-hidden">
                      <div className="flex justify-between items-baseline">
                        <div className={`font-medium truncate ${isSelected ? '' : 'text-foreground'}`}>{c.user.username}</div>
                        <div className={`text-[10px] whitespace-nowrap ml-2 ${isSelected ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>
                          {c.lastMessage?.createdAt && formatDistanceToNow(new Date(c.lastMessage.createdAt), { addSuffix: true })}
                        </div>
                      </div>
                      <div className={`text-sm flex items-center gap-1 truncate ${isSelected ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>
                        {c.lastMessage?.senderId === user?.id ? (
                           <span className="shrink-0 text-[10px]">
                              {c.lastMessage.isRead ? "✓✓" : "✓"}
                           </span>
                        ) : null}
                        <span className="truncate">{c.lastMessage?.content}</span>
                      </div>
                    </div>
                    {c.unreadCount > 0 && (
                      <div className="bg-primary text-primary-foreground text-[10px] font-bold h-5 min-w-5 px-1.5 rounded-full flex items-center justify-center shrink-0">
                        {c.unreadCount}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Main Content Area */}
      <div className={`flex-1 flex flex-col min-w-0 ${!isMessageView ? 'hidden md:flex' : 'flex'}`}>
        <Outlet />
      </div>
    </div>
  );
}
