import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { config } from "./config.js";
import { prisma } from "./lib/prisma.js";
import { adminRouter } from "./routes/adminRoutes.js";
import { authRouter, userRouter } from "./routes/authRoutes.js";
import { mediaRouter } from "./routes/mediaRoutes.js";
import { roomRouter } from "./routes/roomRoutes.js";
import { registerWatchSocket } from "./socket/watchSocket.js";
import { ensureMediaDirectories } from "./utils/mediaPaths.js";
import { errorHandler, HttpError } from "./utils/http.js";

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: config.clientOrigin,
    credentials: true
  }
});

app.use(
  cors({
    origin: config.clientOrigin,
    credentials: true
  })
);
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "online-watching-api"
  });
});

app.use("/api/auth", authRouter);
app.use("/api/users", userRouter);
app.use("/api/media", mediaRouter);
app.use("/api/rooms", roomRouter);
app.use("/api/admin", adminRouter);

app.use((_req, _res, next) => {
  next(new HttpError(404, "Route not found"));
});

app.use(errorHandler);

registerWatchSocket(io);

const shutdown = async () => {
  await prisma.$disconnect();
  httpServer.close(() => process.exit(0));
};

process.on("SIGINT", () => {
  void shutdown();
});

process.on("SIGTERM", () => {
  void shutdown();
});

await ensureMediaDirectories();

httpServer.listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}`);
});
