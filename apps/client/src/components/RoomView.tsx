import {
  ArrowLeft,
  Clapperboard,
  Film,
  Loader2,
  Lock,
  Radio,
  Save,
  Search,
  Trash2,
  Users,
  Wifi,
  X
} from "lucide-react";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  fetchRoom,
  streamMediaUrl,
  type MediaDto,
  type PlaybackDto,
  type RoomDto,
  type UserDto
} from "../lib/api";
import SocialPanel from "./SocialPanel";
import { socket } from "../lib/socket";

type RoomMemberDto = {
  socketId: string;
  userId: string;
  nickname: string;
  joinedAt: number;
  latencyMs: number | null;
  isBuffering: boolean;
};

type PlaybackState = PlaybackDto;

type PlaybackPayload = {
  roomId: string;
  currentTimeSeconds: number;
  playbackRate: number;
  clientEventAt: number;
  serverOffsetMs: number;
  latencyMs?: number;
  isPlaying?: boolean;
};

type PlaybackCorrection = {
  mode: "none" | "seek" | "rate";
  targetTimeSeconds: number;
  driftSeconds: number;
  suggestedPlaybackRate: number;
};

type SocketFailure = {
  ok: false;
  error: string;
  status: number;
};

type SocketSuccess<T> = { ok: true } & T;

type RoomViewProps = {
  roomId: string;
  initialRoom?: RoomDto | null;
  media: MediaDto[];
  onlineUserIds: string[];
  isSocketConnected: boolean;
  user: UserDto;
  password?: string;
  onClose: () => void;
  onRoomDeleted?: (roomId: string) => void;
  onRoomUpdated?: (room: RoomDto) => void;
};

class SocketEventError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const panelClass =
  "rounded-lg border border-white/10 bg-zinc-950/78 shadow-panel backdrop-blur-xl";
const fieldClass =
  "h-10 w-full rounded-md border border-white/10 bg-black/45 px-3 text-sm text-white outline-none transition placeholder:text-white/35 focus:border-toxic focus:shadow-neon";

const formatTime = (seconds: number) => {
  const safeSeconds = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const rest = safeSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  }

  return `${minutes}:${String(rest).padStart(2, "0")}`;
};

const mediaLabel = (item: MediaDto) => {
  if (item.type !== "EPISODE") {
    return item.title;
  }

  const season = item.seasonNumber ? `S${String(item.seasonNumber).padStart(2, "0")}` : "S--";
  const episode = item.episodeNumber ? `E${String(item.episodeNumber).padStart(2, "0")}` : "E--";
  return `${season}${episode} · ${item.title}`;
};

const playableChildren = (item: MediaDto) =>
  item.children.filter((child) => child.type === "EPISODE" && child.isAvailable);

type MediaPickerType = "FILM" | "SERIES";

const normalizeSearch = (value: string) => value.trim().toLowerCase();

const mediaPickerFromRoom = (room: RoomDto | null, media: MediaDto[]) => {
  if (!room?.media) {
    return {
      libraryId: "",
      season: "" as number | "",
      episodeId: ""
    };
  }

  if (room.media.type === "EPISODE") {
    const parent = media.find((item) =>
      item.type === "SERIES" && item.children.some((episode) => episode.id === room.media?.id)
    );

    return {
      libraryId: parent?.id ?? "",
      season: room.media.seasonNumber ?? 1,
      episodeId: room.media.id
    };
  }

  return {
    libraryId: room.media.id,
    season: "" as number | "",
    episodeId: ""
  };
};

const emitWithAck = <T,>(eventName: string, payload?: unknown) =>
  new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error("Socket request timed out"));
    }, 8_000);

    socket.emit(eventName, payload, (response: SocketSuccess<T> | SocketFailure) => {
      window.clearTimeout(timeout);

      if (!response || response.ok !== true) {
        reject(new SocketEventError(response?.error ?? "Socket event failed", response?.status ?? 500));
        return;
      }

      const payloadWithoutOk = { ...response };
      delete (payloadWithoutOk as { ok?: boolean }).ok;
      resolve(payloadWithoutOk as T);
    });
  });

