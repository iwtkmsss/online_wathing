import type { Media } from "../generated/prisma/client.js";

export type MediaWithChildren = Media & {
  children?: MediaWithChildren[];
};

export type MediaDto = {
  id: string;
  libraryKey: string;
  type: Media["type"];
  title: string;
  description: string | null;
  filePath: string | null;
  mimeType: string | null;
  sizeBytes: string | null;
  durationSeconds: number | null;
  isAvailable: boolean;
  missingSince: Date | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  parentId: string | null;
  createdAt: Date;
  updatedAt: Date;
  children: MediaDto[];
};

export const mediaDto = (media: MediaWithChildren): MediaDto => ({
  id: media.id,
  libraryKey: media.libraryKey,
  type: media.type,
  title: media.title,
  description: media.description,
  filePath: media.filePath,
  mimeType: media.mimeType,
  sizeBytes: media.sizeBytes?.toString() ?? null,
  durationSeconds: media.durationSeconds,
  isAvailable: media.isAvailable,
  missingSince: media.missingSince,
  seasonNumber: media.seasonNumber,
  episodeNumber: media.episodeNumber,
  parentId: media.parentId,
  createdAt: media.createdAt,
  updatedAt: media.updatedAt,
  children: media.children?.map((child) => mediaDto(child)) ?? []
});
