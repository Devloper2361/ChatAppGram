import React, { useState, useRef } from "react";
import { useAuth } from "../context/AuthContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { format } from "date-fns";
import { Camera, Save, ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function Profile() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState(user?.displayName || "");
  const [bio, setBio] = useState(user?.bio || "");
  const [avatarBase64, setAvatarBase64] = useState(user?.avatar_url || "");
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        alert("Image must be smaller than 5MB");
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setAvatarBase64(reader.result as string);
      };
      reader.readAsDataURL(file);
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
      if (res.ok) {
        const updatedUser = await res.json();
        setUser((prev: any) => ({ ...prev, ...updatedUser }));
        alert("Profile saved successfully");
      } else {
        const data = await res.json();
        alert(data.error || "Failed to update profile");
      }
    } catch (err) {
      console.error(err);
      alert("Server error");
    } finally {
      setLoading(false);
    }
  };

  if (!user) return null;

  return (
    <div className="flex flex-col h-screen bg-background">
      <header className="flex h-16 items-center border-b px-4 gap-4 sticky top-0 bg-background/95 backdrop-blur z-10 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate(-1)}
          className="md:hidden"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-semibold">Edit Profile</h1>
      </header>

      <main className="flex-1 overflow-y-auto w-full p-6 md:p-10 pl-4 md:pl-10">
        <div className="max-w-xl mx-auto md:ml-0 md:mx-0 w-full space-y-8">
          <div className="flex flex-col items-center sm:items-start sm:flex-row gap-6">
            <div className="relative group shrink-0">
              <Avatar className="h-28 w-28 md:h-32 md:w-32 border-2 shadow-sm">
                <AvatarImage src={avatarBase64} />
                <AvatarFallback className="text-3xl">
                  {user.username.slice(0, 2).toUpperCase()}
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

            <div className="pt-4 border-t border-border flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                Joined{" "}
                {user.created_at
                  ? format(new Date(user.created_at), "PPP")
                  : "recently"}
              </div>
              <Button type="submit" disabled={loading} className="gap-2">
                <Save className="w-4 h-4" /> Save Profile
              </Button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
