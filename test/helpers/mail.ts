import { Injectable } from '@nestjs/common';

export interface CapturedInvite {
  email: string;
  token: string;
  url: string;
  user?: any;
}

export interface CapturedOtp {
  email: string;
  otp: string;
  name?: string;
}

@Injectable()
export class TestMailService {
  private invites: CapturedInvite[] = [];
  private otps: CapturedOtp[] = [];

  async sendMemberInvitation(payload: {
    user?: any;
    member?: { email?: string; token?: string; fname?: string };
    url?: string;
  }): Promise<void> {
    const email = (payload?.member?.email || '').trim().toLowerCase();
    const token = payload?.member?.token || '';
    const url = payload?.url || '';
    this.invites.push({
      email,
      token,
      url,
      user: payload?.user,
    });
  }

  async sendOtpCodeToEmail(payload: {
    name?: string;
    email?: string;
    otp?: string | number;
  }): Promise<void> {
    const email = (payload?.email || '').trim().toLowerCase();
    const otp = payload?.otp != null ? String(payload.otp) : '';
    this.otps.push({
      email,
      otp,
      name: payload?.name,
    });
  }

  async sendVerificationLink(): Promise<void> {
    // no-op in e2e
  }

  getInvite(email: string): CapturedInvite | undefined {
    const normalized = email.trim().toLowerCase();
    return this.invites.find((i) => i.email === normalized);
  }

  getInviteToken(email: string): string | undefined {
    return this.getInvite(email)?.token;
  }

  getOtp(email: string): string | undefined {
    const normalized = email.trim().toLowerCase();
    return this.otps.find((o) => o.email === normalized)?.otp;
  }

  clear(): void {
    this.invites = [];
    this.otps = [];
  }
}
