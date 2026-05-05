import {
  BellRing,
  Clapperboard,
  DoorOpen,
  Film,
  Library,
  Loader2,
  Lock,
  LogOut,
  MonitorPlay,
  Play,
  Plus,
  Radio,
  RefreshCcw,
  Search,
  Sparkles,
  Trash2,
  Users,
  Wifi,
  X
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createRoom,
  deleteRoom,
  fetchRoom,
  fetchMediaLibrary,
  fetchPublicRooms,
  loginByNickname,
  type MediaDto,
  type RoomDto
} from "./lib/api";
import AdminPanel from "./components/AdminPanel";
import HeroPerson from "./components/HeroPerson";
import RoomView from "./components/RoomView";
import SocialPanel from "./components/SocialPanel";
import ToastNotice from "./components/ToastNotice";
import { socket } from "./lib/socket";
import { useSessionStore } from "./store/sessionStore";

const defaultUserAvatar = "/images/unknown-user.png";

const panelClass =
  "rounded-lg border border-white/10 bg-zinc-950/78 shadow-panel backdrop-blur-xl";
const fieldClass =
  "h-11 w-full rounded-md border border-white/10 bg-black/45 px-3 text-sm text-white outline-none transition placeholder:text-white/35 focus:border-toxic focus:shadow-neon";

const sideDecorPhotoHeightPx = 340;
const sideDecorPhotoWidthPx = 950;
const sideDecorBlockOffsetPx = 560;

const sideDecorFrameStyle = {
  height: sideDecorPhotoHeightPx,
  width: sideDecorPhotoWidthPx,
  maxHeight: "calc(100% - 2rem)"
};
const leftSideDecorFrameStyle = {
  ...sideDecorFrameStyle,
  left: -sideDecorBlockOffsetPx
};
const rightSideDecorFrameStyle = {
  ...sideDecorFrameStyle,
  right: -sideDecorBlockOffsetPx
};

const flattenPlayableMedia = (media: MediaDto[]) =>
  media.flatMap((item) => (item.type === "SERIES" ? item.children : [item])).filter((item) => {
    return item.type !== "SERIES" && item.isAvailable;
  });

const mediaLabel = (item: MediaDto) => {
  if (item.type === "EPISODE") {
    const season = item.seasonNumber ? `S${String(item.seasonNumber).padStart(2, "0")}` : "S--";
    const episode = item.episodeNumber ? `E${String(item.episodeNumber).padStart(2, "0")}` : "E--";
    return `${season}${episode} · ${item.title}`;
  }

  return item.title;
};

const mediaKindLabel = (item: MediaDto) => {
  if (item.type === "FILM") {
    return "Фільм";
  }

  if (item.type === "EPISODE") {
    return "Серія";
  }

  return "Серіал";
};

const countEpisodes = (item: MediaDto) =>
  item.type === "SERIES" ? item.children.filter((child) => child.isAvailable).length : 0;

const visibleLibraryMedia = (media: MediaDto[]) =>
  media
    .map((item) => {
      if (item.type !== "SERIES") {
        return item;
      }

      return {
        ...item,
        children: item.children.filter((child) => child.isAvailable && Boolean(child.filePath))
      };
    })
    .filter((item) =>
      item.type === "SERIES"
        ? item.isAvailable && item.children.length > 0
        : item.isAvailable && Boolean(item.filePath)
    );

type InviteNotification = {
  roomId: string;
  roomName: string;
  fromUserId: string;
  fromNickname: string;
  message: string | null;
  serverNow: number;
  receivedAt: number;
};

type LoadDashboardOptions = {
  includeMedia?: boolean;
  clearToast?: boolean;
};

type ToastState = {
  id: number;
  message: string;
  tone: "success" | "info" | "error";
};

const deleteRoomOverSocket = (input: { roomId: string; userId: string }) =>
  new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error("Socket request timed out"));
    }, 8_000);

    socket.emit(
      "room:delete",
      input,
      (response: { ok: true; roomId: string } | { ok: false; error: string } | undefined) => {
        window.clearTimeout(timeout);

        if (!response || response.ok !== true) {
          reject(new Error(response?.error ?? "Не вдалося видалити кімнату."));
          return;
        }

        resolve();
      }
    );
  });

