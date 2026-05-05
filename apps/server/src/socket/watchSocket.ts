import type { Server, Socket } from "socket.io";
import { prisma } from "../lib/prisma.js";
import { saveProgressForUsers } from "../services/progressService.js";
import {
  assertRoomAccess,
  deleteRoom,
  findRoomOrThrow,
  resolvePlaybackState,
  roomDto,
  selectRoomMedia,
  updatePlaybackState,
  type PlaybackState
} from "../services/roomService.js";
import { HttpError } from "../utils/http.js";

type SocketAck<T> = (response: ({ ok: true } & T) | { ok: false; error: string; status: number }) => void;

type RoomMember = {
  socketId: string;
  userId: string;
  nickname: string;
  joinedAt: number;
  latencyMs: number | null;
  isBuffering: boolean;
};

type JoinPayload = {
  roomId?: unknown;
  userId?: unknown;
  password?: unknown;
};

type PlaybackPayload = {
  roomId?: unknown;
  currentTimeSeconds?: unknown;
  playbackRate?: unknown;
  clientEventAt?: unknown;
  serverOffsetMs?: unknown;
  latencyMs?: unknown;
  isPlaying?: unknown;
};

type BufferingPayload = PlaybackPayload & {
  isBuffering?: unknown;
};

type SocialRegisterPayload = {
  userId?: unknown;
};

type FriendInvitePayload = {
  toUserId?: unknown;
  roomId?: unknown;
  message?: unknown;
};

type ProgressCheckpoint = {
  mediaId: string;
  savedAt: number;
};

const roomMembers = new Map<string, Map<string, RoomMember>>();
const progressCheckpoints = new Map<string, ProgressCheckpoint>();
const bufferingSnapshots = new Map<string, PlaybackState>();
const userSockets = new Map<string, Set<string>>();
const socketUsers = new Map<string, string>();

const roomChannel = (roomId: string) => `watch:${roomId}`;

const ok = <T>(ack: SocketAck<T> | undefined, payload: T) => {
  if (typeof ack === "function") {
    ack({ ok: true, ...payload });
  }
};

const fail = (socket: Socket, ack: SocketAck<never> | undefined, error: unknown) => {
  const status = error instanceof HttpError ? error.status : 500;
  const message = error instanceof Error ? error.message : "Socket event failed";
  const payload = { ok: false as const, error: message, status };

  if (typeof ack === "function") {
    ack(payload);
    return;
  }

  socket.emit("server:error", payload);
};

const asString = (value: unknown, field: string) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, `${field} is required`);
  }

  return value.trim();
};

const asOptionalString = (value: unknown) => (typeof value === "string" ? value : undefined);

const asNumber = (value: unknown, field: string) => {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    throw new HttpError(400, `${field} must be a number`);
  }

  return Math.max(0, number);
};

const asOptionalNumber = (value: unknown) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
};

const normalizedPlaybackRate = (value: unknown) => {
  const number = asOptionalNumber(value);

  if (number === undefined) {
    return 1;
  }

  return Math.min(Math.max(number, 0.25), 4);
};

const normalizedLatency = (value: unknown) => {
  const number = asOptionalNumber(value);

  if (number === undefined) {
    return undefined;
  }

  return Math.min(Math.max(number, 0), 2_000);
};

const getMemberMap = (roomId: string) => {
  const existing = roomMembers.get(roomId);

  if (existing) {
    return existing;
  }

  const created = new Map<string, RoomMember>();
  roomMembers.set(roomId, created);
  return created;
};

const memberList = (roomId: string) => Array.from(roomMembers.get(roomId)?.values() ?? []);

const memberUserIds = (roomId: string) => memberList(roomId).map((member) => member.userId);

const listOnlineUserIds = () => Array.from(userSockets.keys());

const emitPresence = (io: Server) => {
  io.emit("social:presence", {
    onlineUserIds: listOnlineUserIds(),
    serverNow: Date.now()
  });
};

const removeSocketPresence = (io: Server, socketId: string) => {
  const userId = socketUsers.get(socketId);

  if (!userId) {
    return;
  }

  socketUsers.delete(socketId);
  const sockets = userSockets.get(userId);

  if (!sockets) {
    return;
  }

  sockets.delete(socketId);

  if (sockets.size === 0) {
    userSockets.delete(userId);
  }

  emitPresence(io);
};

