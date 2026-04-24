import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { mediaDto } from "../utils/dto.js";
import { asyncHandler, HttpError } from "../utils/http.js";
import { routeParam } from "../utils/params.js";
import { normalizeNickname } from "../utils/validation.js";

export const authRouter = Router();

authRouter.post(
  "/nickname",
  asyncHandler(async (req, res) => {
    const nickname = normalizeNickname(req.body?.nickname);
    const existingUser = await prisma.user.findUnique({ where: { nickname } });

    if (existingUser) {
      res.json({ user: existingUser, created: false });
      return;
    }

    try {
      const user = await prisma.user.create({ data: { nickname } });
      res.status(201).json({ user, created: true });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
        const user = await prisma.user.findUnique({ where: { nickname } });
        res.json({ user, created: false });
        return;
      }

      throw error;
    }
  })
);

authRouter.post(
  "/logout",
  asyncHandler(async (_req, res) => {
    res.json({ ok: true });
  })
);

export const userRouter = Router();

userRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const userId = routeParam(req.params.id, "id");
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    const progress = await prisma.progress.findMany({
      where: { userId },
      include: {
        media: true
      },
      orderBy: { lastWatchedAt: "desc" }
    });

    if (!user) {
      throw new HttpError(404, "User not found");
    }

    res.json({
      ...user,
      progress: progress.map((entry) => ({
        ...entry,
        media: mediaDto(entry.media)
      }))
    });
  })
);

userRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const userId = routeParam(req.params.id, "id");
    const nickname = normalizeNickname(req.body?.nickname);

    try {
      const user = await prisma.user.update({
        where: { id: userId },
        data: { nickname }
      });

      res.json({ user });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
        throw new HttpError(409, "Nickname is already taken");
      }

      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2025") {
        throw new HttpError(404, "User not found");
      }

      throw error;
    }
  })
);
