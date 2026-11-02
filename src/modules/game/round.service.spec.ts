import { Test, TestingModule } from '@nestjs/testing';
import {
  GameRoundPhase,
  MatchMode,
  MatchPhase,
  PointsSource,
  PowerCode,
  RoundType,
} from 'prisma/generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FALLBACK_QUESTIONS, RoundService } from './round.service';

describe('RoundService', () => {
  let service: RoundService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      gameMatch: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      gameRound: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      gameParticipant: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      gameTeam: {
        findMany: jest.fn(),
        update: jest.fn(),
      },
      gameAnswer: {
        create: jest.fn(),
        findMany: jest.fn(),
      },
      gameShootout: {
        create: jest.fn(),
      },
      pointsLedger: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      pointRule: {
        findFirst: jest.fn(),
      },
      safeSpaceVisit: {
        create: jest.fn(),
      },
      gameQuestionPack: {
        findFirst: jest.fn(),
      },
      gamePackQuestion: {
        findFirst: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [RoundService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<RoundService>(RoundService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Fallback question and outbound payload', () => {
    it('uses fallback questions when no pack exists and hides correctIndex', async () => {
      prisma.gameMatch.findUnique.mockResolvedValue({
        id: 'match-1',
        school_id: 'school-1',
        participants: [],
      });
      prisma.gameQuestionPack.findFirst.mockResolvedValue(null);

      const qData = await service.getQuestionForRound(
        'match-1',
        RoundType.Q1_WARMUP,
      );
      expect(qData.prompt).toBe(FALLBACK_QUESTIONS[RoundType.Q1_WARMUP].prompt);
      expect(qData.options).toEqual(
        FALLBACK_QUESTIONS[RoundType.Q1_WARMUP].options,
      );

      const clientPayload = service.toClientQuestion(
        'round-1',
        qData,
        1,
        4,
        '2026-11-02T12:00:00Z',
      );
      expect(clientPayload).toEqual({
        roundId: 'round-1',
        prompt: qData.prompt,
        options: qData.options,
        roundType: RoundType.Q1_WARMUP,
        index: 1,
        total: 4,
        deadlineAt: '2026-11-02T12:00:00Z',
      });
      expect(clientPayload).not.toHaveProperty('correctIndex');
      expect((clientPayload as any).options[0]).not.toHaveProperty('isCorrect');
    });
  });

  describe('Buzzing', () => {
    it('second buzz does not replace the winner', async () => {
      const mockRound = {
        id: 'round-buzz-1',
        match_id: 'match-1',
        phase: GameRoundPhase.BUZZ,
        deadline_at: new Date(Date.now() + 10000),
        buzz_winner_id: null,
        match: {
          participants: [
            { id: 'part-1', user_id: 'user-1' },
            { id: 'part-2', user_id: 'user-2' },
          ],
          teams: [{ id: 'team-1' }],
        },
      };

      prisma.gameRound.findUnique.mockResolvedValue(mockRound);
      prisma.gameRound.update.mockResolvedValue({
        ...mockRound,
        buzz_winner_id: 'part-1',
        phase: GameRoundPhase.ANSWER,
      });

      const firstBuzz = await service.buzz('round-buzz-1', 'part-1');
      expect(firstBuzz.participantId).toBe('part-1');
      expect(prisma.gameRound.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'round-buzz-1' },
          data: expect.objectContaining({
            buzz_winner_id: 'part-1',
            phase: GameRoundPhase.ANSWER,
          }),
        }),
      );

      // Now round already has a buzz_winner_id
      const mockRoundWithWinner = {
        ...mockRound,
        buzz_winner_id: 'part-1',
        phase: GameRoundPhase.ANSWER,
      };
      prisma.gameRound.findUnique.mockResolvedValue(mockRoundWithWinner);

      // Second buzz must be rejected and not replace winner
      await expect(service.buzz('round-buzz-1', 'part-2')).rejects.toThrow();
      expect(mockRoundWithWinner.buzz_winner_id).toBe('part-1');
    });
  });

  describe('Answering', () => {
    it('answer after deadlineAt is rejected', async () => {
      const pastDeadline = new Date(Date.now() - 5000);
      const mockRound = {
        id: 'round-ans-1',
        match_id: 'match-1',
        phase: GameRoundPhase.ANSWER,
        deadline_at: pastDeadline,
        buzz_winner_id: 'part-1',
        round_type: RoundType.Q1_WARMUP,
        match: {
          participants: [{ id: 'part-1', user_id: 'user-1' }],
          teams: [{ id: 'team-1' }],
        },
      };

      prisma.gameRound.findUnique.mockResolvedValue(mockRound);

      await expect(
        service.submitAnswer('round-ans-1', 'part-1', 0),
      ).rejects.toThrow(/deadline/i);
      expect(prisma.gameAnswer.create).not.toHaveBeenCalled();
    });

    it('rejects answer from non-buzz-winner', async () => {
      const mockRound = {
        id: 'round-ans-2',
        match_id: 'match-1',
        phase: GameRoundPhase.ANSWER,
        deadline_at: new Date(Date.now() + 5000),
        buzz_winner_id: 'part-1',
        round_type: RoundType.Q1_WARMUP,
        match: {
          participants: [
            { id: 'part-1', user_id: 'user-1' },
            { id: 'part-2', user_id: 'user-2' },
          ],
          teams: [{ id: 'team-1' }],
        },
      };

      prisma.gameRound.findUnique.mockResolvedValue(mockRound);

      await expect(
        service.submitAnswer('round-ans-2', 'part-2', 0),
      ).rejects.toThrow(/buzz winner/i);
    });
  });

  describe('Q2 Kindness Round', () => {
    it('Q2 writes GAME_KINDNESS with kindness_amount 50 once', async () => {
      const mockRound = {
        id: 'round-q2',
        match_id: 'match-1',
        round_type: RoundType.Q2_DEFENSE,
        phase: GameRoundPhase.ANSWER,
        deadline_at: new Date(Date.now() + 40000),
        match: {
          school_id: 'school-1',
          participants: [
            { id: 'part-1', user_id: 'user-1', team_id: 'team-1' },
          ],
          teams: [
            {
              id: 'team-1',
              score_xp: 0,
              score_kindness: 0,
              score_baskets: 0,
            },
          ],
        },
      };

      prisma.gameRound.findUnique.mockResolvedValue(mockRound);
      prisma.gameTeam.findMany.mockResolvedValue([
        { id: 'team-1', score_xp: 0, score_kindness: 50, score_baskets: 0 },
      ]);
      prisma.pointRule.findFirst.mockResolvedValue({
        school_id: 'school-1',
        key: 'KINDNESS_ROUND',
        value_int: 50,
      });

      // First submission: no prior ledger entry
      prisma.pointsLedger.findFirst.mockResolvedValue(null);

      const res1 = await service.submitQ2Answer(
        'round-q2',
        'part-1',
        'I will stand next to my friend and support them.',
      );

      expect(res1.kindnessDelta).toBe(50);
      expect(prisma.pointsLedger.create).toHaveBeenCalledTimes(1);
      expect(prisma.pointsLedger.create).toHaveBeenCalledWith({
        data: {
          user_id: 'user-1',
          source: PointsSource.GAME_KINDNESS,
          amount: 50,
          kindness_amount: 50,
          label: 'Kindness Round',
          ref_type: 'GameRound',
          ref_id: 'round-q2',
        },
      });

      // Second submission: ledger entry already exists
      prisma.pointsLedger.findFirst.mockResolvedValue({
        id: 'ledger-existing',
      });

      const res2 = await service.submitQ2Answer(
        'round-q2',
        'part-1',
        'Updated answer',
      );

      expect(res2.kindnessDelta).toBe(0);
      // Still only 1 create call in total
      expect(prisma.pointsLedger.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('Q4 Team Vote', () => {
    it('Q4 tally hides choices until resolve; majority wins; 1v1 uses the single vote', async () => {
      // 1. Voting tally hides choices during voting
      const mockRoundMulti = {
        id: 'round-q4-multi',
        match_id: 'match-multi',
        round_type: RoundType.Q4_FINALS,
        phase: GameRoundPhase.VOTE,
        deadline_at: new Date(Date.now() + 15000),
        match: {
          mode: MatchMode.FIVE_V_FIVE,
          participants: [
            { id: 'p1', user_id: 'u1', team_id: 't1' },
            { id: 'p2', user_id: 'u2', team_id: 't1' },
            { id: 'p3', user_id: 'u3', team_id: 't1' },
          ],
        },
      };

      prisma.gameRound.findUnique.mockResolvedValue(mockRoundMulti);
      prisma.gameAnswer.findMany.mockResolvedValue([
        { id: 'ans-1', voted_option_index: 0 },
        { id: 'ans-2', voted_option_index: 0 },
      ]);

      const voteUpdate = await service.recordVote('round-q4-multi', 'p2', 0);
      expect(voteUpdate).toEqual({
        roundId: 'round-q4-multi',
        submittedCount: 2,
        teamSize: 3,
      });
      expect(voteUpdate).not.toHaveProperty('optionIndex');
      expect(voteUpdate).not.toHaveProperty('tallies');

      // 2. Majority wins in multi-player
      const roundWith3Votes = {
        ...mockRoundMulti,
        answers: [
          { participant_id: 'p1', voted_option_index: 0 },
          { participant_id: 'p2', voted_option_index: 0 },
          { participant_id: 'p3', voted_option_index: 1 },
        ],
      };
      prisma.gameRound.findUnique.mockResolvedValue(roundWith3Votes);
      prisma.gameRound.update.mockResolvedValue({});

      const multiResult = await service.resolveVote('round-q4-multi');
      expect(multiResult.winningOptionIndex).toBe(0); // 2 votes for 0, 1 vote for 1
      expect(multiResult.tallies).toEqual({ 0: 2, 1: 1 });
      expect(multiResult.correct).toBe(true); // 0 is fallback correctIndex

      // 3. 1v1 uses the single vote
      const mockRound1v1 = {
        id: 'round-q4-1v1',
        match_id: 'match-1v1',
        round_type: RoundType.Q4_FINALS,
        phase: GameRoundPhase.VOTE,
        match: {
          mode: MatchMode.ONE_V_ONE,
          participants: [
            { id: 'solo-1', user_id: 'u-solo', team_id: 'team-solo' },
          ],
          teams: [{ id: 'team-solo' }],
        },
        answers: [{ participant_id: 'solo-1', voted_option_index: 0 }],
      };
      prisma.gameRound.findUnique.mockResolvedValue(mockRound1v1);

      const singleResult = await service.resolveVote('round-q4-1v1');
      expect(singleResult.winningOptionIndex).toBe(0);
      expect(singleResult.correct).toBe(true);
    });
  });

  describe('Powers (Q3)', () => {
    it('second power:use is rejected', async () => {
      const mockParticipant = {
        id: 'part-power',
        user_id: 'user-p',
        power_used: false,
      };

      prisma.gameParticipant.findUnique.mockResolvedValue(mockParticipant);
      prisma.gameRound.findUnique.mockResolvedValue({
        id: 'round-p',
        deadline_at: new Date(Date.now() + 10000),
      });
      prisma.gameParticipant.update.mockResolvedValue({
        ...mockParticipant,
        power_used: true,
      });

      const firstUse = await service.usePower(
        'round-p',
        'part-power',
        PowerCode.MELODY,
      );
      expect(firstUse.powerCode).toBe(PowerCode.MELODY);
      expect(firstUse.effect.type).toBe('extraMs');
      expect(prisma.gameParticipant.update).toHaveBeenCalledWith({
        where: { id: 'part-power' },
        data: { power_used: true },
      });

      // Second power use
      prisma.gameParticipant.findUnique.mockResolvedValue({
        ...mockParticipant,
        power_used: true,
      });

      await expect(
        service.usePower('round-p', 'part-power', PowerCode.COLOR),
      ).rejects.toThrow(/already used/i);
    });
  });

  describe('Shootout', () => {
    it('swipe from a non-shooter is rejected', async () => {
      const mockRound = {
        id: 'round-shootout',
        match_id: 'match-1',
        phase: GameRoundPhase.SHOOTOUT,
        buzz_winner_id: 'designated-shooter',
        deadline_at: new Date(Date.now() + 30000),
        match: {
          participants: [
            {
              id: 'designated-shooter',
              user_id: 'user-shooter',
              team_id: 'team-1',
            },
            { id: 'other-player', user_id: 'user-other', team_id: 'team-2' },
          ],
          teams: [{ id: 'team-1' }, { id: 'team-2' }],
        },
      };

      prisma.gameRound.findUnique.mockResolvedValue(mockRound);

      // Non-shooter swipe
      await expect(
        service.submitShootoutSwipe('round-shootout', 'other-player', true),
      ).rejects.toThrow(/designated shooter/i);
      expect(prisma.gameShootout.create).not.toHaveBeenCalled();

      // Designated shooter swipe
      prisma.gameShootout.create.mockResolvedValue({
        id: 'shoot-1',
        made: true,
        xp_awarded: 3,
      });
      prisma.gameTeam.findMany.mockResolvedValue([
        { id: 'team-1', score_xp: 3, score_kindness: 0, score_baskets: 1 },
      ]);

      const validSwipe = await service.submitShootoutSwipe(
        'round-shootout',
        'designated-shooter',
        true,
      );
      expect(validSwipe.made).toBe(true);
      expect(validSwipe.xp).toBe(3);
      expect(prisma.gameShootout.create).toHaveBeenCalledWith({
        data: {
          round_id: 'round-shootout',
          shooter_participant_id: 'designated-shooter',
          made: true,
          xp_awarded: 3,
          multiplier: 1,
        },
      });
      expect(prisma.gameTeam.update).toHaveBeenCalledWith({
        where: { id: 'team-1' },
        data: {
          score_xp: { increment: 3 },
          score_baskets: { increment: 1 },
        },
      });
    });
  });

  describe('Safe Space during match', () => {
    it('safespace:enter does not change deadlineAt', async () => {
      const fixedDeadline = new Date(Date.now() + 25000);
      const mockRound = {
        id: 'round-live',
        match_id: 'match-ss',
        deadline_at: fixedDeadline,
      };

      prisma.safeSpaceVisit.create.mockResolvedValue({
        id: 'visit-1',
        user_id: 'user-calm',
        match_id: 'match-ss',
      });

      const visit = await service.enterSafeSpace('user-calm', 'match-ss');
      expect(visit.user_id).toBe('user-calm');
      expect(prisma.safeSpaceVisit.create).toHaveBeenCalledWith({
        data: {
          user_id: 'user-calm',
          match_id: 'match-ss',
        },
      });

      // Round deadline in DB remains completely unchanged
      expect(prisma.gameRound.update).not.toHaveBeenCalled();
      expect(mockRound.deadline_at).toEqual(fixedDeadline);
    });
  });

  describe('Finish Match', () => {
    it('finish sets winner_team_id from score_xp', async () => {
      const mockMatch = {
        id: 'match-finish-test',
        teams: [
          {
            id: 'team-alpha',
            score_xp: 9,
            score_kindness: 100,
            score_baskets: 3,
          },
          {
            id: 'team-beta',
            score_xp: 6,
            score_kindness: 50,
            score_baskets: 2,
          },
        ],
      };

      prisma.gameMatch.findUnique.mockResolvedValue(mockMatch);
      prisma.gameMatch.update.mockResolvedValue({
        ...mockMatch,
        phase: MatchPhase.FINISHED,
        winner_team_id: 'team-alpha',
      });

      const result = await service.finishMatch('match-finish-test');
      expect(result.winnerTeamId).toBe('team-alpha');
      expect(prisma.gameMatch.update).toHaveBeenCalledWith({
        where: { id: 'match-finish-test' },
        data: {
          phase: MatchPhase.FINISHED,
          finished_at: expect.any(Date),
          winner_team_id: 'team-alpha',
        },
      });

      // Tie test
      const mockTieMatch = {
        id: 'match-tie-test',
        teams: [
          { id: 'team-1', score_xp: 6, score_kindness: 50, score_baskets: 2 },
          { id: 'team-2', score_xp: 6, score_kindness: 50, score_baskets: 2 },
        ],
      };
      prisma.gameMatch.findUnique.mockResolvedValue(mockTieMatch);

      const tieResult = await service.finishMatch('match-tie-test');
      expect(tieResult.winnerTeamId).toBeNull();
      expect(prisma.gameMatch.update).toHaveBeenCalledWith({
        where: { id: 'match-tie-test' },
        data: {
          phase: MatchPhase.FINISHED,
          finished_at: expect.any(Date),
          winner_team_id: null,
        },
      });
    });
  });
});
