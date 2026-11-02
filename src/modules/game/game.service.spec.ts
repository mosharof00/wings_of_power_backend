import { HttpException, HttpStatus } from '@nestjs/common';
import {
  JoinRequestStatus,
  MatchMode,
  MatchPhase,
  Role,
  TicketStatus,
  UserStatus,
} from 'prisma/generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ProgressService } from '../progress/progress.service';
import { GameService } from './game.service';
import { QueueService } from './queue.service';

describe('GameService', () => {
  let service: GameService;
  let queueService: QueueService;
  let progressService: {
    eligibilityFor: jest.Mock;
  };
  let prisma: {
    user: {
      findUnique: jest.Mock;
    };
    pointRule: {
      findFirst: jest.Mock;
    };
    matchmakingTicket: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      updateMany: jest.Mock;
    };
    gameMatch: {
      create: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    gameParticipant: {
      create: jest.Mock;
      update: jest.Mock;
    };
    gameEligibilityConfig: {
      findUnique: jest.Mock;
      create: jest.Mock;
      upsert: jest.Mock;
    };
  };

  const studentUser = {
    id: 'student-1',
    role: Role.STUDENT,
    status: UserStatus.ACTIVE,
    nickname: 'HeroKid',
    real_name: 'Kid Hero',
    avatar_url: 'https://example.com/avatar.png',
    school_id: 'school-1',
    selected_hero_id: 'hero-1',
    memberships: [
      {
        class_id: 'class-1',
        status: JoinRequestStatus.APPROVED,
        class: { school_id: 'school-1' },
      },
    ],
  };

  const adminUser = {
    id: 'admin-1',
    role: Role.ADMIN,
    status: UserStatus.ACTIVE,
    school_id: 'school-1',
  };

  beforeEach(() => {
    queueService = new QueueService();

    progressService = {
      eligibilityFor: jest.fn().mockResolvedValue({
        eligible: true,
        progress: {
          storiesCompleted: 2,
          chaptersCompleted: 6,
          quizMean: 85,
        },
        rules: {
          requiredStories: 2,
          requiredChapters: 6,
          minQuizPercent: 70,
        },
      }),
    };

    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(studentUser),
      },
      pointRule: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      matchmakingTicket: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 'ticket-1',
            ...data,
            created_at: new Date(),
            updated_at: new Date(),
          }),
        ),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      gameMatch: {
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 'match-1',
            school_id: data.school_id,
            mode: data.mode,
            phase: data.phase,
            class_id: data.class_id,
            teams: [
              {
                id: 'team-1',
                match_id: 'match-1',
                label: 'Single Player',
                score_xp: 0,
                score_kindness: 0,
                score_baskets: 0,
              },
            ],
            participants: [],
            rounds: [],
            created_at: new Date(),
            updated_at: new Date(),
          }),
        ),
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      gameParticipant: {
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 'participant-1',
            ...data,
            left_at: null,
            created_at: new Date(),
            updated_at: new Date(),
          }),
        ),
        update: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 'participant-1',
            ...data,
          }),
        ),
      },
      gameEligibilityConfig: {
        findUnique: jest.fn(),
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            school_id: data.school_id,
            required_stories: data.required_stories ?? 2,
            required_chapters: data.required_chapters ?? 6,
            min_quiz_percent: data.min_quiz_percent ?? 70,
            created_at: new Date(),
            updated_at: new Date(),
          }),
        ),
        upsert: jest.fn().mockImplementation(({ create, update }) =>
          Promise.resolve({
            school_id: create.school_id,
            required_stories:
              update.required_stories ?? create.required_stories,
            required_chapters:
              update.required_chapters ?? create.required_chapters,
            min_quiz_percent:
              update.min_quiz_percent ?? create.min_quiz_percent,
            created_at: new Date(),
            updated_at: new Date(),
          }),
        ),
      },
    };

    service = new GameService(
      prisma as unknown as PrismaService,
      progressService as unknown as ProgressService,
      queueService,
    );
  });

  describe('GET /api/game/eligibility', () => {
    it('returns eligibility status and progress', async () => {
      const res = await service.getEligibility('student-1');
      expect(res.eligible).toBe(true);
      expect(res.progress.storiesCompleted).toBe(2);
      expect(res.rules.requiredStories).toBe(2);
      expect(progressService.eligibilityFor).toHaveBeenCalledWith('student-1');
    });

    it('throws 404 if user not found', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);
      await expect(service.getEligibility('missing')).rejects.toThrow(
        HttpException,
      );
    });
  });

  describe('GET /api/game/how-to-play', () => {
    it('returns static quarters and rules with default 50 kindness', async () => {
      const res = await service.getHowToPlay('student-1');
      expect(res.quarters).toHaveLength(4);
      expect(res.rules.buzzTimeSeconds).toBe(10);
      expect(res.rules.answerTimeSeconds).toBe(10);
      expect(res.rules.q2TimeSeconds).toBe(60);
      expect(res.rules.q4VoteTimeSeconds).toBe(20);
      expect(res.rules.kindnessPoints).toBe(50);
    });

    it('uses custom PointRule KINDNESS_ROUND when available', async () => {
      prisma.pointRule.findFirst.mockResolvedValueOnce({
        key: 'KINDNESS_ROUND',
        value_int: 75,
      });
      const res = await service.getHowToPlay('student-1');
      expect(res.rules.kindnessPoints).toBe(75);
    });
  });

  describe('POST /api/game/queue & required tests', () => {
    it('ineligible queue → 422', async () => {
      progressService.eligibilityFor.mockResolvedValueOnce({
        eligible: false,
        progress: {
          storiesCompleted: 0,
          chaptersCompleted: 1,
          quizMean: 50,
        },
        rules: {
          requiredStories: 2,
          requiredChapters: 6,
          minQuizPercent: 70,
        },
      });

      await expect(
        service.joinQueue('student-1', { mode: MatchMode.ONE_V_ONE }),
      ).rejects.toThrow(
        new HttpException(
          'Student is not eligible for game show',
          HttpStatus.UNPROCESSABLE_ENTITY,
        ),
      );
    });

    it('double queue → 409 when already queued in memory or WAITING ticket in DB', async () => {
      // First, simulate WAITING ticket exists in DB
      prisma.matchmakingTicket.findFirst.mockResolvedValueOnce({
        id: 'ticket-existing',
        user_id: 'student-1',
        status: TicketStatus.WAITING,
      });

      await expect(
        service.joinQueue('student-1', { mode: MatchMode.ONE_V_ONE }),
      ).rejects.toThrow(
        new HttpException(
          'Already queued for matchmaking',
          HttpStatus.CONFLICT,
        ),
      );

      // Next, simulate in-memory queue
      queueService.enqueue({
        ticketId: 'ticket-mem',
        userId: 'student-1',
        schoolId: 'school-1',
        mode: MatchMode.ONE_V_ONE,
      });

      await expect(
        service.joinQueue('student-1', { mode: MatchMode.ONE_V_ONE }),
      ).rejects.toThrow(
        new HttpException(
          'Already queued for matchmaking',
          HttpStatus.CONFLICT,
        ),
      );
    });

    it('SINGLE response includes matchId and one participant', async () => {
      const res = await service.joinQueue('student-1', {
        mode: MatchMode.SINGLE,
      });

      expect(res.matchId).toBe('match-1');
      expect(res.ticketId).toBe('ticket-1');
      expect(prisma.gameMatch.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            mode: MatchMode.SINGLE,
            phase: MatchPhase.COUNTDOWN,
          }),
        }),
      );
      expect(prisma.gameParticipant.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            match_id: 'match-1',
            user_id: 'student-1',
            jersey_number: 1,
          }),
        }),
      );
    });

    it('multiplayer queue (ONE_V_ONE) creates WAITING ticket and enqueues in memory', async () => {
      const res = await service.joinQueue('student-1', {
        mode: MatchMode.ONE_V_ONE,
      });

      expect(res.ticketId).toBe('ticket-1');
      expect(res.matchId).toBeUndefined();
      expect(queueService.isQueued('student-1')).toBe(true);
      expect(prisma.matchmakingTicket.create).toHaveBeenCalledWith({
        data: {
          user_id: 'student-1',
          mode: MatchMode.ONE_V_ONE,
          status: TicketStatus.WAITING,
        },
      });
    });

    it('cancel leaves no WAITING ticket', async () => {
      // Put in queue first
      queueService.enqueue({
        ticketId: 'ticket-1',
        userId: 'student-1',
        schoolId: 'school-1',
        mode: MatchMode.ONE_V_ONE,
      });
      expect(queueService.isQueued('student-1')).toBe(true);

      const cancelRes = await service.cancelQueue('student-1');
      expect(cancelRes.success).toBe(true);

      // Verify db updateMany sets status to CANCELLED
      expect(prisma.matchmakingTicket.updateMany).toHaveBeenCalledWith({
        where: {
          user_id: 'student-1',
          status: TicketStatus.WAITING,
        },
        data: {
          status: TicketStatus.CANCELLED,
        },
      });

      // Verify memory queue is cleared for user
      expect(queueService.isQueued('student-1')).toBe(false);
    });
  });

  describe('GET /api/game/matches/:id & leave', () => {
    const activeMatch = {
      id: 'match-1',
      school_id: 'school-1',
      class_id: 'class-1',
      mode: MatchMode.SINGLE,
      phase: MatchPhase.COUNTDOWN,
      started_at: null,
      finished_at: null,
      winner_team_id: null,
      created_at: new Date(),
      updated_at: new Date(),
      teams: [
        {
          id: 'team-1',
          match_id: 'match-1',
          label: 'Single Player',
          score_xp: 0,
          score_kindness: 0,
          score_baskets: 0,
        },
      ],
      participants: [
        {
          id: 'participant-1',
          match_id: 'match-1',
          team_id: 'team-1',
          user_id: 'student-1',
          is_bot: false,
          jersey_number: 1,
          hero_id: 'hero-1',
          is_connected: true,
          left_at: null,
          power_used: false,
          user: {
            id: 'student-1',
            nickname: 'HeroKid',
            real_name: 'Kid Hero',
            avatar_url: 'https://example.com/avatar.png',
            username: 'herokid',
          },
          hero: {
            id: 'hero-1',
            code: 'captain-kindness',
            display_name: 'Captain Kindness',
            art_url: 'https://example.com/hero.png',
            power_code: 'MELODY',
            power_label: 'Melody Boost',
          },
        },
      ],
      rounds: [],
    };

    it('participant can read snapshot', async () => {
      prisma.gameMatch.findUnique.mockResolvedValueOnce(activeMatch);
      const res = await service.getMatchSnapshot('student-1', 'match-1');
      expect(res.id).toBe('match-1');
      expect(res.participants).toHaveLength(1);
      expect(res.participants[0].nickname).toBe('HeroKid');
    });

    it('another student cannot read the match (403)', async () => {
      prisma.gameMatch.findUnique.mockResolvedValueOnce(activeMatch);
      await expect(
        service.getMatchSnapshot('another-student', 'match-1'),
      ).rejects.toThrow(
        new HttpException(
          'Forbidden - not a participant in this match',
          HttpStatus.FORBIDDEN,
        ),
      );
    });

    it('leave sets left_at', async () => {
      prisma.gameMatch.findUnique.mockResolvedValueOnce(activeMatch);
      const now = new Date();
      prisma.gameParticipant.update.mockResolvedValueOnce({
        id: 'participant-1',
        left_at: now,
        is_connected: false,
      });

      const res = await service.leaveMatch('student-1', 'match-1');
      expect(res.success).toBe(true);
      expect(prisma.gameParticipant.update).toHaveBeenCalledWith({
        where: { id: 'participant-1' },
        data: {
          left_at: expect.any(Date),
          is_connected: false,
        },
      });
    });

    it('leave throws 403 if not participant', async () => {
      prisma.gameMatch.findUnique.mockResolvedValueOnce(activeMatch);
      await expect(service.leaveMatch('intruder', 'match-1')).rejects.toThrow(
        new HttpException(
          'Forbidden - not a participant in this match',
          HttpStatus.FORBIDDEN,
        ),
      );
    });
  });

  describe('Admin game matches & eligibility config', () => {
    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue(adminUser);
    });

    it('lists matches with pagination and filters', async () => {
      prisma.gameMatch.count.mockResolvedValueOnce(1);
      prisma.gameMatch.findMany.mockResolvedValueOnce([
        {
          id: 'match-1',
          school_id: 'school-1',
          mode: MatchMode.ONE_V_ONE,
          phase: MatchPhase.PLAYING,
          teams: [],
          participants: [],
          created_at: new Date(),
          updated_at: new Date(),
        },
      ]);

      const res = await service.listAdminMatches('admin-1', {
        page: 1,
        perPage: 10,
        mode: MatchMode.ONE_V_ONE,
        phase: MatchPhase.PLAYING,
      });

      expect(res.total).toBe(1);
      expect(res.items).toHaveLength(1);
      expect(prisma.gameMatch.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            school_id: 'school-1',
            mode: MatchMode.ONE_V_ONE,
            phase: MatchPhase.PLAYING,
          },
        }),
      );
    });

    it('gets match detail with teams and participants', async () => {
      prisma.gameMatch.findUnique.mockResolvedValueOnce({
        id: 'match-1',
        school_id: 'school-1',
        mode: MatchMode.ONE_V_ONE,
        phase: MatchPhase.FINISHED,
        teams: [
          {
            id: 'team-1',
            label: 'Team A',
            score_xp: 10,
            score_kindness: 50,
            score_baskets: 5,
          },
        ],
        participants: [
          {
            id: 'p-1',
            team_id: 'team-1',
            user_id: 'student-1',
            is_bot: false,
            jersey_number: 1,
            is_connected: true,
            left_at: null,
            power_used: false,
            user: {
              id: 'student-1',
              nickname: 'HeroKid',
              real_name: 'Kid Hero',
              avatar_url: 'https://example.com/avatar.png',
              username: 'herokid',
            },
            hero: null,
          },
        ],
        rounds: [],
        created_at: new Date(),
        updated_at: new Date(),
      });

      const res = await service.getAdminMatchDetail('admin-1', 'match-1');
      expect(res.id).toBe('match-1');
      expect(res.participants[0].nickname).toBe('HeroKid');
      expect(res.teams[0].scoreXp).toBe(10);
    });

    it('get eligibility config creates defaults 2/6/70 when missing', async () => {
      prisma.gameEligibilityConfig.findUnique.mockResolvedValueOnce(null);

      const res = await service.getEligibilityConfig('admin-1');
      expect(res.requiredStories).toBe(2);
      expect(res.requiredChapters).toBe(6);
      expect(res.minQuizPercent).toBe(70);
      expect(prisma.gameEligibilityConfig.create).toHaveBeenCalledWith({
        data: {
          school_id: 'school-1',
          required_stories: 2,
          required_chapters: 6,
          min_quiz_percent: 70,
        },
      });
    });

    it('admin patch updates 2/6/70 style integers; negative → 400', async () => {
      // 1. Negative integer throws 400
      await expect(
        service.updateEligibilityConfig('admin-1', {
          requiredStories: -1,
        }),
      ).rejects.toThrow(
        new HttpException(
          'Config values must be non-negative integers',
          HttpStatus.BAD_REQUEST,
        ),
      );

      // 2. Negative minQuizPercent throws 400
      await expect(
        service.updateEligibilityConfig('admin-1', {
          min_quiz_percent: -5,
        }),
      ).rejects.toThrow(
        new HttpException(
          'Config values must be non-negative integers',
          HttpStatus.BAD_REQUEST,
        ),
      );

      // 3. Valid update succeeds
      const res = await service.updateEligibilityConfig('admin-1', {
        requiredStories: 3,
        requiredChapters: 8,
        minQuizPercent: 75,
      });

      expect(res.requiredStories).toBe(3);
      expect(res.requiredChapters).toBe(8);
      expect(res.minQuizPercent).toBe(75);
      expect(prisma.gameEligibilityConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { school_id: 'school-1' },
          create: expect.objectContaining({
            required_stories: 3,
            required_chapters: 8,
            min_quiz_percent: 75,
          }),
          update: expect.objectContaining({
            required_stories: 3,
            required_chapters: 8,
            min_quiz_percent: 75,
          }),
        }),
      );
    });
  });
});
