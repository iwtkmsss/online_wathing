import type { Server, Socket } from "socket.io";
import { prisma } from "../lib/prisma.js";
import {
  assertRoomAccess,
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

const roomMembers = new Map<string, Map<string, RoomMember>>();

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

const memberList = (roomId: string) => Array.from(getMemberMap(roomId).values());

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
  }

  socket.leave(roomChannel(roomId));
  socket.data.roomId = undefined;

  if (member) {
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

        socket.data.userId = user.id;
        socket.data.nickname = user.nickname;
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
        const room = await selectRoomMedia({ roomId, requesterId, mediaId });
        const state = room.playback;

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

    socket.on("playback:buffering", async (payload: BufferingPayload, ack?: SocketAck<{
      state: PlaybackState;
      members: RoomMember[];
    }>) => {
      try {
        const roomId = joinedRoomId(socket, payload?.roomId);
        const member = ensureMember(socket, roomId);
        updateMemberLatency(member, payload);
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
          state = await updatePlaybackState({
            roomId,
            currentTimeSeconds:
              asOptionalNumber(payload?.currentTimeSeconds) ?? resolvedState.currentTimeSeconds,
            isPlaying: false,
            playbackRate: resolvedState.playbackRate
          });
          emitPlaybackState(io, roomId, state, socket, "buffering");
        } else if (memberList(roomId).every((roomMember) => !roomMember.isBuffering)) {
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
      void leaveCurrentRoom(io, socket, "disconnect");
    });
  });
};