const registerSocketPresence = (io: Server, socket: Socket, userId: string, nickname: string) => {
  const previousUserId = socketUsers.get(socket.id);

  if (previousUserId && previousUserId !== userId) {
    removeSocketPresence(io, socket.id);
  }

  socketUsers.set(socket.id, userId);
  socket.data.userId = userId;
  socket.data.nickname = nickname;

  let sockets = userSockets.get(userId);

  if (!sockets) {
    sockets = new Set<string>();
    userSockets.set(userId, sockets);
  }

  const wasOffline = sockets.size === 0;
  sockets.add(socket.id);

  if (wasOffline || previousUserId !== userId) {
    emitPresence(io);
  }
};

const saveRoomProgress = async (input: {
  roomId: string;
  mediaId: string;
  currentTimeSeconds: number;
  accrueWatchTime: boolean;
  completed?: boolean;
}) => {
  const now = Date.now();
  const previousCheckpoint = progressCheckpoints.get(input.roomId);
  const watchedDeltaSeconds =
    input.accrueWatchTime && previousCheckpoint?.mediaId === input.mediaId
      ? (now - previousCheckpoint.savedAt) / 1_000
      : 0;

  progressCheckpoints.set(input.roomId, {
    mediaId: input.mediaId,
    savedAt: now
  });

  await saveProgressForUsers({
    userIds: memberUserIds(input.roomId),
    mediaId: input.mediaId,
    watchedSeconds: input.currentTimeSeconds,
    watchedDeltaSeconds,
    completed: input.completed
  });
};

const saveSingleMemberProgress = async (input: {
  userId: string;
  mediaId: string;
  currentTimeSeconds: number;
}) => {
  await saveProgressForUsers({
    userIds: [input.userId],
    mediaId: input.mediaId,
    watchedSeconds: input.currentTimeSeconds
  });
};

const broadcastMembers = (io: Server, roomId: string) => {
  io.to(roomChannel(roomId)).emit("room:members", {
    roomId,
    members: memberList(roomId),
    serverNow: Date.now()
  });
};

const joinedRoomId = (socket: Socket, payloadRoomId?: unknown) => {
  const roomId = typeof payloadRoomId === "string" ? payloadRoomId : socket.data.roomId;

  if (!roomId || roomId !== socket.data.roomId) {
    throw new HttpError(403, "Socket is not joined to this room");
  }

  return roomId;
};

const ensureMember = (socket: Socket, roomId: string) => {
  const member = getMemberMap(roomId).get(socket.id);

  if (!member) {
    throw new HttpError(403, "Socket is not a room member");
  }

  return member;
};

const updateMemberLatency = (member: RoomMember, payload: PlaybackPayload) => {
  const latencyMs = normalizedLatency(payload.latencyMs);

  if (latencyMs !== undefined) {
    member.latencyMs = latencyMs;
  }
};

const estimatedServerLagSeconds = (member: RoomMember, payload: PlaybackPayload) => {
  const clientEventAt = asOptionalNumber(payload.clientEventAt);
  const serverOffsetMs = asOptionalNumber(payload.serverOffsetMs);

  if (clientEventAt !== undefined && serverOffsetMs !== undefined) {
    const estimatedServerEventAt = clientEventAt + serverOffsetMs;
    return Math.min(Math.max((Date.now() - estimatedServerEventAt) / 1_000, 0), 2);
  }

  const latencyMs = normalizedLatency(payload.latencyMs) ?? member.latencyMs ?? 0;
  return Math.min(latencyMs / 1_000, 2);
};

const emitPlaybackState = (
  io: Server,
  roomId: string,
  state: PlaybackState,
  source: Socket,
  reason: string
) => {
  io.to(roomChannel(roomId)).emit("playback:state", {
    roomId,
    state,
    sourceSocketId: source.id,
    sourceUserId: source.data.userId,
    reason,
    serverNow: Date.now()
  });
};

const leaveCurrentRoom = async (io: Server, socket: Socket, reason: string) => {
  const roomId = socket.data.roomId as string | undefined;

  if (!roomId) {
    return;
  }

  const members = getMemberMap(roomId);
  const member = members.get(socket.id);
  members.delete(socket.id);

  if (members.size === 0) {
    roomMembers.delete(roomId);
    progressCheckpoints.delete(roomId);
    bufferingSnapshots.delete(roomId);
  }

  socket.leave(roomChannel(roomId));
  socket.data.roomId = undefined;

  if (member) {
    try {
      const room = await findRoomOrThrow(roomId);
      if (room.mediaId) {
        await saveSingleMemberProgress({
          userId: member.userId,
          mediaId: room.mediaId,
          currentTimeSeconds: resolvePlaybackState(room).currentTimeSeconds
        });
      }
    } catch {
      // Leaving a socket room should still succeed if the backing room was removed.
    }

    socket.to(roomChannel(roomId)).emit("room:member-left", {
      roomId,
      member,
      reason,
      serverNow: Date.now()
    });
    broadcastMembers(io, roomId);
  }
};

