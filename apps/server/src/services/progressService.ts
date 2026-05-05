import { prisma } from "../lib/prisma.js";

const resumeWindowSeconds = 10 * 60;
const maxProgressDeltaSeconds = 30;

const clampSeconds = (value: number) => Math.max(0, Number.isFinite(value) ? value : 0);

const uniqueUserIds = (userIds: string[]) =>
  Array.from(new Set(userIds.map((userId) => userId.trim()).filter(Boolean)));

export const resolveResumeTimeSeconds = async (input: {
  creatorId: string;
  mediaId: string;
  participantUserIds?: string[];
}) => {
  const userIds = uniqueUserIds([input.creatorId, ...(input.participantUserIds ?? [])]);

  if (!userIds.length) {
    return 0;
  }

  const progress = await prisma.progress.findMany({
    where: {
      mediaId: input.mediaId,
      userId: { in: userIds }
    },
    select: {
      userId: true,
      watchedSeconds: true
    }
  });

  const validProgress = progress.filter((entry) => entry.watchedSeconds > 0);

  if (!validProgress.length) {
    return 0;
  }

  const creatorProgress = validProgress.find((entry) => entry.userId === input.creatorId);

  if (!creatorProgress) {
    return Math.min(...validProgress.map((entry) => entry.watchedSeconds));
  }

  const closeProgress = validProgress.filter(
    (entry) =>
      entry.userId === input.creatorId ||
      Math.abs(entry.watchedSeconds - creatorProgress.watchedSeconds) <= resumeWindowSeconds
  );

  return Math.min(...closeProgress.map((entry) => entry.watchedSeconds));
};

export const saveProgressForUsers = async (input: {
  userIds: string[];
  mediaId: string;
  watchedSeconds: number;
  watchedDeltaSeconds?: number;
  completed?: boolean;
}) => {
  const userIds = uniqueUserIds(input.userIds);

  if (!userIds.length) {
    return;
  }

  const watchedSeconds = clampSeconds(input.watchedSeconds);
  const watchedDeltaSeconds = Math.round(
    Math.min(clampSeconds(input.watchedDeltaSeconds ?? 0), maxProgressDeltaSeconds)
  );
  const lastWatchedAt = new Date();

  await prisma.$transaction(
    userIds.flatMap((userId) => [
      prisma.progress.upsert({
        where: {
          userId_mediaId: {
            userId,
            mediaId: input.mediaId
          }
        },
        update: {
          watchedSeconds,
          totalWatchSeconds: { increment: watchedDeltaSeconds },
          ...(input.completed !== undefined ? { completed: input.completed } : {}),
          lastWatchedAt
        },
        create: {
          userId,
          mediaId: input.mediaId,
          watchedSeconds,
          totalWatchSeconds: watchedDeltaSeconds,
          completed: input.completed ?? false,
          lastWatchedAt
        }
      }),
      prisma.user.update({
        where: { id: userId },
        data: {
          totalWatchSeconds: { increment: watchedDeltaSeconds }
        }
      })
    ])
  );
};
