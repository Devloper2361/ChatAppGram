/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Conversation from "./pages/Conversation";
import Layout from "./components/Layout";
import { MessageSquare } from "lucide-react";

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex h-screen items-center justify-center">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
};

const AuthRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex h-screen items-center justify-center">Loading...</div>;
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
};

import Profile from "./pages/Profile";

const EmptyState = () => (
  <div className="flex h-full flex-col items-center justify-center bg-muted/10 p-6">
    <div className="flex flex-col items-center max-w-sm text-center gap-4">
      <div className="bg-background p-4 rounded-full shadow-sm">
        <MessageSquare className="h-8 w-8 text-primary" />
      </div>
      <h2 className="text-xl font-semibold">Your Messages</h2>
      <p className="text-muted-foreground text-sm">Select a user from the sidebar to start a conversation.</p>
    </div>
  </div>
);

export default function App() {
  React.useEffect(() => {
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      document.documentElement.classList.add('dark');
    }
  }, []);

  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<AuthRoute><Login /></AuthRoute>} />
          <Route path="/register" element={<AuthRoute><Register /></AuthRoute>} />
          
          <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route index element={<EmptyState />} />
            <Route path="messages/:id" element={<Conversation />} />
            <Route path="profile" element={<Profile />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
