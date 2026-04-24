import type { NextFunction, Request, Response } from "express";

export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type AsyncRoute = (req: Request, res: Response, next: NextFunction) => Promise<void>;

export const asyncHandler =
  (route: AsyncRoute) => (req: Request, res: Response, next: NextFunction) => {
    route(req, res, next).catch(next);
  };

export const errorHandler = (
  error: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  if (error.name === "MulterError") {
    res.status(400).json({ error: error.message });
    return;
  }

  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message });
    return;
  }

  console.error(error);
  res.status(500).json({ error: "Internal server error" });
};
