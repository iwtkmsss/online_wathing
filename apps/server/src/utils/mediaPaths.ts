import { access, mkdir, readdir, stat, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { config } from "../config.js";
import { HttpError } from "./http.js";

export const videoExtensions = new Set([
  ".mp4",
  ".m4v",
  ".webm",
  ".mkv",
  ".mov",
  ".avi",
  ".ogg"
]);

const mimeByExtension = new Map([
  [".mp4", "video/mp4"],
  [".m4v", "video/mp4"],
  [".webm", "video/webm"],
  [".mkv", "video/x-matroska"],
  [".mov", "video/quicktime"],
  [".avi", "video/x-msvideo"],
  [".ogg", "video/ogg"]
]);

export const ensureMediaDirectories = async () => {
  await Promise.all([
    mkdir(config.mediaRoot, { recursive: true }),
    mkdir(join(config.mediaRoot, "films"), { recursive: true }),
    mkdir(join(config.mediaRoot, "series"), { recursive: true }),
    mkdir(join(config.mediaRoot, ".uploads"), { recursive: true })
  ]);
};

export const pathExists = async (path: string) => {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

export const removeFileIfExists = async (path: string) => {
  if (await pathExists(path)) {
    await unlink(path);
  }
};

export const resolveMediaPath = (mediaRelativePath: string) => {
  const absolutePath = resolve(config.mediaRoot, mediaRelativePath);
  const pathFromRoot = relative(config.mediaRoot, absolutePath);

  if (!pathFromRoot || pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
    throw new HttpError(400, "Invalid media path");
  }

  return absolutePath;
};

export const toMediaRelativePath = (absolutePath: string) => {
  const pathFromRoot = relative(config.mediaRoot, absolutePath);

  if (!pathFromRoot || pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
    throw new HttpError(400, "Media file must stay inside media root");
  }

  return pathFromRoot.split(sep).join("/");
};

export const sanitizePathSegment = (value: string) => {
  const cleaned = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/\.+$/g, "");

  return cleaned || "untitled";
};

export const titleFromFilename = (filePath: string) =>
  basename(filePath, extname(filePath))
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const inferMimeType = (filePath: string) =>
  mimeByExtension.get(extname(filePath).toLowerCase()) ?? "application/octet-stream";

export const isVideoFile = (filePath: string) =>
  videoExtensions.has(extname(filePath).toLowerCase());

export const walkFiles = async (directory: string): Promise<string[]> => {
  if (!(await pathExists(directory))) {
    return [];
  }

  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        return walkFiles(entryPath);
      }

      return [entryPath];
    })
  );

  return nested.flat();
};

export const uniqueDestinationPath = async (directory: string, filename: string) => {
  await mkdir(directory, { recursive: true });

  const extension = extname(filename);
  const name = basename(filename, extension);
  let candidate = join(directory, filename);
  let index = 1;

  while (await pathExists(candidate)) {
    candidate = join(directory, `${name}-${index}${extension}`);
    index += 1;
  }

  return candidate;
};

export const fileSize = async (filePath: string) => {
  const stats = await stat(filePath);
  return stats.size;
};

export const directoryName = dirname;
