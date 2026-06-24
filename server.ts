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

// --- Privacy Helper ---
async function applyPrivacy(viewerId: string, targetUsers: any[]) {
  const messages = await prisma.message.findMany({
    where: { OR: [{ senderId: viewerId }, { receiverId: viewerId }] },
    select: { senderId: true, receiverId: true }
  });
  
  const contacts = new Set<string>();
  for (const m of messages) {
    contacts.add(m.senderId === viewerId ? m.receiverId : m.senderId);
  }

  return targetUsers.map(user => {
    if (user.id === viewerId) return user; // don't restrict oneself

    const isContact = contacts.has(user.id);
    const u = { ...user };
    
    const pp = u.profilePhotoPrivacy || "EVERYONE";
    const ls = u.lastSeenPrivacy || "EVERYONE";
    const os = u.onlineStatusPrivacy || "EVERYONE";

    if (pp === "NOBODY" || (pp === "MY_CONTACTS" && !isContact)) {
      u.avatar_url = null;
    }
    
    if (ls === "NOBODY" || (ls === "MY_CONTACTS" && !isContact)) {
      u.lastSeen = null;
    }
    
    if (os === "NOBODY" || (os === "MY_CONTACTS" && !isContact)) {
      u.isOnline = false;
    }

    return u;
  });
}

async function applyStatusPrivacy(viewerId: string, statuses: any[]) {
  const messages = await prisma.message.findMany({
    where: { OR: [{ senderId: viewerId }, { receiverId: viewerId }] },
    select: { senderId: true, receiverId: true }
  });
  
  const contacts = new Set<string>();
  for (const m of messages) {
    contacts.add(m.senderId === viewerId ? m.receiverId : m.senderId);
  }

  return statuses.filter(s => {
    if (s.user.id === viewerId) return true; // always see own

    const isContact = contacts.has(s.user.id);
    const p = s.user.statusPrivacy || "EVERYONE";
    const exceptions = s.user.statusPrivacyExceptions || [];

    if (p === "NOBODY") return false;
    if (p === "MY_CONTACTS" && !isContact) return false;
    
    if (p === "MY_CONTACTS_EXCEPT") {
      if (!isContact) return false;
      const excluded = exceptions.some((e: any) => e.targetUserId === viewerId && e.type === "EXCLUDED");
      if (excluded) return false;
    }
    
    if (p === "ONLY_SHARE_WITH") {
      const allowed = exceptions.some((e: any) => e.targetUserId === viewerId && e.type === "ALLOWED");
      if (!allowed) return false;
    }

    return true;
  });
}
// ----------------------

const app = express();
app.set("trust proxy", 1);
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: "*", credentials: true }
});

const PORT = 3000;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-key-for-local-testing";

