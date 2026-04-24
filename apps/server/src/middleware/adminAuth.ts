import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";

const safeCompare = (actual: string, expected: string) => {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);

  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(actualBuffer, expectedBuffer);
};

export const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  const authorization = req.headers.authorization;

  if (!authorization?.startsWith("Basic ")) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Online Watching Admin"');
    res.status(401).json({ error: "Admin credentials required" });
    return;
  }

  const encodedCredentials = authorization.slice("Basic ".length);
  const decodedCredentials = Buffer.from(encodedCredentials, "base64").toString("utf8");
  const separatorIndex = decodedCredentials.indexOf(":");

  if (separatorIndex === -1) {
    res.status(401).json({ error: "Invalid admin credentials" });
    return;
  }

  const username = decodedCredentials.slice(0, separatorIndex);
  const password = decodedCredentials.slice(separatorIndex + 1);
  const isValid =
    safeCompare(username, config.adminUsername) && safeCompare(password, config.adminPassword);

  if (!isValid) {
    res.status(401).json({ error: "Invalid admin credentials" });
    return;
  }

  next();
};