const waitForSocketConnection = () =>
  new Promise<void>((resolve, reject) => {
    if (socket.connected) {
      resolve();
      return;
    }

    const cleanup = () => {
      socket.off("connect", handleConnect);
      socket.off("connect_error", handleError);
    };
    const handleConnect = () => {
      cleanup();
      resolve();
    };
    const handleError = (error: Error) => {
      cleanup();
      reject(error);
    };

    socket.once("connect", handleConnect);
    socket.once("connect_error", handleError);
    socket.connect();
  });

function RoomView({
  roomId,
  initialRoom,
  media,
  onlineUserIds,
  isSocketConnected,
  user,
  password,
  onClose,
  onRoomDeleted,
  onRoomUpdated
}: RoomViewProps) {
  const initialPicker = mediaPickerFromRoom(initialRoom ?? null, media);
  const [room, setRoom] = useState<RoomDto | null>(initialRoom ?? null);
  const [members, setMembers] = useState<RoomMemberDto[]>([]);
  const [status, setStatus] = useState("Підключення...");
  const [socketError, setSocketError] = useState("");
  const [isJoining, setIsJoining] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [needsPassword, setNeedsPassword] = useState(Boolean(initialRoom?.hasPassword && !password));
  const [joinPassword, setJoinPassword] = useState(password ?? "");
  const [joinAttempt, setJoinAttempt] = useState(0);
  const [selectedLibraryId, setSelectedLibraryId] = useState(initialPicker.libraryId);
  const [, setSelectedSeason] = useState<number | "">(initialPicker.season);
  const [selectedEpisodeId, setSelectedEpisodeId] = useState(initialPicker.episodeId);
  const [mediaPickerType, setMediaPickerType] = useState<MediaPickerType>(
    initialRoom?.media?.type === "EPISODE" ? "SERIES" : "FILM"
  );
  const [mediaSearch, setMediaSearch] = useState("");
  const [isMediaMenuOpen, setIsMediaMenuOpen] = useState(false);
  const [isSelectingMedia, setIsSelectingMedia] = useState(false);
  const [isDeletingRoom, setIsDeletingRoom] = useState(false);
  const [syncStats, setSyncStats] = useState<{ latencyMs: number | null; serverOffsetMs: number }>({
    latencyMs: null,
    serverOffsetMs: 0
  });
  const [playbackSnapshot, setPlaybackSnapshot] = useState<PlaybackState | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playbackStateRef = useRef<PlaybackState | null>(null);
  const applyingRemoteRef = useRef(false);
  const joinedRef = useRef(false);
  const heartbeatBusyRef = useRef(false);
  const bufferingRef = useRef(false);
  const syncStatsRef = useRef(syncStats);
  const onRoomDeletedRef = useRef(onRoomDeleted);
  const onRoomUpdatedRef = useRef(onRoomUpdated);
  const joinPasswordRef = useRef(joinPassword);
  const initialRoomRef = useRef(initialRoom);
  const mediaRef = useRef(media);

  useEffect(() => {
    syncStatsRef.current = syncStats;
  }, [syncStats]);

  useEffect(() => {
    onRoomDeletedRef.current = onRoomDeleted;
  }, [onRoomDeleted]);

  useEffect(() => {
    onRoomUpdatedRef.current = onRoomUpdated;
  }, [onRoomUpdated]);

  useEffect(() => {
    joinPasswordRef.current = joinPassword;
  }, [joinPassword]);

  useEffect(() => {
    mediaRef.current = media;
  }, [media]);

  const activeMedia = room?.media ?? null;
  const isCreator = Boolean(room && room.creatorId === user.id);
  const streamUrl = activeMedia ? streamMediaUrl(activeMedia.id) : "";
  const films = useMemo(() => media.filter((item) => item.type === "FILM" && item.isAvailable), [media]);
  const series = useMemo(
    () => media.filter((item) => item.type === "SERIES" && playableChildren(item).length > 0),
    [media]
  );
  const selectedLibraryItem = media.find((item) => item.id === selectedLibraryId) ?? null;
  const selectedMediaId =
    selectedLibraryItem?.type === "FILM" ? selectedLibraryItem.id : selectedEpisodeId || null;
  const mediaQuery = normalizeSearch(mediaSearch);
  const filteredFilmOptions = useMemo(
    () =>
      films.filter((item) => {
        if (item.id === selectedMediaId) {
          return false;
        }

        if (!mediaQuery) {
          return true;
        }

        return normalizeSearch(item.title).includes(mediaQuery);
      }),
    [films, mediaQuery, selectedMediaId]
  );
  const episodeOptions = useMemo(
    () =>
      series
        .flatMap((item) =>
          playableChildren(item).map((episode) => ({
            series: item,
            episode
          }))
        )
        .filter(({ series: item, episode }) => {
          if (episode.id === selectedMediaId) {
            return false;
          }

          if (!mediaQuery) {
            return true;
          }

          return `${normalizeSearch(item.title)} ${normalizeSearch(mediaLabel(episode))}`.includes(mediaQuery);
        })
        .sort(
          (left, right) =>
            left.series.title.localeCompare(right.series.title) ||
            (left.episode.seasonNumber ?? 1) - (right.episode.seasonNumber ?? 1) ||
            (left.episode.episodeNumber ?? 0) - (right.episode.episodeNumber ?? 0)
        ),
    [mediaQuery, selectedMediaId, series]
  );

  const storePlaybackState = useCallback((state: PlaybackState) => {
    playbackStateRef.current = state;
    setPlaybackSnapshot(state);
  }, []);

  const syncMediaPicker = useCallback((nextRoom: RoomDto | null) => {
    const nextPicker = mediaPickerFromRoom(nextRoom, mediaRef.current);
    setSelectedLibraryId(nextPicker.libraryId);
    setSelectedSeason(nextPicker.season);
    setSelectedEpisodeId(nextPicker.episodeId);
    setMediaPickerType(nextRoom?.media?.type === "EPISODE" ? "SERIES" : "FILM");
  }, []);

  const applyPlaybackState = useCallback((state: PlaybackState) => {
    storePlaybackState(state);
    const video = videoRef.current;

    if (!video || !state.mediaId) {
      return;
    }

    const elapsedSeconds = state.isPlaying
      ? Math.max(0, (Date.now() - state.serverNow) / 1_000) * state.playbackRate
      : 0;
    const targetTime = Math.max(0, state.currentTimeSeconds + elapsedSeconds);

    applyingRemoteRef.current = true;

    try {
      video.playbackRate = state.playbackRate;

      if (Number.isFinite(targetTime) && Math.abs(video.currentTime - targetTime) > 0.45) {
        video.currentTime = targetTime;
      }

      if (state.isPlaying) {
        void video.play().catch(() => {
          setStatus("Натисни Play у плеєрі, браузер заблокував автозапуск.");
        });
      } else {
        video.pause();
      }
    } finally {
      window.setTimeout(() => {
        applyingRemoteRef.current = false;
      }, 500);
    }
  }, [storePlaybackState]);

  const buildPlaybackPayload = useCallback(
    (overrides: Partial<PlaybackPayload> = {}): PlaybackPayload => {
      const video = videoRef.current;
      const currentState = playbackStateRef.current;

      return {
        roomId,
        currentTimeSeconds: video?.currentTime ?? currentState?.currentTimeSeconds ?? 0,
        playbackRate: video?.playbackRate ?? currentState?.playbackRate ?? 1,
        clientEventAt: Date.now(),
        serverOffsetMs: syncStatsRef.current.serverOffsetMs,
        latencyMs: syncStatsRef.current.latencyMs ?? undefined,
        ...overrides
      };
    },
    [roomId]
  );

  const measureSync = useCallback(async () => {
    const clientSentAt = Date.now();
    const response = await emitWithAck<{
      clientSentAt: number | null;
      serverReceivedAt: number;
      serverSentAt: number;
    }>("sync:ping", { clientSentAt });
    const clientReceivedAt = Date.now();
    const roundTripMs = clientReceivedAt - clientSentAt;
    const serverMidpoint = (response.serverReceivedAt + response.serverSentAt) / 2;
    const clientMidpoint = clientSentAt + roundTripMs / 2;

    setSyncStats({
      latencyMs: Math.max(0, Math.round(roundTripMs / 2)),
      serverOffsetMs: Math.round(serverMidpoint - clientMidpoint)
    });
  }, []);

  const sendPlaybackCommand = useCallback(
    async (eventName: "playback:play" | "playback:pause" | "playback:seek") => {
      if (!joinedRef.current || applyingRemoteRef.current || !activeMedia) {
        return;
      }

      try {
        const response = await emitWithAck<{ state: PlaybackState }>(
          eventName,
          buildPlaybackPayload({
            isPlaying: eventName === "playback:seek" ? !videoRef.current?.paused : undefined
          })
        );
        storePlaybackState(response.state);
        setSocketError("");
      } catch (error) {
        setSocketError(error instanceof Error ? error.message : "Не вдалося синхронізувати плеєр.");
      }
    },
    [activeMedia, buildPlaybackPayload, storePlaybackState]
  );

  const sendPlaybackEnded = useCallback(async () => {
    if (!joinedRef.current || applyingRemoteRef.current || !activeMedia) {
      return;
    }

    try {
      const response = await emitWithAck<{ state: PlaybackState }>(
        "playback:ended",
        buildPlaybackPayload({ isPlaying: false })
      );
      storePlaybackState(response.state);
      setStatus("Перегляд завершено.");
      setSocketError("");
    } catch (error) {
      setSocketError(error instanceof Error ? error.message : "Не вдалося зберегти завершення перегляду.");
    }
  }, [activeMedia, buildPlaybackPayload, storePlaybackState]);

  const sendBufferingState = useCallback(
    async (isBuffering: boolean) => {
      if (!joinedRef.current || !activeMedia || bufferingRef.current === isBuffering) {
        return;
      }

      bufferingRef.current = isBuffering;

      try {
        const response = await emitWithAck<{ state: PlaybackState; members: RoomMemberDto[] }>(
          "playback:buffering",
          { ...buildPlaybackPayload(), isBuffering }
        );
        storePlaybackState(response.state);
        setMembers(response.members);
        if (isBuffering) {
          applyPlaybackState(response.state);
        }
      } catch (error) {
        setSocketError(error instanceof Error ? error.message : "Не вдалося оновити буферизацію.");
      }
    },
    [activeMedia, applyPlaybackState, buildPlaybackPayload, storePlaybackState]
  );

  useEffect(() => {
    let cancelled = false;

    const handleMembers = (payload: { roomId: string; members: RoomMemberDto[] }) => {
      if (payload.roomId === roomId) {
        setMembers(payload.members);
      }
    };
    const handleMediaSelected = (payload: { roomId: string; room: RoomDto; state: PlaybackState }) => {
      if (payload.roomId !== roomId) {
        return;
      }

      setRoom(payload.room);
      syncMediaPicker(payload.room);
      onRoomUpdatedRef.current?.(payload.room);
      applyPlaybackState(payload.state);
      setStatus("Медіа обрано.");
    };
    const handlePlaybackState = (payload: { roomId: string; state: PlaybackState; reason: string }) => {
      if (payload.roomId === roomId) {
        applyPlaybackState(payload.state);
        setStatus(
          payload.reason === "buffering"
            ? "Пауза через буферизацію."
            : payload.reason === "buffering-cleared"
              ? "Буферизацію завершено."
              : payload.reason === "ended"
                ? "Перегляд завершено."
                : "Синхронізовано."
        );
      }
    };
    const handleRoomDeleted = (payload: { roomId?: unknown }) => {
      if (payload.roomId !== roomId) {
        return;
      }

      joinedRef.current = false;
      setIsConnected(false);
      setStatus("Кімнату видалено.");
      onRoomDeletedRef.current?.(roomId);
    };
    const handleCorrection = (payload: {
      roomId: string;
      state: PlaybackState;
      correction: PlaybackCorrection;
    }) => {
      if (payload.roomId !== roomId) {
        return;
      }

      if (payload.correction.mode === "seek") {
        applyPlaybackState(payload.state);
        return;
      }

      if (payload.correction.mode === "rate" && videoRef.current) {
        videoRef.current.playbackRate = payload.correction.suggestedPlaybackRate;
      }
    };
    const handleServerError = (payload: { error?: string }) => {
      setSocketError(payload.error ?? "Socket error");
    };

    socket.on("room:members", handleMembers);
    socket.on("room:member-buffering", handleMembers);
    socket.on("room:media-selected", handleMediaSelected);
    socket.on("room:deleted", handleRoomDeleted);
    socket.on("playback:state", handlePlaybackState);
    socket.on("playback:correction", handleCorrection);
    socket.on("server:error", handleServerError);

    const start = async () => {
      setIsJoining(true);
      setSocketError("");
      setStatus("Підключення...");

      try {
        if (!initialRoomRef.current) {
          const response = await fetchRoom(roomId);
          if (!cancelled) {
            setRoom(response.room);
            syncMediaPicker(response.room);
            setNeedsPassword(Boolean(response.room.hasPassword && !password && !joinPasswordRef.current));
          }
        }

        await waitForSocketConnection();
        await measureSync();

        const response = await emitWithAck<{
          room: RoomDto;
          playback: PlaybackState;
          members: RoomMemberDto[];
          member: RoomMemberDto;
          serverNow: number;
        }>("room:join", {
          roomId,
          userId: user.id,
          password: joinPasswordRef.current || password || undefined
        });

        if (cancelled) {
          return;
        }

        joinedRef.current = true;
        setIsConnected(true);
        setNeedsPassword(false);
        setRoom(response.room);
        syncMediaPicker(response.room);
        setMembers(response.members);
        onRoomUpdatedRef.current?.(response.room);
        setStatus("Синхронізовано.");
        applyPlaybackState(response.playback);
      } catch (error) {
        if (cancelled) {
          return;
        }

        joinedRef.current = false;
        setIsConnected(false);
        setStatus("Не підключено.");
        setSocketError(error instanceof Error ? error.message : "Не вдалося увійти в кімнату.");

        if (error instanceof SocketEventError && error.status === 403) {
          setNeedsPassword(true);
        }
      } finally {
        if (!cancelled) {
          setIsJoining(false);
        }
      }
    };

    void start();

    return () => {
      cancelled = true;
      joinedRef.current = false;
      setIsConnected(false);
      socket.off("room:members", handleMembers);
      socket.off("room:member-buffering", handleMembers);
      socket.off("room:media-selected", handleMediaSelected);
      socket.off("room:deleted", handleRoomDeleted);
      socket.off("playback:state", handlePlaybackState);
      socket.off("playback:correction", handleCorrection);
      socket.off("server:error", handleServerError);

      if (socket.connected) {
        socket.emit("room:leave");
      }
    };
  }, [
    applyPlaybackState,
    joinAttempt,
    measureSync,
    password,
    roomId,
    syncMediaPicker,
    user.id
  ]);

  useEffect(() => {
    if (!isConnected) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      void measureSync().catch(() => undefined);
    }, 15_000);

    return () => window.clearInterval(timer);
  }, [isConnected, measureSync]);

  useEffect(() => {
    if (!isConnected || !activeMedia) {
      return undefined;
    }

    const sendHeartbeat = async () => {
      if (heartbeatBusyRef.current || !joinedRef.current) {
        return;
      }

      heartbeatBusyRef.current = true;

      try {
        const response = await emitWithAck<{
          state: PlaybackState;
          correction: PlaybackCorrection;
        }>("playback:heartbeat", buildPlaybackPayload());
        storePlaybackState(response.state);

        if (response.correction.mode === "seek") {
          applyPlaybackState(response.state);
        } else if (response.correction.mode === "rate" && videoRef.current) {
          videoRef.current.playbackRate = response.correction.suggestedPlaybackRate;
        }
      } catch (error) {
        setSocketError(error instanceof Error ? error.message : "Heartbeat failed.");
      } finally {
        heartbeatBusyRef.current = false;
      }
    };

    void sendHeartbeat();
    const timer = window.setInterval(() => {
      void sendHeartbeat();
    }, 5_000);

    return () => window.clearInterval(timer);
  }, [activeMedia, applyPlaybackState, buildPlaybackPayload, isConnected, storePlaybackState]);

  const handleFilmPick = (item: MediaDto) => {
    setSelectedLibraryId(item.id);
    setSelectedSeason("");
    setSelectedEpisodeId("");
    setMediaSearch("");
    setIsMediaMenuOpen(false);
  };

  const handleEpisodePick = (seriesItem: MediaDto, episode: MediaDto) => {
    setSelectedLibraryId(seriesItem.id);
    setSelectedSeason(episode.seasonNumber ?? 1);
    setSelectedEpisodeId(episode.id);
    setMediaSearch("");
    setIsMediaMenuOpen(false);
  };

  const handleClearMediaPick = () => {
    setSelectedLibraryId("");
    setSelectedSeason("");
    setSelectedEpisodeId("");
    setMediaSearch("");
    setIsMediaMenuOpen(false);
  };

  const handleSelectMedia = async () => {
    if (!isCreator || !isConnected) {
      return;
    }

    setIsSelectingMedia(true);
    setSocketError("");

    try {
      const response = await emitWithAck<{ room: RoomDto; state: PlaybackState }>("room:select-media", {
        roomId,
        userId: user.id,
        mediaId: selectedMediaId
      });
      setRoom(response.room);
      syncMediaPicker(response.room);
      onRoomUpdatedRef.current?.(response.room);
      applyPlaybackState(response.state);
      setStatus("Медіа обрано.");
    } catch (error) {
      setSocketError(error instanceof Error ? error.message : "Не вдалося обрати медіа.");
    } finally {
      setIsSelectingMedia(false);
    }
  };

  const handleDeleteRoom = async () => {
    if (!isCreator || !isConnected || !room) {
      return;
    }

    setIsDeletingRoom(true);
    setSocketError("");

    try {
      await emitWithAck<{ roomId: string; serverNow: number }>("room:delete", {
        roomId,
        userId: user.id
      });
      onRoomDeletedRef.current?.(roomId);
    } catch (error) {
      setSocketError(error instanceof Error ? error.message : "Не вдалося видалити кімнату.");
    } finally {
      setIsDeletingRoom(false);
    }
  };

  const handlePasswordSubmit = (event: FormEvent) => {
    event.preventDefault();
    setJoinAttempt((current) => current + 1);
  };

  return (
    <section className="grid flex-1 gap-4 py-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-w-0 flex-col gap-4">
        <div className={`${panelClass} p-4`}>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="mb-3 flex flex-wrap gap-2">
                <button
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-white/10 px-3 text-sm font-semibold text-white/76 transition hover:border-toxic hover:text-toxic"
                  type="button"
                  onClick={onClose}
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  Назад
                </button>
                {isCreator ? (
                  <button
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-plasma/45 bg-plasma/10 px-3 text-sm font-semibold text-plasma transition hover:bg-plasma hover:text-black disabled:cursor-not-allowed disabled:opacity-55"
                    disabled={!isConnected || isDeletingRoom}
                    type="button"
                    onClick={() => void handleDeleteRoom()}
                  >
                    {isDeletingRoom ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    )}
                    Видалити
                  </button>
                ) : null}
              </div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-toxic">room</p>
              <h2 className="mt-1 truncate text-2xl font-black">{room?.name ?? "Кімната"}</h2>
            </div>
            <div className="flex flex-wrap gap-2 text-xs font-semibold uppercase">
              <span className="rounded-md border border-white/10 px-2 py-1 text-white/62">
                {isConnected ? "online" : "offline"}
              </span>
              <span className="rounded-md border border-white/10 px-2 py-1 text-white/62">
                {syncStats.latencyMs === null ? "ping --" : `ping ${syncStats.latencyMs}ms`}
              </span>
            </div>
          </div>

          {needsPassword && !isConnected ? (
            <form className="mt-4 flex flex-col gap-3 sm:flex-row" onSubmit={handlePasswordSubmit}>
              <input
                className={fieldClass}
                placeholder="Пароль кімнати"
                type="password"
                value={joinPassword}
                onChange={(event) => setJoinPassword(event.target.value)}
              />
              <button
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-toxic px-4 text-sm font-bold text-black transition hover:shadow-neon"
                type="submit"
              >
                <Lock className="h-4 w-4" aria-hidden="true" />
                Підключитись
              </button>
            </form>
          ) : null}

          {socketError ? (
            <div className="mt-4 rounded-lg border border-plasma/35 bg-plasma/10 px-4 py-3 text-sm text-white/82">
              {socketError}
            </div>
          ) : null}

          <div className="mt-4 overflow-hidden rounded-lg border border-white/10 bg-black">
            <div className="grid aspect-video place-items-center">
              {activeMedia ? (
                <video
                  className="h-full w-full bg-black"
                  controls
                  key={activeMedia.id}
                  preload="metadata"
                  ref={videoRef}
                  src={streamUrl}
                  onCanPlay={() => void sendBufferingState(false)}
                  onLoadedMetadata={() => {
                    const state = playbackStateRef.current;
                    if (state) {
                      applyPlaybackState(state);
                    }
                  }}
                  onEnded={() => void sendPlaybackEnded()}
                  onPause={() => void sendPlaybackCommand("playback:pause")}
                  onPlay={() => void sendPlaybackCommand("playback:play")}
                  onPlaying={() => void sendBufferingState(false)}
                  onSeeked={() => void sendPlaybackCommand("playback:seek")}
                  onStalled={() => void sendBufferingState(true)}
                  onWaiting={() => void sendBufferingState(true)}
                />
              ) : (
                <div className="px-6 text-center">
                  <Radio className="mx-auto h-9 w-9 text-toxic" aria-hidden="true" />
                  <p className="mt-3 text-sm text-white/62">Творець ще не обрав медіа.</p>
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <p className="truncate text-lg font-bold">{activeMedia?.title ?? "Без медіа"}</p>
              <p className="mt-1 text-sm text-white/58">
                {playbackSnapshot
                  ? `${formatTime(playbackSnapshot.currentTimeSeconds)} · ${status}`
                  : status}
              </p>
            </div>
            {isJoining ? (
              <span className="inline-flex items-center gap-2 text-sm text-white/62">
                <Loader2 className="h-4 w-4 animate-spin text-toxic" aria-hidden="true" />
                Підключення
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <aside className="flex min-w-0 flex-col gap-4">
        <section className={`${panelClass} p-4`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-plasma">watchers</p>
              <h3 className="mt-1 text-xl font-bold">У кімнаті</h3>
            </div>
            <Users className="h-5 w-5 text-toxic" aria-hidden="true" />
          </div>
          <div className="mt-4 space-y-2">
            {members.length ? (
              members.map((member) => (
                <div
                  className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-black/35 px-3 py-2 text-sm"
                  key={member.socketId}
                >
                  <span className="min-w-0 truncate text-white/82">{member.nickname}</span>
                  <span className="shrink-0 text-xs text-white/48">
                    {member.isBuffering ? "buffer" : member.latencyMs === null ? "sync" : `${member.latencyMs}ms`}
                  </span>
                </div>
              ))
            ) : (
              <p className="rounded-md border border-white/10 bg-black/35 px-3 py-3 text-sm text-white/58">
                Список порожній.
              </p>
            )}
          </div>
        </section>

        <section className={`${panelClass} p-4`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-toxic">media</p>
              <h3 className="mt-1 text-xl font-bold">Вибір трансляції</h3>
            </div>
            {selectedLibraryItem?.type === "SERIES" ? (
              <Clapperboard className="h-5 w-5 text-plasma" aria-hidden="true" />
            ) : (
              <Film className="h-5 w-5 text-toxic" aria-hidden="true" />
            )}
          </div>

          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <button
                className={`inline-flex h-10 items-center justify-center gap-2 rounded-md border px-3 text-sm font-bold transition ${
                  mediaPickerType === "FILM"
                    ? "border-toxic bg-toxic text-black shadow-neon"
                    : "border-white/10 text-white/72 hover:border-toxic hover:text-toxic"
                }`}
                disabled={!isCreator || !isConnected}
                type="button"
                onClick={() => {
                  setMediaPickerType("FILM");
                  setMediaSearch("");
                  setIsMediaMenuOpen(false);
                }}
              >
                <Film className="h-4 w-4" aria-hidden="true" />
                Фільми
              </button>
              <button
                className={`inline-flex h-10 items-center justify-center gap-2 rounded-md border px-3 text-sm font-bold transition ${
                  mediaPickerType === "SERIES"
                    ? "border-toxic bg-toxic text-black shadow-neon"
                    : "border-white/10 text-white/72 hover:border-toxic hover:text-toxic"
                }`}
                disabled={!isCreator || !isConnected}
                type="button"
                onClick={() => {
                  setMediaPickerType("SERIES");
                  setMediaSearch("");
                  setIsMediaMenuOpen(false);
                }}
              >
                <Clapperboard className="h-4 w-4" aria-hidden="true" />
                Серіали
              </button>
            </div>

            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/38" />
              <input
                className={`${fieldClass} pl-10 pr-10`}
                disabled={!isCreator || !isConnected}
                placeholder={mediaPickerType === "FILM" ? "Пошук фільму" : "Пошук серіалу або серії"}
                value={mediaSearch}
                onFocus={() => setIsMediaMenuOpen(true)}
                onChange={(event) => setMediaSearch(event.target.value)}
              />
              {mediaSearch ? (
                <button
                  className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md border border-white/10 text-white/55 transition hover:border-toxic hover:text-toxic"
                  type="button"
                  onClick={() => {
                    setMediaSearch("");
                    setIsMediaMenuOpen(true);
                  }}
                  title="Очистити"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              ) : null}
            </label>

            {isMediaMenuOpen ? (
              <div className="max-h-72 space-y-2 overflow-y-auto rounded-md border border-white/10 bg-black/30 p-2">
                <button
                  className={`inline-flex min-h-10 w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm transition ${
                    !selectedMediaId
                      ? "border-toxic bg-toxic/10 text-toxic"
                      : "border-white/10 bg-black/35 text-white/66 hover:border-toxic hover:text-toxic"
                  }`}
                  disabled={!isCreator || !isConnected}
                  type="button"
                  onClick={handleClearMediaPick}
                >
                  <span>Без медіа</span>
                  <X className="h-4 w-4 shrink-0" aria-hidden="true" />
                </button>

                {mediaPickerType === "FILM" ? (
                  filteredFilmOptions.length ? (
                    filteredFilmOptions.map((item) => (
                      <button
                        className={`inline-flex min-h-10 w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm transition ${
                          selectedMediaId === item.id
                            ? "border-toxic bg-toxic/10 text-toxic"
                            : "border-white/10 bg-black/35 text-white/76 hover:border-toxic hover:text-toxic"
                        }`}
                        disabled={!isCreator || !isConnected}
                        key={item.id}
                        type="button"
                        onClick={() => handleFilmPick(item)}
                      >
                        <span className="min-w-0 truncate">{item.title}</span>
                        <Film className="h-4 w-4 shrink-0" aria-hidden="true" />
                      </button>
                    ))
                  ) : (
                    <p className="rounded-md border border-white/10 bg-black/35 px-3 py-2 text-sm text-white/58">
                      Фільмів за цим пошуком немає.
                    </p>
                  )
                ) : episodeOptions.length ? (
                  episodeOptions.map(({ series: seriesItem, episode }) => (
                    <button
                      className={`inline-flex min-h-10 w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm transition ${
                        selectedMediaId === episode.id
                          ? "border-toxic bg-toxic/10 text-toxic"
                          : "border-white/10 bg-black/35 text-white/76 hover:border-toxic hover:text-toxic"
                      }`}
                      disabled={!isCreator || !isConnected}
                      key={episode.id}
                      type="button"
                      onClick={() => handleEpisodePick(seriesItem, episode)}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{seriesItem.title}</span>
                        <span className="block truncate text-xs text-white/50">{mediaLabel(episode)}</span>
                      </span>
                      <Clapperboard className="h-4 w-4 shrink-0" aria-hidden="true" />
                    </button>
                  ))
                ) : (
                  <p className="rounded-md border border-white/10 bg-black/35 px-3 py-2 text-sm text-white/58">
                    Серій за цим пошуком немає.
                  </p>
                )}
              </div>
            ) : null}

            <button
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-toxic/70 bg-toxic/10 px-4 text-sm font-bold text-toxic transition hover:bg-toxic hover:text-black hover:shadow-neon disabled:cursor-not-allowed disabled:opacity-55"
              disabled={!isCreator || !isConnected || isSelectingMedia}
              type="button"
              onClick={() => void handleSelectMedia()}
            >
              {isSelectingMedia ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="h-4 w-4" aria-hidden="true" />
              )}
              Обрати
            </button>

            {!isCreator ? (
              <p className="rounded-md border border-white/10 bg-black/35 px-3 py-3 text-sm text-white/58">
                Медіа змінює тільки творець кімнати.
              </p>
            ) : null}
          </div>
        </section>

        <section className={`${panelClass} p-4`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-plasma">sync</p>
              <h3 className="mt-1 text-xl font-bold">Стан</h3>
            </div>
            <Wifi className="h-5 w-5 text-toxic" aria-hidden="true" />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-md border border-white/10 bg-black/35 p-3">
              <p className="text-white/45">Host</p>
              <p className="mt-1 truncate font-semibold">{room?.creator.nickname ?? "--"}</p>
            </div>
            <div className="rounded-md border border-white/10 bg-black/35 p-3">
              <p className="text-white/45">Offset</p>
              <p className="mt-1 font-semibold">{syncStats.serverOffsetMs}ms</p>
            </div>
          </div>
        </section>

        <SocialPanel
          activeRoomId={isConnected ? roomId : null}
          activeRoomName={room?.name ?? null}
          isSocketConnected={isSocketConnected}
          onlineUserIds={onlineUserIds}
          user={user}
        />
      </aside>
    </section>
  );
}

export default RoomView;
