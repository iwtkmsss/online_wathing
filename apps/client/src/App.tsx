import {
  Clapperboard,
  DoorOpen,
  Film,
  Library,
  Loader2,
  Lock,
  LogIn,
  LogOut,
  Play,
  Plus,
  Radio,
  RefreshCcw,
  Search,
  Sparkles,
  Users,
  Wifi
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  createRoom,
  fetchMediaLibrary,
  fetchPublicRooms,
  loginByNickname,
  type MediaDto,
  type RoomDto
} from "./lib/api";
import { useSessionStore } from "./store/sessionStore";

const brandPhoto = "/brand/darinka-face.jpg";

const panelClass =
  "rounded-lg border border-white/10 bg-zinc-950/78 shadow-panel backdrop-blur-xl";
const fieldClass =
  "h-11 w-full rounded-md border border-white/10 bg-black/45 px-3 text-sm text-white outline-none transition placeholder:text-white/35 focus:border-toxic focus:shadow-neon";

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

function App() {
  const { nickname, user, setNickname, setUser, reset } = useSessionStore();
  const [rooms, setRooms] = useState<RoomDto[]>([]);
  const [media, setMedia] = useState<MediaDto[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [roomName, setRoomName] = useState("Darinka watch party");
  const [selectedMediaId, setSelectedMediaId] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  const playableMedia = useMemo(() => flattenPlayableMedia(media), [media]);
  const selectedRoom = rooms.find((room) => room.id === selectedRoomId) ?? rooms[0] ?? null;
  const filteredMedia = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) {
      return media;
    }

    return media.filter((item) => {
      const selfMatches = item.title.toLowerCase().includes(query);
      const childMatches = item.children.some((child) => child.title.toLowerCase().includes(query));
      return selfMatches || childMatches;
    });
  }, [media, search]);

  const loadDashboard = async () => {
    setIsLoading(true);
    setMessage("");

    try {
      const [roomsResponse, mediaResponse] = await Promise.all([
        fetchPublicRooms(),
        fetchMediaLibrary()
      ]);
      setRooms(roomsResponse.rooms);
      setMedia(mediaResponse.media);
      setSelectedRoomId((current) => current ?? roomsResponse.rooms[0]?.id ?? null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не вдалося оновити головну.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadDashboard();
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage("");

    try {
      const response = await loginByNickname(nickname);
      setUser(response.user);
      setMessage(response.created ? "Профіль створено." : "Профіль відкрито.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не вдалося увійти.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateRoom = async (event: FormEvent) => {
    event.preventDefault();

    if (!user) {
      setMessage("Увійди з нікнеймом, щоб створити кімнату.");
      return;
    }

    setIsSubmitting(true);
    setMessage("");

    try {
      const response = await createRoom({
        name: roomName,
        creatorId: user.id,
        isPublic: !isPrivate,
        password: isPrivate ? password : undefined,
        mediaId: selectedMediaId || undefined
      });
      setRooms((current) => [response.room, ...current.filter((room) => room.id !== response.room.id)]);
      setSelectedRoomId(response.room.id);
      setMessage("Кімнату створено.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не вдалося створити кімнату.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen overflow-hidden bg-void text-white">
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(rgba(57,255,20,0.055)_1px,transparent_1px),linear-gradient(90deg,rgba(155,92,255,0.045)_1px,transparent_1px)] bg-[size:42px_42px]" />
      <div className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-4 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-white/10 pb-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div className="grid h-12 w-12 place-items-center rounded-lg border border-toxic/45 bg-toxic/10 shadow-neon">
              <Sparkles className="h-6 w-6 text-toxic" aria-hidden="true" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-toxic">
                MarlineLabs
              </p>
              <h1 className="text-3xl font-black text-white sm:text-4xl">Darinka’s Edition</h1>
            </div>
          </div>

          <form className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto" onSubmit={handleLogin}>
            <input
              className={`${fieldClass} sm:w-64`}
              placeholder="Нікнейм"
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
            />
            <button
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-toxic px-4 text-sm font-bold text-black transition hover:shadow-neon disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSubmitting || !nickname.trim()}
              type="submit"
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <LogIn className="h-4 w-4" aria-hidden="true" />
              )}
              Увійти
            </button>
            {user ? (
              <button
                className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-white/10 px-4 text-sm font-semibold text-white/80 transition hover:border-plasma hover:text-white"
                type="button"
                onClick={reset}
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                Вийти
              </button>
            ) : null}
          </form>
        </header>

        <section className="grid flex-1 gap-4 py-4 lg:grid-cols-[340px_minmax(0,1fr)]">
          <aside className="flex flex-col gap-4">
            <div className={`${panelClass} overflow-hidden`}>
              <div className="relative h-72 overflow-hidden border-b border-white/10 bg-black sm:h-80 lg:h-72">
                <img
                  className="h-full w-full scale-[1.34] object-cover object-[56%_38%]"
                  src={brandPhoto}
                  alt="Обличчя компанії MarlineLabs"
                />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/60 to-transparent p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-toxic">
                    company face
                  </p>
                  <p className="mt-1 text-xl font-black">Darinka</p>
                </div>
              </div>
              <div className="p-4">
                <p className="text-sm leading-6 text-white/68">
                  Darinka’s Edition від MarlineLabs. Локальна медіатека, приватні кімнати,
                  синхронний перегляд і зелений неон без зайвого шуму.
                </p>
              </div>
            </div>

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
                  placeholder="Назва кімнати"
                  value={roomName}
                  onChange={(event) => setRoomName(event.target.value)}
                />
                <select
                  className={fieldClass}
                  value={selectedMediaId}
                  onChange={(event) => setSelectedMediaId(event.target.value)}
                >
                  <option value="">Медіа оберемо пізніше</option>
                  {playableMedia.map((item) => (
                    <option key={item.id} value={item.id}>
                      {mediaLabel(item)}
                    </option>
                  ))}
                </select>
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
          </aside>

          <div className="flex min-w-0 flex-col gap-4">
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
                <p className="mt-4 text-3xl font-black">{user ? user.nickname : "guest"}</p>
                <p className="mt-1 text-sm text-white/60">поточний профіль</p>
              </div>
            </div>

            {message ? (
              <div className="rounded-lg border border-toxic/30 bg-toxic/10 px-4 py-3 text-sm text-white/82">
                {message}
              </div>
            ) : null}

            <section className={`${panelClass} p-4`}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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

              <div className="mt-4 grid gap-3 xl:grid-cols-2">
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
            </section>

            <section className={`${panelClass} p-4`}>
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

              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
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
        </section>
      </div>
    </main>
  );
}

export default App;
