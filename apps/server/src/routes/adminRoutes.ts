import multer from "multer";
import { Router } from "express";
import { uploadTempDir, config } from "../config.js";
import { requireAdmin } from "../middleware/adminAuth.js";
import { prisma } from "../lib/prisma.js";
import { markMediaFileDeleted, scanMediaLibrary, uploadMedia } from "../services/mediaService.js";
import { mediaDto } from "../utils/dto.js";
import { asyncHandler, HttpError } from "../utils/http.js";
import { removeFileIfExists } from "../utils/mediaPaths.js";
import { routeParam } from "../utils/params.js";
import { optionalInteger, optionalString, requiredString } from "../utils/validation.js";

const upload = multer({
  dest: uploadTempDir,
  limits: config.maxUploadBytes ? { fileSize: config.maxUploadBytes } : undefined
});

export const adminRouter = Router();

adminRouter.use(requireAdmin);

adminRouter.get(
  "/media",
  asyncHandler(async (_req, res) => {
    const media = await prisma.media.findMany({
      where: { parentId: null },
      include: {
        children: {
          orderBy: [{ seasonNumber: "asc" }, { episodeNumber: "asc" }, { title: "asc" }]
        }
      },
      orderBy: [{ type: "asc" }, { title: "asc" }]
    });

    res.json({ media: media.map(mediaDto) });
  })
);

adminRouter.post(
  "/media/scan",
  asyncHandler(async (_req, res) => {
    const result = await scanMediaLibrary();
    res.json(result);
  })
);

adminRouter.post(
  "/media/upload",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new HttpError(400, "file is required");
    }

    try {
      const type = requiredString(req.body?.type, "type", 12).toUpperCase();
      if (type !== "FILM" && type !== "EPISODE") {
        throw new HttpError(400, "type must be FILM or EPISODE");
      }

      const title = requiredString(req.body?.title, "title", 180);
      const description = optionalString(req.body?.description, "description");
      const seasonNumber = optionalInteger(req.body?.seasonNumber, "seasonNumber");
      const episodeNumber = optionalInteger(req.body?.episodeNumber, "episodeNumber");
      const seriesTitle = optionalString(req.body?.seriesTitle, "seriesTitle", 180);

      if (type === "EPISODE" && !seriesTitle) {
        throw new HttpError(400, "seriesTitle is required for episodes");
      }

      const result = await uploadMedia({
        type,
        title,
        description,
        seriesTitle,
        seasonNumber,
        episodeNumber,
        file: req.file
      });

      res.status(result.created ? 201 : 200).json({
        media: mediaDto(result.media),
        created: result.created
      });
    } catch (error) {
      await removeFileIfExists(req.file.path);
      throw error;
    }
  })
);

adminRouter.patch(
  "/media/:id",
  asyncHandler(async (req, res) => {
    const mediaId = routeParam(req.params.id, "id");
    const title = optionalString(req.body?.title, "title", 180);
    const description = optionalString(req.body?.description, "description");
    const seasonNumber = optionalInteger(req.body?.seasonNumber, "seasonNumber");
    const episodeNumber = optionalInteger(req.body?.episodeNumber, "episodeNumber");

    if (!title && description === undefined && !seasonNumber && !episodeNumber) {
      throw new HttpError(400, "No media fields provided");
    }

    try {
      const media = await prisma.media.update({
        where: { id: mediaId },
        data: {
          ...(title ? { title } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(seasonNumber ? { seasonNumber } : {}),
          ...(episodeNumber ? { episodeNumber } : {})
        }
      });

      res.json({ media: mediaDto(media) });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2025") {
        throw new HttpError(404, "Media not found");
      }

      throw error;
    }
  })
);

adminRouter.delete(
  "/media/:id/file",
  asyncHandler(async (req, res) => {
    const mediaId = routeParam(req.params.id, "id");
    const media = await markMediaFileDeleted(mediaId);
    res.json({ media: mediaDto(media) });
  })
);
