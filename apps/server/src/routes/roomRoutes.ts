import { Router } from "express";
import {
  createRoom,
  findRoomOrThrow,
  listPublicRooms,
  roomDto,
  selectRoomMedia
} from "../services/roomService.js";
import { asyncHandler, HttpError } from "../utils/http.js";
import { routeParam } from "../utils/params.js";
import { optionalString, requiredString } from "../utils/validation.js";

export const roomRouter = Router();

roomRouter.get(
  "/public",
  asyncHandler(async (_req, res) => {
    res.json({ rooms: await listPublicRooms() });
  })
);

roomRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const name = requiredString(req.body?.name, "name", 100);
    const creatorId = requiredString(req.body?.creatorId, "creatorId", 80);
    const password = optionalString(req.body?.password, "password", 120);
    const mediaId = optionalString(req.body?.mediaId, "mediaId", 80);
    const isPublic = req.body?.isPublic === undefined ? true : Boolean(req.body.isPublic);

    if (password && password.length < 3) {
      throw new HttpError(400, "password must be at least 3 characters");
    }

    const room = await createRoom({
      creatorId,
      name,
      isPublic,
      password,
      mediaId
    });

    res.status(201).json({ room });
  })
);

roomRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const roomId = routeParam(req.params.id, "id");
    const room = await findRoomOrThrow(roomId);

    res.json({ room: roomDto(room) });
  })
);

roomRouter.patch(
  "/:id/media",
  asyncHandler(async (req, res) => {
    const roomId = routeParam(req.params.id, "id");
    const requesterId = requiredString(req.body?.requesterId, "requesterId", 80);
    const mediaId = req.body?.mediaId === null ? null : requiredString(req.body?.mediaId, "mediaId", 80);
    const room = await selectRoomMedia({ roomId, requesterId, mediaId });

    res.json({ room });
  })
);
