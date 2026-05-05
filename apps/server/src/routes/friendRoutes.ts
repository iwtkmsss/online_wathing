import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { findUserByNicknameInsensitive } from "../services/userService.js";
import { asyncHandler, HttpError } from "../utils/http.js";
import { routeParam } from "../utils/params.js";
import { requiredString } from "../utils/validation.js";

const includeUsers = {
  requester: {
    select: {
      id: true,
      nickname: true
    }
  },
  addressee: {
    select: {
      id: true,
      nickname: true
    }
  }
} as const;

type FriendshipWithUsers = {
  id: string;
  status: "PENDING" | "ACCEPTED" | "BLOCKED";
  requesterId: string;
  addresseeId: string;
  requester: { id: string; nickname: string };
  addressee: { id: string; nickname: string };
  createdAt: Date;
  updatedAt: Date;
};

const toFriendshipDto = (friendship: FriendshipWithUsers) => ({
  id: friendship.id,
  status: friendship.status,
  requester: friendship.requester,
  addressee: friendship.addressee,
  createdAt: friendship.createdAt,
  updatedAt: friendship.updatedAt
});

export const friendRouter = Router();

friendRouter.get(
  "/:userId",
  asyncHandler(async (req, res) => {
    const userId = routeParam(req.params.userId, "userId");
    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new HttpError(404, "User not found");
    }

    const friendships = await prisma.friend.findMany({
      where: {
        OR: [{ requesterId: userId }, { addresseeId: userId }]
      },
      include: includeUsers,
      orderBy: { updatedAt: "desc" }
    });

    const accepted = friendships
      .filter((friendship) => friendship.status === "ACCEPTED")
      .map((friendship) => ({
        ...toFriendshipDto(friendship),
        friend:
          friendship.requesterId === userId ? friendship.addressee : friendship.requester
      }));
    const incoming = friendships
      .filter((friendship) => friendship.status === "PENDING" && friendship.addresseeId === userId)
      .map(toFriendshipDto);
    const outgoing = friendships
      .filter((friendship) => friendship.status === "PENDING" && friendship.requesterId === userId)
      .map(toFriendshipDto);

    res.json({
      accepted,
      incoming,
      outgoing
    });
  })
);

friendRouter.post(
  "/request",
  asyncHandler(async (req, res) => {
    const requesterId = requiredString(req.body?.requesterId, "requesterId", 80);
    const targetNickname = requiredString(req.body?.targetNickname, "targetNickname", 32);

    const [requester, addressee] = await Promise.all([
      prisma.user.findUnique({ where: { id: requesterId } }),
      findUserByNicknameInsensitive(targetNickname)
    ]);

    if (!requester) {
      throw new HttpError(404, "Requester user not found");
    }

    if (!addressee) {
      throw new HttpError(404, "Target user not found");
    }

    if (requester.id === addressee.id) {
      throw new HttpError(400, "You cannot add yourself");
    }

    const existing = await prisma.friend.findFirst({
      where: {
        OR: [
          {
            requesterId: requester.id,
            addresseeId: addressee.id
          },
          {
            requesterId: addressee.id,
            addresseeId: requester.id
          }
        ]
      },
      include: includeUsers
    });

    if (existing) {
      if (existing.status === "BLOCKED") {
        throw new HttpError(403, "Friendship is blocked");
      }

      if (existing.status === "ACCEPTED") {
        res.json({ friendship: toFriendshipDto(existing), created: false });
        return;
      }

      if (existing.requesterId === addressee.id && existing.addresseeId === requester.id) {
        const accepted = await prisma.friend.update({
          where: { id: existing.id },
          data: { status: "ACCEPTED" },
          include: includeUsers
        });
        res.json({
          friendship: toFriendshipDto(accepted),
          created: false,
          autoAccepted: true
        });
        return;
      }

      res.json({ friendship: toFriendshipDto(existing), created: false });
      return;
    }

    const created = await prisma.friend.create({
      data: {
        requesterId: requester.id,
        addresseeId: addressee.id,
        status: "PENDING"
      },
      include: includeUsers
    });

    res.status(201).json({
      friendship: toFriendshipDto(created),
      created: true
    });
  })
);

friendRouter.post(
  "/:friendshipId/accept",
  asyncHandler(async (req, res) => {
    const friendshipId = routeParam(req.params.friendshipId, "friendshipId");
    const userId = requiredString(req.body?.userId, "userId", 80);
    const friendship = await prisma.friend.findUnique({
      where: { id: friendshipId },
      include: includeUsers
    });

    if (!friendship) {
      throw new HttpError(404, "Friend request not found");
    }

    if (friendship.addresseeId !== userId) {
      throw new HttpError(403, "Only the addressee can accept this request");
    }

    if (friendship.status === "ACCEPTED") {
      res.json({ friendship: toFriendshipDto(friendship), changed: false });
      return;
    }

    if (friendship.status !== "PENDING") {
      throw new HttpError(400, "Only pending requests can be accepted");
    }

    const accepted = await prisma.friend.update({
      where: { id: friendship.id },
      data: { status: "ACCEPTED" },
      include: includeUsers
    });

    res.json({ friendship: toFriendshipDto(accepted), changed: true });
  })
);

friendRouter.post(
  "/:friendshipId/reject",
  asyncHandler(async (req, res) => {
    const friendshipId = routeParam(req.params.friendshipId, "friendshipId");
    const userId = requiredString(req.body?.userId, "userId", 80);
    const friendship = await prisma.friend.findUnique({
      where: { id: friendshipId }
    });

    if (!friendship) {
      throw new HttpError(404, "Friend request not found");
    }

    if (friendship.addresseeId !== userId) {
      throw new HttpError(403, "Only the addressee can reject this request");
    }

    if (friendship.status !== "PENDING") {
      throw new HttpError(400, "Only pending requests can be rejected");
    }

    await prisma.friend.delete({
      where: { id: friendship.id }
    });

    res.json({ ok: true });
  })
);
