import {
  ArrowLeft,
  Check,
  Clapperboard,
  Film,
  FolderSync,
  Loader2,
  Plus,
  RefreshCcw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  UploadCloud,
  X
} from "lucide-react";
import { type ChangeEvent, type DragEvent, type FormEvent, useMemo, useRef, useState } from "react";
import {
  createAdminSeries,
  deleteAdminMediaFile,
  fetchAdminMedia,
  scanAdminMedia,
  updateAdminMedia,
  uploadAdminMedia,
  type AdminCredentials,
  type MediaDto
} from "../lib/api";
import ToastNotice from "./ToastNotice";

const panelClass =
  "rounded-lg border border-white/10 bg-zinc-950/78 shadow-panel backdrop-blur-xl";
const fieldClass =
  "h-10 w-full rounded-md border border-white/10 bg-black/45 px-3 text-sm text-white outline-none transition placeholder:text-white/35 focus:border-toxic focus:shadow-neon";

type EditDraft = {
  title: string;
  description: string;
  seasonNumber: string;
  episodeNumber: string;
};

type UploadState = {
  file: File | null;
  type: "FILM" | "EPISODE";
  title: string;
  description: string;
  seriesTitle: string;
  seasonNumber: string;
  episodeNumber: string;
};

type AdminPanelProps = {
  onBack: () => void;
};

type ToastState = {
  id: number;
  message: string;
  tone: "success" | "info" | "error";
};

const defaultUploadState: UploadState = {
  file: null,
  type: "FILM",
  title: "",
  description: "",
  seriesTitle: "",
  seasonNumber: "1",
  episodeNumber: "1"
};

const normalizeSearch = (value: string) => value.trim().toLowerCase();

const buildDrafts = (media: MediaDto[]) => {
  const drafts: Record<string, EditDraft> = {};

  const visit = (item: MediaDto) => {
    drafts[item.id] = {
      title: item.title,
      description: item.description ?? "",
      seasonNumber: item.seasonNumber ? String(item.seasonNumber) : "",
      episodeNumber: item.episodeNumber ? String(item.episodeNumber) : ""
    };

    for (const child of item.children) {
      visit(child);
    }
  };

  for (const item of media) {
    visit(item);
  }

  return drafts;
};

const visibleAdminMedia = (media: MediaDto[]) =>
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
      item.type === "SERIES" ? item.isAvailable : item.isAvailable && Boolean(item.filePath)
    );

