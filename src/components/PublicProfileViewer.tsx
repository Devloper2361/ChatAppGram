import React, { useEffect, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { format, isToday, isYesterday } from "date-fns";
import io from "socket.io-client";

interface PublicProfileViewerProps {
  userId: string;
  onClose: () => void;
}

export function PublicProfileViewer({ userId, onClose }: PublicProfileViewerProps) {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    fetch(`/api/users/${userId}`)
      .then(res => res.json())
      .then(data => {
        if (mounted) {
          setUser(data);
          setLoading(false);
        }
      })
      .catch(console.error);

    const socket = io();
    
    socket.on("user_status", (status) => {
      if (status.userId === userId) {
        setUser((prev: any) => prev ? { ...prev, isOnline: status.isOnline, lastSeen: status.lastSeen } : prev);
      }
    });

    socket.on("profile_updated", (updatedUser) => {
      if (updatedUser.id === userId) {
        setUser((prev: any) => prev ? { ...prev, ...updatedUser } : prev);
      }
    });

    return () => {
      mounted = false;
      socket.disconnect();
    };
  }, [userId]);

  const formatLastSeen = (dateString: string) => {
    const date = new Date(dateString);
    if (isToday(date)) return `Last seen today at ${format(date, "HH:mm")}`;
    if (isYesterday(date)) return `Last seen yesterday at ${format(date, "HH:mm")}`;
    return `Last seen ${format(date, "MMM d")}`;
  };

  if (loading || !user) {
    return (
      <div 
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
        onClick={onClose}
      >
        <div className="bg-background rounded-xl shadow-lg w-full max-w-sm h-64 flex items-center justify-center" onClick={e => e.stopPropagation()}>
           <div className="animate-pulse flex flex-col items-center gap-4">
             <div className="h-20 w-20 bg-muted rounded-full"></div>
             <div className="h-4 w-32 bg-muted rounded"></div>
             <div className="h-3 w-24 bg-muted rounded"></div>
           </div>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div className="bg-background rounded-xl shadow-lg w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="h-32 bg-muted/30 relative">
           <Button 
            variant="default" 
            size="icon" 
            className="absolute top-2 right-2 rounded-full h-8 w-8 bg-black/20 hover:bg-black/40 text-white"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="px-6 pb-6 relative">
           <div className="flex justify-between items-end -mt-12 mb-4">
             <Avatar className="h-24 w-24 border-4 border-background bg-muted text-foreground">
                <AvatarImage src={user.avatar_url || ""} />
                <AvatarFallback className="text-3xl">{user.username?.slice(0, 2).toUpperCase() || "?"}</AvatarFallback>
             </Avatar>
           </div>
           
           <div className="space-y-4">
             <div>
                <h2 className="text-xl font-bold">{user.displayName || user.username}</h2>
                <p className="text-muted-foreground text-sm">@{user.username}</p>
             </div>
             
             {user.bio && (
               <div>
                 <p className="text-sm whitespace-pre-wrap">{user.bio}</p>
               </div>
             )}
             
             <div className="flex items-center gap-2 text-sm pt-4 border-t">
               <div className={`w-2 h-2 rounded-full ${user.isOnline ? 'bg-green-500' : 'bg-muted-foreground'}`}></div>
               <span className={user.isOnline ? "text-foreground" : "text-muted-foreground"}>
                 {user.isOnline ? "Online now" : user.lastSeen ? formatLastSeen(user.lastSeen) : "Offline"}
               </span>
             </div>
             
             <div className="text-xs text-muted-foreground">
               Joined {user.created_at ? format(new Date(user.created_at), "PPP") : "recently"}
             </div>
           </div>
        </div>
      </div>
    </div>
  );
}
