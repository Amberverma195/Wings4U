import cookieParser from "cookie-parser";
import { HttpStatus, INestApplication, ValidationPipe } from "@nestjs/common";
import { IoAdapter } from "@nestjs/platform-socket.io";
import { ApiExceptionFilter } from "./common/filters/api-exception.filter";
import { EnvelopeInterceptor } from "./common/interceptors/envelope.interceptor";
import { csrfMiddleware } from "./common/middleware/csrf.middleware";
import { requestIdMiddleware } from "./common/middleware/request-id.middleware";

/** Shared HTTP + WebSocket bootstrap for `main.ts` and e2e tests. */
export function configureApp(app: INestApplication): void {
  app.useWebSocketAdapter(new IoAdapter(app));
  app.use(requestIdMiddleware);
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
  app.enableCors({ origin: true, credentials: true });
}
