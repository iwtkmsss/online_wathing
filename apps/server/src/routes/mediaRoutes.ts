import { createReadStream } from "node:fs";
import { Router } from "express";
import { MediaType } from "../generated/prisma/enums.js";
import { prisma } from "../lib/prisma.js";
import { assertPlayableMediaFile } from "../services/mediaService.js";
import { mediaDto } from "../utils/dto.js";
import { asyncHandler, HttpError } from "../utils/http.js";
import { routeParam } from "../utils/params.js";

type ByteRange = {
  start: number;
  end: number;
};

const parseRangeHeader = (rangeHeader: string, fileSize: number): ByteRange => {
  const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);

  if (!match) {
    throw new HttpError(416, "Invalid range header");
  }

  const [, rawStart, rawEnd] = match;

  if (!rawStart && !rawEnd) {
    throw new HttpError(416, "Invalid range header");
  }

  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) {
      throw new HttpError(416, "Invalid range header");
    }

    return {
      start: Math.max(fileSize - suffixLength, 0),
      end: fileSize - 1
    };
  }

  const start = Number(rawStart);
  const end = rawEnd ? Number(rawEnd) : fileSize - 1;

  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    start >= fileSize
  ) {
    throw new HttpError(416, "Requested range is not satisfiable");
  }

  return {
    start,
    end: Math.min(end, fileSize - 1)
  };
};

export const mediaRouter = Router();

mediaRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const media = await prisma.media.findMany({
      where: {
        parentId: null,
        OR: [{ type: MediaType.SERIES }, { isAvailable: true }]
      },
      include: {
        children: {
          where: { isAvailable: true },
          orderBy: [{ seasonNumber: "asc" }, { episodeNumber: "asc" }, { title: "asc" }]
        }
      },
      orderBy: [{ type: "asc" }, { title: "asc" }]
    });

    res.json({ media: media.map(mediaDto) });
  })
);

const streamMedia = asyncHandler(async (req, res, next) => {
  const mediaId = routeParam(req.params.id, "id");
  const { media, absolutePath, size, mimeType } = await assertPlayableMediaFile(mediaId);

  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", mimeType);
  res.setHeader("Cache-Control", "private, max-age=0");

  const rangeHeader = req.headers.range;

  if (!rangeHeader) {
    res.setHeader("Content-Length", size);
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(media.title)}"`);

    if (req.method === "HEAD") {
      res.status(200).end();
      return;
    }

    createReadStream(absolutePath).on("error", next).pipe(res.status(200));
    return;
  }

  const { start, end } = parseRangeHeader(rangeHeader, size);
  const chunkSize = end - start + 1;

  res.status(206);
  res.setHeader("Content-Length", chunkSize);
  res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
  res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(media.title)}"`);

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  createReadStream(absolutePath, { start, end }).on("error", next).pipe(res);
});

mediaRouter.get("/:id/stream", streamMedia);
mediaRouter.head("/:id/stream", streamMedia);
