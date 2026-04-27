import { randomUUID } from "crypto";
import type { NextFunction, Request, Response } from "express";

export function requestIdMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const fromHeader = req.headers["x-request-id"];
  req.requestId =
    typeof fromHeader === "string" && fromHeader.length > 0 ? fromHeader : randomUUID();
  next();
}
