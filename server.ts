import dotenv from "dotenv";
dotenv.config();

import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import http from "node:http";
import { Server as SocketIOServer } from "socket.io";
import * as cookie from "cookie";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";

const app = express();
app.set("trust proxy", 1);
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: "*", credentials: true }
});

const PORT = 3000;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-key-for-local-testing";

const prisma = new PrismaClient({
  log: ['query', 'info', 'warn', 'error'],
});

prisma.$connect().then(() => {
  console.log('Connected to Prisma SQLite Database at file:./dev.db');
}).catch((e) => {
  console.error('Failed to connect to Prisma SQLite Database', e);
});

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(express.json());
app.use(cookieParser());

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 1000,
});

app.use("/api/auth", authLimiter);
app.use("/api", apiLimiter);

interface AuthRequest extends express.Request {
  userId?: string;
}

const registerSchema = z.object({
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and underscores"),
  email: z.string().email(),
  password: z.string().min(6)
});

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});

const messageSchema = z.object({
  receiverId: z.string().uuid(),
  content: z.string().min(1).max(5000)
});

// Auth Middleware
const authenticateToken = (req: AuthRequest, res: express.Response, next: express.NextFunction) => {
  const token = req.cookies.token;
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const verified = jwt.verify(token, JWT_SECRET) as { userId: string };
    req.userId = verified.userId;
    next();
  } catch (err) {
    res.status(401).clearCookie("token", { secure: true, sameSite: 'none' }).json({ error: "Invalid token" });
  }
};