const prisma = new PrismaClient({
  log: ['warn', 'error'],
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
app.use(express.json({ limit: "15mb" }));
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
  content: z.string().max(5000).optional().nullable().default(""),
  imageUrl: z.string().optional().nullable(),
  audioUrl: z.string().optional().nullable(),
  audioDuration: z.number().int().optional().nullable(),
  replyToId: z.string().uuid().optional().nullable(),
  replyToStatusId: z.string().uuid().optional().nullable()
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
    res.status(500).json({ error: "Server error register", message: String(err) });
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
    
    res.json({ id: user.id, username: user.username, email: user.email, displayName: user.displayName, avatar_url: user.avatar_url, bio: user.bio });
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

const profileUpdateSchema = z.object({
  displayName: z.string().max(50).optional().nullable(),
  bio: z.string().max(200).optional().nullable(),
  avatar_url: z.string().optional().nullable()
});

const settingsUpdateSchema = z.object({
  wallpaperLight: z.string().optional().nullable(),
  wallpaperDark: z.string().optional().nullable(),
  wallpaperBlur: z.boolean().optional()
});

app.put("/api/auth/settings", authenticateToken, async (req: AuthRequest, res) => {
  try {
    const data = settingsUpdateSchema.parse(req.body);
    const userExists = await prisma.user.findUnique({ where: { id: req.userId! } });
    if (!userExists) return res.status(404).json({ error: "User not found" });

    const user = await prisma.user.update({
      where: { id: req.userId! },
      data: {
        ...(data.wallpaperLight !== undefined && { wallpaperLight: data.wallpaperLight }),
        ...(data.wallpaperDark !== undefined && { wallpaperDark: data.wallpaperDark }),
        ...(data.wallpaperBlur !== undefined && { wallpaperBlur: data.wallpaperBlur })
      }
    });

    res.json(user);
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Invalid input" });
  }
});

// API: Update Profile
app.put("/api/auth/profile", authenticateToken, async (req: AuthRequest, res) => {
  try {
    const data = profileUpdateSchema.parse(req.body);
    const userExists = await prisma.user.findUnique({ where: { id: req.userId! } });
    if (!userExists) return res.status(404).json({ error: "User not found" });

    const user = await prisma.user.update({
      where: { id: req.userId! },
      data: {
        displayName: data.displayName !== undefined ? data.displayName : undefined,
        bio: data.bio !== undefined ? data.bio : undefined,
        avatar_url: data.avatar_url !== undefined ? data.avatar_url : undefined,
      }
    });
    
    // Broadcast profile update
    const publicProfile = {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatar_url: user.avatar_url,
      bio: user.bio,
      isOnline: user.isOnline,
      lastSeen: user.lastSeen,
      created_at: user.created_at
    };
    io.emit("profile_updated", publicProfile);

    res.json({ id: user.id, username: user.username, email: user.email, displayName: user.displayName, avatar_url: user.avatar_url, bio: user.bio });
  } catch (e) {
    const err = e as any;
    if (err && (err.name === "ZodError" || err.issues || err.errors)) {
      const message = err.errors?.[0]?.message || err.issues?.[0]?.message || "Validation failed";
      res.status(400).json({ error: message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Server error profile update", message: String(err) });
  }
});

// API: Get Current User
app.get("/api/auth/me", authenticateToken, async (req: AuthRequest, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! } });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json({ 
      id: user.id, username: user.username, email: user.email, displayName: user.displayName, 
      avatar_url: user.avatar_url, bio: user.bio, isOnline: user.isOnline, lastSeen: user.lastSeen, 
      wallpaperLight: user.wallpaperLight, wallpaperDark: user.wallpaperDark, wallpaperBlur: user.wallpaperBlur, 
      created_at: user.created_at,
      profilePhotoPrivacy: user.profilePhotoPrivacy, statusPrivacy: user.statusPrivacy, 
      lastSeenPrivacy: user.lastSeenPrivacy, onlineStatusPrivacy: user.onlineStatusPrivacy 
    });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// API: Get Privacy Settings
app.get("/api/auth/privacy", authenticateToken, async (req: AuthRequest, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId! },
      include: {
        statusPrivacyExceptions: {
          include: { targetUser: { select: { displayName: true, username: true } } }
        }
      }
    });
    if (!user) return res.status(404).json({ error: "User not found" });
    
    res.json({
      profilePhotoPrivacy: user.profilePhotoPrivacy,
      statusPrivacy: user.statusPrivacy,
      lastSeenPrivacy: user.lastSeenPrivacy,
      onlineStatusPrivacy: user.onlineStatusPrivacy,
      statusPrivacyExceptions: user.statusPrivacyExceptions
    });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

const privacyUpdateSchema = z.object({
  profilePhotoPrivacy: z.enum(["EVERYONE", "MY_CONTACTS", "NOBODY"]).optional(),
  statusPrivacy: z.enum(["EVERYONE", "MY_CONTACTS", "MY_CONTACTS_EXCEPT", "ONLY_SHARE_WITH"]).optional(),
  lastSeenPrivacy: z.enum(["EVERYONE", "MY_CONTACTS", "NOBODY"]).optional(),
  onlineStatusPrivacy: z.enum(["EVERYONE", "MY_CONTACTS", "NOBODY"]).optional(),
  statusPrivacyExceptions: z.array(z.object({
    targetUserId: z.string().uuid(),
    type: z.enum(["EXCLUDED", "ALLOWED"])
  })).optional()
});

app.put("/api/auth/privacy", authenticateToken, async (req: AuthRequest, res) => {
  try {
    const data = privacyUpdateSchema.parse(req.body);
    const user = await prisma.user.update({
      where: { id: req.userId! },
      data: {
        profilePhotoPrivacy: data.profilePhotoPrivacy,
        statusPrivacy: data.statusPrivacy,
        lastSeenPrivacy: data.lastSeenPrivacy,
        onlineStatusPrivacy: data.onlineStatusPrivacy
      }
    });

    if (data.statusPrivacyExceptions !== undefined) {
      // clear old exceptions
      await prisma.statusPrivacyException.deleteMany({
        where: { userId: req.userId! }
      });
      if (data.statusPrivacyExceptions.length > 0) {
        await prisma.statusPrivacyException.createMany({
          data: data.statusPrivacyExceptions.map(ex => ({
            userId: req.userId!,
            targetUserId: ex.targetUserId,
            type: ex.type
          }))
        });
      }
    }

    // Broadcast privacy update so other clients refresh
    io.emit("privacy_updated", { userId: req.userId! });

    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Invalid input" });
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
        displayName: true,
        avatar_url: true,
        bio: true,
        isOnline: true,
        lastSeen: true,
        profilePhotoPrivacy: true,
        lastSeenPrivacy: true,
        onlineStatusPrivacy: true,
      },
      take: 20,
    });
    
    const safeUsers = await applyPrivacy(currentUserId, users);
    res.json(safeUsers);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/users/:id", authenticateToken, async (req: AuthRequest, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { id: true, username: true, displayName: true, avatar_url: true, bio: true, isOnline: true, lastSeen: true, created_at: true, profilePhotoPrivacy: true, lastSeenPrivacy: true, onlineStatusPrivacy: true }
    });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const safeUserList = await applyPrivacy(req.userId!, [user]);
    res.json(safeUserList[0]);
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

async function emitUserStatus(userId: string, isOnline: boolean, lastSeen: Date) {
  const targetUser = await prisma.user.findUnique({ where: { id: userId } });
  if (!targetUser) return;
  
  const contacts = await prisma.message.findMany({
    where: { OR: [{ senderId: userId }, { receiverId: userId }] },
    select: { senderId: true, receiverId: true }
  });
  const contactIds = new Set<string>();
  for (const m of contacts) {
    contactIds.add(m.senderId === userId ? m.receiverId : m.senderId);
  }

  for (const [connectedId, sockets] of connectedUsers.entries()) {
    if (connectedId === userId) continue;
    const isContact = contactIds.has(connectedId);
    
    let canSeeOnline = true;
    let canSeeLastSeen = true;

    if (targetUser.onlineStatusPrivacy === "NOBODY" || (targetUser.onlineStatusPrivacy === "MY_CONTACTS" && !isContact)) {
      canSeeOnline = false;
    }
    
    if (targetUser.lastSeenPrivacy === "NOBODY" || (targetUser.lastSeenPrivacy === "MY_CONTACTS" && !isContact)) {
      canSeeLastSeen = false;
    }

    if (!canSeeOnline && !canSeeLastSeen) continue; // skip

    for (const sId of sockets) {
      io.to(sId).emit("user_status", { 
        userId, 
        isOnline: canSeeOnline ? isOnline : false, 
        lastSeen: canSeeLastSeen ? lastSeen : null 
      });
    }
  }
}

io.on("connection", (socket) => {
  const userId = (socket as any).userId as string;
  
  if (!connectedUsers.has(userId)) {
    connectedUsers.set(userId, new Set());
    prisma.user.updateMany({ where: { id: userId }, data: { isOnline: true } }).catch(console.error);
    emitUserStatus(userId, true, new Date());
  }
  connectedUsers.get(userId)!.add(socket.id);

  socket.on("typing_start", async (receiverId: string) => {
    try {
      const sockets = connectedUsers.get(receiverId);
      if (sockets) {
        const sender = await prisma.user.findUnique({ where: { id: userId } });
        if (!sender) return;
        
        let canSee = true;
        if (sender.onlineStatusPrivacy === "NOBODY") {
          canSee = false;
        } else if (sender.onlineStatusPrivacy === "MY_CONTACTS") {
          const contact = await prisma.message.findFirst({
            where: { OR: [{ senderId: userId, receiverId }, { senderId: receiverId, receiverId: userId }] }
          });
          if (!contact) canSee = false;
        }
        
        if (canSee) {
          for (const sId of sockets) {
            io.to(sId).emit("typing_start", userId);
          }
        }
      }
    } catch (err) {
      console.error(err);
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

  socket.on("message_delivered", async (params: { messageId?: string; senderId: string }) => {
    try {
      const deliveredAt = new Date();
      if (params.messageId) {
        await prisma.message.updateMany({
          where: { id: params.messageId, receiverId: userId, deliveredAt: null },
          data: { deliveredAt },
        });
      } else {
        await prisma.message.updateMany({
          where: { senderId: params.senderId, receiverId: userId, deliveredAt: null },
          data: { deliveredAt },
        });
      }
      const sockets = connectedUsers.get(params.senderId);
      if (sockets) {
        for (const sId of sockets) {
          io.to(sId).emit("message_delivered", { receiverId: userId, messageId: params.messageId, deliveredAt });
        }
      }
    } catch(e) {
      console.error(e);
    }
  });

  socket.on("message_read", async (params: { messageId?: string; senderId: string }) => {
    try {
      const readAt = new Date();
      // Only set readAt if it wasn't read before, or just update `readAt` anyway.
      if (params.messageId) {
        await prisma.message.updateMany({
          where: { id: params.messageId, receiverId: userId, isRead: false },
          data: { isRead: true, readAt, deliveredAt: readAt }, // also ensure deliveredAt is set if read straight away
        });
      } else {
        await prisma.message.updateMany({
          where: { senderId: params.senderId, receiverId: userId, isRead: false },
          data: { isRead: true, readAt, deliveredAt: readAt },
        });
      }
      const sockets = connectedUsers.get(params.senderId);
      if (sockets) {
        for (const sId of sockets) {
          io.to(sId).emit("message_read", { receiverId: userId, messageId: params.messageId, readAt });
        }
      }
    } catch(e) {
      console.error(e);
    }
  });

  // WebRTC Signaling
  socket.on("call_user", (data: { recipientId: string; callerName: string; callType: "voice" | "video" }) => {
    const sockets = connectedUsers.get(data.recipientId);
    if (sockets) {
      for (const sId of sockets) {
        io.to(sId).emit("incoming_call", { callerId: userId, callerName: data.callerName, callType: data.callType });
      }
    }
  });

  socket.on("call_accepted", (data: { to: string }) => {
    const sockets = connectedUsers.get(data.to);
    if (sockets) {
      for (const sId of sockets) {
        io.to(sId).emit("call_accepted", { from: userId });
      }
    }
  });

  socket.on("call_rejected", (data: { to: string }) => {
    const sockets = connectedUsers.get(data.to);
    if (sockets) {
      for (const sId of sockets) {
        io.to(sId).emit("call_rejected", { from: userId });
      }
    }
  });

  socket.on("offer", (data: { to: string; offer: any }) => {
    const sockets = connectedUsers.get(data.to);
    if (sockets) {
      for (const sId of sockets) {
        io.to(sId).emit("offer", { from: userId, offer: data.offer });
      }
    }
  });

  socket.on("answer", (data: { to: string; answer: any }) => {
    const sockets = connectedUsers.get(data.to);
    if (sockets) {
      for (const sId of sockets) {
        io.to(sId).emit("answer", { from: userId, answer: data.answer });
      }
    }
  });

  socket.on("ice_candidate", (data: { to: string; candidate: any }) => {
    const sockets = connectedUsers.get(data.to);
    if (sockets) {
      for (const sId of sockets) {
        io.to(sId).emit("ice_candidate", { from: userId, candidate: data.candidate });
      }
    }
  });

  socket.on("end_call", (data: { to: string }) => {
    const sockets = connectedUsers.get(data.to);
    if (sockets) {
      for (const sId of sockets) {
        io.to(sId).emit("end_call", { from: userId });
      }
    }
  });

  socket.on("disconnect", () => {
    const userSockets = connectedUsers.get(userId);
    if (userSockets) {
      userSockets.delete(socket.id);
      if (userSockets.size === 0) {
        connectedUsers.delete(userId);
        const lastSeen = new Date();
        prisma.user.updateMany({ where: { id: userId }, data: { isOnline: false, lastSeen } }).catch(console.error);
        emitUserStatus(userId, false, lastSeen);
      }
    }
  });
});

app.get("/api/messages/:userId", authenticateToken, async (req: AuthRequest, res) => {
  const currentUserId = req.userId!;
  const targetUserId = req.params.userId;
  try {
    const rawMessages = await prisma.message.findMany({
      where: {
        OR: [
          { senderId: currentUserId, receiverId: targetUserId },
          { senderId: targetUserId, receiverId: currentUserId },
        ],
      },
      include: {
        replyTo: {
          include: { sender: { select: { username: true, displayName: true } } }
        },
        replyToStatus: {
          include: { user: { select: { username: true, displayName: true } } }
        },
        reactions: true
      },
      orderBy: { createdAt: "desc" },
      take: 1000,
    });
    
    const messages = rawMessages.reverse();

    const u1 = currentUserId < targetUserId ? currentUserId : targetUserId;
    const u2 = currentUserId < targetUserId ? targetUserId : currentUserId;

    const chatSetting = await prisma.chatSetting.findUnique({
      where: {
        user1Id_user2Id: {
          user1Id: u1,
          user2Id: u2
        }
      },
      include: {
        pinnedMessage: {
           include: {
             sender: { select: { username: true, displayName: true } }
           }
        }
      }
    });
    
    const readAtDate = new Date();
    const updated = await prisma.message.updateMany({
      where: { senderId: targetUserId, receiverId: currentUserId, isRead: false },
      data: { isRead: true, readAt: readAtDate, deliveredAt: readAtDate },
    });
    
    if (updated.count > 0) {
      const senderSockets = connectedUsers.get(targetUserId);
      if (senderSockets) {
        for (const sId of senderSockets) {
          io.to(sId).emit("message_read", { receiverId: currentUserId, readAt: readAtDate, deliveredAt: readAtDate });
        }
      }
      
      const receiverSockets = connectedUsers.get(currentUserId);
      if (receiverSockets) {
         for (const sId of receiverSockets) {
            io.to(sId).emit("message_read", { receiverId: currentUserId, readAt: readAtDate, deliveredAt: readAtDate });
         }
      }
    }
    
    res.json({ messages, pinnedMessage: chatSetting?.pinnedMessage || null });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/messages/:id/pin", authenticateToken, async (req: AuthRequest, res) => {
  const userId = req.userId!;
  const messageId = req.params.id;

  try {
    const message = await prisma.message.findUnique({ where: { id: messageId } });
    if (!message) return res.status(404).json({ error: "Message not found" });

    // Validate that user is part of the conversation
    if (message.senderId !== userId && message.receiverId !== userId) {
       return res.status(403).json({ error: "Unauthorized" });
    }

    const u1 = message.senderId < message.receiverId ? message.senderId : message.receiverId;
    const u2 = message.senderId < message.receiverId ? message.receiverId : message.senderId;

    const chatSetting = await prisma.chatSetting.upsert({
      where: {
        user1Id_user2Id: {
          user1Id: u1,
          user2Id: u2
        }
      },
      update: {
        pinnedMessageId: messageId
      },
      create: {
        user1Id: u1,
        user2Id: u2,
        pinnedMessageId: messageId
      },
      include: {
        pinnedMessage: {
           include: { sender: { select: { username: true, displayName: true } } }
        }
      }
    });

    const emitToUserSockets = (toUserId: string, data: any) => {
      const sockets = connectedUsers.get(toUserId);
      if (sockets) {
        for (const socketId of sockets) {
          io.to(socketId).emit("message_pinned", data);
        }
      }
    };

    emitToUserSockets(message.senderId, chatSetting.pinnedMessage);
    emitToUserSockets(message.receiverId, chatSetting.pinnedMessage);

    res.json(chatSetting.pinnedMessage);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/conversations/:id/unpin", authenticateToken, async (req: AuthRequest, res) => {
  const userId = req.userId!;
  const targetUserId = req.params.id;

  try {
    const u1 = userId < targetUserId ? userId : targetUserId;
    const u2 = userId < targetUserId ? targetUserId : userId;

    await prisma.chatSetting.update({
      where: {
        user1Id_user2Id: {
          user1Id: u1,
          user2Id: u2
        }
      },
      data: {
        pinnedMessageId: null
      }
    });

    const emitToUserSockets = (toUserId: string, data: any) => {
      const sockets = connectedUsers.get(toUserId);
      if (sockets) {
        for (const socketId of sockets) {
          io.to(socketId).emit("message_unpinned", data);
        }
      }
    };

    emitToUserSockets(userId, { targetUserId });
    emitToUserSockets(targetUserId, { targetUserId: userId });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// STATUS APIs

const statusCreateSchema = z.object({
  type: z.enum(["TEXT", "IMAGE", "VIDEO", "AUDIO"]),
  content: z.string().optional().nullable(),
  mediaUrl: z.string().optional().nullable(),
});

app.post("/api/status", authenticateToken, async (req: AuthRequest, res) => {
  try {
    const data = statusCreateSchema.parse(req.body);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    
    const status = await prisma.status.create({
      data: {
        userId: req.userId!,
        type: data.type,
        content: data.content,
        mediaUrl: data.mediaUrl,
        expiresAt
      },
      include: { user: { select: { id: true, username: true, displayName: true, avatar_url: true } } }
    });
    
    io.emit("new_status", status); // Broadcast to all connected clients
    res.json(status);
  } catch (err) {
    res.status(400).json({ error: "Invalid input" });
  }
});

app.get("/api/status", authenticateToken, async (req: AuthRequest, res) => {
  const userId = req.userId!;
  try {
    const messages = await prisma.message.findMany({
      where: { OR: [{ senderId: userId }, { receiverId: userId }] },
      select: { senderId: true, receiverId: true }
    });
    const contactIds = new Set<string>();
    contactIds.add(userId); // Always include own statuses
    messages.forEach(m => {
      contactIds.add(m.senderId);
      contactIds.add(m.receiverId);
    });

    const activeStatuses = await prisma.status.findMany({
      where: {
        userId: { in: Array.from(contactIds) },
        expiresAt: { gt: new Date() }
      },
      include: {
        user: { select: { id: true, username: true, displayName: true, avatar_url: true, profilePhotoPrivacy: true, statusPrivacy: true, statusPrivacyExceptions: true, lastSeenPrivacy: true, onlineStatusPrivacy: true } },
        views: { 
          select: { viewerId: true, viewedAt: true, viewer: { select: { id: true, username: true, displayName: true, avatar_url: true, profilePhotoPrivacy: true, lastSeenPrivacy: true, onlineStatusPrivacy: true } } },
          orderBy: { viewedAt: 'desc' }
        },
        reactions: { include: { viewer: { select: { id: true, username: true, displayName: true } } } }
      },
      orderBy: { createdAt: "desc" }
    });
    
    const filteredStatuses = await applyStatusPrivacy(userId, activeStatuses);
    
    // Now apply profile photo privacy to the status user and viewers
    const finalStatuses = [];
    for (const status of filteredStatuses) {
      const safeUsers = await applyPrivacy(userId, [status.user]);
      const safeUser = safeUsers[0];
      
      const safeViewers = await applyPrivacy(userId, status.views.map((v: any) => v.viewer));
      const newViews = status.views.map((v: any, idx: number) => ({
        ...v,
        viewer: safeViewers[idx]
      }));

      finalStatuses.push({
        ...status,
        user: safeUser,
        views: newViews
      });
    }

    res.json(finalStatuses);
  } catch (err) {
     res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/status/:id/view", authenticateToken, async (req: AuthRequest, res) => {
  try {
    const statusId = req.params.id;
    const viewerId = req.userId!;
    
    const status = await prisma.status.findUnique({ 
      where: { id: statusId },
      include: { user: { select: { id: true, statusPrivacy: true, statusPrivacyExceptions: true } } }
    });
    if (!status) return res.json({ success: true });
    if (status.userId === viewerId) return res.json({ success: true });

    const isAllowed = await applyStatusPrivacy(viewerId, [status]);
    if (isAllowed.length === 0) return res.status(403).json({ error: "Access denied" });
    
    await prisma.statusView.upsert({
      where: { statusId_viewerId: { statusId, viewerId } },
      create: { statusId, viewerId },
      update: {}
    });

    const updatedStatus = await prisma.status.findUnique({
      where: { id: statusId },
      include: {
        user: { select: { id: true, username: true, displayName: true, avatar_url: true } },
        views: { 
          select: { viewerId: true, viewedAt: true, viewer: { select: { id: true, username: true, displayName: true, avatar_url: true } } },
          orderBy: { viewedAt: 'desc' }
        },
        reactions: { include: { viewer: { select: { id: true, username: true, displayName: true } } } }
      }
    });

    io.emit("status_updated", updatedStatus);
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/status/:id/views", authenticateToken, async (req: AuthRequest, res) => {
  try {
    const views = await prisma.statusView.findMany({
      where: { statusId: req.params.id, status: { userId: req.userId! } },
      include: { viewer: { select: { id: true, username: true, displayName: true, avatar_url: true, profilePhotoPrivacy: true, lastSeenPrivacy: true, onlineStatusPrivacy: true } } },
      orderBy: { viewedAt: 'desc' }
    });
    
    const safeViewers = await applyPrivacy(req.userId!, views.map(v => v.viewer));
    const safeViews = views.map((v, i) => ({ ...v, viewer: safeViewers[i] }));
    
    res.json(safeViews);
  } catch(e) {
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/status/:id/react", authenticateToken, async (req: AuthRequest, res) => {
  try {
    const statusId = req.params.id;
    const viewerId = req.userId!;
    const { emoji } = req.body;
    
    if (!emoji) return res.status(400).json({ error: "Missing emoji" });

    const status = await prisma.status.findUnique({ 
      where: { id: statusId },
      include: { user: { select: { id: true, statusPrivacy: true, statusPrivacyExceptions: true } } }
    });
    if (!status) return res.status(404).json({ error: "Not found" });
    if (status.userId !== viewerId) {
      const isAllowed = await applyStatusPrivacy(viewerId, [status]);
      if (isAllowed.length === 0) return res.status(403).json({ error: "Access denied" });
    }

    const existing = await prisma.statusReaction.findUnique({
      where: { statusId_viewerId_emoji: { statusId, viewerId, emoji } }
    });

    if (existing) {
      await prisma.statusReaction.delete({ where: { id: existing.id } });
    } else {
      await prisma.statusReaction.create({
        data: { statusId, viewerId, emoji }
      });
    }

    const updatedStatus = await prisma.status.findUnique({
      where: { id: statusId },
      include: {
        user: { select: { id: true, username: true, displayName: true, avatar_url: true } },
        views: { 
          select: { viewerId: true, viewedAt: true, viewer: { select: { id: true, username: true, displayName: true, avatar_url: true } } },
          orderBy: { viewedAt: 'desc' }
        },
        reactions: { include: { viewer: { select: { id: true, username: true, displayName: true } } } }
      }
    });

    io.emit("status_updated", updatedStatus);
    res.json(updatedStatus);
  } catch(e) {
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/conversations", authenticateToken, async (req: AuthRequest, res) => {
  const userId = req.userId!;
  try {
    const deliveredAtDate = new Date();
    const undelivered = await prisma.message.findMany({
      where: { receiverId: userId, deliveredAt: null },
      select: { id: true, senderId: true }
    });
    
    if (undelivered.length > 0) {
      await prisma.message.updateMany({
        where: { receiverId: userId, deliveredAt: null },
        data: { deliveredAt: deliveredAtDate }
      });
      // Notify senders
      const senders = new Set(undelivered.map(u => u.senderId));
      for (const senderId of senders) {
        const sockets = connectedUsers.get(senderId);
        if (sockets) {
          for (const sId of sockets) {
            io.to(sId).emit("message_delivered", { receiverId: userId, deliveredAt: deliveredAtDate });
          }
        }
      }
    }

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
      select: { id: true, username: true, displayName: true, avatar_url: true, isOnline: true, lastSeen: true, profilePhotoPrivacy: true, lastSeenPrivacy: true, onlineStatusPrivacy: true },
    });

    const safeUsers = await applyPrivacy(userId, users);

    const result = safeUsers.map(u => ({
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

    if (!data.content && !data.imageUrl && !data.audioUrl) {
      res.status(400).json({ error: "Message must contain text, an image, or audio" });
      return;
    }

    const targetUser = await prisma.user.findUnique({ where: { id: data.receiverId } });
    if (!targetUser) {
      res.status(404).json({ error: "Recipient not found" });
      return;
    }

    if (data.replyToStatusId) {
      const status = await prisma.status.findUnique({ 
        where: { id: data.replyToStatusId },
        include: { user: { select: { id: true, statusPrivacy: true, statusPrivacyExceptions: true } } }
      });
      if (!status) return res.status(404).json({ error: "Status not found" });
      if (status.userId !== senderId) {
        const isAllowed = await applyStatusPrivacy(senderId, [status]);
        if (isAllowed.length === 0) return res.status(403).json({ error: "Access denied to reply to this status" });
      }
    }

    const msg = await prisma.message.create({
      data: { 
        senderId, 
        receiverId: data.receiverId, 
        content: data.content || "", 
        imageUrl: data.imageUrl,
        audioUrl: data.audioUrl,
        audioDuration: data.audioDuration,
        replyToId: data.replyToId,
        replyToStatusId: data.replyToStatusId
      },
      include: {
        replyTo: {
          include: { sender: { select: { username: true, displayName: true } } }
        },
        replyToStatus: {
          include: { user: { select: { username: true, displayName: true } } }
        },
        reactions: true
      }
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

app.post("/api/messages/forward", authenticateToken, async (req: AuthRequest, res) => {
  const senderId = req.userId!;
  const { messageId, receiverIds } = req.body;
  if (!messageId || !Array.isArray(receiverIds) || receiverIds.length === 0) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  try {
    const originalMessage = await prisma.message.findUnique({
      where: { id: messageId },
      include: { replyTo: { include: { sender: { select: { username: true, displayName: true } } } } }
    });

    if (!originalMessage) {
      res.status(404).json({ error: "Message not found" });
      return;
    }

    const emitToUserSockets = (toUserId: string, message: any) => {
      const sockets = connectedUsers.get(toUserId);
      if (sockets) {
        for (const socketId of sockets) {
          io.to(socketId).emit("new_message", message);
        }
      }
    };

    const newMessages = [];

    for (const receiverId of receiverIds) {
      const msg = await prisma.message.create({
        data: {
          senderId,
          receiverId,
          content: originalMessage.content,
          imageUrl: originalMessage.imageUrl,
          audioUrl: originalMessage.audioUrl,
          audioDuration: originalMessage.audioDuration,
          replyToId: originalMessage.replyToId,
          isForwarded: true
        },
        include: {
          replyTo: {
            include: { sender: { select: { username: true, displayName: true } } }
          },
          reactions: true
        }
      });
      newMessages.push(msg);

      emitToUserSockets(receiverId, msg);
      emitToUserSockets(senderId, msg);
    }

    res.json({ success: true, count: newMessages.length });
  } catch (err) {
    console.error("Forward error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/messages/:id/react", authenticateToken, async (req: AuthRequest, res) => {
  const userId = req.userId!;
  const messageId = req.params.id;
  const { emoji } = req.body;

  try {
    const message = await prisma.message.findUnique({ where: { id: messageId } });
    if (!message) return res.status(404).json({ error: "Message not found" });

    // Try to find existing reaction
    const existingReaction = await prisma.messageReaction.findUnique({
      where: {
        messageId_userId_emoji: {
          messageId,
          userId,
          emoji
        }
      }
    });

    if (existingReaction) {
      await prisma.messageReaction.deleteMany({ where: { id: existingReaction.id } });
    } else {
      await prisma.messageReaction.create({
        data: { messageId, userId, emoji }
      });
    }

    const updatedMessage = await prisma.message.findUnique({
      where: { id: messageId },
      include: {
        replyTo: {
          include: { sender: { select: { username: true, displayName: true } } }
        },
        reactions: true
      }
    });

    const emitToUserSockets = (toUserId: string, data: any) => {
      const sockets = connectedUsers.get(toUserId);
      if (sockets) {
        for (const socketId of sockets) {
          io.to(socketId).emit("message_updated", data);
        }
      }
    };

    emitToUserSockets(message.receiverId, updatedMessage);
    emitToUserSockets(message.senderId, updatedMessage);

    res.json(updatedMessage);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.put("/api/messages/:id", authenticateToken, async (req: AuthRequest, res) => {
  const userId = req.userId!;
  const messageId = req.params.id;
  const { content } = req.body;

  try {
    const message = await prisma.message.findUnique({ where: { id: messageId } });
    if (!message) return res.status(404).json({ error: "Message not found" });
    if (message.senderId !== userId) return res.status(403).json({ error: "Only sender can edit" });
    
    // 15 minutes limit
    if (new Date().getTime() - new Date(message.createdAt).getTime() > 15 * 60 * 1000) {
      return res.status(400).json({ error: "Editing window has expired" });
    }

    const updatedMessage = await prisma.message.update({
      where: { id: messageId },
      data: { content, editedAt: new Date() },
      include: {
        replyTo: {
          include: { sender: { select: { username: true, displayName: true } } }
        },
        reactions: true
      }
    });

    const emitToUserSockets = (toUserId: string, data: any) => {
      const sockets = connectedUsers.get(toUserId);
      if (sockets) {
        for (const socketId of sockets) {
          io.to(socketId).emit("message_updated", data);
        }
      }
    };

    emitToUserSockets(message.receiverId, updatedMessage);
    emitToUserSockets(message.senderId, updatedMessage);

    res.json(updatedMessage);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.delete("/api/messages/:id", authenticateToken, async (req: AuthRequest, res) => {
  const userId = req.userId!;
  const messageId = req.params.id;
  const { type } = req.body; // "me" | "everyone"

  try {
    const message = await prisma.message.findUnique({ where: { id: messageId } });
    if (!message) return res.status(404).json({ error: "Message not found" });

    if (type === "everyone") {
      if (message.senderId !== userId) return res.status(403).json({ error: "Only sender can delete for everyone" });
      
      // 24 hours limit
      if (new Date().getTime() - new Date(message.createdAt).getTime() > 24 * 60 * 60 * 1000) {
        return res.status(400).json({ error: "Deletion window has expired" });
      }

      const updatedMessage = await prisma.message.update({
        where: { id: messageId },
        data: { isDeleted: true, deletedAt: new Date(), content: "", imageUrl: null, audioUrl: null },
        include: {
          replyTo: {
            include: { sender: { select: { username: true, displayName: true } } }
          },
          reactions: true
        }
      });

      const u1 = message.senderId < message.receiverId ? message.senderId : message.receiverId;
      const u2 = message.senderId < message.receiverId ? message.receiverId : message.senderId;
      
      try {
        const chatSetting = await prisma.chatSetting.findUnique({
          where: { user1Id_user2Id: { user1Id: u1, user2Id: u2 } }
        });
        if (chatSetting?.pinnedMessageId === messageId) {
          await prisma.chatSetting.update({
            where: { id: chatSetting.id },
            data: { pinnedMessageId: null }
          });
          
          const emitToUserSocketsLocal = (toUserId: string, data: any) => {
            const sockets = connectedUsers.get(toUserId);
            if (sockets) {
              for (const socketId of sockets) {
                io.to(socketId).emit("message_unpinned", data);
              }
            }
          };
          emitToUserSocketsLocal(userId, { targetUserId: message.senderId === userId ? message.receiverId : message.senderId });
          emitToUserSocketsLocal(message.senderId === userId ? message.receiverId : message.senderId, { targetUserId: userId });
        }
      } catch (err) {
        console.error("Failed to unpin on delete", err);
      }

      const emitToUserSockets = (toUserId: string, data: any) => {
        const sockets = connectedUsers.get(toUserId);
        if (sockets) {
          for (const socketId of sockets) {
            io.to(socketId).emit("message_updated", data);
          }
        }
      };

      emitToUserSockets(message.receiverId, updatedMessage);
      emitToUserSockets(message.senderId, updatedMessage);

      return res.json(updatedMessage);
    } else {
      // In a real app we might want a separate junction table to track who deleted the message for themselves
      // For this implementation, since we need simple "Delete for Me", we can skip showing it for `userId`
      // Since WhatsApp just hides it local, or we can just send back a success and have the client remove it from local state
      // if it's "Delete for Me", they just hide it on their device immediately
      res.json({ success: true, id: messageId });
    }
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
