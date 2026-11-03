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
        findFirst: jest.fn(),
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
        allVoted: false,
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

      // 4. Strict majority tallies: (2, 2, 1) is a tie on top and awards no ball
      const roundTie221 = {
        ...mockRoundMulti,
        answers: [
          { participant_id: 'p1', voted_option_index: 0 },
          { participant_id: 'p2', voted_option_index: 0 },
          { participant_id: 'p3', voted_option_index: 1 },
          { participant_id: 'p4', voted_option_index: 1 },
          { participant_id: 'p5', voted_option_index: 2 },
        ],
      };
      prisma.gameRound.findUnique.mockResolvedValue(roundTie221);
      const tieResult = await service.resolveVote('round-q4-multi');
      expect(tieResult.winningOptionIndex).toBeNull();
      expect(tieResult.correct).toBe(false);
      expect(tieResult.designatedShooterId).toBeNull();

      // 5. Strict majority tallies: (A, A, B, B) tie awards no ball
      const roundTieAABB = {
        ...mockRoundMulti,
        answers: [
          { participant_id: 'p1', voted_option_index: 0 },
          { participant_id: 'p2', voted_option_index: 0 },
          { participant_id: 'p3', voted_option_index: 1 },
          { participant_id: 'p4', voted_option_index: 1 },
        ],
      };
      prisma.gameRound.findUnique.mockResolvedValue(roundTieAABB);
      const tieAABBResult = await service.resolveVote('round-q4-multi');
      expect(tieAABBResult.winningOptionIndex).toBeNull();
      expect(tieAABBResult.correct).toBe(false);

      // 6. Strict majority tallies: (3, 1, 1) awards the option with 3
      const round311 = {
        ...mockRoundMulti,
        answers: [
          { participant_id: 'p1', voted_option_index: 0 },
          { participant_id: 'p2', voted_option_index: 0 },
          { participant_id: 'p3', voted_option_index: 0 },
          { participant_id: 'p4', voted_option_index: 1 },
          { participant_id: 'p5', voted_option_index: 2 },
        ],
      };
      prisma.gameRound.findUnique.mockResolvedValue(round311);
      const res311 = await service.resolveVote('round-q4-multi');
      expect(res311.winningOptionIndex).toBe(0);
      expect(res311.correct).toBe(true);

      // 7. One vote and four silent teammates -> that vote wins at 20s
      const round1Vote = {
        ...mockRoundMulti,
        answers: [{ participant_id: 'p1', voted_option_index: 2 }],
      };
      prisma.gameRound.findUnique.mockResolvedValue(round1Vote);
      const res1Vote = await service.resolveVote('round-q4-multi');
      expect(res1Vote.winningOptionIndex).toBe(2);

      // 8. Disconnected members not in denominator and early resolve
      const roundWithDisconnected = {
        id: 'round-q4-disc',
        match_id: 'match-disc',
        round_type: RoundType.Q4_FINALS,
        phase: GameRoundPhase.VOTE,
        match: {
          mode: MatchMode.FIVE_V_FIVE,
          participants: [
            {
              id: 'p1',
              user_id: 'u1',
              team_id: 't1',
              is_connected: true,
              left_at: null,
            },
            {
              id: 'p2',
              user_id: 'u2',
              team_id: 't1',
              is_connected: true,
              left_at: null,
            },
            {
              id: 'p3',
              user_id: 'u3',
              team_id: 't1',
              is_connected: true,
              left_at: null,
            },
            {
              id: 'p4',
              user_id: 'u4',
              team_id: 't1',
              is_connected: false,
              left_at: null,
            },
            {
              id: 'p5',
              user_id: 'u5',
              team_id: 't1',
              is_connected: false,
              left_at: new Date(),
            },
          ],
        },
      };
      prisma.gameRound.findUnique.mockResolvedValue(roundWithDisconnected);
      prisma.gameAnswer.findMany.mockResolvedValue([
        { id: 'ans-1', participant_id: 'p1', voted_option_index: 0 },
        { id: 'ans-2', participant_id: 'p2', voted_option_index: 0 },
        { id: 'ans-3', participant_id: 'p3', voted_option_index: 1 },
      ]);
      const discVoteUpdate = await service.recordVote('round-q4-disc', 'p3', 1);
      // Denominator is 3 connected members (p4, p5 excluded)
      expect(discVoteUpdate.teamSize).toBe(3);
      expect(discVoteUpdate.submittedCount).toBe(3);
      expect(discVoteUpdate.allVoted).toBe(true);
    });
  });

  describe('Pass once (T-BE-GAME-012)', () => {
    beforeEach(() => {
      service.resetState();
    });

    it('rejects pass in 1v1 mode and when team has no teammates', async () => {
      const mockRound1v1 = {
        id: 'round-pass-1v1',
        round_type: RoundType.Q1_WARMUP,
        phase: GameRoundPhase.ANSWER,
        buzz_winner_id: 'p-solo',
        match: {
          mode: MatchMode.ONE_V_ONE,
          participants: [
            { id: 'p-solo', user_id: 'u-solo', team_id: 't-solo' },
          ],
          teams: [{ id: 't-solo' }],
        },
      };
      prisma.gameRound.findUnique.mockResolvedValue(mockRound1v1);

      await expect(service.pass('round-pass-1v1', 'p-solo')).rejects.toThrow(
        /not allowed in 1v1 mode/i,
      );
    });

    it('rejects pass in Q2 and Q4', async () => {
      const mockRoundQ2 = {
        id: 'round-pass-q2',
        round_type: RoundType.Q2_DEFENSE,
        phase: GameRoundPhase.ANSWER,
        buzz_winner_id: 'p1',
        match: {
          mode: MatchMode.FIVE_V_FIVE,
          participants: [{ id: 'p1', user_id: 'u1', team_id: 't1' }],
        },
      };
      prisma.gameRound.findUnique.mockResolvedValue(mockRoundQ2);

      await expect(service.pass('round-pass-q2', 'p1')).rejects.toThrow(
        /only allowed in Q1 and Q3/i,
      );
    });

    it('rejects pass from non-answerer', async () => {
      const mockRound = {
        id: 'round-pass-non',
        round_type: RoundType.Q1_WARMUP,
        phase: GameRoundPhase.ANSWER,
        buzz_winner_id: 'p1',
        match: {
          mode: MatchMode.FIVE_V_FIVE,
          participants: [
            { id: 'p1', user_id: 'u1', team_id: 't1' },
            { id: 'p2', user_id: 'u2', team_id: 't1' },
          ],
        },
      };
      prisma.gameRound.findUnique.mockResolvedValue(mockRound);

      await expect(service.pass('round-pass-non', 'p2')).rejects.toThrow(
        /only current answerer/i,
      );
    });

    it('transfers answer right to lowest jersey_number teammate, resets deadline, and rejects second pass', async () => {
      const mockRound = {
        id: 'round-pass-success',
        round_type: RoundType.Q1_WARMUP,
        phase: GameRoundPhase.ANSWER,
        buzz_winner_id: 'p-answerer',
        deadline_at: new Date(Date.now() + 5000),
        match: {
          id: 'match-5v5',
          mode: MatchMode.FIVE_V_FIVE,
          participants: [
            {
              id: 'p-answerer',
              user_id: 'u-ans',
              team_id: 't1',
              jersey_number: 1,
              is_connected: true,
              left_at: null,
            },
            {
              id: 'p-teammate-high',
              user_id: 'u-high',
              team_id: 't1',
              jersey_number: 9,
              is_connected: true,
              left_at: null,
            },
            {
              id: 'p-teammate-low',
              user_id: 'u-low',
              team_id: 't1',
              jersey_number: 3,
              is_connected: true,
              left_at: null,
            },
            {
              id: 'p-teammate-disc',
              user_id: 'u-disc',
              team_id: 't1',
              jersey_number: 2,
              is_connected: false,
              left_at: null,
            },
            {
              id: 'p-opponent',
              user_id: 'u-opp',
              team_id: 't2',
              jersey_number: 1,
              is_connected: true,
              left_at: null,
            },
          ],
          teams: [{ id: 't1' }, { id: 't2' }],
        },
      };

      prisma.gameRound.findUnique.mockResolvedValue(mockRound);
      prisma.gameRound.update.mockResolvedValue({});

      const passResult = await service.pass('round-pass-success', 'p-answerer');
      // Lowest connected teammate is p-teammate-low (jersey 3, jersey 2 is disconnected)
      expect(passResult.participantId).toBe('p-teammate-low');
      expect(passResult.userId).toBe('u-low');
      expect(prisma.gameRound.update).toHaveBeenCalledWith({
        where: { id: 'round-pass-success' },
        data: {
          buzz_winner_id: 'p-teammate-low',
          deadline_at: expect.any(Date),
        },
      });

      // Second pass is rejected
      const roundAfterPass = {
        ...mockRound,
        buzz_winner_id: 'p-teammate-low',
      };
      prisma.gameRound.findUnique.mockResolvedValue(roundAfterPass);
      await expect(
        service.pass('round-pass-success', 'p-teammate-low'),
      ).rejects.toThrow(/pass already used/i);
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

    it('Harmony power is rejected in 1v1 mode', async () => {
      const mockParticipant = {
        id: 'p-solo',
        user_id: 'u-solo',
        team_id: 't-solo',
        power_used: false,
      };
      prisma.gameParticipant.findUnique.mockResolvedValue(mockParticipant);
      prisma.gameRound.findUnique.mockResolvedValue({
        id: 'round-1v1-harm',
        round_type: RoundType.Q3_HOBBY,
        phase: GameRoundPhase.ANSWER,
        match: {
          mode: MatchMode.ONE_V_ONE,
          participants: [mockParticipant],
        },
      });

      await expect(
        service.usePower('round-1v1-harm', 'p-solo', PowerCode.HARMONY),
      ).rejects.toThrow(/harmony not allowed in 1v1 mode/i);
    });

    it('power:help_request echoes prompt and options to connected teammates without key', async () => {
      const mockRound = {
        id: 'round-q3-help',
        round_type: RoundType.Q3_HOBBY,
        phase: GameRoundPhase.ANSWER,
        buzz_winner_id: 'ans-part',
        deadline_at: new Date(Date.now() + 10000),
        match: {
          id: 'match-5v5',
          mode: MatchMode.FIVE_V_FIVE,
          participants: [
            {
              id: 'ans-part',
              user_id: 'u-ans',
              team_id: 't1',
              is_connected: true,
              left_at: null,
            },
            {
              id: 'teammate-1',
              user_id: 'u-team1',
              team_id: 't1',
              is_connected: true,
              left_at: null,
            },
            {
              id: 'teammate-disc',
              user_id: 'u-disc',
              team_id: 't1',
              is_connected: false,
              left_at: null,
            },
            {
              id: 'opp-part',
              user_id: 'u-opp',
              team_id: 't2',
              is_connected: true,
              left_at: null,
            },
          ],
        },
        question: {
          id: 'q-pack-1',
          prompt: 'What hobby helps reduce stress?',
          options_json: [
            { text: 'Painting', isCorrect: true },
            { text: 'Bullying', isCorrect: false },
          ],
          round_type: RoundType.Q3_HOBBY,
        },
      };

      prisma.gameRound.findUnique.mockResolvedValue(mockRound);

      const helpRes = await service.requestHelp('round-q3-help', 'ans-part');
      expect(helpRes.roundId).toBe('round-q3-help');
      expect(helpRes.prompt).toBe('What hobby helps reduce stress?');
      expect(helpRes.options).toEqual(['Painting', 'Bullying']);
      expect((helpRes as any).correctIndex).toBeUndefined();
      expect(helpRes.connectedTeammates).toHaveLength(1);
      expect(helpRes.connectedTeammates[0].id).toBe('teammate-1');
    });

    it('power:help_suggest validates teammates, bounds, and accepts only first suggestion', async () => {
      service.resetState();

      const mockRound = {
        id: 'round-q3-sug',
        round_type: RoundType.Q3_HOBBY,
        phase: GameRoundPhase.ANSWER,
        buzz_winner_id: 'ans-part',
        deadline_at: new Date(Date.now() + 10000),
        match: {
          id: 'match-5v5',
          mode: MatchMode.FIVE_V_FIVE,
          participants: [
            { id: 'ans-part', user_id: 'u-ans', team_id: 't1' },
            { id: 'team-part-1', user_id: 'u-team1', team_id: 't1' },
            { id: 'team-part-2', user_id: 'u-team2', team_id: 't1' },
            { id: 'opp-part', user_id: 'u-opp', team_id: 't2' },
          ],
        },
        question: {
          id: 'q-pack-1',
          prompt: 'Question?',
          options_json: ['Option 0', 'Option 1', 'Option 2'],
          round_type: RoundType.Q3_HOBBY,
        },
      };

      prisma.gameRound.findUnique.mockResolvedValue(mockRound);

      // 1. Suggesting to themself rejected
      await expect(
        service.suggestHelp('round-q3-sug', 'u-ans', 'u-ans', 0),
      ).rejects.toThrow(/cannot suggest to yourself/i);

      // 2. Opponent suggestion rejected
      await expect(
        service.suggestHelp('round-q3-sug', 'u-opp', 'u-ans', 0),
      ).rejects.toThrow(/opponents cannot suggest help/i);

      // 3. Option index outside bounds rejected
      await expect(
        service.suggestHelp('round-q3-sug', 'u-team1', 'u-ans', 99),
      ).rejects.toThrow(/outside options list/i);

      // 4. Valid first suggestion succeeds
      const firstSug = await service.suggestHelp(
        'round-q3-sug',
        'u-team1',
        'u-ans',
        1,
      );
      expect(firstSug).toEqual({
        roundId: 'round-q3-sug',
        fromUserId: 'u-team1',
        forUserId: 'u-ans',
        optionIndex: 1,
      });
      expect((firstSug as any).correctIndex).toBeUndefined();

      // 5. Second suggestion rejected (first wins)
      await expect(
        service.suggestHelp('round-q3-sug', 'u-team2', 'u-ans', 0),
      ).rejects.toThrow(/already been submitted/i);
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
