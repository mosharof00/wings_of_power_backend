import { Injectable } from '@nestjs/common';
import { MatchMode, MatchPhase, TicketStatus } from 'prisma/generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { QueuedPlayer, QueueService } from './queue.service';

export interface MatchTeamMember {
  userId: string;
  nickname: string | null;
  avatarUrl: string | null;
  heroId: string | null;
}

export interface MatchFoundTeam {
  id: string;
  label: string;
  members: MatchTeamMember[];
}

export interface MatchFoundPayload {
  matchId: string;
  mode: MatchMode;
  teams: MatchFoundTeam[];
}

@Injectable()
export class MatchmakingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
  ) {}

  getRequiredPlayerCount(mode: MatchMode): number {
    switch (mode) {
      case MatchMode.ONE_V_ONE:
        return 2;
      case MatchMode.FIVE_V_FIVE:
        return 10;
      case MatchMode.SINGLE:
        return 1;
      default:
        return 2;
    }
  }

  async tryMatch(mode: MatchMode): Promise<MatchFoundPayload | null> {
    const required = this.getRequiredPlayerCount(mode);
    const queue = this.queueService.getQueue(mode);
    if (queue.length < required) {
      return null;
    }

    const candidates = this.queueService.dequeueCandidates(mode, required);
    if (candidates.length < required) {
      return null;
    }

    try {
      return await this.createMatchFromCandidates(mode, candidates);
    } catch (error) {
      // Re-enqueue if creation failed unexpectedly
      for (const candidate of candidates) {
        this.queueService.enqueue(candidate);
      }
      throw error;
    }
  }

  private async createMatchFromCandidates(
    mode: MatchMode,
    candidates: QueuedPlayer[],
  ): Promise<MatchFoundPayload> {
    const userIds = candidates.map((c) => c.userId);
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        nickname: true,
        avatar_url: true,
        selected_hero_id: true,
        school_id: true,
      },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    const schoolId = candidates[0].schoolId ?? users[0]?.school_id ?? '';

    // Random 50/50 split for Team A and Team B
    const shuffled = [...candidates].sort(() => Math.random() - 0.5);
    const half = Math.floor(shuffled.length / 2);
    const teamACandidates = shuffled.slice(0, half);
    const teamBCandidates = shuffled.slice(half);

    const match = await this.prisma.gameMatch.create({
      data: {
        school_id: schoolId,
        mode,
        phase: MatchPhase.COUNTDOWN,
        started_at: new Date(),
        teams: {
          create: [
            {
              label: 'Team A',
              score_xp: 0,
              score_kindness: 0,
              score_baskets: 0,
            },
            {
              label: 'Team B',
              score_xp: 0,
              score_kindness: 0,
              score_baskets: 0,
            },
          ],
        },
      },
      include: {
        teams: true,
      },
    });

    const teamA = match.teams.find((t) => t.label === 'Team A')!;
    const teamB = match.teams.find((t) => t.label === 'Team B')!;

    // Create participants for Team A
    for (let i = 0; i < teamACandidates.length; i++) {
      const c = teamACandidates[i];
      const u = userMap.get(c.userId);
      await this.prisma.gameParticipant.create({
        data: {
          match_id: match.id,
          team_id: teamA.id,
          user_id: c.userId,
          is_bot: false,
          jersey_number: i + 1,
          hero_id: u?.selected_hero_id ?? null,
          is_connected: true,
          power_used: false,
        },
      });
    }

    // Create participants for Team B
    for (let i = 0; i < teamBCandidates.length; i++) {
      const c = teamBCandidates[i];
      const u = userMap.get(c.userId);
      await this.prisma.gameParticipant.create({
        data: {
          match_id: match.id,
          team_id: teamB.id,
          user_id: c.userId,
          is_bot: false,
          jersey_number: i + 1,
          hero_id: u?.selected_hero_id ?? null,
          is_connected: true,
          power_used: false,
        },
      });
    }

    // Update tickets to MATCHED
    await this.prisma.matchmakingTicket.updateMany({
      where: {
        id: { in: candidates.map((c) => c.ticketId) },
      },
      data: {
        status: TicketStatus.MATCHED,
        match_id: match.id,
      },
    });

    return {
      matchId: match.id,
      mode: match.mode,
      teams: [
        {
          id: teamA.id,
          label: 'Team A',
          members: teamACandidates.map((c) => {
            const u = userMap.get(c.userId);
            return {
              userId: c.userId,
              nickname: u?.nickname ?? null,
              avatarUrl: u?.avatar_url ?? null,
              heroId: u?.selected_hero_id ?? null,
            };
          }),
        },
        {
          id: teamB.id,
          label: 'Team B',
          members: teamBCandidates.map((c) => {
            const u = userMap.get(c.userId);
            return {
              userId: c.userId,
              nickname: u?.nickname ?? null,
              avatarUrl: u?.avatar_url ?? null,
              heroId: u?.selected_hero_id ?? null,
            };
          }),
        },
      ],
    };
  }
}
