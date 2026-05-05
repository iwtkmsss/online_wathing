import {
  Check,
  Loader2,
  RefreshCcw,
  SendHorizontal,
  UserPlus,
  Users,
  X
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  acceptFriendRequest,
  fetchFriendships,
  rejectFriendRequest,
  sendFriendRequest,
  type AcceptedFriendDto,
  type FriendshipDto,
  type UserDto
} from "../lib/api";
import { socket } from "../lib/socket";
import ToastNotice from "./ToastNotice";

const panelClass =
  "rounded-lg border border-white/10 bg-zinc-950/78 shadow-panel backdrop-blur-xl";
const fieldClass =
  "h-10 w-full rounded-md border border-white/10 bg-black/45 px-3 text-sm text-white outline-none transition placeholder:text-white/35 focus:border-toxic focus:shadow-neon";

type SocialPanelProps = {
  user: UserDto;
  onlineUserIds: string[];
  activeRoomId: string | null;
  activeRoomName: string | null;
  isSocketConnected: boolean;
};

type ToastState = {
  id: number;
  message: string;
  tone: "success" | "info" | "error";
};

const emitInvite = (payload: { toUserId: string; roomId: string }) =>
  new Promise<{ delivered: number }>((resolve, reject) => {
    socket.emit(
      "friend:invite",
      payload,
      (response: { ok: true; delivered: number } | { ok: false; error: string }) => {
        if (!response || response.ok !== true) {
          reject(new Error(response?.error ?? "Invite failed"));
          return;
        }

        resolve({ delivered: response.delivered });
      }
    );
  });

