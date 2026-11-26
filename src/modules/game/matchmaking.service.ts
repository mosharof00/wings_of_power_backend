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
        return 2;
      default:
        return 2;
    }
  }

  async tryMatch(mode: MatchMode): Promise<MatchFoundPayload | null> {
    const required = this.getRequiredPlayerCount(mode);
    const queue = this.queueService.getQueue(mode);
    const schools = new Map<string, number>();
    let matchGroup: QueuedPlayer | undefined;
    for (const player of queue) {
      const group = JSON.stringify([player.schoolId, player.fixtureCode]);
      const count = (schools.get(group) ?? 0) + 1;
      schools.set(group, count);
      if (count === required) {
        matchGroup = player;
        break;
      }
    }
    if (!matchGroup) return null;

    const candidates = this.queueService.dequeueCandidates(
      mode,
      required,
      matchGroup.schoolId,
      matchGroup.fixtureCode,
    );
    if (candidates.length < required) return null;

    try {
      return await this.createMatchFromCandidates(mode, candidates);
    } catch (error) {
      const waiting = await this.prisma.matchmakingTicket.findMany({
        where: {
          id: { in: candidates.map((candidate) => candidate.ticketId) },
          status: TicketStatus.WAITING,
        },
        select: { id: true },
      });
      const active = new Set(waiting.map((ticket) => ticket.id));
      this.queueService.restore(
        candidates.filter((candidate) => active.has(candidate.ticketId)),
      );
      throw error;
    }
  }

  async createPractice(
    userId: string,
    schoolId: string,
    heroId?: string | null,
  ): Promise<{ matchId: string; ticketId: string }> {
    const match = await this.prisma.$transaction(async (tx) => {
      const game = await tx.gameMatch.create({
        data: {
          school_id: schoolId,
          phase: MatchPhase.COUNTDOWN,
          mode: MatchMode.SINGLE,
          teams: {
            create: ['Team A', 'Team B'].map((label) => ({
              label,
              score_xp: 0,
              score_kindness: 0,
              score_baskets: 0,
            })),
          },
        },
        include: { teams: true },
      });
      const humanTeam = game.teams.find((team) => team.label === 'Team A')!;
      const botTeam = game.teams.find((team) => team.label === 'Team B')!;
      await tx.gameParticipant.createMany({
        data: [
          {
            match_id: game.id,
            team_id: humanTeam.id,
            user_id: userId,
            hero_id: heroId ?? null,
            jersey_number: 1,
            is_connected: true,
            power_used: false,
          },
          {
            match_id: game.id,
            team_id: botTeam.id,
            is_bot: true,
            jersey_number: 1,
            is_connected: true,
            power_used: false,
          },
        ],
      });
      const ticket = await tx.matchmakingTicket.create({
        data: {
          user_id: userId,
          mode: MatchMode.SINGLE,
          status: TicketStatus.MATCHED,
          match_id: game.id,
        },
      });
      return { matchId: game.id, ticketId: ticket.id };
    });
    return match;
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

    const { match, teamA, teamB } = await this.prisma.$transaction(
      async (tx) => {
        const match = await tx.gameMatch.create({
          data: {
            school_id: schoolId,
            mode,
            phase: MatchPhase.QUEUED,
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
          await tx.gameParticipant.create({
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
          await tx.gameParticipant.create({
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
        const tickets = await tx.matchmakingTicket.updateMany({
          where: {
            id: { in: candidates.map((c) => c.ticketId) },
            status: TicketStatus.WAITING,
          },
          data: {
            status: TicketStatus.MATCHED,
            match_id: match.id,
          },
        });
        if (tickets.count !== candidates.length)
          throw new Error('A player left the queue while a match was forming');
        return { match, teamA, teamB };
      },
    );

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
