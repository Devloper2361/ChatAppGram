import React, { useState, useRef } from "react";
import { useAuth } from "../context/AuthContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { format } from "date-fns";
import { Camera, Save, ArrowLeft } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { toast } from "sonner";

export default function Profile() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  console.log("CURRENT PATH", location.pathname);

  const [displayName, setDisplayName] = useState(user?.displayName || "");
  const [bio, setBio] = useState(user?.bio || "");
  const [avatarBase64, setAvatarBase64] = useState(user?.avatar_url || "");
  const [wallpaperLight, setWallpaperLight] = useState(user?.wallpaperLight || "");
  const [wallpaperDark, setWallpaperDark] = useState(user?.wallpaperDark || "");
  const [wallpaperBlur, setWallpaperBlur] = useState(user?.wallpaperBlur || false);

  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const wallpaperLightInputRef = useRef<HTMLInputElement>(null);
  const wallpaperDarkInputRef = useRef<HTMLInputElement>(null);

  const compressImage = async (file: File, quality = 0.6, maxWidth = 1920): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (e) => {
        const img = new Image();
        img.src = e.target?.result as string;
        img.onload = () => {
          const canvas = document.createElement("canvas");
          let width = img.width;
          let height = img.height;
          
          if (width > maxWidth) {
            height = (maxWidth / width) * height;
            width = maxWidth;
          }
          
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx?.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", quality));
        };
        img.onerror = () => reject(new Error("Image compression failed"));
      };
      reader.onerror = () => reject(new Error("File read failed"));
    });
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        toast.error("Image must be smaller than 5MB");
        return;
      }
      try {
        const compressed = await compressImage(file, 0.7, 800);
        setAvatarBase64(compressed);
      } catch (err) {
        console.error(err);
      }
    }
  };

  const handleWallpaperUpload = async (e: React.ChangeEvent<HTMLInputElement>, theme: 'light' | 'dark') => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        toast.error("Wallpaper image must be smaller than 10MB");
        return;
      }
      try {
        const compressed = await compressImage(file, 0.8, 1920);
        if (theme === 'light') {
           setWallpaperLight(compressed);
        } else {
           setWallpaperDark(compressed);
        }
      } catch (err) {
        console.error(err);
      }
    }
  };

  const handleRemoveAvatar = () => {
    setAvatarBase64("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/auth/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName,
          bio,
          avatar_url: avatarBase64,
        }),
      });

      const settingsRes = await fetch("/api/auth/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallpaperLight,
          wallpaperDark,
          wallpaperBlur,
        }),
      });

      if (res.ok && settingsRes.ok) {
        const updatedUser = await res.json();
        const updatedSettings = await settingsRes.json();
        setUser((prev: any) => ({ ...prev, ...updatedUser, ...updatedSettings }));
        toast.success("Changes saved", { duration: 3000 });
      } else {
        const data = await res.json().catch(() => null);
        toast.error(`Failed to save changes${data?.error ? `: ${data.error}` : ''}`);
      }
    } catch (err: any) {
      console.error(err);
      toast.error(`Failed to save changes: ${err.message || 'Network error'}`);
    } finally {
      setLoading(false);
    }
  };

  if (!user) return null;

  return (
    <div className="flex flex-col h-screen bg-background">
      <header className="flex h-16 items-center justify-between border-b px-4 sticky top-0 bg-background/95 backdrop-blur z-10 shrink-0">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => { console.log("PROFILE BACK CLICKED"); navigate(-1); }}
            className="md:hidden"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-semibold">Settings</h1>
        </div>
        <Button variant="outline" size="sm" onClick={() => { console.log("PRIVACY CLICKED"); navigate("/privacy"); }} className="gap-2">
          Privacy
        </Button>
      </header>

      <main className="flex-1 overflow-y-auto w-full p-6 md:p-10 pl-4 md:pl-10">
        <div className="max-w-xl mx-auto md:ml-0 md:mx-0 w-full space-y-8">
          <div className="flex flex-col items-center sm:items-start sm:flex-row gap-6">
            <div className="relative group shrink-0">
              <Avatar className="h-28 w-28 md:h-32 md:w-32 border-2 shadow-sm">
                <AvatarImage src={avatarBase64} />
                <AvatarFallback className="text-3xl">
                  {user.username?.slice(0, 2).toUpperCase() || "?"}
                </AvatarFallback>
              </Avatar>
              <div
                onClick={() => fileInputRef.current?.click()}
                className="absolute inset-0 bg-black/40 flex items-center justify-center rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
              >
                <Camera className="text-white w-8 h-8" />
              </div>
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept="image/png, image/jpeg, image/gif, image/webp"
                onChange={handleImageUpload}
              />
            </div>

            <div className="flex flex-col gap-2 mt-2 items-center sm:items-start object-contain">
              <h2 className="text-2xl font-bold">
                {displayName || user.username}
              </h2>
              <p className="text-muted-foreground text-sm">@{user.username}</p>
              <div className="flex gap-2 mt-1">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Change Photo
                </Button>
                {avatarBase64 && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleRemoveAvatar}
                  >
                    Remove
                  </Button>
                )}
              </div>
            </div>
          </div>

          <form onSubmit={saveProfile} className="space-y-6">
            <div className="space-y-2">
              <label className="text-sm font-medium">Username</label>
              <Input disabled value={user.username} className="bg-muted/50" />
              <p className="text-xs text-muted-foreground">
                You can't change your username
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Display Name</label>
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your display name"
                maxLength={50}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Bio</label>
              <Textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="A little bit about yourself"
                rows={4}
                maxLength={200}
              />
            </div>

            <div className="pt-6 border-t border-border space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <h3 className="text-lg font-semibold">Chat Wallpaper</h3>
                <Button 
                  type="button" 
                  variant="outline" 
                  size="sm" 
                  onClick={() => {
                    setWallpaperLight("");
                    setWallpaperDark("");
                    setWallpaperBlur(false);
                  }}
                >
                  Reset to Default
                </Button>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Light Mode Wallpaper</label>
                  <div 
                    className="h-32 border-2 border-dashed rounded-lg flex flex-col items-center justify-center cursor-pointer overflow-hidden relative"
                    onClick={() => wallpaperLightInputRef.current?.click()}
                  >
                    {wallpaperLight ? (
                      <img src={wallpaperLight} alt="Light Wallpaper" className={`w-full h-full object-cover ${wallpaperBlur ? 'blur-sm scale-110' : ''}`} />
                    ) : (
                      <span className="text-sm text-muted-foreground">+ Upload Image</span>
                    )}
                  </div>
                  {wallpaperLight && (
                    <Button variant="ghost" size="sm" type="button" onClick={() => setWallpaperLight("")} className="w-full text-destructive">Remove Light Wallpaper</Button>
                  )}
                  <input type="file" ref={wallpaperLightInputRef} className="hidden" accept="image/*" onChange={(e) => handleWallpaperUpload(e, 'light')} />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Dark Mode Wallpaper</label>
                  <div 
                    className="h-32 border-2 border-dashed rounded-lg flex flex-col items-center justify-center cursor-pointer overflow-hidden relative"
                    onClick={() => wallpaperDarkInputRef.current?.click()}
                  >
                    {wallpaperDark ? (
                      <img src={wallpaperDark} alt="Dark Wallpaper" className={`w-full h-full object-cover ${wallpaperBlur ? 'blur-sm scale-110' : ''}`} />
                    ) : (
                      <span className="text-sm text-muted-foreground">+ Upload Image</span>
                    )}
                  </div>
                  {wallpaperDark && (
                    <Button variant="ghost" size="sm" type="button" onClick={() => setWallpaperDark("")} className="w-full text-destructive">Remove Dark Wallpaper</Button>
                  )}
                  <input type="file" ref={wallpaperDarkInputRef} className="hidden" accept="image/*" onChange={(e) => handleWallpaperUpload(e, 'dark')} />
                </div>
              </div>

              <div className="flex items-center space-x-2 pt-2">
                <input
                  type="checkbox"
                  id="blur-wallpaper"
                  checked={wallpaperBlur}
                  onChange={(e) => setWallpaperBlur(e.target.checked)}
                  className="rounded border-gray-300 w-4 h-4"
                />
                <label htmlFor="blur-wallpaper" className="text-sm font-medium leading-none">
                  Blur Wallpaper
                </label>
              </div>
            </div>

            <div className="pt-4 border-t border-border flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                Joined{" "}
                {user.created_at
                  ? format(new Date(user.created_at), "PPP")
                  : "recently"}
              </div>
              <Button type="submit" disabled={loading} className="gap-2">
                {loading ? (
                  <>Saving...</>
                ) : (
                  <><Save className="w-4 h-4" /> Save Profile</>
                )}
              </Button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
