import type { Media, Room, User } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { assertPlayableMediaFile } from "./mediaService.js";
import { mediaDto } from "../utils/dto.js";
import { HttpError } from "../utils/http.js";
import { hashPassword, verifyPassword } from "../utils/password.js";

type RoomWithRelations = Room & {
  creator: User;
  media: Media | null;
};

export type PlaybackState = {
  roomId: string;
  mediaId: string | null;
  currentTimeSeconds: number;
  isPlaying: boolean;
  playbackRate: number;
  lastStateAt: Date | null;
  serverNow: number;
};

const clampTime = (value: number) => Math.max(0, Number.isFinite(value) ? value : 0);

export const resolvePlaybackState = (room: Room): PlaybackState => {
  const serverNow = Date.now();
  const lastStateAt = room.lastStateAt;
  const elapsedSeconds =
    room.isPlaying && lastStateAt ? Math.max(0, (serverNow - lastStateAt.getTime()) / 1_000) : 0;

  return {
    roomId: room.id,
    mediaId: room.mediaId,
    currentTimeSeconds: clampTime(room.currentTimeSeconds + elapsedSeconds * room.playbackRate),
    isPlaying: room.isPlaying,
    playbackRate: room.playbackRate,
    lastStateAt,
    serverNow
  };
};

export const roomDto = (room: RoomWithRelations) => ({
  id: room.id,
  name: room.name,
  isPublic: room.isPublic,
  hasPassword: Boolean(room.passwordHash),
  creatorId: room.creatorId,
  creator: {
    id: room.creator.id,
    nickname: room.creator.nickname
  },
  mediaId: room.mediaId,
  media: room.media ? mediaDto(room.media) : null,
  playback: resolvePlaybackState(room),
  createdAt: room.createdAt,
  updatedAt: room.updatedAt
});

export const includeRoomRelations = {
  creator: true,
  media: true
} as const;

export const findRoomOrThrow = async (roomId: string) => {
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    include: includeRoomRelations
  });

  if (!room) {
    throw new HttpError(404, "Room not found");
  }

  return room;
};

export const listPublicRooms = async () => {
  const rooms = await prisma.room.findMany({
    where: { isPublic: true },
    include: includeRoomRelations,
    orderBy: { updatedAt: "desc" }
  });

  return rooms.map(roomDto);
};

export const createRoom = async (input: {
  creatorId: string;
  name: string;
  isPublic?: boolean;
  password?: string;
  mediaId?: string;
}) => {
  const creator = await prisma.user.findUnique({ where: { id: input.creatorId } });

  if (!creator) {
    throw new HttpError(404, "Creator user not found");
  }

  if (input.mediaId) {
    await assertPlayableMediaFile(input.mediaId);
  }

  const room = await prisma.room.create({
    data: {
      name: input.name,
      isPublic: input.isPublic ?? true,
      passwordHash: input.password ? hashPassword(input.password) : null,
      creatorId: input.creatorId,
      mediaId: input.mediaId,
      currentTimeSeconds: 0,
      isPlaying: false,
      playbackRate: 1,
      lastStateAt: new Date()
    },
    include: includeRoomRelations
  });

  return roomDto(room);
};

export const assertRoomAccess = (room: Room, password?: string) => {
  if (!room.passwordHash) {
    return;
  }

  if (!password || !verifyPassword(password, room.passwordHash)) {
    throw new HttpError(403, "Room password is invalid");
  }
};

export const assertRoomCreator = (room: Room, userId: string) => {
  if (room.creatorId !== userId) {
    throw new HttpError(403, "Only the room creator can perform this action");
  }
};

export const selectRoomMedia = async (input: {
  roomId: string;
  requesterId: string;
  mediaId: string | null;
}) => {
  const room = await findRoomOrThrow(input.roomId);
  assertRoomCreator(room, input.requesterId);

  if (input.mediaId) {
    await assertPlayableMediaFile(input.mediaId);
  }

  const updatedRoom = await prisma.room.update({
    where: { id: input.roomId },
    data: {
      mediaId: input.mediaId,
      currentTimeSeconds: 0,
      isPlaying: false,
      playbackRate: 1,
      lastStateAt: new Date()
    },
    include: includeRoomRelations
  });

  return roomDto(updatedRoom);
};

export const updatePlaybackState = async (input: {
  roomId: string;
  currentTimeSeconds: number;
  isPlaying: boolean;
  playbackRate?: number;
}) => {
  const room = await prisma.room.update({
    where: { id: input.roomId },
    data: {
      currentTimeSeconds: clampTime(input.currentTimeSeconds),
      isPlaying: input.isPlaying,
      playbackRate: input.playbackRate ?? 1,
      lastStateAt: new Date()
    }
  });

  return resolvePlaybackState(room);
};