const handlePlaybackCommand = async (
  io: Server,
  socket: Socket,
  payload: PlaybackPayload,
  ack: SocketAck<{ state: PlaybackState }> | undefined,
  reason: "play" | "pause" | "seek"
) => {
  const roomId = joinedRoomId(socket, payload.roomId);
  const member = ensureMember(socket, roomId);
  updateMemberLatency(member, payload);

  const room = await findRoomOrThrow(roomId);
  if (!room.mediaId) {
    throw new HttpError(400, "Room has no selected media");
  }

  const currentTimeSeconds = asNumber(payload.currentTimeSeconds, "currentTimeSeconds");
  const playbackRate = normalizedPlaybackRate(payload.playbackRate);
  const lagSeconds = estimatedServerLagSeconds(member, payload);
  const shouldPlay =
    reason === "play" ||
    (reason === "seek" && (typeof payload.isPlaying === "boolean" ? payload.isPlaying : room.isPlaying));
  const compensatedTime = shouldPlay
    ? currentTimeSeconds + lagSeconds * playbackRate
    : currentTimeSeconds;

  const state = await updatePlaybackState({
    roomId,
    currentTimeSeconds: compensatedTime,
    isPlaying: shouldPlay,
    playbackRate
  });

  bufferingSnapshots.delete(roomId);

  if (reason !== "play") {
    await saveRoomProgress({
      roomId,
      mediaId: room.mediaId,
      currentTimeSeconds: state.currentTimeSeconds,
      accrueWatchTime: room.isPlaying
    });
  } else {
    await saveRoomProgress({
      roomId,
      mediaId: room.mediaId,
      currentTimeSeconds: state.currentTimeSeconds,
      accrueWatchTime: false
    });
  }

  emitPlaybackState(io, roomId, state, socket, reason);
  ok(ack, { state });
};

const buildCorrection = (state: PlaybackState, clientTimeSeconds: number) => {
  const driftSeconds = clientTimeSeconds - state.currentTimeSeconds;
  const absoluteDrift = Math.abs(driftSeconds);

  if (absoluteDrift >= 2) {
    return {
      mode: "seek",
      targetTimeSeconds: state.currentTimeSeconds,
      driftSeconds,
      suggestedPlaybackRate: state.playbackRate
    };
  }

  if (state.isPlaying && absoluteDrift >= 0.35) {
    return {
      mode: "rate",
      targetTimeSeconds: state.currentTimeSeconds,
      driftSeconds,
      suggestedPlaybackRate: driftSeconds < 0 ? Math.min(state.playbackRate + 0.05, 1.15) : 0.95
    };
  }

  return {
    mode: "none",
    targetTimeSeconds: state.currentTimeSeconds,
    driftSeconds,
    suggestedPlaybackRate: state.playbackRate
  };
};

