import { apiUrl } from "./network";

export { apiUrl };

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
  lastStateAt: string | null;
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

export type FriendshipDto = {
  id: string;
  status: "PENDING" | "ACCEPTED" | "BLOCKED";
  requester: {
    id: string;
    nickname: string;
  };
  addressee: {
    id: string;
    nickname: string;
  };
  createdAt: string;
  updatedAt: string;
};

export type AcceptedFriendDto = FriendshipDto & {
  friend: {
    id: string;
    nickname: string;
  };
};

export type FriendshipsDto = {
  accepted: AcceptedFriendDto[];
  incoming: FriendshipDto[];
  outgoing: FriendshipDto[];
};

export type AdminCredentials = {
  username: string;
  password: string;
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

export const fetchRoom = (roomId: string) =>
  request<{ room: RoomDto }>(`/api/rooms/${encodeURIComponent(roomId)}`);

export const fetchMediaLibrary = () => request<{ media: MediaDto[] }>("/api/media");

export const streamMediaUrl = (mediaId: string) =>
  `${apiUrl}/api/media/${encodeURIComponent(mediaId)}/stream`;

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

export const deleteRoom = (input: { roomId: string; requesterId: string }) =>
  request<{ room: RoomDto }>(`/api/rooms/${encodeURIComponent(input.roomId)}`, {
    method: "DELETE",
    body: { requesterId: input.requesterId }
  });

export const fetchFriendships = (userId: string) =>
  request<FriendshipsDto>(`/api/friends/${encodeURIComponent(userId)}`);

export const sendFriendRequest = (input: { requesterId: string; targetNickname: string }) =>
  request<{ friendship: FriendshipDto; created: boolean; autoAccepted?: boolean }>(
    "/api/friends/request",
    {
      method: "POST",
      body: input
    }
  );

export const acceptFriendRequest = (input: { friendshipId: string; userId: string }) =>
  request<{ friendship: FriendshipDto; changed: boolean }>(
    `/api/friends/${encodeURIComponent(input.friendshipId)}/accept`,
    {
      method: "POST",
      body: { userId: input.userId }
    }
  );

export const rejectFriendRequest = (input: { friendshipId: string; userId: string }) =>
  request<{ ok: true }>(`/api/friends/${encodeURIComponent(input.friendshipId)}/reject`, {
    method: "POST",
    body: { userId: input.userId }
  });

const adminHeaders = (credentials: AdminCredentials, headers?: HeadersInit) => {
  const resolvedHeaders = new Headers(headers);
  resolvedHeaders.set(
    "Authorization",
    `Basic ${btoa(`${credentials.username}:${credentials.password}`)}`
  );
  return resolvedHeaders;
};

const adminRequest = <T>(
  path: string,
  credentials: AdminCredentials,
  options: ApiOptions = {}
) =>
  request<T>(path, {
    ...options,
    headers: adminHeaders(credentials, options.headers)
  });

export const fetchAdminMedia = (credentials: AdminCredentials) =>
  adminRequest<{ media: MediaDto[] }>("/api/admin/media", credentials);

export const scanAdminMedia = (credentials: AdminCredentials) =>
  adminRequest<{
    filmsFound: number;
    episodesFound: number;
    created: number;
    updated: number;
    missing: number;
  }>("/api/admin/media/scan", credentials, {
    method: "POST"
  });

export const createAdminSeries = (input: {
  credentials: AdminCredentials;
  title: string;
  description?: string;
}) =>
  adminRequest<{ media: MediaDto; created: boolean }>("/api/admin/media/series", input.credentials, {
    method: "POST",
    body: {
      title: input.title,
      description: input.description
    }
  });

export const uploadAdminMedia = (input: {
  credentials: AdminCredentials;
  file: File;
  type: "FILM" | "EPISODE";
  title: string;
  description?: string;
  seriesTitle?: string;
  seasonNumber?: number;
  episodeNumber?: number;
}) => {
  const formData = new FormData();
  formData.append("file", input.file);
  formData.append("type", input.type);
  formData.append("title", input.title);

  if (input.description) {
    formData.append("description", input.description);
  }

  if (input.seriesTitle) {
    formData.append("seriesTitle", input.seriesTitle);
  }

  if (input.seasonNumber !== undefined) {
    formData.append("seasonNumber", String(input.seasonNumber));
  }

  if (input.episodeNumber !== undefined) {
    formData.append("episodeNumber", String(input.episodeNumber));
  }

  return adminRequest<{ media: MediaDto; created: boolean }>(
    "/api/admin/media/upload",
    input.credentials,
    {
      method: "POST",
      body: formData
    }
  );
};

export const updateAdminMedia = (input: {
  credentials: AdminCredentials;
  mediaId: string;
  title?: string;
  description?: string;
  seasonNumber?: number;
  episodeNumber?: number;
}) =>
  adminRequest<{ media: MediaDto }>(
    `/api/admin/media/${encodeURIComponent(input.mediaId)}`,
    input.credentials,
    {
      method: "PATCH",
      body: {
        title: input.title,
        description: input.description,
        seasonNumber: input.seasonNumber,
        episodeNumber: input.episodeNumber
      }
    }
  );

export const deleteAdminMediaFile = (input: {
  credentials: AdminCredentials;
  mediaId: string;
}) =>
  adminRequest<{ media: MediaDto }>(
    `/api/admin/media/${encodeURIComponent(input.mediaId)}/file`,
    input.credentials,
    {
      method: "DELETE"
    }
  );
