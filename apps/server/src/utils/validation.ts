import { HttpError } from "./http.js";

export const requiredString = (value: unknown, fieldName: string, maxLength = 120) => {
  if (typeof value !== "string") {
    throw new HttpError(400, `${fieldName} is required`);
  }

  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) {
    throw new HttpError(400, `${fieldName} is required`);
  }

  if (trimmed.length > maxLength) {
    throw new HttpError(400, `${fieldName} is too long`);
  }

  return trimmed;
};

export const optionalString = (value: unknown, fieldName: string, maxLength = 1_000) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new HttpError(400, `${fieldName} must be a string`);
  }

  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new HttpError(400, `${fieldName} is too long`);
  }

  return trimmed || undefined;
};

export const optionalInteger = (value: unknown, fieldName: string) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new HttpError(400, `${fieldName} must be a positive integer`);
  }

  return parsed;
};

export const normalizeNickname = (value: unknown) => {
  const nickname = requiredString(value, "nickname", 32);

  if (nickname.length < 2) {
    throw new HttpError(400, "nickname must be at least 2 characters");
  }

  if (/[\u0000-\u001F\u007F]/u.test(nickname)) {
    throw new HttpError(400, "nickname contains invalid characters");
  }

  return nickname;
};