export const registerWatchSocket = (io: Server) => {
  io.on("connection", (socket) => {
    socket.emit("server:ready", {
      socketId: socket.id,
      connectedAt: Date.now()
    });

    socket.on(
      "sync:ping",
      (payload: { clientSentAt?: number } | undefined, ack?: SocketAck<{
        clientSentAt: number | null;
        serverReceivedAt: number;
        serverSentAt: number;
      }>) => {
        const serverReceivedAt = Date.now();

        ok(ack, {
          clientSentAt: typeof payload?.clientSentAt === "number" ? payload.clientSentAt : null,
          serverReceivedAt,
          serverSentAt: Date.now()
        });
      }
    );

    socket.on("social:register", async (payload: SocialRegisterPayload, ack?: SocketAck<{
      user: { id: string; nickname: string };
      onlineUserIds: string[];
      serverNow: number;
    }>) => {
      try {
        const userId = asString(payload?.userId, "userId");
        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            nickname: true
          }
        });

        if (!user) {
          throw new HttpError(404, "User not found");
        }

        registerSocketPresence(io, socket, user.id, user.nickname);

        ok(ack, {
          user,
          onlineUserIds: listOnlineUserIds(),
          serverNow: Date.now()
        });
      } catch (error) {
        fail(socket, ack, error);
      }
    });

    socket.on("social:online", (_payload, ack?: SocketAck<{
      onlineUserIds: string[];
      serverNow: number;
    }>) => {
      ok(ack, {
        onlineUserIds: listOnlineUserIds(),
        serverNow: Date.now()
      });
    });

    socket.on("room:join", async (payload: JoinPayload, ack?: SocketAck<{
      room: ReturnType<typeof roomDto>;
      playback: PlaybackState;
      members: RoomMember[];
      member: RoomMember;
      serverNow: number;
    }>) => {
      try {
        const roomId = asString(payload?.roomId, "roomId");
        const userId = asString(payload?.userId, "userId");
        const user = await prisma.user.findUnique({ where: { id: userId } });

        if (!user) {
          throw new HttpError(404, "User not found");
        }

        const room = await findRoomOrThrow(roomId);
        assertRoomAccess(room, asOptionalString(payload?.password));

        await leaveCurrentRoom(io, socket, "switch-room");
        await socket.join(roomChannel(roomId));

        const member: RoomMember = {
          socketId: socket.id,
          userId: user.id,
          nickname: user.nickname,
          joinedAt: Date.now(),
          latencyMs: null,
          isBuffering: false
        };

        registerSocketPresence(io, socket, user.id, user.nickname);
        socket.data.roomId = roomId;
        getMemberMap(roomId).set(socket.id, member);

        socket.to(roomChannel(roomId)).emit("room:member-joined", {
          roomId,
          member,
          serverNow: Date.now()
        });
        broadcastMembers(io, roomId);

        ok(ack, {
          room: roomDto(room),
          playback: resolvePlaybackState(room),
          members: memberList(roomId),
          member,
          serverNow: Date.now()
        });
      } catch (error) {
        fail(socket, ack, error);
      }
    });

    socket.on("room:leave", async (_payload, ack?: SocketAck<{ serverNow: number }>) => {
      try {
        await leaveCurrentRoom(io, socket, "client-leave");
        ok(ack, { serverNow: Date.now() });
      } catch (error) {
        fail(socket, ack, error);
      }
    });

    socket.on("room:select-media", async (payload: { roomId?: unknown; userId?: unknown; mediaId?: unknown }, ack?: SocketAck<{
      room: ReturnType<typeof roomDto>;
      state: PlaybackState;
    }>) => {
      try {
        const roomId = joinedRoomId(socket, payload?.roomId);
        const requesterId = asString(payload?.userId ?? socket.data.userId, "userId");
        const mediaId =
          payload?.mediaId === null ? null : asString(payload?.mediaId, "mediaId");
        const previousRoom = await findRoomOrThrow(roomId);

        if (previousRoom.creatorId !== requesterId) {
          throw new HttpError(403, "Only the room creator can perform this action");
        }

        if (previousRoom.mediaId && previousRoom.mediaId !== mediaId) {
          const previousState = resolvePlaybackState(previousRoom);
          await saveRoomProgress({
            roomId,
            mediaId: previousRoom.mediaId,
            currentTimeSeconds: previousState.currentTimeSeconds,
            accrueWatchTime: previousState.isPlaying
          });
        }

        const room = await selectRoomMedia({
          roomId,
          requesterId,
          mediaId,
          participantUserIds: memberUserIds(roomId)
        });
        const state = room.playback;
        progressCheckpoints.delete(roomId);
        bufferingSnapshots.delete(roomId);

        io.to(roomChannel(roomId)).emit("room:media-selected", {
          roomId,
          room,
          state,
          sourceSocketId: socket.id,
          sourceUserId: socket.data.userId,
          serverNow: Date.now()
        });
        ok(ack, { room, state });
      } catch (error) {
        fail(socket, ack, error);
      }
    });

    socket.on("room:delete", async (payload: { roomId?: unknown; userId?: unknown }, ack?: SocketAck<{
      roomId: string;
      serverNow: number;
    }>) => {
      try {
        const roomId = asString(payload?.roomId, "roomId");
        const requesterId = asString(payload?.userId ?? socket.data.userId, "userId");
        const room = await findRoomOrThrow(roomId);
        const state = resolvePlaybackState(room);

        if (room.mediaId) {
          await saveRoomProgress({
            roomId,
            mediaId: room.mediaId,
            currentTimeSeconds: state.currentTimeSeconds,
            accrueWatchTime: state.isPlaying
          });
        }

        await deleteRoom({ roomId, requesterId });

        io.to(roomChannel(roomId)).emit("room:deleted", {
          roomId,
          deletedByUserId: requesterId,
          serverNow: Date.now()
        });

        for (const roomMember of memberList(roomId)) {
          const memberSocket = io.sockets.sockets.get(roomMember.socketId);
          memberSocket?.leave(roomChannel(roomId));

          if (memberSocket?.data.roomId === roomId) {
            memberSocket.data.roomId = undefined;
          }
        }

        roomMembers.delete(roomId);
        progressCheckpoints.delete(roomId);
        bufferingSnapshots.delete(roomId);

        ok(ack, { roomId, serverNow: Date.now() });
      } catch (error) {
        fail(socket, ack, error);
      }
    });

    socket.on("friend:invite", async (payload: FriendInvitePayload, ack?: SocketAck<{
      delivered: number;
      serverNow: number;
    }>) => {
      try {
        const inviterUserId = asString(socket.data.userId, "userId");
        const inviterNickname = asString(socket.data.nickname, "nickname");
        const toUserId = asString(payload?.toUserId, "toUserId");
        const roomId = asString(payload?.roomId, "roomId");
        const message = asOptionalString(payload?.message)?.slice(0, 280) ?? null;

        if (inviterUserId === toUserId) {
          throw new HttpError(400, "You cannot invite yourself");
        }

        const [room, friendship] = await Promise.all([
          findRoomOrThrow(roomId),
          prisma.friend.findFirst({
            where: {
              status: "ACCEPTED",
              OR: [
                { requesterId: inviterUserId, addresseeId: toUserId },
                { requesterId: toUserId, addresseeId: inviterUserId }
              ]
            }
          })
        ]);

        if (!friendship) {
          throw new HttpError(403, "Only friends can be invited");
        }

        if (socket.data.roomId !== roomId && room.creatorId !== inviterUserId) {
          throw new HttpError(403, "Join this room before sending invites");
        }

        const recipientSockets = Array.from(userSockets.get(toUserId) ?? []);

        for (const recipientSocketId of recipientSockets) {
          io.to(recipientSocketId).emit("friend:invitation", {
            roomId: room.id,
            roomName: room.name,
            fromUserId: inviterUserId,
            fromNickname: inviterNickname,
            message,
            serverNow: Date.now()
          });
        }

        ok(ack, {
          delivered: recipientSockets.length,
          serverNow: Date.now()
        });
      } catch (error) {
        fail(socket, ack, error);
      }
    });

    socket.on("playback:play", async (payload: PlaybackPayload, ack?: SocketAck<{ state: PlaybackState }>) => {
      try {
        await handlePlaybackCommand(io, socket, payload, ack, "play");
      } catch (error) {
        fail(socket, ack, error);
      }
    });

    socket.on("playback:pause", async (payload: PlaybackPayload, ack?: SocketAck<{ state: PlaybackState }>) => {
      try {
        await handlePlaybackCommand(io, socket, payload, ack, "pause");
      } catch (error) {
        fail(socket, ack, error);
      }
    });

    socket.on("playback:seek", async (payload: PlaybackPayload, ack?: SocketAck<{ state: PlaybackState }>) => {
      try {
        await handlePlaybackCommand(io, socket, payload, ack, "seek");
      } catch (error) {
        fail(socket, ack, error);
      }
    });

    socket.on("playback:ended", async (payload: PlaybackPayload, ack?: SocketAck<{ state: PlaybackState }>) => {
      try {
        const roomId = joinedRoomId(socket, payload?.roomId);
        const member = ensureMember(socket, roomId);
        updateMemberLatency(member, payload);

        const room = await findRoomOrThrow(roomId);
        if (!room.mediaId) {
          throw new HttpError(400, "Room has no selected media");
        }

        const state = await updatePlaybackState({
          roomId,
          currentTimeSeconds: asNumber(payload?.currentTimeSeconds, "currentTimeSeconds"),
          isPlaying: false,
          playbackRate: normalizedPlaybackRate(payload?.playbackRate)
        });

        bufferingSnapshots.delete(roomId);
        await saveRoomProgress({
          roomId,
          mediaId: room.mediaId,
          currentTimeSeconds: state.currentTimeSeconds,
          accrueWatchTime: room.isPlaying,
          completed: true
        });

        emitPlaybackState(io, roomId, state, socket, "ended");
        ok(ack, { state });
      } catch (error) {
        fail(socket, ack, error);
      }
    });

    socket.on("playback:buffering", async (payload: BufferingPayload, ack?: SocketAck<{
      state: PlaybackState;
      members: RoomMember[];
    }>) => {
      try {
        const roomId = joinedRoomId(socket, payload?.roomId);
        const member = ensureMember(socket, roomId);
        updateMemberLatency(member, payload);
        const wasAnyBuffering = memberList(roomId).some((roomMember) => roomMember.isBuffering);
        member.isBuffering = Boolean(payload?.isBuffering);

        const room = await findRoomOrThrow(roomId);
        const resolvedState = resolvePlaybackState(room);
        let state = resolvedState;

        io.to(roomChannel(roomId)).emit("room:member-buffering", {
          roomId,
          member,
          members: memberList(roomId),
          serverNow: Date.now()
        });

        if (member.isBuffering) {
          if (!wasAnyBuffering && resolvedState.isPlaying) {
            bufferingSnapshots.set(roomId, resolvedState);
          }

          state = await updatePlaybackState({
            roomId,
            currentTimeSeconds:
              asOptionalNumber(payload?.currentTimeSeconds) ?? resolvedState.currentTimeSeconds,
            isPlaying: false,
            playbackRate: resolvedState.playbackRate
          });
          if (room.mediaId) {
            await saveRoomProgress({
              roomId,
              mediaId: room.mediaId,
              currentTimeSeconds: state.currentTimeSeconds,
              accrueWatchTime: resolvedState.isPlaying
            });
          }
          emitPlaybackState(io, roomId, state, socket, "buffering");
        } else if (memberList(roomId).every((roomMember) => !roomMember.isBuffering)) {
          const snapshot = bufferingSnapshots.get(roomId);
          const shouldResume = Boolean(snapshot?.isPlaying);

          if (shouldResume) {
            state = await updatePlaybackState({
              roomId,
              currentTimeSeconds:
                asOptionalNumber(payload?.currentTimeSeconds) ?? resolvedState.currentTimeSeconds,
              isPlaying: true,
              playbackRate: snapshot?.playbackRate ?? resolvedState.playbackRate
            });

            if (room.mediaId) {
              await saveRoomProgress({
                roomId,
                mediaId: room.mediaId,
                currentTimeSeconds: state.currentTimeSeconds,
                accrueWatchTime: false
              });
            }

            emitPlaybackState(io, roomId, state, socket, "buffering-cleared");
          }

          bufferingSnapshots.delete(roomId);
          io.to(roomChannel(roomId)).emit("playback:buffering-cleared", {
            roomId,
            state,
            serverNow: Date.now()
          });
        }

        broadcastMembers(io, roomId);
        ok(ack, { state, members: memberList(roomId) });
      } catch (error) {
        fail(socket, ack, error);
      }
    });

    socket.on("playback:heartbeat", async (payload: PlaybackPayload, ack?: SocketAck<{
      state: PlaybackState;
      correction: ReturnType<typeof buildCorrection>;
    }>) => {
      try {
        const roomId = joinedRoomId(socket, payload?.roomId);
        const member = ensureMember(socket, roomId);
        updateMemberLatency(member, payload);

        const room = await findRoomOrThrow(roomId);
        const state = resolvePlaybackState(room);
        const clientTimeSeconds = asNumber(payload?.currentTimeSeconds, "currentTimeSeconds");
        const correction = buildCorrection(state, clientTimeSeconds);

        if (state.mediaId && state.isPlaying) {
          const checkpoint = progressCheckpoints.get(roomId);
          if (!checkpoint || checkpoint.mediaId !== state.mediaId || Date.now() - checkpoint.savedAt >= 10_000) {
            await saveRoomProgress({
              roomId,
              mediaId: state.mediaId,
              currentTimeSeconds: state.currentTimeSeconds,
              accrueWatchTime: true
            });
          }
        }

        if (correction.mode !== "none") {
          socket.emit("playback:correction", {
            roomId,
            state,
            correction,
            serverNow: Date.now()
          });
        }

        ok(ack, { state, correction });
      } catch (error) {
        fail(socket, ack, error);
      }
    });

    socket.on("disconnect", () => {
      removeSocketPresence(io, socket.id);
      void leaveCurrentRoom(io, socket, "disconnect");
    });
  });
};
