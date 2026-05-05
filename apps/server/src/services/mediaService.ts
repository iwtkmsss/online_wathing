import { mkdir, rename, stat, copyFile, unlink } from "node:fs/promises";
import { basename, dirname, extname, join, relative, sep } from "node:path";
import { MediaType } from "../generated/prisma/enums.js";
import type { Media } from "../generated/prisma/client.js";
import { config } from "../config.js";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../utils/http.js";
import {
  ensureMediaDirectories,
  fileSize,
  inferMimeType,
  isVideoFile,
  pathExists,
  removeFileIfExists,
  resolveMediaPath,
  sanitizePathSegment,
  titleFromFilename,
  toMediaRelativePath,
  uniqueDestinationPath,
  walkFiles
} from "../utils/mediaPaths.js";

type ScanStats = {
  filmsFound: number;
  episodesFound: number;
  created: number;
  updated: number;
  missing: number;
};

type UpsertResult = {
  media: Media;
  created: boolean;
};

type UploadInput = {
  type: "FILM" | "EPISODE";
  title: string;
  description?: string;
  seriesTitle?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  file: Express.Multer.File;
};

const normalizeLibraryPart = (value: string) =>
  value.trim().toLowerCase().replace(/\\/g, "/").replace(/\s+/g, " ");

const fileLibraryKey = (mediaRelativePath: string) =>
  `file:${normalizeLibraryPart(mediaRelativePath)}`;

const seriesLibraryKey = (title: string) => `series:${normalizeLibraryPart(title)}`;

const moveFile = async (from: string, to: string) => {
  await mkdir(dirname(to), { recursive: true });

  try {
    await rename(from, to);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "EXDEV") {
      await copyFile(from, to);
      await unlink(from);
      return;
    }

    throw error;
  }
};

const upsertMedia = async (data: {
  libraryKey: string;
  type: "FILM" | "EPISODE" | "SERIES";
  title: string;
  description?: string;
  filePath?: string;
  mimeType?: string;
  sizeBytes?: bigint;
  parentId?: string;
  seasonNumber?: number;
  episodeNumber?: number;
}) => {
  const existing = await prisma.media.findUnique({ where: { libraryKey: data.libraryKey } });
  const commonData = {
    type: data.type,
    title: data.title,
    description: data.description,
    filePath: data.filePath,
    mimeType: data.mimeType,
    sizeBytes: data.sizeBytes,
    parentId: data.parentId,
    seasonNumber: data.seasonNumber,
    episodeNumber: data.episodeNumber,
    isAvailable: data.type === MediaType.SERIES || Boolean(data.filePath),
    missingSince: null
  };

  if (existing) {
    const media = await prisma.media.update({
      where: { id: existing.id },
      data: commonData
    });

    return { media, created: false } satisfies UpsertResult;
  }

  const media = await prisma.media.create({
    data: {
      libraryKey: data.libraryKey,
      ...commonData
    }
  });

  return { media, created: true } satisfies UpsertResult;
};

export const upsertSeries = async (title: string, description?: string) => {
  const libraryKey = seriesLibraryKey(title);
  const existing = await prisma.media.findUnique({ where: { libraryKey } });

  if (existing) {
    const media = await prisma.media.update({
      where: { id: existing.id },
      data: {
        type: MediaType.SERIES,
        title,
        ...(description !== undefined ? { description } : {}),
        isAvailable: true,
        missingSince: null
      }
    });

    return { media, created: false } satisfies UpsertResult;
  }

  const media = await prisma.media.create({
    data: {
      libraryKey,
      type: MediaType.SERIES,
      title,
      description,
      isAvailable: true
    }
  });

  return { media, created: true } satisfies UpsertResult;
};

export const getOrCreateSeries = async (title: string) => {
  const result = await upsertSeries(title);
  return result.media;
};

const registerFilm = async (absolutePath: string, title?: string, description?: string) => {
  const mediaRelativePath = toMediaRelativePath(absolutePath);
  const stats = await stat(absolutePath);

  return upsertMedia({
    libraryKey: fileLibraryKey(mediaRelativePath),
    type: MediaType.FILM,
    title: title ?? titleFromFilename(absolutePath),
    description,
    filePath: mediaRelativePath,
    mimeType: inferMimeType(absolutePath),
    sizeBytes: BigInt(stats.size)
  });
};