// API: Register
app.post("/api/auth/register", async (req, res) => {
  try {
    const data = registerSchema.parse(req.body);
    
    // Check if exists
    const existingUser = await prisma.user.findFirst({
      where: { 
        OR: [
          { username: data.username },
          { email: data.email }
        ] 
      },
    });

    if (existingUser) {
      const isUsernameMatch = existingUser.username.toLowerCase() === data.username.toLowerCase();
      res.status(400).json({ error: isUsernameMatch ? "Username already exists" : "Email already in use" });
      return;
    }
    
    const password_hash = await bcrypt.hash(data.password, 12);
    const user = await prisma.user.create({
      data: { username: data.username, email: data.email, password_hash },
    });
    
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "7d" });
    res.cookie("token", token, { 
      httpOnly: true, 
      secure: true,
      sameSite: 'none',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
    
    res.status(201).json({ id: user.id, username: user.username, email: user.email });
  } catch (e) {
    const err = e as any;
    if (err && (err.name === "ZodError" || err.issues || err.errors)) {
      const message = err.errors?.[0]?.message || err.issues?.[0]?.message || "Validation failed";
      res.status(400).json({ error: message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// API: Login
app.post("/api/auth/login", async (req, res) => {
  try {
    const data = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { username: data.username } });
    
    if (!user) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    
    const valid = await bcrypt.compare(data.password, user.password_hash);
    if (!valid) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "7d" });
    res.cookie("token", token, { 
      httpOnly: true, 
      secure: true,
      sameSite: 'none',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
    
    res.json({ id: user.id, username: user.username, email: user.email, avatar_url: user.avatar_url, bio: user.bio });
  } catch (e) {
    const err = e as any;
    if (err && (err.name === "ZodError" || err.issues || err.errors)) {
      const message = err.errors?.[0]?.message || err.issues?.[0]?.message || "Validation failed";
      res.status(400).json({ error: message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// API: Logout
app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("token", { secure: true, sameSite: 'none' });
  res.json({ success: true });
});

// API: Get Current User
app.get("/api/auth/me", authenticateToken, async (req: AuthRequest, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! } });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json({ id: user.id, username: user.username, email: user.email, avatar_url: user.avatar_url, bio: user.bio, isOnline: user.isOnline, lastSeen: user.lastSeen });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// API: Search Users
app.get("/api/users/search", authenticateToken, async (req: AuthRequest, res) => {
  const currentUserId = req.userId!;
  const q = req.query.q as string;
  
  if (!q || q.trim() === "") {
    res.json([]);
    return;
  }
  
  try {
    // In SQLite, contains is case-sensitive or insensitive depending on pragma, but we use string operations if needed
    // However, Prisma SQLite contains defaults to something reasonable, let's just use it 
    const users = await prisma.user.findMany({
      where: {
        username: {
          contains: q.trim(),
        },
        id: {
          not: currentUserId
        }
      },
      select: {
        id: true,
        username: true,
        avatar_url: true,
        bio: true,
        isOnline: true,
        lastSeen: true,
      },
      take: 20,
    });
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/users/:id", authenticateToken, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { id: true, username: true, avatar_url: true, bio: true, isOnline: true, lastSeen: true }
    });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

const connectedUsers = new Map<string, Set<string>>();

io.use((socket, next) => {
  try {
    const cookies = cookie.parse(socket.request.headers.cookie || "");
    const token = cookies.token;
    if (!token) return next(new Error("Authentication error"));
    
    const verified = jwt.verify(token, JWT_SECRET) as { userId: string };
    (socket as any).userId = verified.userId;
    next();
  } catch (err) {
    next(new Error("Authentication error"));
  }
});

io.on("connection", (socket) => {
  const userId = (socket as any).userId as string;
  
  if (!connectedUsers.has(userId)) {
    connectedUsers.set(userId, new Set());
    prisma.user.update({ where: { id: userId }, data: { isOnline: true } }).catch(console.error);
    io.emit("user_status", { userId, isOnline: true, lastSeen: new Date() });
  }
  connectedUsers.get(userId)!.add(socket.id);

  socket.on("typing_start", (receiverId: string) => {
    const sockets = connectedUsers.get(receiverId);
    if (sockets) {
      for (const sId of sockets) {
        io.to(sId).emit("typing_start", userId);
      }
    }
  });

  socket.on("typing_stop", (receiverId: string) => {
    const sockets = connectedUsers.get(receiverId);
    if (sockets) {
      for (const sId of sockets) {
        io.to(sId).emit("typing_stop", userId);
      }
    }
  });

  socket.on("message_read", async (params: { messageId?: string; senderId: string }) => {
    try {
      if (params.messageId) {
        await prisma.message.updateMany({
          where: { id: params.messageId, receiverId: userId, isRead: false },
          data: { isRead: true },
        });
      } else {
        await prisma.message.updateMany({
          where: { senderId: params.senderId, receiverId: userId, isRead: false },
          data: { isRead: true },
        });
      }
      const sockets = connectedUsers.get(params.senderId);
      if (sockets) {
        for (const sId of sockets) {
          io.to(sId).emit("message_read", { receiverId: userId, messageId: params.messageId });
        }
      }
    } catch(e) {
      console.error(e);
    }
  });

  socket.on("disconnect", () => {
    const userSockets = connectedUsers.get(userId);
    if (userSockets) {
      userSockets.delete(socket.id);
      if (userSockets.size === 0) {
        connectedUsers.delete(userId);
        const lastSeen = new Date();
        prisma.user.update({ where: { id: userId }, data: { isOnline: false, lastSeen } }).catch(console.error);
        io.emit("user_status", { userId, isOnline: false, lastSeen });
      }
    }
  });
});

app.get("/api/messages/:userId", authenticateToken, async (req: AuthRequest, res) => {
  const currentUserId = req.userId!;
  const targetUserId = req.params.userId;
  try {
    const messages = await prisma.message.findMany({
      where: {
        OR: [
          { senderId: currentUserId, receiverId: targetUserId },
          { senderId: targetUserId, receiverId: currentUserId },
        ],
      },
      orderBy: { createdAt: "asc" },
      take: 1000,
    });
    
    const updated = await prisma.message.updateMany({
      where: { senderId: targetUserId, receiverId: currentUserId, isRead: false },
      data: { isRead: true },
    });
    
    if (updated.count > 0) {
      const sockets = connectedUsers.get(targetUserId);
      if (sockets) {
        for (const sId of sockets) {
          io.to(sId).emit("message_read", { receiverId: currentUserId });
        }
      }
    }
    
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/conversations", authenticateToken, async (req: AuthRequest, res) => {
  const userId = req.userId!;
  try {
    const lastMessages = await prisma.message.findMany({
      where: {
        OR: [{ senderId: userId }, { receiverId: userId }],
      },
      orderBy: { createdAt: "desc" },
    });
    
    const conversationsMap = new Map<string, any>();
    for (const msg of lastMessages) {
      const otherUserId = msg.senderId === userId ? msg.receiverId : msg.senderId;
      if (!conversationsMap.has(otherUserId)) {
        conversationsMap.set(otherUserId, msg);
      }
    }

    const otherUserIds = Array.from(conversationsMap.keys());
    if (otherUserIds.length === 0) {
      res.json([]);
      return;
    }

    const users = await prisma.user.findMany({
      where: { id: { in: otherUserIds } },
      select: { id: true, username: true, avatar_url: true, isOnline: true, lastSeen: true },
    });

    const result = users.map(u => ({
      user: u,
      lastMessage: conversationsMap.get(u.id),
      unreadCount: lastMessages.filter(m => m.senderId === u.id && m.receiverId === userId && !m.isRead).length
    })).sort((a: any, b: any) => new Date(b.lastMessage.createdAt).getTime() - new Date(a.lastMessage.createdAt).getTime());

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/messages/send", authenticateToken, async (req: AuthRequest, res) => {
  const senderId = req.userId!;
  
  try {
    let data;
    try {
      data = messageSchema.parse(req.body);
    } catch(e) {
      const err = e as any;
      const message = err.errors?.[0]?.message || err.issues?.[0]?.message || "Invalid input";
      res.status(400).json({ error: message });
      return;
    }

    const targetUser = await prisma.user.findUnique({ where: { id: data.receiverId } });
    if (!targetUser) {
      res.status(404).json({ error: "Recipient not found" });
      return;
    }

    const msg = await prisma.message.create({
      data: { senderId, receiverId: data.receiverId, content: data.content },
    });
    
    const emitToUserSockets = (toUserId: string, message: any) => {
      const sockets = connectedUsers.get(toUserId);
      if (sockets) {
        for (const socketId of sockets) {
          io.to(socketId).emit("new_message", message);
        }
      }
    };
    
    emitToUserSockets(data.receiverId, msg);
    emitToUserSockets(senderId, msg);
    
    res.json(msg);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
