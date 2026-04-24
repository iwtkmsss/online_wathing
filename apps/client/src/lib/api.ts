export const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export type UserDto = {
  id: string;
  nickname: string;
  totalWatchSeconds: number;
  createdAt: string;
  updatedAt: string;
};

export type MediaDto = {
  id: string;
  libraryKey: string;
  type: "FILM" | "SERIES" | "EPISODE";
  title: string;
  description: string | null;
  filePath: string | null;
  mimeType: string | null;
  sizeBytes: string | null;
  durationSeconds: number | null;
  isAvailable: boolean;
  seasonNumber: number | null;
  episodeNumber: number | null;
  parentId: string | null;
  children: MediaDto[];
};

export type PlaybackDto = {
  roomId: string;
  mediaId: string | null;
  currentTimeSeconds: number;
  isPlaying: boolean;
  playbackRate: number;
  serverNow: number;
};

export type RoomDto = {
  id: string;
  name: string;
  isPublic: boolean;
  hasPassword: boolean;
  creatorId: string;
  creator: {
    id: string;
    nickname: string;
  };
  mediaId: string | null;
  media: MediaDto | null;
  playback: PlaybackDto;
  createdAt: string;
  updatedAt: string;
};

type ApiOptions = Omit<RequestInit, "body"> & {
  body?: BodyInit | Record<string, unknown> | null;
};

const request = async <T>(path: string, options: ApiOptions = {}) => {
  const headers = new Headers(options.headers);
  let body = options.body;

  if (body && !(body instanceof FormData) && typeof body !== "string") {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(body);
  }

  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers,
    body
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(payload?.error ?? "Request failed");
  }

  return payload as T;
};

export const loginByNickname = (nickname: string) =>
  request<{ user: UserDto; created: boolean }>("/api/auth/nickname", {
    method: "POST",
    body: { nickname }
  });

export const fetchPublicRooms = () => request<{ rooms: RoomDto[] }>("/api/rooms/public");

export const fetchMediaLibrary = () => request<{ media: MediaDto[] }>("/api/media");

export const createRoom = (input: {
  name: string;
  creatorId: string;
  isPublic: boolean;
  password?: string;
  mediaId?: string;
}) =>
  request<{ room: RoomDto }>("/api/rooms", {
    method: "POST",
    body: input
  });
