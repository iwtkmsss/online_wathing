# Online Watching

Shared movie and series watching platform built as a TypeScript monorepo.

## Workspaces

- `apps/client` - Vite, React, TypeScript, Tailwind CSS, Zustand, Socket.io client.
- `apps/server` - Express, TypeScript, Socket.io, Prisma ORM with SQLite.
- `media/films` and `media/series` - local server media roots.

## Scripts

```bash
npm install
npm run dev
npm run build
npm run lint
npm run prisma:generate
npm run prisma:migrate -w apps/server -- --name <migration-name>
```

## Local URLs

- Client: `http://localhost:5173`
- API health: `http://localhost:4000/health`

Copy `.env.example` to `.env` when you need custom ports, admin credentials, media root, or database URL.

## Step 2 API

- `POST /api/auth/nickname` - login/register with `{ "nickname": "Neo" }`.
- `GET /api/users/:id` and `PATCH /api/users/:id` - profile and nickname update.
- `GET /api/media` - public media library tree.
- `GET /api/media/:id/stream` - HTML5-video friendly streaming with HTTP Range Requests.
- `GET /api/admin/media` - admin media tree.
- `POST /api/admin/media/scan` - scan `media/films` and `media/series`.
- `POST /api/admin/media/upload` - multipart upload with file field `file`.
- `PATCH /api/admin/media/:id` - update title, description, season, or episode.
- `DELETE /api/admin/media/:id/file` - delete only the local file and keep progress/history records.
- `GET /api/rooms/public` - public room list.
- `POST /api/rooms` - create a room with `{ name, creatorId, isPublic, password?, mediaId? }`.
- `GET /api/rooms/:id` - room details.
- `PATCH /api/rooms/:id/media` - creator selects or clears playable media.

Admin routes use HTTP Basic Auth with `ADMIN_USERNAME` and `ADMIN_PASSWORD`.

## Step 3 Socket Events

Client emits:

- `sync:ping` - returns server timestamps for offset and latency estimation.
- `room:join` - `{ roomId, userId, password? }`.
- `room:leave`.
- `room:select-media` - creator-only media selection.
- `playback:play`, `playback:pause`, `playback:seek` - `{ roomId?, currentTimeSeconds, playbackRate?, clientEventAt?, serverOffsetMs?, latencyMs?, isPlaying? }`.
- `playback:buffering` - `{ roomId?, isBuffering, currentTimeSeconds?, latencyMs? }`; buffering pauses the room for everyone.
- `playback:heartbeat` - client drift report; server may respond with a seek or rate correction.

Server emits:

- `server:ready`, `server:error`.
- `room:member-joined`, `room:member-left`, `room:member-buffering`, `room:members`, `room:media-selected`.
- `playback:state`, `playback:correction`, `playback:buffering-cleared`.
