import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor
} from "@nestjs/common";
import { Observable } from "rxjs";
import { map } from "rxjs/operators";
import { randomUUID } from "crypto";
import type { Request } from "express";

@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const requestId = req.requestId ?? randomUUID();
    req.requestId = requestId;
    return next.handle().pipe(
      map((data) => ({
        data,
        meta: { request_id: requestId },
        errors: null
      }))
    );
  }
}