function SocialPanel({
  user,
  onlineUserIds,
  activeRoomId,
  activeRoomName,
  isSocketConnected
}: SocialPanelProps) {
  const [accepted, setAccepted] = useState<AcceptedFriendDto[]>([]);
  const [incoming, setIncoming] = useState<FriendshipDto[]>([]);
  const [outgoing, setOutgoing] = useState<FriendshipDto[]>([]);
  const [nickname, setNickname] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  const onlineSet = useMemo(() => new Set(onlineUserIds), [onlineUserIds]);

  const showToast = (message: string, tone: ToastState["tone"] = "info") => {
    setToast({
      id: Date.now(),
      message,
      tone
    });
  };

  const loadFriends = async () => {
    setIsLoading(true);

    try {
      const response = await fetchFriendships(user.id);
      setAccepted(response.accepted);
      setIncoming(response.incoming);
      setOutgoing(response.outgoing);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Не вдалося завантажити друзів.", "error");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadFriends();
    }, 0);

    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);

  const handleRequest = async (event: FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);

    try {
      const response = await sendFriendRequest({
        requesterId: user.id,
        targetNickname: nickname
      });
      setNickname("");
      showToast(
        response.autoAccepted
          ? "Запит прийнято автоматично."
          : response.created
            ? "Запит у друзі відправлено."
            : "Цей контакт уже є у списку.",
        response.created || response.autoAccepted ? "success" : "info"
      );
      await loadFriends();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Не вдалося відправити запит.", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAccept = async (friendshipId: string) => {
    setIsSubmitting(true);

    try {
      await acceptFriendRequest({
        friendshipId,
        userId: user.id
      });
      showToast("Запит прийнято.", "success");
      await loadFriends();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Не вдалося прийняти запит.", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReject = async (friendshipId: string) => {
    setIsSubmitting(true);

    try {
      await rejectFriendRequest({
        friendshipId,
        userId: user.id
      });
      showToast("Запит відхилено.", "info");
      await loadFriends();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Не вдалося відхилити запит.", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleInvite = async (friendUserId: string) => {
    if (!activeRoomId) {
      showToast("Інвайти доступні лише коли ти вже в кімнаті.", "info");
      return;
    }

    if (!isSocketConnected) {
      showToast("Socket ще підключається, спробуй за секунду.", "info");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await emitInvite({
        toUserId: friendUserId,
        roomId: activeRoomId
      });
      showToast(
        response.delivered > 0
          ? `Інвайт відправлено (${response.delivered}).`
          : "Інвайт відправлено, друг зараз офлайн.",
        "success"
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Не вдалося запросити друга.", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className={`${panelClass} p-4`}>
      {toast ? (
        <ToastNotice
          key={toast.id}
          message={toast.message}
          tone={toast.tone}
          onClose={() => setToast(null)}
        />
      ) : null}
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-plasma">social</p>
          <h3 className="mt-1 text-xl font-bold">Додати друга</h3>
        </div>
        <button
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-white/10 px-3 text-sm font-semibold text-white/75 transition hover:border-toxic hover:text-toxic"
          type="button"
          onClick={() => void loadFriends()}
        >
          <RefreshCcw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} aria-hidden="true" />
          Оновити
        </button>
      </div>

      <form className="mt-4 flex gap-2" onSubmit={handleRequest}>
        <input
          className={fieldClass}
          placeholder="Нік друга"
          value={nickname}
          onChange={(event) => setNickname(event.target.value)}
        />
        <button
          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md bg-toxic px-3 text-sm font-bold text-black transition hover:shadow-neon disabled:opacity-60"
          disabled={isSubmitting || !nickname.trim()}
          type="submit"
        >
          {isSubmitting ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <UserPlus className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </form>

      {activeRoomId ? (
        <p className="mt-3 text-xs text-white/50">
          Інвайти доступні для кімнати: <span className="text-white/75">{activeRoomName ?? activeRoomId}</span>
        </p>
      ) : (
        <p className="mt-3 text-xs text-white/50">Щоб запрошувати, спочатку зайди в кімнату.</p>
      )}

      <div className="mt-4 space-y-3">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-toxic">Друзі</p>
          <div className="space-y-2">
            {accepted.length ? (
              accepted.map((friendship) => {
                const isOnline = onlineSet.has(friendship.friend.id);

                return (
                  <div
                    className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-black/35 px-3 py-2"
                    key={friendship.id}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{friendship.friend.nickname}</p>
                      <p className="text-xs text-white/50">
                        {isOnline ? "online" : "offline"}
                      </p>
                    </div>
                    {activeRoomId ? (
                      <button
                        className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-toxic/70 px-2 text-xs font-semibold text-toxic transition hover:bg-toxic hover:text-black disabled:opacity-55"
                        disabled={isSubmitting}
                        type="button"
                        onClick={() => void handleInvite(friendship.friend.id)}
                      >
                        <SendHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                        Запросити
                      </button>
                    ) : null}
                  </div>
                );
              })
            ) : (
              <p className="rounded-md border border-white/10 bg-black/35 px-3 py-2 text-sm text-white/58">
                Поки немає друзів.
              </p>
            )}
          </div>
        </div>

        {incoming.length ? (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-plasma">Вхідні</p>
            <div className="space-y-2">
              {incoming.map((friendship) => (
                <div
                  className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-black/35 px-3 py-2"
                  key={friendship.id}
                >
                  <span className="truncate text-sm">{friendship.requester.nickname}</span>
                  <div className="flex gap-2">
                    <button
                      className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-toxic/70 px-2 text-xs font-semibold text-toxic transition hover:bg-toxic hover:text-black disabled:opacity-55"
                      disabled={isSubmitting}
                      type="button"
                      onClick={() => void handleAccept(friendship.id)}
                    >
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      Прийняти
                    </button>
                    <button
                      className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-white/20 px-2 text-xs font-semibold text-white/70 transition hover:border-plasma hover:text-plasma disabled:opacity-55"
                      disabled={isSubmitting}
                      type="button"
                      onClick={() => void handleReject(friendship.id)}
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                      Відхилити
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {outgoing.length ? (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-white/55">Вихідні</p>
            <div className="space-y-2">
              {outgoing.map((friendship) => (
                <div
                  className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-black/35 px-3 py-2"
                  key={friendship.id}
                >
                  <span className="truncate text-sm">{friendship.addressee.nickname}</span>
                  <Users className="h-4 w-4 text-white/35" aria-hidden="true" />
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export default SocialPanel;
