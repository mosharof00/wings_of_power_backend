import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import {
  MatchMode,
  MatchPhase,
  Role,
  TicketStatus,
  UserStatus,
} from 'prisma/generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ProgressService } from '../progress/progress.service';
import { GameGateway } from './game.gateway';
import { MatchmakingService } from './matchmaking.service';
import { QueueService } from './queue.service';

describe('GameGateway', () => {
  let gateway: GameGateway;
  let prisma: any;
  let jwtService: any;
  let progressService: any;
  let queueService: QueueService;
  let matchmakingService: any;
  let mockServer: any;

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
      },
      gameMatch: {
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        findUnique: jest.fn(),
      },
      gameParticipant: {
        create: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      gameRound: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      matchmakingTicket: {
        create: jest.fn(),
        findFirst: jest.fn(),
        updateMany: jest.fn(),
      },
    };

    jwtService = {
      verify: jest.fn(),
    };

    progressService = {
      eligibilityFor: jest.fn(),
    };

    matchmakingService = {
      getRequiredPlayerCount: jest.fn((mode) =>
        mode === MatchMode.ONE_V_ONE ? 2 : 10,
      ),
      tryMatch: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GameGateway,
        QueueService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
        { provide: ProgressService, useValue: progressService },
        { provide: MatchmakingService, useValue: matchmakingService },
      ],
    }).compile();

    gateway = module.get<GameGateway>(GameGateway);
    queueService = module.get<QueueService>(QueueService);

    mockServer = {
      to: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnValue({
        socketsJoin: jest.fn(),
      }),
      emit: jest.fn(),
    };
    gateway.server = mockServer as any;
  });

  afterEach(() => {
    gateway.clearAllTimers();
    queueService.clear();
    jest.clearAllMocks();
  });

  describe('Authentication & Connection', () => {
    it('invalid token is rejected (missing token)', async () => {
      const mockClient: any = {
        handshake: { auth: {}, headers: {} },
        disconnect: jest.fn(),
        join: jest.fn(),
      };

      await gateway.handleConnection(mockClient);

      expect(mockClient.disconnect).toHaveBeenCalledWith(true);
      expect(mockClient.join).not.toHaveBeenCalled();
    });

    it('invalid token is rejected (jwt verify fails)', async () => {
      const mockClient: any = {
        handshake: { auth: { token: 'bad-token' } },
        disconnect: jest.fn(),
        join: jest.fn(),
      };
      jwtService.verify.mockImplementation(() => {
        throw new Error('Invalid token');
      });

      await gateway.handleConnection(mockClient);

      expect(mockClient.disconnect).toHaveBeenCalledWith(true);
      expect(mockClient.join).not.toHaveBeenCalled();
    });

    it('invalid token is rejected (user is not ACTIVE student)', async () => {
      const mockClient: any = {
        handshake: { auth: { token: 'valid-token' } },
        disconnect: jest.fn(),
        join: jest.fn(),
      };
      jwtService.verify.mockReturnValue({ sub: 'student-pending' });
      prisma.user.findUnique.mockResolvedValue({
        id: 'student-pending',
        role: Role.STUDENT,
        status: UserStatus.PENDING,
      });

      await gateway.handleConnection(mockClient);

      expect(mockClient.disconnect).toHaveBeenCalledWith(true);
      expect(mockClient.join).not.toHaveBeenCalled();
    });

    it('invalid token is rejected (user is TEACHER, not student)', async () => {
      const mockClient: any = {
        handshake: { auth: { token: 'teacher-token' } },
        disconnect: jest.fn(),
        join: jest.fn(),
      };
      jwtService.verify.mockReturnValue({ sub: 'teacher-1' });
      prisma.user.findUnique.mockResolvedValue({
        id: 'teacher-1',
        role: Role.TEACHER,
        status: UserStatus.ACTIVE,
      });

      await gateway.handleConnection(mockClient);

      expect(mockClient.disconnect).toHaveBeenCalledWith(true);
      expect(mockClient.join).not.toHaveBeenCalled();
    });

    it('valid token with ACTIVE student connects and joins user room', async () => {
      const mockClient: any = {
        handshake: { auth: { token: 'good-token' } },
        disconnect: jest.fn(),
        join: jest.fn(),
        data: {},
      };
      jwtService.verify.mockReturnValue({ sub: 'student-active' });
      prisma.user.findUnique.mockResolvedValue({
        id: 'student-active',
        role: Role.STUDENT,
        status: UserStatus.ACTIVE,
        school_id: 'school-1',
        nickname: 'Alice',
      });
      prisma.gameParticipant.findFirst.mockResolvedValue(null);

      await gateway.handleConnection(mockClient);

      expect(mockClient.disconnect).not.toHaveBeenCalled();
      expect(mockClient.join).toHaveBeenCalledWith('user:student-active');
      expect(mockClient.data.userId).toBe('student-active');
    });
  });

  describe('boot cancel (onModuleInit)', () => {
    it('boot cancel marks an old PLAYING row CANCELLED (call the init method directly)', async () => {
      prisma.gameMatch.updateMany.mockResolvedValue({ count: 3 });

      await gateway.onModuleInit();

      expect(prisma.gameMatch.updateMany).toHaveBeenCalledWith({
        where: {
          phase: {
            notIn: [MatchPhase.FINISHED, MatchPhase.CANCELLED],
          },
        },
        data: {
          phase: MatchPhase.CANCELLED,
        },
      });
    });

    it('cancelStaleMatches method directly updates stale matches', async () => {
      prisma.gameMatch.updateMany.mockResolvedValue({ count: 2 });

      const count = await gateway.cancelStaleMatches();

      expect(count).toBe(2);
      expect(prisma.gameMatch.updateMany).toHaveBeenCalledWith({
        where: {
          phase: {
            notIn: [MatchPhase.FINISHED, MatchPhase.CANCELLED],
          },
        },
        data: {
          phase: MatchPhase.CANCELLED,
        },
      });
    });
  });

  describe('Leave match (match:leave)', () => {
    it('leave emits peer-left and leaves phase unchanged', async () => {
      const mockClient: any = {
        data: { userId: 'student-leaving' },
        leave: jest.fn(),
      };

      prisma.gameParticipant.findFirst.mockResolvedValue({
        id: 'participant-1',
        match_id: 'match-xyz',
        user_id: 'student-leaving',
        left_at: null,
        user: {
          id: 'student-leaving',
          nickname: 'Speedy',
        },
        match: {
          id: 'match-xyz',
          phase: MatchPhase.PLAYING,
        },
      });

      prisma.gameParticipant.update.mockResolvedValue({
        id: 'participant-1',
        left_at: new Date(),
        is_connected: false,
      });

      await gateway.handleLeave(mockClient, { matchId: 'match-xyz' });

      // Marks participant left
      expect(prisma.gameParticipant.update).toHaveBeenCalledWith({
        where: { id: 'participant-1' },
        data: {
          left_at: expect.any(Date),
          is_connected: false,
        },
      });

      // Does NOT update gameMatch phase!
      expect(prisma.gameMatch.update).not.toHaveBeenCalled();
      expect(prisma.gameMatch.updateMany).not.toHaveBeenCalled();

      // Socket leaves match room
      expect(mockClient.leave).toHaveBeenCalledWith('match:match-xyz');

      // Emits match:peer_left to match room
      expect(mockServer.to).toHaveBeenCalledWith('match:match-xyz');
      expect(mockServer.emit).toHaveBeenCalledWith('match:peer_left', {
        userId: 'student-leaving',
        nickname: 'Speedy',
      });
    });
  });

  describe('Snapshot & Reconnect (match:snapshot)', () => {
    it('snapshot for a non-participant is MATCH_GONE', async () => {
      const mockClient: any = {
        data: { userId: 'intruder-user' },
        emit: jest.fn(),
        join: jest.fn(),
      };

      prisma.gameMatch.findUnique.mockResolvedValue({
        id: 'match-abc',
        phase: MatchPhase.PLAYING,
        teams: [],
        participants: [
          {
            id: 'part-1',
            user_id: 'other-user',
            left_at: null,
          },
        ],
        rounds: [],
      });

      const result = await gateway.handleSnapshot(mockClient, {
        matchId: 'match-abc',
      });

      expect(result).toEqual(
        expect.objectContaining({
          code: 'MATCH_GONE',
        }),
      );
      expect(mockClient.emit).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({ code: 'MATCH_GONE' }),
      );
      expect(mockClient.join).not.toHaveBeenCalled();
    });

    it('snapshot for participant who left permanently is MATCH_GONE', async () => {
      const mockClient: any = {
        data: { userId: 'left-user' },
        emit: jest.fn(),
        join: jest.fn(),
      };

      prisma.gameMatch.findUnique.mockResolvedValue({
        id: 'match-abc',
        phase: MatchPhase.PLAYING,
        teams: [],
        participants: [
          {
            id: 'part-left',
            user_id: 'left-user',
            left_at: new Date(),
          },
        ],
        rounds: [],
      });

      const result = await gateway.handleSnapshot(mockClient, {
        matchId: 'match-abc',
      });

      expect(result).toEqual(
        expect.objectContaining({
          code: 'MATCH_GONE',
        }),
      );
      expect(mockClient.emit).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({ code: 'MATCH_GONE' }),
      );
    });

    it('snapshot for active participant returns full snapshot and marks is_connected', async () => {
      const mockClient: any = {
        data: { userId: 'active-user' },
        emit: jest.fn(),
        join: jest.fn(),
      };

      const mockMatch = {
        id: 'match-live',
        phase: MatchPhase.PLAYING,
        teams: [
          {
            id: 'team-1',
            label: 'Team A',
            score_xp: 4,
            score_kindness: 50,
            score_baskets: 2,
          },
        ],
        participants: [
          {
            id: 'part-active',
            team_id: 'team-1',
            user_id: 'active-user',
            left_at: null,
            hero_id: 'hero-1',
            jersey_number: 1,
            is_connected: false,
            power_used: false,
            user: {
              id: 'active-user',
              nickname: 'Ace',
              avatar_url: 'ace.png',
            },
          },
        ],
        rounds: [
          {
            id: 'round-1',
            round_type: 'Q1_WARMUP',
            phase: 'ANSWER',
            deadline_at: new Date('2026-11-02T10:00:10Z'),
            number: 1,
          },
        ],
      };

      prisma.gameMatch.findUnique.mockResolvedValue(mockMatch);
      prisma.gameParticipant.update.mockResolvedValue({});

      const result = await gateway.handleSnapshot(mockClient, {
        matchId: 'match-live',
      });

      expect(result.code).toBeUndefined();
      expect(result.matchId).toBe('match-live');
      expect(result.phase).toBe(MatchPhase.PLAYING);
      expect(result.serverNow).toBeDefined();
      expect(result.teams).toHaveLength(1);
      expect(result.teams[0].members).toHaveLength(1);
      expect(result.you).toEqual({
        participantId: 'part-active',
        canBuzz: false,
        powerUsed: false,
        heroId: 'hero-1',
        jerseyNumber: 1,
      });

      expect(prisma.gameParticipant.update).toHaveBeenCalledWith({
        where: { id: 'part-active' },
        data: { is_connected: true },
      });
      expect(mockClient.join).toHaveBeenCalledWith('match:match-live');
      expect(mockClient.emit).toHaveBeenCalledWith('match:snapshot', result);
    });
  });

  describe('Queue Handling', () => {
    it('ineligible student emits queue:error INELIGIBLE', async () => {
      const mockClient: any = {
        data: {
          user: { id: 'student-ineligible' },
        },
        emit: jest.fn(),
      };

      progressService.eligibilityFor.mockResolvedValue({ eligible: false });

      await gateway.handleQueueJoin(mockClient, { mode: MatchMode.ONE_V_ONE });

      expect(mockClient.emit).toHaveBeenCalledWith('queue:error', {
        code: 'INELIGIBLE',
        message: 'Student is not eligible for game show',
      });
      expect(queueService.getQueue(MatchMode.ONE_V_ONE)).toHaveLength(0);
    });

    it('already queued student emits queue:error ALREADY_QUEUED', async () => {
      const mockClient: any = {
        data: {
          user: { id: 'student-queued' },
        },
        emit: jest.fn(),
      };

      progressService.eligibilityFor.mockResolvedValue({ eligible: true });
      prisma.matchmakingTicket.findFirst.mockResolvedValue({
        id: 'ticket-existing',
        status: TicketStatus.WAITING,
      });

      await gateway.handleQueueJoin(mockClient, { mode: MatchMode.ONE_V_ONE });

      expect(mockClient.emit).toHaveBeenCalledWith('queue:error', {
        code: 'ALREADY_QUEUED',
        message: 'Already queued for matchmaking',
      });
      expect(queueService.getQueue(MatchMode.ONE_V_ONE)).toHaveLength(0);
    });

    it('eligible student joins queue, updates ticket, and broadcasts queue:update', async () => {
      const mockClient: any = {
        data: {
          user: {
            id: 'student-eligible',
            school_id: 'school-1',
            nickname: 'Bob',
            avatar_url: 'bob.png',
          },
        },
        join: jest.fn(),
        emit: jest.fn(),
      };

      progressService.eligibilityFor.mockResolvedValue({ eligible: true });
      prisma.matchmakingTicket.findFirst.mockResolvedValue(null);
      prisma.matchmakingTicket.create.mockResolvedValue({
        id: 'ticket-new',
        user_id: 'student-eligible',
        status: TicketStatus.WAITING,
      });
      matchmakingService.tryMatch.mockResolvedValue(null);

      await gateway.handleQueueJoin(mockClient, { mode: MatchMode.ONE_V_ONE });

      expect(prisma.matchmakingTicket.create).toHaveBeenCalledWith({
        data: {
          user_id: 'student-eligible',
          mode: MatchMode.ONE_V_ONE,
          status: TicketStatus.WAITING,
        },
      });

      expect(mockClient.join).toHaveBeenCalledWith('queue:ONE_V_ONE');
      expect(mockServer.to).toHaveBeenCalledWith('queue:ONE_V_ONE');
      expect(mockServer.emit).toHaveBeenCalledWith('queue:update', {
        mode: MatchMode.ONE_V_ONE,
        filled: 1,
        required: 2,
        players: [
          {
            userId: 'student-eligible',
            nickname: 'Bob',
            avatarUrl: 'bob.png',
          },
        ],
      });
    });

    it('queue:cancel cancels active tickets and broadcasts queue:update', async () => {
      const mockClient: any = {
        data: { userId: 'student-cancelling' },
        leave: jest.fn(),
      };

      queueService.enqueue({
        ticketId: 't-cancel',
        userId: 'student-cancelling',
        schoolId: 'school-1',
        mode: MatchMode.ONE_V_ONE,
      });

      prisma.matchmakingTicket.updateMany.mockResolvedValue({ count: 1 });

      await gateway.handleQueueCancel(mockClient);

      expect(prisma.matchmakingTicket.updateMany).toHaveBeenCalledWith({
        where: { user_id: 'student-cancelling', status: TicketStatus.WAITING },
        data: { status: TicketStatus.CANCELLED },
      });

      expect(queueService.isQueued('student-cancelling')).toBe(false);
      expect(mockClient.leave).toHaveBeenCalledWith('queue:ONE_V_ONE');
      expect(mockClient.leave).toHaveBeenCalledWith('queue:FIVE_V_FIVE');
    });
  });

  describe('Countdown and Phase Transition', () => {
    it('startCountdown emits match:countdown and advances to PLAYING', async () => {
      prisma.gameMatch.update.mockResolvedValue({
        id: 'match-countdown-test',
        phase: MatchPhase.PLAYING,
      });

      await gateway.startCountdown('match-countdown-test', 50);

      expect(mockServer.to).toHaveBeenCalledWith('match:match-countdown-test');
      expect(mockServer.emit).toHaveBeenCalledWith('match:countdown', {
        matchId: 'match-countdown-test',
        deadlineAt: expect.any(String),
        value: 3,
      });

      // Wait for timer (50ms)
      await new Promise((resolve) => setTimeout(resolve, 80));

      expect(prisma.gameMatch.update).toHaveBeenCalledWith({
        where: { id: 'match-countdown-test' },
        data: {
          phase: MatchPhase.PLAYING,
          started_at: expect.any(Date),
        },
      });

      expect(mockServer.emit).toHaveBeenCalledWith('match:phase', {
        matchId: 'match-countdown-test',
        phase: MatchPhase.PLAYING,
      });
    });
  });

  describe('Pass, Q4 Vote, and Harmony (T-BE-GAME-012 Gateway Events)', () => {
    it('handlePass transfers answerer, emits buzz_winner and waiting events, and resets timer', async () => {
      const mockClient: any = {
        data: { userId: 'u-passer' },
        emit: jest.fn(),
      };

      prisma.gameParticipant.findFirst.mockResolvedValue({
        id: 'p-passer',
        user_id: 'u-passer',
        team_id: 't1',
      });

      jest.spyOn(gateway.roundService, 'pass').mockResolvedValue({
        roundId: 'r-pass-1',
        participantId: 'p-new',
        userId: 'u-new',
        deadlineAt: '2026-11-03T12:00:10.000Z',
        newAnswerer: { id: 'p-new', team_id: 't1' },
        match: {
          id: 'm-1',
          participants: [
            { id: 'p-passer', user_id: 'u-passer', team_id: 't1' },
            { id: 'p-new', user_id: 'u-new', team_id: 't1' },
            { id: 'p-opp', user_id: 'u-opp', team_id: 't2' },
          ],
        },
      } as any);

      const scheduleSpy = jest.spyOn(gateway, 'scheduleRoundTimer');

      await gateway.handlePass(mockClient, { roundId: 'r-pass-1' });

      // Emits round:buzz_winner to match
      expect(mockServer.to).toHaveBeenCalledWith('match:m-1');
      expect(mockServer.emit).toHaveBeenCalledWith('round:buzz_winner', {
        roundId: 'r-pass-1',
        participantId: 'p-new',
        userId: 'u-new',
        deadlineAt: '2026-11-03T12:00:10.000Z',
      });

      // Emits round:waiting with TEAMMATE to u-passer
      expect(mockServer.to).toHaveBeenCalledWith('user:u-passer');
      expect(mockServer.emit).toHaveBeenCalledWith('round:waiting', {
        roundId: 'r-pass-1',
        reason: 'TEAMMATE',
      });

      // Emits round:waiting with OPPONENT to u-opp
      expect(mockServer.to).toHaveBeenCalledWith('user:u-opp');
      expect(mockServer.emit).toHaveBeenCalledWith('round:waiting', {
        roundId: 'r-pass-1',
        reason: 'OPPONENT',
      });

      // Resets answer timer
      expect(scheduleSpy).toHaveBeenCalledWith('m-1', 'r-pass-1', 10000);
    });

    it('handleVote emits round:vote_update and triggers early resolve when allVoted is true', async () => {
      const mockClient: any = {
        data: { userId: 'u-voter' },
        emit: jest.fn(),
      };

      prisma.gameParticipant.findFirst.mockResolvedValue({
        id: 'p-voter',
        user_id: 'u-voter',
        team_id: 't1',
      });

      jest.spyOn(gateway.roundService, 'recordVote').mockResolvedValue({
        roundId: 'r-vote-1',
        submittedCount: 3,
        teamSize: 3,
        allVoted: true,
      });

      prisma.gameRound.findUnique.mockResolvedValue({
        id: 'r-vote-1',
        match_id: 'm-vote',
        phase: 'VOTE',
      });

      const resolveSpy = jest
        .spyOn(gateway, 'resolveVoteAndAdvance')
        .mockResolvedValue();

      await gateway.handleVote(mockClient, {
        roundId: 'r-vote-1',
        optionIndex: 0,
      });

      expect(mockServer.to).toHaveBeenCalledWith('match:m-vote');
      expect(mockServer.emit).toHaveBeenCalledWith('round:vote_update', {
        roundId: 'r-vote-1',
        submittedCount: 3,
        teamSize: 3,
      });

      expect(resolveSpy).toHaveBeenCalledWith('m-vote', 'r-vote-1');
    });

    it('handleHelpRequest echoes prompt and options to connected teammates', async () => {
      const mockClient: any = {
        data: { userId: 'u-ans' },
        emit: jest.fn(),
      };

      prisma.gameParticipant.findFirst.mockResolvedValue({
        id: 'p-ans',
        user_id: 'u-ans',
      });

      jest.spyOn(gateway.roundService, 'requestHelp').mockResolvedValue({
        roundId: 'r-help-1',
        prompt: 'Trivia prompt',
        options: ['A', 'B', 'C', 'D'],
        connectedTeammates: [{ id: 'p-team1', user_id: 'u-team1' }] as any,
      });

      await gateway.handleHelpRequest(mockClient, { roundId: 'r-help-1' });

      expect(mockServer.to).toHaveBeenCalledWith('user:u-team1');
      expect(mockServer.emit).toHaveBeenCalledWith('power:help_request', {
        roundId: 'r-help-1',
        prompt: 'Trivia prompt',
        options: ['A', 'B', 'C', 'D'],
      });
    });

    it('handleHelpSuggest relays optionIndex to answerer', async () => {
      const mockClient: any = {
        data: { userId: 'u-suggest' },
        emit: jest.fn(),
      };

      jest.spyOn(gateway.roundService, 'suggestHelp').mockResolvedValue({
        roundId: 'r-sug-1',
        fromUserId: 'u-suggest',
        forUserId: 'u-ans',
        optionIndex: 2,
      });

      await gateway.handleHelpSuggest(mockClient, {
        roundId: 'r-sug-1',
        forUserId: 'u-ans',
        optionIndex: 2,
      });

      expect(mockServer.to).toHaveBeenCalledWith('user:u-ans');
      expect(mockServer.emit).toHaveBeenCalledWith('power:help_suggest', {
        roundId: 'r-sug-1',
        fromUserId: 'u-suggest',
        optionIndex: 2,
      });
    });
  });
});
