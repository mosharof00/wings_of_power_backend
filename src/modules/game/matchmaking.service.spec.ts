import { Test, TestingModule } from '@nestjs/testing';
import { MatchMode, MatchPhase, TicketStatus } from 'prisma/generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MatchmakingService } from './matchmaking.service';
import { QueueService } from './queue.service';

describe('MatchmakingService', () => {
  let service: MatchmakingService;
  let queueService: QueueService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      user: {
        findMany: jest.fn(),
      },
      gameMatch: {
        create: jest.fn(),
      },
      gameParticipant: {
        create: jest.fn(),
      },
      matchmakingTicket: {
        updateMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MatchmakingService,
        QueueService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<MatchmakingService>(MatchmakingService);
    queueService = module.get<QueueService>(QueueService);
  });

  afterEach(() => {
    queueService.clear();
    jest.clearAllMocks();
  });

  describe('getRequiredPlayerCount', () => {
    it('returns 2 for ONE_V_ONE', () => {
      expect(service.getRequiredPlayerCount(MatchMode.ONE_V_ONE)).toBe(2);
    });

    it('returns 10 for FIVE_V_FIVE', () => {
      expect(service.getRequiredPlayerCount(MatchMode.FIVE_V_FIVE)).toBe(10);
    });

    it('returns 1 for SINGLE', () => {
      expect(service.getRequiredPlayerCount(MatchMode.SINGLE)).toBe(1);
    });
  });

  describe('tryMatch', () => {
    it('FIVE_V_FIVE does not start at 9 players', async () => {
      for (let i = 1; i <= 9; i++) {
        queueService.enqueue({
          ticketId: `ticket-${i}`,
          userId: `user-${i}`,
          schoolId: 'school-1',
          mode: MatchMode.FIVE_V_FIVE,
        });
      }

      expect(queueService.getQueue(MatchMode.FIVE_V_FIVE)).toHaveLength(9);

      const result = await service.tryMatch(MatchMode.FIVE_V_FIVE);

      expect(result).toBeNull();
      expect(prisma.gameMatch.create).not.toHaveBeenCalled();
      expect(queueService.getQueue(MatchMode.FIVE_V_FIVE)).toHaveLength(9);
    });

    it('two ONE_V_ONE tickets produce one match and match:found payload with two members', async () => {
      queueService.enqueue({
        ticketId: 't-1',
        userId: 'u-1',
        schoolId: 'school-1',
        mode: MatchMode.ONE_V_ONE,
      });
      queueService.enqueue({
        ticketId: 't-2',
        userId: 'u-2',
        schoolId: 'school-1',
        mode: MatchMode.ONE_V_ONE,
      });

      prisma.user.findMany.mockResolvedValue([
        {
          id: 'u-1',
          nickname: 'Alice',
          avatar_url: 'alice.png',
          selected_hero_id: 'hero-alice',
          school_id: 'school-1',
        },
        {
          id: 'u-2',
          nickname: 'Bob',
          avatar_url: 'bob.png',
          selected_hero_id: 'hero-bob',
          school_id: 'school-1',
        },
      ]);

      const mockMatch = {
        id: 'match-123',
        school_id: 'school-1',
        mode: MatchMode.ONE_V_ONE,
        phase: MatchPhase.COUNTDOWN,
        teams: [
          {
            id: 'team-a-id',
            match_id: 'match-123',
            label: 'Team A',
            score_xp: 0,
            score_kindness: 0,
            score_baskets: 0,
          },
          {
            id: 'team-b-id',
            match_id: 'match-123',
            label: 'Team B',
            score_xp: 0,
            score_kindness: 0,
            score_baskets: 0,
          },
        ],
      };
      prisma.gameMatch.create.mockResolvedValue(mockMatch);
      prisma.gameParticipant.create.mockImplementation((args: any) =>
        Promise.resolve({ id: `part-${args.data.user_id}`, ...args.data }),
      );
      prisma.matchmakingTicket.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.tryMatch(MatchMode.ONE_V_ONE);

      expect(result).not.toBeNull();
      expect(result?.matchId).toBe('match-123');
      expect(result?.mode).toBe(MatchMode.ONE_V_ONE);
      expect(result?.teams).toHaveLength(2);

      const teamA = result?.teams.find((t) => t.label === 'Team A');
      const teamB = result?.teams.find((t) => t.label === 'Team B');
      expect(teamA?.members).toHaveLength(1);
      expect(teamB?.members).toHaveLength(1);

      const allMembers = [...(teamA?.members ?? []), ...(teamB?.members ?? [])];
      expect(allMembers).toHaveLength(2);
      expect(allMembers.map((m) => m.userId).sort()).toEqual(['u-1', 'u-2']);

      // Verifies hero id is mapped from selected_hero_id
      const aliceMember = allMembers.find((m) => m.userId === 'u-1');
      expect(aliceMember?.heroId).toBe('hero-alice');
      const bobMember = allMembers.find((m) => m.userId === 'u-2');
      expect(bobMember?.heroId).toBe('hero-bob');

      // Check DB calls
      expect(prisma.gameMatch.create).toHaveBeenCalledWith({
        data: {
          school_id: 'school-1',
          mode: MatchMode.ONE_V_ONE,
          phase: MatchPhase.COUNTDOWN,
          started_at: expect.any(Date),
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
        include: { teams: true },
      });

      expect(prisma.gameParticipant.create).toHaveBeenCalledTimes(2);
      expect(prisma.matchmakingTicket.updateMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['t-1', 't-2'] },
        },
        data: {
          status: TicketStatus.MATCHED,
          match_id: 'match-123',
        },
      });

      // Queue is now empty
      expect(queueService.getQueue(MatchMode.ONE_V_ONE)).toHaveLength(0);
    });

    it('FIVE_V_FIVE starts at 10 players and creates 5 members per team', async () => {
      for (let i = 1; i <= 10; i++) {
        queueService.enqueue({
          ticketId: `t-${i}`,
          userId: `u-${i}`,
          schoolId: 'school-1',
          mode: MatchMode.FIVE_V_FIVE,
        });
      }

      prisma.user.findMany.mockResolvedValue(
        Array.from({ length: 10 }, (_, i) => ({
          id: `u-${i + 1}`,
          nickname: `User${i + 1}`,
          avatar_url: null,
          selected_hero_id: `hero-${i + 1}`,
          school_id: 'school-1',
        })),
      );

      prisma.gameMatch.create.mockResolvedValue({
        id: 'match-5v5',
        school_id: 'school-1',
        mode: MatchMode.FIVE_V_FIVE,
        phase: MatchPhase.COUNTDOWN,
        teams: [
          { id: 'team-a-5v5', label: 'Team A' },
          { id: 'team-b-5v5', label: 'Team B' },
        ],
      });
      prisma.gameParticipant.create.mockResolvedValue({});
      prisma.matchmakingTicket.updateMany.mockResolvedValue({ count: 10 });

      const result = await service.tryMatch(MatchMode.FIVE_V_FIVE);

      expect(result).not.toBeNull();
      expect(result?.matchId).toBe('match-5v5');
      expect(result?.teams[0].members).toHaveLength(5);
      expect(result?.teams[1].members).toHaveLength(5);
      expect(queueService.getQueue(MatchMode.FIVE_V_FIVE)).toHaveLength(0);
    });
  });
});