function AdminPanel({ onBack }: AdminPanelProps) {
  const [credentials, setCredentials] = useState<AdminCredentials>({
    username: "",
    password: ""
  });
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [toast, setToast] = useState<ToastState | null>(null);
  const [media, setMedia] = useState<MediaDto[]>([]);
  const [drafts, setDrafts] = useState<Record<string, EditDraft>>({});
  const [upload, setUpload] = useState<UploadState>(defaultUploadState);
  const [preferredSeriesTitle, setPreferredSeriesTitle] = useState("");
  const [isSeriesMenuOpen, setIsSeriesMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const visibleMedia = useMemo(() => visibleAdminMedia(media), [media]);
  const topLevelCount = visibleMedia.length;
  const seriesItems = useMemo(
    () => media.filter((item) => item.type === "SERIES" && item.isAvailable),
    [media]
  );
  const filteredSeriesItems = useMemo(() => {
    const query = normalizeSearch(upload.seriesTitle);
    const filtered = query
      ? seriesItems.filter((item) => normalizeSearch(item.title).includes(query))
      : seriesItems;

    return [...filtered].sort((left, right) => {
      const leftPreferred = left.title === preferredSeriesTitle ? 0 : 1;
      const rightPreferred = right.title === preferredSeriesTitle ? 0 : 1;

      if (leftPreferred !== rightPreferred) {
        return leftPreferred - rightPreferred;
      }

      return left.title.localeCompare(right.title);
    });
  }, [preferredSeriesTitle, seriesItems, upload.seriesTitle]);
  const fileCount = useMemo(
    () =>
      visibleMedia.reduce((total, item) => {
        if (item.type === "SERIES") {
          return total + item.children.length;
        }

        return total + 1;
      }, 0),
    [visibleMedia]
  );

  const showToast = (message: string, tone: ToastState["tone"] = "info") => {
    setToast({
      id: Date.now(),
      message,
      tone
    });
  };

  const loadAdminMedia = async (nextCredentials = credentials) => {
    setIsLoading(true);
    setMessage("");

    try {
      const response = await fetchAdminMedia(nextCredentials);
      setMedia(response.media);
      setDrafts(buildDrafts(response.media));
      setIsAuthorized(true);
    } catch (error) {
      setIsAuthorized(false);
      setMessage(error instanceof Error ? error.message : "Не вдалося завантажити адмін-дані.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleAuth = async (event: FormEvent) => {
    event.preventDefault();
    await loadAdminMedia(credentials);
  };

  const handleScan = async () => {
    setIsBusy(true);
    setMessage("");

    try {
      const result = await scanAdminMedia(credentials);
      await loadAdminMedia(credentials);
      showToast(
        `Сканування завершено: films ${result.filmsFound}, episodes ${result.episodesFound}, new ${result.created}, updated ${result.updated}, missing ${result.missing}.`,
        "success"
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Не вдалося просканувати директорії.", "error");
    } finally {
      setIsBusy(false);
    }
  };

  const handleUploadTypeChange = (type: UploadState["type"]) => {
    setUpload((current) => ({
      ...current,
      type
    }));

    if (type === "EPISODE") {
      setIsSeriesMenuOpen(false);
    }
  };

  const handleUploadFile = (file: File | null) => {
    setUpload((current) => ({
      ...current,
      file
    }));
  };

  const handleUploadDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    handleUploadFile(event.dataTransfer.files?.[0] ?? null);
  };

  const handleCreateSeries = async () => {
    const title = upload.seriesTitle.trim();

    if (!title) {
      showToast("Введіть назву серіалу.", "info");
      return;
    }

    setIsBusy(true);
    setMessage("");

    try {
      const response = await createAdminSeries({
        credentials,
        title,
        description: upload.description.trim() || undefined
      });
      setPreferredSeriesTitle(response.media.title);
      setUpload((current) => ({
        ...current,
        type: "EPISODE",
        seriesTitle: response.media.title,
        description: ""
      }));
      setIsSeriesMenuOpen(false);
      await loadAdminMedia(credentials);
      showToast(response.created ? "Серіал створено." : "Серіал вже існує, вибір оновлено.", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Не вдалося створити серіал.", "error");
    } finally {
      setIsBusy(false);
    }
  };

  const handleUpload = async (event: FormEvent) => {
    event.preventDefault();

    if (!upload.file) {
      showToast("Оберіть файл для завантаження.", "info");
      return;
    }

    const selectedFile = upload.file;
    setIsBusy(true);
    setMessage("");
    const currentUpload = upload;

    try {
      await uploadAdminMedia({
        credentials,
        file: selectedFile,
        type: currentUpload.type,
        title: currentUpload.title,
        description: currentUpload.description || undefined,
        seriesTitle: currentUpload.seriesTitle || undefined,
        seasonNumber: currentUpload.seasonNumber ? Number(currentUpload.seasonNumber) : undefined,
        episodeNumber: currentUpload.episodeNumber ? Number(currentUpload.episodeNumber) : undefined
      });
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      setUpload({
        ...defaultUploadState,
        type: currentUpload.type,
        seriesTitle: currentUpload.type === "EPISODE" ? currentUpload.seriesTitle : "",
        seasonNumber: currentUpload.type === "EPISODE" ? currentUpload.seasonNumber || "1" : "1",
        episodeNumber:
          currentUpload.type === "EPISODE"
            ? String((Number(currentUpload.episodeNumber) || 1) + 1)
            : "1"
      });
      if (currentUpload.type === "EPISODE") {
        setPreferredSeriesTitle(currentUpload.seriesTitle);
      }
      setIsSeriesMenuOpen(false);
      await loadAdminMedia(credentials);
      showToast("Файл завантажено.", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Не вдалося завантажити файл.", "error");
    } finally {
      setIsBusy(false);
    }
  };

  const handleSaveMedia = async (item: MediaDto) => {
    const draft = drafts[item.id];

    if (!draft) {
      return;
    }

    setIsBusy(true);
    setMessage("");

    try {
      await updateAdminMedia({
        credentials,
        mediaId: item.id,
        title: draft.title.trim(),
        description: draft.description.trim() || undefined,
        seasonNumber: draft.seasonNumber ? Number(draft.seasonNumber) : undefined,
        episodeNumber: draft.episodeNumber ? Number(draft.episodeNumber) : undefined
      });
      await loadAdminMedia(credentials);
      showToast("Медіа оновлено.", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Не вдалося оновити медіа.", "error");
    } finally {
      setIsBusy(false);
    }
  };

  const handleDeleteFile = async (item: MediaDto) => {
    setIsBusy(true);
    setMessage("");

    try {
      await deleteAdminMediaFile({
        credentials,
        mediaId: item.id
      });
      await loadAdminMedia(credentials);
      showToast("Контент прибрано зі списку. Запис та статистика залишились.", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Не вдалося видалити файл.", "error");
    } finally {
      setIsBusy(false);
    }
  };

  const updateDraft = (mediaId: string, key: keyof EditDraft, value: string) => {
    setDrafts((current) => ({
      ...current,
      [mediaId]: {
        ...(current[mediaId] ?? {
          title: "",
          description: "",
          seasonNumber: "",
          episodeNumber: ""
        }),
        [key]: value
      }
    }));
  };

  if (!isAuthorized) {
    return (
      <section className="grid flex-1 place-items-center py-6">
        <form className={`${panelClass} w-full max-w-md p-5`} onSubmit={handleAuth}>
          <button
            className="mb-4 inline-flex h-10 items-center justify-center gap-2 rounded-md border border-white/10 px-3 text-sm font-semibold text-white/75 transition hover:border-toxic hover:text-toxic"
            type="button"
            onClick={onBack}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Назад
          </button>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-toxic">admin</p>
          <h2 className="mt-1 text-2xl font-black">Доступ до панелі</h2>
          <p className="mt-2 text-sm text-white/58">
            Використай логін та пароль з `.env` сервера (`ADMIN_USERNAME`, `ADMIN_PASSWORD`).
          </p>
          <div className="mt-4 space-y-3">
            <input
              className={fieldClass}
              placeholder="Username"
              value={credentials.username}
              onChange={(event) =>
                setCredentials((current) => ({ ...current, username: event.target.value }))
              }
            />
            <input
              className={fieldClass}
              placeholder="Password"
              type="password"
              value={credentials.password}
              onChange={(event) =>
                setCredentials((current) => ({ ...current, password: event.target.value }))
              }
            />
            <button
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-toxic px-4 text-sm font-bold text-black transition hover:shadow-neon disabled:opacity-60"
              disabled={isLoading || !credentials.username.trim() || !credentials.password}
              type="submit"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              )}
              Увійти
            </button>
          </div>
          {message ? (
            <div className="mt-3 rounded-md border border-plasma/35 bg-plasma/10 px-3 py-2 text-sm text-white/82">
              {message}
            </div>
          ) : null}
        </form>
      </section>
    );
  }

  return (
    <>
      {toast ? (
        <ToastNotice
          key={toast.id}
          message={toast.message}
          tone={toast.tone}
          onClose={() => setToast(null)}
        />
      ) : null}

    <section className="grid flex-1 gap-4 py-4 xl:grid-cols-[360px_minmax(0,1fr)]">
      <aside className="flex min-w-0 flex-col gap-4">
        <section className={`${panelClass} p-4`}>
          <button
            className="mb-4 inline-flex h-10 items-center justify-center gap-2 rounded-md border border-white/10 px-3 text-sm font-semibold text-white/75 transition hover:border-toxic hover:text-toxic"
            type="button"
            onClick={onBack}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Назад
          </button>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-toxic">admin</p>
          <h2 className="mt-1 text-2xl font-black">Керування медіатекою</h2>
          <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-md border border-white/10 bg-black/35 p-3">
              <p className="text-white/45">Top level</p>
              <p className="mt-1 text-xl font-black">{topLevelCount}</p>
            </div>
            <div className="rounded-md border border-white/10 bg-black/35 p-3">
              <p className="text-white/45">Playable</p>
              <p className="mt-1 text-xl font-black">{fileCount}</p>
            </div>
          </div>
          <button
            className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-toxic/70 bg-toxic/10 px-4 text-sm font-bold text-toxic transition hover:bg-toxic hover:text-black hover:shadow-neon disabled:opacity-55"
            disabled={isBusy || isLoading}
            type="button"
            onClick={() => void handleScan()}
          >
            {isBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <FolderSync className="h-4 w-4" aria-hidden="true" />
            )}
            Просканувати директорії
          </button>
        </section>

        <section className={`${panelClass} p-4`}>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-plasma">upload</p>
          <h3 className="mt-1 text-xl font-bold">Додати контент</h3>
          <form className="mt-4 space-y-3" onSubmit={handleUpload}>
            <div className="grid grid-cols-2 gap-2">
              <button
                className={`inline-flex h-10 items-center justify-center gap-2 rounded-md border px-3 text-sm font-bold transition ${
                  upload.type === "FILM"
                    ? "border-toxic bg-toxic text-black shadow-neon"
                    : "border-white/10 text-white/72 hover:border-toxic hover:text-toxic"
                }`}
                type="button"
                onClick={() => handleUploadTypeChange("FILM")}
              >
                <Film className="h-4 w-4" aria-hidden="true" />
                Фільм
              </button>
              <button
                className={`inline-flex h-10 items-center justify-center gap-2 rounded-md border px-3 text-sm font-bold transition ${
                  upload.type === "EPISODE"
                    ? "border-toxic bg-toxic text-black shadow-neon"
                    : "border-white/10 text-white/72 hover:border-toxic hover:text-toxic"
                }`}
                type="button"
                onClick={() => handleUploadTypeChange("EPISODE")}
              >
                <Clapperboard className="h-4 w-4" aria-hidden="true" />
                Серія
              </button>
            </div>

            <label
              className="group flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-white/15 bg-black/35 px-3 py-4 text-center transition hover:border-toxic hover:bg-toxic/5"
              onDragOver={(event) => event.preventDefault()}
              onDrop={handleUploadDrop}
            >
              <UploadCloud className="h-6 w-6 text-toxic transition group-hover:scale-110" aria-hidden="true" />
              <span className="mt-2 text-sm font-semibold text-white/82">
                {upload.file ? upload.file.name : "Обери файл або перетягни сюди"}
              </span>
              <span className="mt-1 text-xs text-white/45">mp4, mkv, webm та інші відеоформати</span>
              <input
                className="sr-only"
                ref={fileInputRef}
                type="file"
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  handleUploadFile(event.target.files?.[0] ?? null)
                }
              />
            </label>

            {upload.type === "EPISODE" ? (
              <div className="rounded-md border border-white/10 bg-black/30 p-3">
                <label className="relative block">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/38" />
                  <input
                    className={`${fieldClass} pl-10 pr-10`}
                    placeholder={
                      seriesItems.length
                        ? "Пошук серіалу або назва нового"
                        : "Серіалів ще немає, введи назву"
                    }
                    value={upload.seriesTitle}
                    onFocus={() => setIsSeriesMenuOpen(true)}
                    onChange={(event) =>
                      setUpload((current) => ({ ...current, seriesTitle: event.target.value }))
                    }
                  />
                  {upload.seriesTitle ? (
                    <button
                      className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md border border-white/10 text-white/55 transition hover:border-toxic hover:text-toxic"
                      type="button"
                      onClick={() => {
                        setUpload((current) => ({ ...current, seriesTitle: "" }));
                        setIsSeriesMenuOpen(true);
                      }}
                      title="Очистити"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  ) : null}
                </label>
                {isSeriesMenuOpen ? (
                  <div className="mt-2">
                    <div className="max-h-[156px] space-y-2 overflow-y-auto pr-1">
                      {filteredSeriesItems.length ? (
                        filteredSeriesItems.map((item) => (
                          <button
                            className={`inline-flex min-h-10 w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm transition ${
                              item.title === upload.seriesTitle
                                ? "border-toxic bg-toxic/10 text-toxic"
                                : "border-white/10 bg-black/35 text-white/76 hover:border-toxic hover:text-toxic"
                            }`}
                            key={item.id}
                            type="button"
                            onClick={() => {
                              setPreferredSeriesTitle(item.title);
                              setUpload((current) => ({ ...current, seriesTitle: item.title }));
                              setIsSeriesMenuOpen(false);
                            }}
                          >
                            <span className="min-w-0 truncate">{item.title}</span>
                            {item.title === upload.seriesTitle ? (
                              <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
                            ) : (
                              <span className="shrink-0 text-xs text-white/38">{item.children.length} серій</span>
                            )}
                          </button>
                        ))
                      ) : (
                        <p className="rounded-md border border-white/10 bg-black/35 px-3 py-2 text-xs text-white/52">
                          Збігів немає.
                        </p>
                      )}
                    </div>

                    <button
                      className="mt-2 inline-flex min-h-10 w-full items-center justify-between gap-3 rounded-md border border-toxic/45 bg-toxic/10 px-3 py-2 text-left text-sm font-semibold text-toxic transition hover:bg-toxic hover:text-black disabled:cursor-not-allowed disabled:opacity-55"
                      disabled={isBusy || !upload.seriesTitle.trim()}
                      type="button"
                      onClick={() => void handleCreateSeries()}
                    >
                      <span className="min-w-0 truncate">
                        Створити новий серіал
                        {upload.seriesTitle.trim() ? `: ${upload.seriesTitle.trim()}` : ""}
                      </span>
                      <Plus className="h-4 w-4 shrink-0" aria-hidden="true" />
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}

            <input
              className={fieldClass}
              placeholder={upload.type === "EPISODE" ? "Назва серії" : "Назва фільму"}
              value={upload.title}
              onChange={(event) =>
                setUpload((current) => ({ ...current, title: event.target.value }))
              }
            />
            <input
              className={fieldClass}
              placeholder="Опис за бажанням"
              value={upload.description}
              onChange={(event) =>
                setUpload((current) => ({ ...current, description: event.target.value }))
              }
            />
            {upload.type === "EPISODE" ? (
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-white/45">
                    Сезон
                  </span>
                  <input
                    className={fieldClass}
                    min={1}
                    type="number"
                    value={upload.seasonNumber}
                    onChange={(event) =>
                      setUpload((current) => ({ ...current, seasonNumber: event.target.value }))
                    }
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-white/45">
                    Номер серії
                  </span>
                  <input
                    className={fieldClass}
                    min={1}
                    type="number"
                    value={upload.episodeNumber}
                    onChange={(event) =>
                      setUpload((current) => ({ ...current, episodeNumber: event.target.value }))
                    }
                  />
                </label>
              </div>
            ) : null}
            <button
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-toxic px-4 text-sm font-bold text-black transition hover:shadow-neon disabled:opacity-60"
              disabled={
                isBusy ||
                isLoading ||
                !upload.file ||
                !upload.title.trim() ||
                (upload.type === "EPISODE" && !upload.seriesTitle.trim())
              }
              type="submit"
            >
              {isBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <UploadCloud className="h-4 w-4" aria-hidden="true" />
              )}
              Завантажити
            </button>
          </form>
        </section>
      </aside>

      <section className={`${panelClass} p-4`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-toxic">library</p>
            <h3 className="mt-1 text-xl font-bold">Контент</h3>
          </div>
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-white/10 px-3 text-sm font-semibold text-white/75 transition hover:border-toxic hover:text-toxic"
            disabled={isLoading}
            type="button"
            onClick={() => void loadAdminMedia()}
          >
            <RefreshCcw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} aria-hidden="true" />
            Оновити
          </button>
        </div>

        {message ? (
          <div className="mt-3 rounded-md border border-toxic/30 bg-toxic/10 px-3 py-2 text-sm text-white/82">
            {message}
          </div>
        ) : null}

        <div className="mt-4 space-y-4">
          {visibleMedia.length ? (
            visibleMedia.map((item) => (
              <article
                className="rounded-md border border-white/10 bg-black/35 p-3"
                key={item.id}
              >
                <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto_auto]">
                  <input
                    className={fieldClass}
                    value={drafts[item.id]?.title ?? ""}
                    onChange={(event) => updateDraft(item.id, "title", event.target.value)}
                  />
                  <input
                    className={fieldClass}
                    value={drafts[item.id]?.description ?? ""}
                    onChange={(event) =>
                      updateDraft(item.id, "description", event.target.value)
                    }
                  />
                  <button
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-toxic/70 px-3 text-sm font-semibold text-toxic transition hover:bg-toxic hover:text-black disabled:opacity-55"
                    disabled={isBusy}
                    type="button"
                    onClick={() => void handleSaveMedia(item)}
                  >
                    <Save className="h-4 w-4" aria-hidden="true" />
                  </button>
                  {(item.type === "SERIES" || item.filePath) ? (
                    <button
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-white/20 px-3 text-sm font-semibold text-white/70 transition hover:border-plasma hover:text-plasma disabled:opacity-55"
                      disabled={isBusy}
                      type="button"
                      onClick={() => void handleDeleteFile(item)}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  ) : null}
                </div>

                {item.type === "SERIES" && item.children.length ? (
                  <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
                    {item.children.map((episode) => (
                      <div
                        className="grid gap-2 md:grid-cols-[1fr_1fr_90px_90px_auto_auto]"
                        key={episode.id}
                      >
                        <input
                          className={fieldClass}
                          value={drafts[episode.id]?.title ?? ""}
                          onChange={(event) =>
                            updateDraft(episode.id, "title", event.target.value)
                          }
                        />
                        <input
                          className={fieldClass}
                          value={drafts[episode.id]?.description ?? ""}
                          onChange={(event) =>
                            updateDraft(episode.id, "description", event.target.value)
                          }
                        />
                        <input
                          className={fieldClass}
                          min={1}
                          type="number"
                          value={drafts[episode.id]?.seasonNumber ?? ""}
                          onChange={(event) =>
                            updateDraft(episode.id, "seasonNumber", event.target.value)
                          }
                        />
                        <input
                          className={fieldClass}
                          min={1}
                          type="number"
                          value={drafts[episode.id]?.episodeNumber ?? ""}
                          onChange={(event) =>
                            updateDraft(episode.id, "episodeNumber", event.target.value)
                          }
                        />
                        <button
                          className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-toxic/70 px-3 text-sm font-semibold text-toxic transition hover:bg-toxic hover:text-black disabled:opacity-55"
                          disabled={isBusy}
                          type="button"
                          onClick={() => void handleSaveMedia(episode)}
                        >
                          <Save className="h-4 w-4" aria-hidden="true" />
                        </button>
                        {episode.filePath ? (
                          <button
                            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-white/20 px-3 text-sm font-semibold text-white/70 transition hover:border-plasma hover:text-plasma disabled:opacity-55"
                            disabled={isBusy}
                            type="button"
                            onClick={() => void handleDeleteFile(episode)}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </article>
            ))
          ) : (
            <p className="rounded-md border border-white/10 bg-black/35 px-3 py-3 text-sm text-white/58">
              Активного контенту поки немає.
            </p>
          )}
        </div>
      </section>
    </section>
    </>
  );
}

export default AdminPanel;
