import React, { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { ArrowLeft, Save, Plus, X } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";

import { toast } from "sonner";

export default function Privacy() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  console.log("CURRENT PATH", location.pathname);

  React.useEffect(() => {
    console.log("PRIVACY PAGE MOUNTED");
  }, []);

  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exceptionUserSearch, setExceptionUserSearch] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  
  useEffect(() => {
    fetch("/api/auth/privacy", { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } })
      .then(res => res.json())
      .then(data => {
        setSettings(data);
        setLoading(false);
      });
  }, []);

  const searchUsers = async (q: string) => {
    setExceptionUserSearch(q);
    if (!q) {
      setSearchResults([]);
      return;
    }
    try {
      const res = await fetch(`/api/users/search?q=${encodeURIComponent(q)}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      });
      const data = await res.json();
      setSearchResults(data);
    } catch(e) {}
  };

  const addException = (u: any) => {
    const type = settings.statusPrivacy === "MY_CONTACTS_EXCEPT" ? "EXCLUDED" : "ALLOWED";
    if (!settings.statusPrivacyExceptions.some((ex: any) => ex.targetUserId === u.id)) {
      setSettings({
        ...settings,
        statusPrivacyExceptions: [...settings.statusPrivacyExceptions, { targetUserId: u.id, type, user: u }]
      });
    }
    setExceptionUserSearch("");
    setSearchResults([]);
  };

  const removeException = (id: string) => {
    setSettings({
      ...settings,
      statusPrivacyExceptions: settings.statusPrivacyExceptions.filter((ex: any) => ex.targetUserId !== id)
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/auth/privacy", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
        body: JSON.stringify(settings)
      });
      if (res.ok) {
        setUser({ ...user, ...settings });
        toast.success("Changes saved", { duration: 3000 });
      } else {
        const errData = await res.json().catch(() => null);
        toast.error(`Failed to save changes${errData?.error ? `: ${errData.error}` : ''}`);
      }
    } catch (err: any) {
      console.error(err);
      toast.error(`Failed to save changes: ${err.message || 'Network error'}`);
    }
    setSaving(false);
  };

  if (loading) return <div className="p-6">Loading...</div>;

  return (
    <div className="flex flex-col h-screen bg-background">
      <header className="flex h-16 items-center border-b px-4 gap-4 sticky top-0 bg-background/95 backdrop-blur z-10 shrink-0">
        <Button variant="ghost" size="icon" onClick={() => { console.log("PRIVACY BACK CLICKED"); navigate("/profile", { replace: true }); }} className="md:hidden">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-semibold">Privacy Settings</h1>
      </header>
      
      <main className="flex-1 overflow-y-auto p-6 max-w-xl mx-auto w-full space-y-8">
        
        {/* Profile Photo */}
        <section className="space-y-3">
          <h2 className="text-md font-semibold text-primary uppercase tracking-wider">Profile Photo</h2>
          <div className="flex flex-col gap-2">
            {["EVERYONE", "MY_CONTACTS", "NOBODY"].map(opt => (
              <label key={opt} className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted transition-colors">
                <input 
                  type="radio" 
                  name="profilePhotoPrivacy" 
                  value={opt} 
                  checked={settings.profilePhotoPrivacy === opt} 
                  onChange={(e) => setSettings({ ...settings, profilePhotoPrivacy: e.target.value })}
                  className="w-4 h-4"
                />
                <span className="capitalize text-sm font-medium">{opt.replace("_", " ").toLowerCase()}</span>
              </label>
            ))}
          </div>
        </section>

        {/* Status */}
        <section className="space-y-3">
          <h2 className="text-md font-semibold text-primary uppercase tracking-wider">Status</h2>
          <div className="flex flex-col gap-2">
            {["EVERYONE", "MY_CONTACTS", "MY_CONTACTS_EXCEPT", "ONLY_SHARE_WITH"].map(opt => (
              <label key={opt} className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted transition-colors">
                <input 
                  type="radio" 
                  name="statusPrivacy" 
                  value={opt} 
                  checked={settings.statusPrivacy === opt} 
                  onChange={(e) => {
                    const newType = e.target.value === "MY_CONTACTS_EXCEPT" ? "EXCLUDED" : "ALLOWED";
                    setSettings({ 
                      ...settings, 
                      statusPrivacy: e.target.value,
                      statusPrivacyExceptions: (e.target.value === "MY_CONTACTS_EXCEPT" || e.target.value === "ONLY_SHARE_WITH") 
                        ? settings.statusPrivacyExceptions.map((ex: any) => ({ ...ex, type: newType })) 
                        : []
                    });
                  }}
                  className="w-4 h-4"
                />
                <span className="capitalize text-sm font-medium">{opt.replace(/_/g, " ").toLowerCase()}</span>
              </label>
            ))}
          </div>
          
          {(settings.statusPrivacy === "MY_CONTACTS_EXCEPT" || settings.statusPrivacy === "ONLY_SHARE_WITH") && (
             <div className="p-4 bg-muted/50 border rounded-lg mt-2 flex flex-col gap-3">
               <span className="text-sm font-medium">
                 {settings.statusPrivacy === "MY_CONTACTS_EXCEPT" ? "Excluded Users:" : "Allowed Users:"}
               </span>
               <div className="flex flex-wrap gap-2">
                 {settings.statusPrivacyExceptions.map((ex: any) => (
                   <div key={ex.targetUserId} className="bg-background border px-3 py-1 rounded-full text-xs flex items-center gap-2 shadow-sm">
                     <span>{ex.user?.displayName || ex.targetUser?.displayName || ex.targetUser?.username || ex.targetUserId}</span>
                     <button onClick={() => removeException(ex.targetUserId)} className="hover:text-destructive"><X className="w-3 h-3" /></button>
                   </div>
                 ))}
               </div>
               <div className="relative mt-2">
                 <input 
                   placeholder="Search user to add..." 
                   className="w-full bg-background border px-3 py-2 rounded-md text-sm"
                   value={exceptionUserSearch}
                   onChange={(e) => searchUsers(e.target.value)}
                 />
                 {searchResults.length > 0 && (
                   <div className="absolute top-full left-0 right-0 bg-background border rounded-md shadow-lg mt-1 z-10 max-h-40 overflow-y-auto">
                     {searchResults.map(su => (
                       <div key={su.id} className="p-2 border-b last:border-b-0 hover:bg-muted cursor-pointer flex items-center justify-between" onClick={() => addException(su)}>
                         <span className="text-sm">{su.displayName || su.username}</span>
                         <Plus className="w-4 h-4 text-primary" />
                       </div>
                     ))}
                   </div>
                 )}
               </div>
             </div>
          )}
        </section>

        {/* Last Seen */}
        <section className="space-y-3">
          <h2 className="text-md font-semibold text-primary uppercase tracking-wider">Last Seen</h2>
          <div className="flex flex-col gap-2">
            {["EVERYONE", "MY_CONTACTS", "NOBODY"].map(opt => (
              <label key={opt} className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted transition-colors">
                <input 
                  type="radio" 
                  name="lastSeenPrivacy" 
                  value={opt} 
                  checked={settings.lastSeenPrivacy === opt} 
                  onChange={(e) => setSettings({ ...settings, lastSeenPrivacy: e.target.value })}
                  className="w-4 h-4"
                />
                <span className="capitalize text-sm font-medium">{opt.replace("_", " ").toLowerCase()}</span>
              </label>
            ))}
          </div>
        </section>

        {/* Online Status */}
        <section className="space-y-3">
          <h2 className="text-md font-semibold text-primary uppercase tracking-wider">Online Status</h2>
          <div className="flex flex-col gap-2">
            {["EVERYONE", "MY_CONTACTS", "NOBODY"].map(opt => (
              <label key={opt} className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted transition-colors">
                <input 
                  type="radio" 
                  name="onlineStatusPrivacy" 
                  value={opt} 
                  checked={settings.onlineStatusPrivacy === opt} 
                  onChange={(e) => setSettings({ ...settings, onlineStatusPrivacy: e.target.value })}
                  className="w-4 h-4"
                />
                <span className="capitalize text-sm font-medium">{opt.replace("_", " ").toLowerCase()}</span>
              </label>
            ))}
          </div>
        </section>

        <Button onClick={handleSave} disabled={saving} className="w-full gap-2 mt-4" size="lg">
          {saving ? (
            <>Saving...</>
          ) : (
            <><Save className="w-5 h-5" /> Save Privacy Settings</>
          )}
        </Button>
      </main>
    </div>
  );
}
