import { Injectable, NestMiddleware } from '@nestjs/common';

@Injectable()
export class AuthGateMiddleware implements NestMiddleware {
  use(req: unknown, res: unknown, next: () => void) {
    void req;
    void res;
    next();
  }
}