function App() {
  const { nickname, user, setNickname, setUser, reset } = useSessionStore();
  const [rooms, setRooms] = useState<RoomDto[]>([]);
  const [media, setMedia] = useState<MediaDto[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [openedRoom, setOpenedRoom] = useState<RoomDto | null>(null);
  const [activeRoomPassword, setActiveRoomPassword] = useState("");
  const [search, setSearch] = useState("");
  const [roomName, setRoomName] = useState("");
  const [selectedMediaId, setSelectedMediaId] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [password, setPassword] = useState("");
  const [pathname, setPathname] = useState(window.location.pathname);
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);
  const [inviteNotifications, setInviteNotifications] = useState<InviteNotification[]>([]);
  const [isSocketConnected, setIsSocketConnected] = useState(socket.connected);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [createMediaSearch, setCreateMediaSearch] = useState("");
  const [isCreateMediaMenuOpen, setIsCreateMediaMenuOpen] = useState(false);
  const createMediaPickerRef = useRef<HTMLDivElement | null>(null);

  const playableMedia = useMemo(() => flattenPlayableMedia(media), [media]);
  const visibleMedia = useMemo(() => visibleLibraryMedia(media), [media]);
  const selectedRoom = rooms.find((room) => room.id === selectedRoomId) ?? rooms[0] ?? null;
  const filteredMedia = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) {
      return visibleMedia;
    }

    return visibleMedia.filter((item) => {
      const selfMatches = item.title.toLowerCase().includes(query);
      const childMatches = item.children.some((child) => child.title.toLowerCase().includes(query));
      return selfMatches || childMatches;
    });
  }, [search, visibleMedia]);
  const selectedCreateMedia = useMemo(
    () => playableMedia.find((item) => item.id === selectedMediaId) ?? null,
    [playableMedia, selectedMediaId]
  );
  const filteredCreateMedia = useMemo(() => {
    const query = createMediaSearch.trim().toLowerCase();

    if (!query) {
      return playableMedia;
    }

    return playableMedia.filter((item) => mediaLabel(item).toLowerCase().includes(query));
  }, [createMediaSearch, playableMedia]);

  const showToast = useCallback((message: string, tone: ToastState["tone"] = "info") => {
    setToast({
      id: Date.now(),
      message,
      tone
    });
  }, []);

  const loadDashboard = useCallback(async (options: LoadDashboardOptions = {}) => {
    const shouldLoadMedia = options.includeMedia ?? Boolean(user);

    setIsLoading(true);

    if (options.clearToast ?? true) {
      setToast(null);
    }

    try {
      const roomsRequest = fetchPublicRooms();
      const mediaRequest = shouldLoadMedia ? fetchMediaLibrary() : Promise.resolve({ media: [] });
      const [roomsResponse, mediaResponse] = await Promise.all([roomsRequest, mediaRequest]);

      setRooms(roomsResponse.rooms);
      setMedia(mediaResponse.media);
      setSelectedRoomId((current) =>
        roomsResponse.rooms.some((room) => room.id === current)
          ? current
          : roomsResponse.rooms[0]?.id ?? null
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Не вдалося оновити головну.", "error");
    } finally {
      setIsLoading(false);
    }
  }, [showToast, user]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadDashboard({ clearToast: false });
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadDashboard]);

  useEffect(() => {
    const handlePopstate = () => {
      setPathname(window.location.pathname);
    };

    window.addEventListener("popstate", handlePopstate);
    return () => window.removeEventListener("popstate", handlePopstate);
  }, []);

  useEffect(() => {
    if (!user) {
      if (socket.connected) {
        socket.disconnect();
      }
      return;
    }

    const registerPresence = () => {
      socket.emit(
        "social:register",
        { userId: user.id },
        (
          response:
            | { ok: true; onlineUserIds: string[] }
            | { ok: false; error: string }
            | undefined
        ) => {
          if (!response || response.ok !== true) {
            if (response?.error) {
              showToast(response.error, "error");
            }
            return;
          }

          setOnlineUserIds(response.onlineUserIds);
        }
      );
    };

    const handleConnect = () => {
      setIsSocketConnected(true);
      registerPresence();
    };

    const handleDisconnect = () => {
      setIsSocketConnected(false);
    };

    const handlePresence = (payload: { onlineUserIds?: unknown }) => {
      if (Array.isArray(payload?.onlineUserIds)) {
        setOnlineUserIds(payload.onlineUserIds.filter((item): item is string => typeof item === "string"));
      }
    };

    const handleInvitation = (payload: {
      roomId?: unknown;
      roomName?: unknown;
      fromUserId?: unknown;
      fromNickname?: unknown;
      message?: unknown;
      serverNow?: unknown;
    }) => {
      if (
        typeof payload?.roomId !== "string" ||
        typeof payload?.roomName !== "string" ||
        typeof payload?.fromUserId !== "string" ||
        typeof payload?.fromNickname !== "string"
      ) {
        return;
      }

      const invitation: InviteNotification = {
        roomId: payload.roomId,
        roomName: payload.roomName,
        fromUserId: payload.fromUserId,
        fromNickname: payload.fromNickname,
        message: typeof payload.message === "string" ? payload.message : null,
        serverNow: typeof payload.serverNow === "number" ? payload.serverNow : Date.now(),
        receivedAt: Date.now()
      };

      setInviteNotifications((current) => {
        const duplicate = current.find(
          (item) =>
            item.roomId === invitation.roomId && item.fromUserId === invitation.fromUserId
        );

        if (duplicate) {
          return current;
        }

        return [invitation, ...current].slice(0, 8);
      });
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("social:presence", handlePresence);
    socket.on("friend:invitation", handleInvitation);

    if (socket.connected) {
      handleConnect();
    } else {
      socket.connect();
    }

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("social:presence", handlePresence);
      socket.off("friend:invitation", handleInvitation);
    };
  }, [showToast, user]);

  useEffect(() => {
    if (!isCreateMediaMenuOpen) {
      return undefined;
    }

    const handleOutsideClick = (event: MouseEvent | TouchEvent) => {
      const target = event.target;

      if (!(target instanceof Node)) {
        return;
      }

      if (createMediaPickerRef.current?.contains(target)) {
        return;
      }

      setIsCreateMediaMenuOpen(false);
    };

    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("touchstart", handleOutsideClick);

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("touchstart", handleOutsideClick);
    };
  }, [isCreateMediaMenuOpen]);

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);
    setToast(null);

    try {
      const response = await loginByNickname(nickname);
      setUser(response.user);
      showToast(`Ти в системі як ${response.user.nickname}.`, "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Не вдалося увійти.", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateRoom = async (event: FormEvent) => {
    event.preventDefault();

    if (!user) {
      showToast("Увійди з нікнеймом.", "info");
      return;
    }

    setIsSubmitting(true);
    setToast(null);

    try {
      const response = await createRoom({
        name: roomName,
        creatorId: user.id,
        isPublic: !isPrivate,
        password: isPrivate ? password : undefined,
        mediaId: selectedMediaId || undefined
      });
      setRooms((current) =>
        response.room.isPublic
          ? [response.room, ...current.filter((room) => room.id !== response.room.id)]
          : current
      );
      setSelectedRoomId((current) => (response.room.isPublic ? response.room.id : current));
      showToast(
        response.room.isPublic
          ? "Кімнату створено."
          : "Приватну кімнату створено.",
        "success"
      );
      setOpenedRoom(response.room);
      setActiveRoomId(response.room.id);
      setActiveRoomPassword(isPrivate ? password : "");
      setCreateMediaSearch("");
      setIsCreateMediaMenuOpen(false);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Не вдалося створити кімнату.", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const openRoomById = async (roomId: string, roomPassword = "") => {
    if (!user) {
      showToast("Увійди з нікнеймом.", "info");
      return;
    }

    try {
      const response = await fetchRoom(roomId);
      setOpenedRoom(response.room);
      setActiveRoomId(roomId);
      setActiveRoomPassword(roomPassword);
      setInviteNotifications((current) => current.filter((item) => item.roomId !== roomId));
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Не вдалося відкрити кімнату.", "error");
    }
  };

  const handleOpenRoom = (room: RoomDto) => {
    if (!user) {
      showToast("Увійди з нікнеймом.", "info");
      return;
    }

    setOpenedRoom(room);
    setActiveRoomId(room.id);
    setActiveRoomPassword("");
  };

  const handleRoomUpdated = (room: RoomDto) => {
    setOpenedRoom(room);
    setRooms((current) =>
      room.isPublic
        ? [room, ...current.filter((item) => item.id !== room.id)]
        : current.filter((item) => item.id !== room.id)
    );
  };

  const handleRoomDeleted = (roomId: string) => {
    setRooms((current) => current.filter((room) => room.id !== roomId));
    setSelectedRoomId((current) => (current === roomId ? null : current));

    if (activeRoomId === roomId) {
      setActiveRoomId(null);
      setOpenedRoom(null);
      setActiveRoomPassword("");
    }
  };

  const handleDeleteRoom = async (room: RoomDto) => {
    if (!user) {
      showToast("Увійди з нікнеймом.", "info");
      return;
    }

    if (room.creatorId !== user.id) {
      showToast("Кімнату може видалити тільки творець.", "info");
      return;
    }

    setIsSubmitting(true);
    setToast(null);

    try {
      if (socket.connected) {
        await deleteRoomOverSocket({ roomId: room.id, userId: user.id });
      } else {
        await deleteRoom({ roomId: room.id, requesterId: user.id });
      }
      handleRoomDeleted(room.id);
      showToast("Кімнату видалено.", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Не вдалося видалити кімнату.", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogout = () => {
    reset();
    setMedia([]);
    setSelectedMediaId("");
    setActiveRoomId(null);
    setOpenedRoom(null);
    setActiveRoomPassword("");
    setOnlineUserIds([]);
    setIsSocketConnected(false);
    setInviteNotifications([]);
    setToast(null);
  };

  const navigateTo = (nextPath: string) => {
    if (window.location.pathname === nextPath) {
      return;
    }

    window.history.pushState({}, "", nextPath);
    setPathname(nextPath);
  };

  if (pathname.startsWith("/admin")) {
    return (
      <main className="min-h-screen overflow-hidden bg-void text-white">
        <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(rgba(57,255,20,0.055)_1px,transparent_1px),linear-gradient(90deg,rgba(155,92,255,0.045)_1px,transparent_1px)] bg-[size:42px_42px]" />
        <div className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-4 sm:px-6 lg:px-8">
          <AdminPanel onBack={() => navigateTo("/")} />
        </div>
      </main>
    );
  }

  const isGuestLanding = !user && !activeRoomId;
  const isDashboardLanding = Boolean(user) && !activeRoomId;
  const pickCreateMedia = (mediaItem: MediaDto | null) => {
    setSelectedMediaId(mediaItem?.id ?? "");
    setCreateMediaSearch("");
    setIsCreateMediaMenuOpen(false);
  };

  return (
      <main
        className={`${
          isGuestLanding || isDashboardLanding
            ? "min-h-[100svh] overflow-x-hidden lg:h-[100svh] lg:overflow-hidden"
            : "min-h-screen overflow-x-hidden"
        } bg-void text-white`}
      >
      {toast ? (
        <ToastNotice
          key={toast.id}
          durationMs={2200}
          message={toast.message}
          tone={toast.tone}
          onClose={() => setToast(null)}
        />
      ) : null}
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(rgba(57,255,20,0.055)_1px,transparent_1px),linear-gradient(90deg,rgba(155,92,255,0.045)_1px,transparent_1px)] bg-[size:42px_42px]" />
      <div
        className={`relative mx-auto flex w-full max-w-7xl flex-col px-4 py-4 sm:px-6 lg:px-8 ${
          isGuestLanding || isDashboardLanding ? "min-h-[100svh] lg:h-full lg:min-h-0" : "min-h-screen"
        }`}
      >
        <header className="flex flex-col gap-4 border-b border-white/10 pb-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="group flex items-center gap-3 rounded-lg border border-white/5 px-2 py-1 transition duration-300 hover:border-toxic/35 hover:bg-white/[0.02] hover:shadow-neon">
            <div className="grid h-12 w-12 place-items-center rounded-lg border border-toxic/45 bg-toxic/10 shadow-neon transition duration-300 group-hover:rotate-6 group-hover:scale-110">
              <Sparkles className="h-6 w-6 text-toxic transition duration-300 group-hover:text-white" aria-hidden="true" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-toxic transition duration-300 group-hover:text-white">
                MarlineLabs
              </p>
              <h1 className="text-2xl font-black text-white transition duration-300 group-hover:text-toxic sm:text-3xl">
                Viktoria’s Edition
              </h1>
            </div>
          </div>

          <div className="flex w-full items-center justify-end gap-3 lg:w-auto">
            {user ? (
              <>
                <div className="flex min-w-0 items-center gap-2 rounded-md border border-white/10 bg-black/35 px-3 py-2">
                  <img
                    alt=""
                    className="h-9 w-9 shrink-0 rounded-full border border-white/20 object-cover"
                    src={defaultUserAvatar}
                  />
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">
                      profile
                    </p>
                    <p className="truncate text-sm font-semibold text-white/88">{user.nickname}</p>
                  </div>
                </div>
                <button
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-white/10 px-4 text-sm font-semibold text-white/80 transition hover:border-plasma hover:text-white"
                  type="button"
                  onClick={handleLogout}
                >
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                  Вийти
                </button>
              </>
            ) : null}
          </div>
        </header>

        {activeRoomId && user ? (
          <RoomView
            key={activeRoomId}
            initialRoom={openedRoom}
            isSocketConnected={isSocketConnected}
            media={media}
            onlineUserIds={onlineUserIds}
            password={activeRoomPassword}
            roomId={activeRoomId}
            user={user}
            onClose={() => {
              setActiveRoomId(null);
              setActiveRoomPassword("");
              void loadDashboard();
            }}
            onRoomDeleted={handleRoomDeleted}
            onRoomUpdated={handleRoomUpdated}
          />
        ) : user ? (
          <section className="relative py-3 lg:min-h-0 lg:flex-1">
            <div
              aria-hidden="true"
              className="side-decor side-decor-official side-decor-left absolute top-8 z-0 hidden w-fit opacity-95 xl:block"
              style={leftSideDecorFrameStyle}
            >
              <img
                alt=""
                className="h-full w-full select-none object-contain"
                src="/images/person-official-right.png"
              />
            </div>
            <div
              aria-hidden="true"
              className="side-decor side-decor-alt side-decor-right absolute top-8 z-0 hidden w-fit opacity-95 xl:block"
              style={rightSideDecorFrameStyle}
            >
              <img
                alt=""
                className="h-full w-full select-none object-contain"
                src="/images/person-alt-left.png"
              />
            </div>

            <div
              className="relative z-10 grid gap-4 lg:h-full lg:min-h-0 lg:grid-cols-[340px_minmax(0,1fr)]"
            >
              <aside className="flex flex-col gap-4 lg:min-h-0 lg:overflow-hidden">
                <form className={`${panelClass} p-4`} onSubmit={handleCreateRoom}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-plasma">
                        rooms
                      </p>
                      <h2 className="mt-1 text-xl font-bold">Нова кімната</h2>
                    </div>
                    <Plus className="h-5 w-5 text-toxic" aria-hidden="true" />
                  </div>

                  <div className="mt-4 space-y-3">
                    <input
                      className={fieldClass}
                      placeholder="Viktoria likes to watch.."
                      value={roomName}
                      onChange={(event) => setRoomName(event.target.value)}
                    />

                    <div className="space-y-2" ref={createMediaPickerRef}>
                      <label className="relative block">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                        <input
                          className={`${fieldClass} pl-10 pr-10`}
                          placeholder={
                            selectedCreateMedia
                              ? `Обрано: ${mediaLabel(selectedCreateMedia)}`
                              : "Пошук медіа для кімнати"
                          }
                          value={createMediaSearch}
                          onChange={(event) => {
                            setCreateMediaSearch(event.target.value);
                            setIsCreateMediaMenuOpen(true);
                          }}
                          onFocus={() => setIsCreateMediaMenuOpen(true)}
                        />
                        {(selectedMediaId || createMediaSearch) ? (
                          <button
                            className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md border border-white/10 text-white/55 transition hover:border-toxic hover:text-toxic"
                            type="button"
                            onClick={() => pickCreateMedia(null)}
                            title="Очистити"
                          >
                            <X className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        ) : null}
                      </label>

                      {isCreateMediaMenuOpen ? (
                        <div className="max-h-56 overflow-y-auto rounded-md border border-white/10 bg-black/55 p-2">
                          <button
                            className={`inline-flex min-h-10 w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm transition ${
                              !selectedMediaId
                                ? "border-toxic bg-toxic/10 text-toxic"
                                : "border-white/10 bg-black/35 text-white/70 hover:border-toxic hover:text-toxic"
                            }`}
                            type="button"
                            onClick={() => pickCreateMedia(null)}
                          >
                            <span>Медіа оберемо пізніше</span>
                            <X className="h-4 w-4 shrink-0" aria-hidden="true" />
                          </button>

                          <div className="mt-2 space-y-2">
                            {filteredCreateMedia.length ? (
                              filteredCreateMedia.map((item) => (
                                <button
                                  className={`inline-flex min-h-10 w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm transition ${
                                    selectedMediaId === item.id
                                      ? "border-toxic bg-toxic/10 text-toxic"
                                      : "border-white/10 bg-black/35 text-white/76 hover:border-toxic hover:text-toxic"
                                  }`}
                                  key={item.id}
                                  type="button"
                                  onClick={() => pickCreateMedia(item)}
                                >
                                  <span className="min-w-0 truncate">{mediaLabel(item)}</span>
                                  {item.type === "FILM" ? (
                                    <Film className="h-4 w-4 shrink-0" aria-hidden="true" />
                                  ) : (
                                    <Clapperboard className="h-4 w-4 shrink-0" aria-hidden="true" />
                                  )}
                                </button>
                              ))
                            ) : (
                              <p className="rounded-md border border-white/10 bg-black/35 px-3 py-2 text-sm text-white/58">
                                Нічого не знайдено.
                              </p>
                            )}
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <label className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-black/35 px-3 py-3 text-sm">
                      <span className="inline-flex items-center gap-2 text-white/82">
                        {isPrivate ? (
                          <Lock className="h-4 w-4 text-plasma" aria-hidden="true" />
                        ) : (
                          <Wifi className="h-4 w-4 text-toxic" aria-hidden="true" />
                        )}
                        Приватна кімната
                      </span>
                      <input
                        className="h-5 w-5 accent-toxic"
                        checked={isPrivate}
                        type="checkbox"
                        onChange={(event) => setIsPrivate(event.target.checked)}
                      />
                    </label>

                    {isPrivate ? (
                      <input
                        className={fieldClass}
                        placeholder="Пароль кімнати"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                      />
                    ) : null}

                    <button
                      className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border border-toxic/70 bg-toxic/10 px-4 text-sm font-bold text-toxic transition hover:bg-toxic hover:text-black hover:shadow-neon disabled:cursor-not-allowed disabled:opacity-55"
                      disabled={isSubmitting || !user || !roomName.trim()}
                      type="submit"
                    >
                      <Plus className="h-4 w-4" aria-hidden="true" />
                      Створити
                    </button>
                  </div>
                </form>

                <div className="pr-1 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
                  <SocialPanel
                    activeRoomId={activeRoomId}
                    activeRoomName={openedRoom?.name ?? null}
                    isSocketConnected={isSocketConnected}
                    onlineUserIds={onlineUserIds}
                    user={user}
                  />
                </div>
              </aside>

              <div className="grid gap-4 lg:min-h-0 lg:grid-rows-[auto_minmax(0,1fr)_minmax(0,1fr)]">
                <div className="grid gap-4 md:grid-cols-3">
                  <div className={`${panelClass} p-4`}>
                    <Radio className="h-5 w-5 text-toxic" aria-hidden="true" />
                    <p className="mt-4 text-3xl font-black">{rooms.length}</p>
                    <p className="mt-1 text-sm text-white/60">активних кімнат</p>
                  </div>
                  <div className={`${panelClass} p-4`}>
                    <Library className="h-5 w-5 text-plasma" aria-hidden="true" />
                    <p className="mt-4 text-3xl font-black">{playableMedia.length}</p>
                    <p className="mt-1 text-sm text-white/60">доступних файлів</p>
                  </div>
                  <div className={`${panelClass} p-4`}>
                    <Users className="h-5 w-5 text-toxic" aria-hidden="true" />
                    <p className="mt-4 truncate text-3xl font-black">{user.nickname}</p>
                    <p className="mt-1 text-sm text-white/60">поточний профіль</p>
                  </div>
                </div>

                <section className={`${panelClass} flex flex-col p-4 lg:min-h-0 lg:overflow-hidden`}>
                  {inviteNotifications.length ? (
                    <div className="mb-4 rounded-lg border border-plasma/30 bg-plasma/10 p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-plasma">
                          invites
                        </p>
                        <BellRing className="h-4 w-4 text-toxic" aria-hidden="true" />
                      </div>
                      <div className="max-h-28 space-y-2 overflow-y-auto pr-1">
                        {inviteNotifications.map((invite) => (
                          <div
                            className="flex items-center justify-between gap-2 rounded-md border border-white/10 bg-black/35 px-2 py-2"
                            key={`${invite.roomId}:${invite.fromUserId}:${invite.receivedAt}`}
                          >
                            <div className="min-w-0">
                              <p className="truncate text-xs font-semibold">{invite.roomName}</p>
                              <p className="truncate text-[11px] text-white/55">від {invite.fromNickname}</p>
                            </div>
                            <div className="flex gap-1.5">
                              <button
                                className="inline-flex h-7 items-center justify-center rounded-md bg-toxic px-2 text-[11px] font-bold text-black transition hover:shadow-neon"
                                type="button"
                                onClick={() => void openRoomById(invite.roomId)}
                              >
                                Прийняти
                              </button>
                              <button
                                className="inline-flex h-7 items-center justify-center rounded-md border border-white/15 px-2 text-[11px] font-semibold text-white/70 transition hover:border-plasma hover:text-plasma"
                                type="button"
                                onClick={() =>
                                  setInviteNotifications((current) =>
                                    current.filter(
                                      (item) =>
                                        !(
                                          item.roomId === invite.roomId &&
                                          item.fromUserId === invite.fromUserId &&
                                          item.receivedAt === invite.receivedAt
                                        )
                                    )
                                  )
                                }
                              >
                                Відхилити
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-toxic">
                        live
                      </p>
                      <h2 className="mt-1 text-2xl font-black">Публічні кімнати</h2>
                    </div>
                    <button
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-white/10 px-3 text-sm font-semibold text-white/78 transition hover:border-toxic hover:text-toxic"
                      type="button"
                      onClick={() => void loadDashboard()}
                      title="Оновити"
                    >
                      <RefreshCcw className="h-4 w-4" aria-hidden="true" />
                      Оновити
                    </button>
                  </div>

                  <div className="mt-4 grid content-start gap-3 pr-1 lg:min-h-0 lg:flex-1 lg:overflow-y-auto xl:grid-cols-2">
                    {isLoading ? (
                      <div className="rounded-lg border border-white/10 bg-black/35 p-5 text-white/62">
                        <Loader2 className="h-5 w-5 animate-spin text-toxic" aria-hidden="true" />
                      </div>
                    ) : rooms.length ? (
                      rooms.map((room) => (
                        <button
                          className={`rounded-lg border p-4 text-left transition hover:border-toxic hover:shadow-neon ${
                            selectedRoom?.id === room.id
                              ? "border-toxic/70 bg-toxic/10"
                              : "border-white/10 bg-black/35"
                          }`}
                          key={room.id}
                          type="button"
                          onClick={() => setSelectedRoomId(room.id)}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-lg font-bold">{room.name}</p>
                              <p className="mt-1 text-sm text-white/58">host · {room.creator.nickname}</p>
                            </div>
                            {room.hasPassword ? (
                              <Lock className="h-4 w-4 shrink-0 text-plasma" aria-hidden="true" />
                            ) : (
                              <DoorOpen className="h-4 w-4 shrink-0 text-toxic" aria-hidden="true" />
                            )}
                          </div>
                          <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold uppercase">
                            <span className="rounded-md border border-white/10 px-2 py-1 text-white/62">
                              {room.playback.isPlaying ? "playing" : "paused"}
                            </span>
                            <span className="rounded-md border border-white/10 px-2 py-1 text-white/62">
                              {room.media ? room.media.title : "no media"}
                            </span>
                          </div>
                        </button>
                      ))
                    ) : (
                      <div className="rounded-lg border border-white/10 bg-black/35 p-5 text-sm text-white/62">
                        Публічних кімнат поки немає.
                      </div>
                    )}
                  </div>

                  {selectedRoom ? (
                    <div className="mt-4 flex shrink-0 flex-col gap-3 rounded-lg border border-white/10 bg-black/35 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white/82">{selectedRoom.name}</p>
                        <p className="mt-1 text-xs text-white/50">
                          {selectedRoom.media ? selectedRoom.media.title : "медіа ще не обрано"}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        {user && selectedRoom.creatorId === user.id ? (
                          <button
                            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-plasma/45 bg-plasma/10 px-4 text-sm font-bold text-plasma transition hover:bg-plasma hover:text-black disabled:cursor-not-allowed disabled:opacity-55"
                            disabled={isSubmitting}
                            type="button"
                            onClick={() => void handleDeleteRoom(selectedRoom)}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                            Видалити
                          </button>
                        ) : null}
                        <button
                          className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-toxic px-4 text-sm font-bold text-black transition hover:shadow-neon disabled:cursor-not-allowed disabled:opacity-55"
                          disabled={!user}
                          type="button"
                          onClick={() => handleOpenRoom(selectedRoom)}
                        >
                          <MonitorPlay className="h-4 w-4" aria-hidden="true" />
                          Увійти
                        </button>
                      </div>
                    </div>
                  ) : null}
                </section>

                <section className={`${panelClass} p-4 lg:min-h-0`}>
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-plasma">
                        library
                      </p>
                      <h2 className="mt-1 text-2xl font-black">Медіатека MarlineLabs</h2>
                    </div>
                    <label className="relative block w-full lg:w-80">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/42" />
                      <input
                        className={`${fieldClass} pl-10`}
                        placeholder="Пошук"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                      />
                    </label>
                  </div>

                  <div className="mt-4 grid gap-3 pr-1 md:grid-cols-2 lg:max-h-[36vh] lg:overflow-y-auto xl:grid-cols-3">
                    {filteredMedia.length ? (
                      filteredMedia.map((item) => (
                        <article
                          className="min-h-40 rounded-lg border border-white/10 bg-black/35 p-4 transition hover:border-toxic/70 hover:shadow-neon"
                          key={item.id}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-white/10 bg-white/5">
                              {item.type === "SERIES" ? (
                                <Clapperboard className="h-5 w-5 text-plasma" aria-hidden="true" />
                              ) : (
                                <Film className="h-5 w-5 text-toxic" aria-hidden="true" />
                              )}
                            </div>
                            <span className="rounded-md border border-toxic/35 px-2 py-1 text-xs font-bold uppercase text-toxic">
                              {mediaKindLabel(item)}
                            </span>
                          </div>
                          <h3 className="mt-4 line-clamp-2 text-lg font-bold">{item.title}</h3>
                          <p className="mt-2 line-clamp-2 text-sm leading-6 text-white/58">
                            {item.description ??
                              (item.type === "SERIES"
                                ? `${countEpisodes(item)} серій доступно`
                                : "Готово до перегляду")}
                          </p>
                          <div className="mt-4 flex items-center justify-between gap-3 text-xs text-white/50">
                            <span>{item.isAvailable ? "online" : "missing"}</span>
                            {item.type !== "SERIES" ? (
                              <Play className="h-4 w-4 text-toxic" aria-hidden="true" />
                            ) : (
                              <span>{countEpisodes(item)} ep</span>
                            )}
                          </div>
                        </article>
                      ))
                    ) : (
                      <div className="rounded-lg border border-white/10 bg-black/35 p-5 text-sm text-white/62 md:col-span-2 xl:col-span-3">
                        Медіатека порожня.
                      </div>
                    )}
                  </div>
                </section>
              </div>
            </div>
          </section>
        ) : (
          <section className="py-2 lg:min-h-0 lg:flex-1">
            <HeroPerson
              className="hero-person-fullscreen"
              isSubmitting={isSubmitting}
              nickname={nickname}
              user={user}
              onLoginSubmit={handleLogin}
              onNicknameChange={setNickname}
            />
          </section>
        )}
      </div>
    </main>
  );
}

export default App;
