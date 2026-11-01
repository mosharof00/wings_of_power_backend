import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable } from '@nestjs/common';
import appConfig from '../../../config/app.config';

type StaffJwtPayload = {
  sub: string;
  role: string;
  status: string;
  schoolId: string | null;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: appConfig().jwt.secret,
    });
  }

  async validate(payload: StaffJwtPayload) {
    return {
      userId: payload.sub,
      role: payload.role,
      status: payload.status,
      schoolId: payload.schoolId,
    };
  }
}
