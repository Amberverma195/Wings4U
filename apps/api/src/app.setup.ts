import { json, type Request, type Response, type NextFunction } from "express";
import cookieParser from "cookie-parser";
import { HttpStatus, INestApplication, ValidationPipe } from "@nestjs/common";
import { IoAdapter } from "@nestjs/platform-socket.io";
import { ApiExceptionFilter } from "./common/filters/api-exception.filter";
import { EnvelopeInterceptor } from "./common/interceptors/envelope.interceptor";
import { csrfMiddleware } from "./common/middleware/csrf.middleware";
import { requestIdMiddleware } from "./common/middleware/request-id.middleware";
import { isAllowedCorsOrigin } from "./common/utils/cors-origins";

/** Shared HTTP + WebSocket bootstrap for `main.ts` and e2e tests. */
export function configureApp(app: INestApplication): void {
  app.useWebSocketAdapter(new IoAdapter(app));
  app.use(requestIdMiddleware);
  const quoteBodyParser = json({ limit: "1mb", verify: (_req, _res, buffer) => {
    let depth = 0, quoted = false, escaped = false;
    for (const byte of buffer) {
      if (quoted) {
        if (escaped) escaped = false;
        else if (byte === 92) escaped = true;
        else if (byte === 34) quoted = false;
      } else if (byte === 34) quoted = true;
      else if (byte === 123 || byte === 91) {
        if (++depth > 16) throw Object.assign(new Error("Cart payload nesting exceeds the supported limit"), { status: 413 });
      } else if (byte === 125 || byte === 93) depth--;
    }
  } });
  // Keep the wrapper name distinct so Nest still registers its default parser for all other routes.
  app.use("/api/v1/cart/quote", function cartQuoteBodyParser(req: Request, res: Response, next: NextFunction) {
    quoteBodyParser(req, res, next);
  });
  app.use(cookieParser());
  app.use(csrfMiddleware);
  app.setGlobalPrefix("api/v1");
  app.useGlobalInterceptors(new EnvelopeInterceptor());
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidUnknownValues: true,
      transformOptions: { enableImplicitConversion: true },
      errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY
    })
  );
  app.enableCors({
    origin(origin, callback) {
      callback(null, isAllowedCorsOrigin(origin));
    },
    credentials: true,
    // Not CORS-safelisted; without this the cross-origin website cannot read it.
    exposedHeaders: ["Retry-After"],
  });
}
