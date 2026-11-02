import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import {
  JoinRequestStatus,
  MatchMode,
  MatchPhase,
  TicketStatus,
} from 'prisma/generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ProgressService } from '../progress/progress.service';
import {
  AdminMatchQueryDto,
  JoinQueueDto,
  UpdateEligibilityConfigDto,
} from './dto/game.dto';
import { QueueService } from './queue.service';

@Injectable()
export class GameService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly progressService: ProgressService,
    private readonly queueService: QueueService,
  ) {}

  async getEligibility(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    const result = await this.progressService.eligibilityFor(userId);

    return {
      success: true,
      data: result,
      ...result,
    };
  }

  async getHowToPlay(userId: string) {
    let kindnessPoints = 50;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { school_id: true },
    });

    if (user?.school_id) {
      const pointRule = await this.prisma.pointRule.findFirst({
        where: {
          school_id: user.school_id,
          key: 'KINDNESS_ROUND',
        },
      });
      if (pointRule && typeof pointRule.value_int === 'number') {
        kindnessPoints = pointRule.value_int;
      }
    }

    const payload = {
      quarters: [
        {
          quarter: 1,
          name: 'Warm-Up',
          type: 'Q1_WARMUP',
          questions: 5,
          buzzTimeSeconds: 10,
          answerTimeSeconds: 10,
          pointsPerBasket: 2,
          description:
            'Buzz in within 10s, answer MCQ within 10s. Correct answer earns a shot opportunity for 2 XP.',
        },
        {
          quarter: 2,
          name: 'Upstander Defense',
          type: 'Q2_DEFENSE',
          questions: 1,
          answerTimeSeconds: 60,
          kindnessPoints,
          description: `Free-text kindness response in 60s. Non-empty response awards ${kindnessPoints} kindness points.`,
        },
        {
          quarter: 3,
          name: 'Hobby Trivia',
          type: 'Q3_HOBBY',
          questions: 5,
          buzzTimeSeconds: 10,
          answerTimeSeconds: 10,
          pointsPerBasket: 2,
          description:
            'Buzz in within 10s, answer hobby trivia MCQ within 10s. Correct answer earns a shot opportunity for 2 XP.',
        },
        {
          quarter: 4,
          name: 'Championship',
          type: 'Q4_CHAMPIONSHIP',
          questions: 3,
          voteTimeSeconds: 20,
          pointsPerBasket: 3,
          description:
            'Team discussion and majority vote within 20s for 3 questions. Made basket awards 3 XP.',
        },
      ],
      rules: {
        buzzTimeSeconds: 10,
        answerTimeSeconds: 10,
        q2TimeSeconds: 60,
        q4VoteTimeSeconds: 20,
        shootoutTimeSeconds: 60,
        kindnessPoints,
        xpPerBasketQ1Q3: 2,
        xpPerBasketQ4: 3,
        powerWingUsesPerMatch: 1,
      },
    };

    return {
      success: true,
      data: payload,
      ...payload,
    };
  }

  async joinQueue(userId: string, dto: JoinQueueDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        memberships: {
          where: { status: JoinRequestStatus.APPROVED },
          include: { class: true },
          orderBy: { created_at: 'desc' },
        },
      },
    });

    if (!user) {
      throw new HttpException('Student not found', HttpStatus.NOT_FOUND);
    }

    const eligibility = await this.progressService.eligibilityFor(userId);
    if (!eligibility.eligible) {
      throw new HttpException(
        'Student is not eligible for game show',
        HttpStatus.UNPROCESSABLE_ENTITY, // 422
      );
    }

    const isMemQueued = this.queueService.isQueued(userId);
    const activeTicket = await this.prisma.matchmakingTicket.findFirst({
      where: {
        user_id: userId,
        status: TicketStatus.WAITING,
      },
    });

    if (isMemQueued || activeTicket) {
      throw new HttpException(
        'Already queued for matchmaking',
        HttpStatus.CONFLICT, // 409
      );
    }

    const schoolId = user.school_id ?? user.memberships?.[0]?.class?.school_id;
    if (!schoolId) {
      throw new HttpException(
        'Student does not belong to a school',
        HttpStatus.BAD_REQUEST,
      );
    }
    const classId = user.memberships?.[0]?.class_id ?? null;

    if (dto.mode === MatchMode.SINGLE) {
      const match = await this.prisma.gameMatch.create({
        data: {
          school_id: schoolId,
          mode: MatchMode.SINGLE,
          phase: MatchPhase.COUNTDOWN,
          class_id: classId,
          teams: {
            create: {
              label: 'Single Player',
              score_xp: 0,
              score_kindness: 0,
              score_baskets: 0,
            },
          },
        },
        include: {
          teams: true,
        },
      });

      const team = match.teams[0];

      await this.prisma.gameParticipant.create({
        data: {
          match_id: match.id,
          team_id: team.id,
          user_id: userId,
          is_bot: false,
          jersey_number: 1,
          hero_id: user.selected_hero_id ?? null,
          is_connected: true,
          power_used: false,
        },
      });

      const ticket = await this.prisma.matchmakingTicket.create({
        data: {
          user_id: userId,
          mode: MatchMode.SINGLE,
          status: TicketStatus.MATCHED,
          match_id: match.id,
        },
      });

      const resultData = {
        ticketId: ticket.id,
        matchId: match.id,
        mode: dto.mode,
      };

      return {
        success: true,
        data: resultData,
        ...resultData,
      };
    }

    // MULTIPLAYER (ONE_V_ONE or FIVE_V_FIVE)
    const ticket = await this.prisma.matchmakingTicket.create({
      data: {
        user_id: userId,
        mode: dto.mode,
        status: TicketStatus.WAITING,
      },
    });

    this.queueService.enqueue({
      ticketId: ticket.id,
      userId,
      schoolId,
      mode: dto.mode,
      fixtureCode: dto.fixtureCode,
    });

    const resultData: {
      ticketId: string;
      mode: MatchMode;
      matchId?: string;
    } = {
      ticketId: ticket.id,
      mode: dto.mode,
    };

    return {
      success: true,
      data: resultData,
      ticketId: ticket.id,
      matchId: undefined,
      mode: dto.mode,
    };
  }

  async cancelQueue(userId: string) {
    await this.prisma.matchmakingTicket.updateMany({
      where: {
        user_id: userId,
        status: TicketStatus.WAITING,
      },
      data: {
        status: TicketStatus.CANCELLED,
      },
    });

    this.queueService.removeFromAll(userId);

    return {
      success: true,
      message: 'Matchmaking ticket cancelled',
    };
  }

  async getMatchSnapshot(userId: string, matchId: string) {
    const match = await this.prisma.gameMatch.findUnique({
      where: { id: matchId },
      include: {
        teams: true,
        participants: {
          include: {
            user: {
              select: {
                id: true,
                nickname: true,
                real_name: true,
                avatar_url: true,
                username: true,
              },
            },
            hero: {
              select: {
                id: true,
                code: true,
                display_name: true,
                art_url: true,
                power_code: true,
                power_label: true,
              },
            },
          },
        },
        rounds: {
          orderBy: { number: 'asc' },
          include: {
            answers: true,
            shootouts: true,
          },
        },
      },
    });

    if (!match) {
      throw new HttpException('Match not found', HttpStatus.NOT_FOUND);
    }

    const isParticipant = match.participants.some((p) => p.user_id === userId);
    if (!isParticipant) {
      throw new HttpException(
        'Forbidden - not a participant in this match',
        HttpStatus.FORBIDDEN, // 403
      );
    }

    const formatted = {
      id: match.id,
      mode: match.mode,
      phase: match.phase,
      schoolId: match.school_id,
      classId: match.class_id,
      packId: match.pack_id,
      startedAt: match.started_at,
      finishedAt: match.finished_at,
      winnerTeamId: match.winner_team_id,
      teams: match.teams.map((t) => ({
        id: t.id,
        matchId: t.match_id,
        label: t.label,
        scoreXp: t.score_xp,
        scoreKindness: t.score_kindness,
        scoreBaskets: t.score_baskets,
      })),
      participants: match.participants.map((p) => ({
        id: p.id,
        matchId: p.match_id,
        teamId: p.team_id,
        userId: p.user_id,
        isBot: p.is_bot,
        jerseyNumber: p.jersey_number,
        heroId: p.hero_id,
        isConnected: p.is_connected,
        leftAt: p.left_at,
        powerUsed: p.power_used,
        nickname: p.user?.nickname ?? (p.is_bot ? 'Bot' : null),
        avatarUrl: p.user?.avatar_url ?? null,
        user: p.user
          ? {
              id: p.user.id,
              nickname: p.user.nickname,
              realName: p.user.real_name,
              avatarUrl: p.user.avatar_url,
              username: p.user.username,
            }
          : null,
        hero: p.hero
          ? {
              id: p.hero.id,
              code: p.hero.code,
              name: p.hero.display_name,
              displayName: p.hero.display_name,
              avatarUrl: p.hero.art_url,
              artUrl: p.hero.art_url,
              powerCode: p.hero.power_code,
              powerLabel: p.hero.power_label,
            }
          : null,
      })),
      rounds: match.rounds.map((r) => ({
        id: r.id,
        number: r.number,
        roundType: r.round_type,
        phase: r.phase,
        deadlineAt: r.deadline_at,
        buzzWinnerId: r.buzz_winner_id,
        answersCount: r.answers.length,
        shootoutsCount: r.shootouts.length,
      })),
      createdAt: match.created_at,
      updatedAt: match.updated_at,
    };

    return {
      success: true,
      data: formatted,
      ...formatted,
    };
  }

  async leaveMatch(userId: string, matchId: string) {
    const match = await this.prisma.gameMatch.findUnique({
      where: { id: matchId },
      include: { participants: true },
    });

    if (!match) {
      throw new HttpException('Match not found', HttpStatus.NOT_FOUND);
    }

    const participant = match.participants.find((p) => p.user_id === userId);
    if (!participant) {
      throw new HttpException(
        'Forbidden - not a participant in this match',
        HttpStatus.FORBIDDEN,
      );
    }

    const updated = await this.prisma.gameParticipant.update({
      where: { id: participant.id },
      data: {
        left_at: new Date(),
        is_connected: false,
      },
    });

    return {
      success: true,
      message: 'Left match successfully',
      data: {
        participantId: updated.id,
        leftAt: updated.left_at,
      },
      leftAt: updated.left_at,
    };
  }

  async listAdminMatches(adminId: string, query: AdminMatchQueryDto) {
    const admin = await this.prisma.user.findUnique({
      where: { id: adminId },
    });
    if (!admin) {
      throw new HttpException('Admin user not found', HttpStatus.NOT_FOUND);
    }

    const page = query?.page ? Number(query.page) : 1;
    const perPage = query?.perPage ? Number(query.perPage) : 10;
    const skip = (page - 1) * perPage;

    const where: any = {};
    if (admin.school_id) {
      where.school_id = admin.school_id;
    }
    if (query?.mode) {
      where.mode = query.mode;
    }
    if (query?.phase) {
      where.phase = query.phase;
    }

    const [total, matches] = await Promise.all([
      this.prisma.gameMatch.count({ where }),
      this.prisma.gameMatch.findMany({
        where,
        skip,
        take: perPage,
        orderBy: { created_at: 'desc' },
        include: {
          teams: true,
          participants: {
            include: {
              user: {
                select: {
                  id: true,
                  nickname: true,
                  real_name: true,
                  avatar_url: true,
                  username: true,
                },
              },
              hero: {
                select: {
                  id: true,
                  code: true,
                  display_name: true,
                  art_url: true,
                  power_code: true,
                  power_label: true,
                },
              },
            },
          },
        },
      }),
    ]);

    const formattedMatches = matches.map((m) => ({
      id: m.id,
      mode: m.mode,
      phase: m.phase,
      schoolId: m.school_id,
      classId: m.class_id,
      startedAt: m.started_at,
      finishedAt: m.finished_at,
      winnerTeamId: m.winner_team_id,
      teams: m.teams.map((t) => ({
        id: t.id,
        label: t.label,
        scoreXp: t.score_xp,
        scoreKindness: t.score_kindness,
        scoreBaskets: t.score_baskets,
      })),
      participants: m.participants.map((p) => ({
        id: p.id,
        teamId: p.team_id,
        userId: p.user_id,
        isBot: p.is_bot,
        jerseyNumber: p.jersey_number,
        isConnected: p.is_connected,
        leftAt: p.left_at,
        nickname: p.user?.nickname ?? (p.is_bot ? 'Bot' : null),
        avatarUrl: p.user?.avatar_url ?? null,
      })),
      createdAt: m.created_at,
      updatedAt: m.updated_at,
    }));

    const lastPage = Math.ceil(total / perPage) || 1;

    return {
      success: true,
      data: {
        items: formattedMatches,
        total,
        page,
        perPage,
        lastPage,
      },
      items: formattedMatches,
      total,
      page,
      perPage,
      lastPage,
    };
  }

  async getAdminMatchDetail(adminId: string, matchId: string) {
    const admin = await this.prisma.user.findUnique({
      where: { id: adminId },
    });
    if (!admin) {
      throw new HttpException('Admin user not found', HttpStatus.NOT_FOUND);
    }

    const match = await this.prisma.gameMatch.findUnique({
      where: { id: matchId },
      include: {
        teams: true,
        participants: {
          include: {
            user: {
              select: {
                id: true,
                nickname: true,
                real_name: true,
                avatar_url: true,
                username: true,
              },
            },
            hero: {
              select: {
                id: true,
                code: true,
                display_name: true,
                art_url: true,
                power_code: true,
                power_label: true,
              },
            },
          },
        },
        rounds: {
          orderBy: { number: 'asc' },
          include: {
            answers: true,
            shootouts: true,
          },
        },
      },
    });

    if (!match) {
      throw new HttpException('Match not found', HttpStatus.NOT_FOUND);
    }

    if (admin.school_id && match.school_id !== admin.school_id) {
      throw new HttpException(
        'Match not found in your school',
        HttpStatus.NOT_FOUND,
      );
    }

    const formatted = {
      id: match.id,
      mode: match.mode,
      phase: match.phase,
      schoolId: match.school_id,
      classId: match.class_id,
      packId: match.pack_id,
      startedAt: match.started_at,
      finishedAt: match.finished_at,
      winnerTeamId: match.winner_team_id,
      teams: match.teams.map((t) => ({
        id: t.id,
        label: t.label,
        scoreXp: t.score_xp,
        scoreKindness: t.score_kindness,
        scoreBaskets: t.score_baskets,
      })),
      participants: match.participants.map((p) => ({
        id: p.id,
        teamId: p.team_id,
        userId: p.user_id,
        isBot: p.is_bot,
        jerseyNumber: p.jersey_number,
        heroId: p.hero_id,
        isConnected: p.is_connected,
        leftAt: p.left_at,
        powerUsed: p.power_used,
        nickname: p.user?.nickname ?? (p.is_bot ? 'Bot' : null),
        avatarUrl: p.user?.avatar_url ?? null,
        user: p.user
          ? {
              id: p.user.id,
              nickname: p.user.nickname,
              realName: p.user.real_name,
              avatarUrl: p.user.avatar_url,
              username: p.user.username,
            }
          : null,
        hero: p.hero
          ? {
              id: p.hero.id,
              code: p.hero.code,
              name: p.hero.display_name,
              displayName: p.hero.display_name,
              avatarUrl: p.hero.art_url,
              artUrl: p.hero.art_url,
              powerCode: p.hero.power_code,
              powerLabel: p.hero.power_label,
            }
          : null,
      })),
      rounds: match.rounds.map((r) => ({
        id: r.id,
        number: r.number,
        roundType: r.round_type,
        phase: r.phase,
        deadlineAt: r.deadline_at,
        buzzWinnerId: r.buzz_winner_id,
        answersCount: r.answers.length,
        shootoutsCount: r.shootouts.length,
      })),
      createdAt: match.created_at,
      updatedAt: match.updated_at,
    };

    return {
      success: true,
      data: formatted,
      ...formatted,
    };
  }

  async getEligibilityConfig(adminId: string) {
    const admin = await this.prisma.user.findUnique({
      where: { id: adminId },
    });
    if (!admin) {
      throw new HttpException('Admin user not found', HttpStatus.NOT_FOUND);
    }
    if (!admin.school_id) {
      throw new HttpException(
        'Admin does not belong to a school',
        HttpStatus.BAD_REQUEST,
      );
    }

    let config = await this.prisma.gameEligibilityConfig.findUnique({
      where: { school_id: admin.school_id },
    });

    if (!config) {
      config = await this.prisma.gameEligibilityConfig.create({
        data: {
          school_id: admin.school_id,
          required_stories: 2,
          required_chapters: 6,
          min_quiz_percent: 70,
        },
      });
    }

    const formatted = {
      schoolId: config.school_id,
      requiredStories: config.required_stories,
      requiredChapters: config.required_chapters,
      minQuizPercent: config.min_quiz_percent,
      required_stories: config.required_stories,
      required_chapters: config.required_chapters,
      min_quiz_percent: config.min_quiz_percent,
      createdAt: config.created_at,
      updatedAt: config.updated_at,
    };

    return {
      success: true,
      data: formatted,
      ...formatted,
    };
  }

  async updateEligibilityConfig(
    adminId: string,
    dto: UpdateEligibilityConfigDto,
  ) {
    const admin = await this.prisma.user.findUnique({
      where: { id: adminId },
    });
    if (!admin) {
      throw new HttpException('Admin user not found', HttpStatus.NOT_FOUND);
    }
    if (!admin.school_id) {
      throw new HttpException(
        'Admin does not belong to a school',
        HttpStatus.BAD_REQUEST,
      );
    }

    const stories = dto.requiredStories ?? dto.required_stories;
    const chapters = dto.requiredChapters ?? dto.required_chapters;
    const quiz = dto.minQuizPercent ?? dto.min_quiz_percent;

    if (
      (stories !== undefined &&
        (typeof stories !== 'number' ||
          stories < 0 ||
          !Number.isInteger(stories))) ||
      (chapters !== undefined &&
        (typeof chapters !== 'number' ||
          chapters < 0 ||
          !Number.isInteger(chapters))) ||
      (quiz !== undefined &&
        (typeof quiz !== 'number' || quiz < 0 || !Number.isInteger(quiz)))
    ) {
      throw new HttpException(
        'Config values must be non-negative integers',
        HttpStatus.BAD_REQUEST,
      );
    }

    const config = await this.prisma.gameEligibilityConfig.upsert({
      where: { school_id: admin.school_id },
      create: {
        school_id: admin.school_id,
        required_stories: stories ?? 2,
        required_chapters: chapters ?? 6,
        min_quiz_percent: quiz ?? 70,
      },
      update: {
        ...(stories !== undefined && { required_stories: stories }),
        ...(chapters !== undefined && { required_chapters: chapters }),
        ...(quiz !== undefined && { min_quiz_percent: quiz }),
      },
    });

    const formatted = {
      schoolId: config.school_id,
      requiredStories: config.required_stories,
      requiredChapters: config.required_chapters,
      minQuizPercent: config.min_quiz_percent,
      required_stories: config.required_stories,
      required_chapters: config.required_chapters,
      min_quiz_percent: config.min_quiz_percent,
      createdAt: config.created_at,
      updatedAt: config.updated_at,
    };

    return {
      success: true,
      data: formatted,
      ...formatted,
    };
  }
}