const parseSeasonNumber = (pathParts: string[], filename: string) => {
  const seasonFolder = pathParts.find((part) => /(?:season|сезон|s)\s*\d+/i.test(part));
  const fromFolder = seasonFolder?.match(/(?:season|сезон|s)\s*(\d+)/i)?.[1];
  const fromFilename = filename.match(/s(\d{1,2})e\d{1,3}/i)?.[1];
  return Number(fromFolder ?? fromFilename ?? 1);
};

const parseEpisodeNumber = (filename: string) => {
  const patterns = [
    /s\d{1,2}e(\d{1,3})/i,
    /(?:episode|серія|ep|e)\s*(\d{1,3})/i,
    /\b(\d{1,3})\b/
  ];

  for (const pattern of patterns) {
    const match = filename.match(pattern);
    if (match?.[1]) {
      return Number(match[1]);
    }
  }

  return undefined;
};

const registerEpisode = async (input: {
  absolutePath: string;
  seriesTitle: string;
  title?: string;
  description?: string;
  seasonNumber: number;
  episodeNumber: number;
}) => {
  const mediaRelativePath = toMediaRelativePath(input.absolutePath);
  const series = await getOrCreateSeries(input.seriesTitle);
  const stats = await stat(input.absolutePath);

  return upsertMedia({
    libraryKey: fileLibraryKey(mediaRelativePath),
    type: MediaType.EPISODE,
    title: input.title ?? titleFromFilename(input.absolutePath),
    description: input.description,
    filePath: mediaRelativePath,
    mimeType: inferMimeType(input.absolutePath),
    sizeBytes: BigInt(stats.size),
    parentId: series.id,
    seasonNumber: input.seasonNumber,
    episodeNumber: input.episodeNumber
  });
};

export const scanMediaLibrary = async () => {
  await ensureMediaDirectories();

  const filmsDirectory = join(config.mediaRoot, "films");
  const seriesDirectory = join(config.mediaRoot, "series");
  const foundPaths = new Set<string>();
  const stats: ScanStats = {
    filmsFound: 0,
    episodesFound: 0,
    created: 0,
    updated: 0,
    missing: 0
  };

  const filmFiles = (await walkFiles(filmsDirectory)).filter(isVideoFile).sort();
  for (const filmFile of filmFiles) {
    const result = await registerFilm(filmFile);
    foundPaths.add(result.media.filePath ?? "");
    stats.filmsFound += 1;
    stats.created += result.created ? 1 : 0;
    stats.updated += result.created ? 0 : 1;
  }

  const episodeFiles = (await walkFiles(seriesDirectory)).filter(isVideoFile).sort();
  const filesBySeason = new Map<string, string[]>();

  for (const episodeFile of episodeFiles) {
    const pathFromSeriesRoot = relative(seriesDirectory, episodeFile);
    const pathParts = pathFromSeriesRoot.split(sep);
    const seriesTitle = pathParts[0];
    const seasonNumber = parseSeasonNumber(pathParts, basename(episodeFile));
    const key = `${seriesTitle}:${seasonNumber}`;
    filesBySeason.set(key, [...(filesBySeason.get(key) ?? []), episodeFile]);
  }

  for (const files of filesBySeason.values()) {
    const sortedFiles = files.sort();

    for (const [index, episodeFile] of sortedFiles.entries()) {
      const pathFromSeriesRoot = relative(seriesDirectory, episodeFile);
      const pathParts = pathFromSeriesRoot.split(sep);
      const seriesTitle = titleFromFilename(pathParts[0]);
      const seasonNumber = parseSeasonNumber(pathParts, basename(episodeFile));
      const episodeNumber = parseEpisodeNumber(basename(episodeFile)) ?? index + 1;
      const result = await registerEpisode({
        absolutePath: episodeFile,
        seriesTitle,
        seasonNumber,
        episodeNumber
      });

      foundPaths.add(result.media.filePath ?? "");
      stats.episodesFound += 1;
      stats.created += result.created ? 1 : 0;
      stats.updated += result.created ? 0 : 1;
    }
  }

  const trackedFiles = await prisma.media.findMany({
    where: {
      filePath: { not: null }
    }
  });

  for (const media of trackedFiles) {
    if (media.filePath && !foundPaths.has(media.filePath)) {
      await prisma.media.update({
        where: { id: media.id },
        data: {
          isAvailable: false,
          missingSince: media.missingSince ?? new Date()
        }
      });
      stats.missing += 1;
    }
  }

  return stats;
};

