import { HttpError } from "./http.js";

export const routeParam = (value: string | string[] | undefined, name: string) => {
  if (typeof value !== "string" || !value) {
    throw new HttpError(400, `${name} route parameter is required`);
  }

  return value;
};
