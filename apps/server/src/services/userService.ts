import type { User } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";

export const findUserByNicknameInsensitive = async (nickname: string) => {
  const users = await prisma.$queryRaw<User[]>`
    SELECT "id", "nickname", "totalWatchSeconds", "createdAt", "updatedAt"
    FROM "User"
    WHERE "nickname" = ${nickname} COLLATE NOCASE
    LIMIT 1
  `;

  return users[0] ?? null;
};