export const uploadMedia = async (input: UploadInput) => {
  if (!isVideoFile(input.file.originalname)) {
    await removeFileIfExists(input.file.path);
    throw new HttpError(400, "Only video files are supported");
  }

  const extension = extname(input.file.originalname).toLowerCase();
  const safeTitle = sanitizePathSegment(input.title);
  const filename =
    input.type === MediaType.EPISODE
      ? `S${String(input.seasonNumber ?? 1).padStart(2, "0")}E${String(
          input.episodeNumber ?? 1
        ).padStart(2, "0")} - ${safeTitle}${extension}`
      : `${safeTitle}${extension}`;

  const destinationDirectory =
    input.type === MediaType.EPISODE
      ? join(
          config.mediaRoot,
          "series",
          sanitizePathSegment(input.seriesTitle ?? "Untitled Series"),
          `Season ${String(input.seasonNumber ?? 1).padStart(2, "0")}`
        )
      : join(config.mediaRoot, "films");

  const destinationPath = await uniqueDestinationPath(destinationDirectory, filename);
  await moveFile(input.file.path, destinationPath);

  if (input.type === MediaType.EPISODE) {
    return registerEpisode({
      absolutePath: destinationPath,
      seriesTitle: input.seriesTitle ?? "Untitled Series",
      title: input.title,
      description: input.description,
      seasonNumber: input.seasonNumber ?? 1,
      episodeNumber: input.episodeNumber ?? 1
    });
  }

  return registerFilm(destinationPath, input.title, input.description);
};

export const markMediaFileDeleted = async (mediaId: string) => {
  const media = await prisma.media.findUnique({
    where: { id: mediaId },
    include: {
      children: true
    }
  });

  if (!media) {
    throw new HttpError(404, "Media not found");
  }

  if (media.type === MediaType.SERIES) {
    for (const episode of media.children) {
      if (episode.filePath) {
        await removeFileIfExists(resolveMediaPath(episode.filePath));
      }
    }

    const deletedAt = new Date();
    await prisma.media.updateMany({
      where: { parentId: media.id },
      data: {
        filePath: null,
        mimeType: null,
        sizeBytes: null,
        isAvailable: false,
        missingSince: deletedAt
      }
    });

    return prisma.media.update({
      where: { id: media.id },
      data: {
        isAvailable: false,
        missingSince: deletedAt
      }
    });
  }

  if (!media.filePath) {
    throw new HttpError(400, "Media does not have an attached file");
  }

  const absolutePath = resolveMediaPath(media.filePath);
  await removeFileIfExists(absolutePath);

  return prisma.media.update({
    where: { id: media.id },
    data: {
      filePath: null,
      mimeType: null,
      sizeBytes: null,
      isAvailable: false,
      missingSince: new Date()
    }
  });
};

export const assertPlayableMediaFile = async (mediaId: string) => {
  const media = await prisma.media.findUnique({ where: { id: mediaId } });

  if (!media) {
    throw new HttpError(404, "Media not found");
  }

  if (media.type === MediaType.SERIES || !media.filePath) {
    throw new HttpError(400, "Selected media is not a playable file");
  }

  const absolutePath = resolveMediaPath(media.filePath);

  if (!media.isAvailable || !(await pathExists(absolutePath))) {
    await prisma.media.update({
      where: { id: media.id },
      data: {
        isAvailable: false,
        missingSince: media.missingSince ?? new Date()
      }
    });
    throw new HttpError(404, "Media file is not available on the server");
  }

  return {
    media,
    absolutePath,
    size: await fileSize(absolutePath),
    mimeType: media.mimeType ?? inferMimeType(absolutePath)
  };
};
