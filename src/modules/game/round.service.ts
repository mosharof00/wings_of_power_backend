import { Injectable } from '@nestjs/common';
import {
  GameRoundPhase,
  MatchMode,
  MatchPhase,
  PointsSource,
  PowerCode,
  PublishStatus,
  RoundType,
} from 'prisma/generated/client';
import { PrismaService } from '../../prisma/prisma.service';

export class GameError extends Error {
  constructor(
    public readonly code:
      | 'FORBIDDEN'
      | 'TOO_LATE'
      | 'NOT_FOUND'
      | 'INVALID_PHASE'
      | 'ALREADY_USED',
    message: string,
  ) {
    super(message);
    this.name = 'GameError';
  }
}

export interface PowerEffect {
  type: 'removedOptions' | 'extraMs' | 'hint' | 'freeze';
  value?: any;
}

export const POWER_EFFECT_MAP: Record<PowerCode, PowerEffect> = {
  [PowerCode.MELODY]: { type: 'extraMs', value: 10000 },
  [PowerCode.COLOR]: { type: 'extraMs', value: 10000 },
  [PowerCode.LAB]: { type: 'removedOptions', value: [2, 3] },
  [PowerCode.CHECKMATE]: { type: 'removedOptions', value: [1, 3] },
  [PowerCode.NATURE]: { type: 'freeze', value: 5000 },
  [PowerCode.PRISM]: { type: 'freeze', value: 5000 },
  [PowerCode.HARMONY]: {
    type: 'hint',
    value: 'Harmony: Teammate advice enabled',
  },
  [PowerCode.STORY]: {
    type: 'hint',
    value: 'Story: Recall the lesson of empathy',
  },
};

export interface RoundQuestionData {
  id?: string;
  prompt: string;
  options: string[];
  correctIndex?: number;
  roundType: RoundType;
}

export const FALLBACK_QUESTIONS: Record<RoundType, RoundQuestionData> = {
  [RoundType.Q1_WARMUP]: {
    prompt: 'What should you do when you see someone being bullied?',
    options: [
      'Speak up or find a trusted adult',
      'Join in the teasing',
      'Record it on your phone and laugh',
      'Ignore it completely',
    ],
    correctIndex: 0,
    roundType: RoundType.Q1_WARMUP,
  },
  [RoundType.Q2_DEFENSE]: {
    prompt:
      'Describe a time you or someone else showed kindness to a classmate.',
    options: [],
    roundType: RoundType.Q2_DEFENSE,
  },
  [RoundType.Q3_HOBBY]: {
    prompt:
      'Which activity is a great way to express creativity and relieve stress?',
    options: [
      'Painting and drawing',
      'Gossiping about peers',
      'Skipping homework',
      'Yelling at others',
    ],
    correctIndex: 0,
    roundType: RoundType.Q3_HOBBY,
  },
  [RoundType.Q4_FINALS]: {
    prompt:
      'What is the most effective way for a team to build an inclusive culture?',
    options: [
      'Include and support everyone regardless of differences',
      'Form exclusive cliques',
      'Only talk to people who look like you',
      'Blame others when things go wrong',
    ],
    correctIndex: 0,
    roundType: RoundType.Q4_FINALS,
  },
};

@Injectable()
export class RoundService {
  private readonly passedRoundIds = new Set<string>();
  private readonly roundSuggestions = new Map<
    string,
    { fromUserId: string; optionIndex: number }
  >();

  constructor(private readonly prisma: PrismaService) {}

  resetState(): void {
    this.passedRoundIds.clear();
    this.roundSuggestions.clear();
  }

  async getTeamScores(matchId: string) {
    const teams = await this.prisma.gameTeam.findMany({
      where: { match_id: matchId },
    });
    return teams.reduce(
      (acc, t) => {
        acc[t.id] = {
          xp: t.score_xp,
          kindness: t.score_kindness,
          baskets: t.score_baskets,
        };
        return acc;
      },
      {} as Record<string, { xp: number; kindness: number; baskets: number }>,
    );
  }

  parsePackQuestion(q: any): RoundQuestionData {
    let options: string[] = [];
    let correctIndex: number | undefined;

    const rawOptions = q.options_json;
    if (Array.isArray(rawOptions)) {
      if (
        rawOptions.length > 0 &&
        typeof rawOptions[0] === 'object' &&
        rawOptions[0] !== null
      ) {
        options = rawOptions.map((o: any) => o.label || o.text || String(o));
        const idx = rawOptions.findIndex(
          (o: any) => o.isCorrect === true || o.is_correct === true,
        );
        if (idx >= 0) correctIndex = idx;
      } else {
        options = rawOptions.map(String);
        if (q.meta_json && typeof q.meta_json.correctIndex === 'number') {
          correctIndex = q.meta_json.correctIndex;
        }
      }
    } else if (rawOptions && typeof rawOptions === 'object') {
      if (Array.isArray(rawOptions.options)) {
        options = rawOptions.options.map(String);
        if (typeof rawOptions.correctIndex === 'number') {
          correctIndex = rawOptions.correctIndex;
        }
      }
    }

    if (
      correctIndex === undefined &&
      q.meta_json &&
      typeof q.meta_json.correctIndex === 'number'
    ) {
      correctIndex = q.meta_json.correctIndex;
    }

    return {
      id: q.id,
      prompt: q.prompt,
      options,
      correctIndex,
      roundType: q.round_type,
    };
  }

  async getQuestionForRound(
    matchId: string,
    roundType: RoundType,
  ): Promise<RoundQuestionData> {
    const match = await this.prisma.gameMatch.findUnique({
      where: { id: matchId },
      include: {
        participants: {
          include: {
            user: {
              include: {
                memberships: {
                  include: { class: true },
                },
              },
            },
          },
        },
      },
    });

    if (!match) {
      return FALLBACK_QUESTIONS[roundType];
    }

    let packId = match.pack_id;
    if (!packId) {
      let ageGroup: any = null;
      for (const p of match.participants) {
        const cls = p.user?.memberships?.[0]?.class;
        if (cls?.age_group) {
          ageGroup = cls.age_group;
          break;
        }
      }

      let pack = null;
      if (ageGroup) {
        pack = await this.prisma.gameQuestionPack.findFirst({
          where: {
            school_id: match.school_id,
            status: PublishStatus.PUBLISHED,
            age_group: ageGroup,
          },
          orderBy: { created_at: 'desc' },
        });
      }

      if (!pack) {
        pack = await this.prisma.gameQuestionPack.findFirst({
          where: {
            school_id: match.school_id,
            status: PublishStatus.PUBLISHED,
          },
          orderBy: { created_at: 'desc' },
        });
      }

      if (pack) {
        packId = pack.id;
      }
    }

    if (packId) {
      const q = await this.prisma.gamePackQuestion.findFirst({
        where: {
          pack_id: packId,
          round_type: roundType,
        },
        orderBy: { sort_order: 'asc' },
      });

      if (q) {
        return this.parsePackQuestion(q);
      }
    }

    return FALLBACK_QUESTIONS[roundType];
  }

  toClientQuestion(
    roundId: string,
    question: RoundQuestionData,
    index = 1,
    total = 1,
    deadlineAt: string,
  ) {
    return {
      roundId,
      prompt: question.prompt,
      options: question.options,
      roundType: question.roundType,
      index,
      total,
      deadlineAt,
    };
  }

  async getSnapshotQuestion(round: any) {
    if (round.question) {
      const parsed = this.parsePackQuestion(round.question);
      return {
        prompt: parsed.prompt,
        options: parsed.options,
      };
    }
    const fallback = FALLBACK_QUESTIONS[round.round_type as RoundType];
    return {
      prompt: fallback?.prompt ?? '',
      options: fallback?.options ?? [],
    };
  }

  async createRound(matchId: string, roundType: RoundType, number: number) {
    const question = await this.getQuestionForRound(matchId, roundType);

    let phase: GameRoundPhase = GameRoundPhase.BUZZ;
    let durationMs = 10000;

    if (roundType === RoundType.Q1_WARMUP) {
      phase = GameRoundPhase.BUZZ;
      durationMs = 10000;
    } else if (roundType === RoundType.Q2_DEFENSE) {
      phase = GameRoundPhase.ANSWER;
      durationMs = 60000;
    } else if (roundType === RoundType.Q3_HOBBY) {
      phase = GameRoundPhase.BUZZ;
      durationMs = 10000;
    } else if (roundType === RoundType.Q4_FINALS) {
      phase = GameRoundPhase.VOTE;
      durationMs = 20000;
    }

    const deadlineAt = new Date(Date.now() + durationMs);

    const round = await this.prisma.gameRound.create({
      data: {
        match_id: matchId,
        round_type: roundType,
        number,
        question_id: question.id ?? null,
        phase,
        deadline_at: deadlineAt,
      },
      include: {
        match: {
          include: { teams: true, participants: true },
        },
      },
    });

    return { round, question, durationMs };
  }

  async buzz(roundId: string, participantId: string) {
    const round = await this.prisma.gameRound.findUnique({
      where: { id: roundId },
      include: {
        match: {
          include: { participants: true, teams: true },
        },
      },
    });

    if (!round) {
      throw new GameError('NOT_FOUND', 'Round not found');
    }

    if (round.phase !== GameRoundPhase.BUZZ) {
      throw new GameError('FORBIDDEN', 'Round is not in buzz phase');
    }

    if (round.deadline_at && new Date() > round.deadline_at) {
      throw new GameError('TOO_LATE', 'Buzz window expired');
    }

    if (round.buzz_winner_id) {
      throw new GameError(
        'FORBIDDEN',
        'Buzz already claimed by another participant',
      );
    }

    const participant = round.match.participants.find(
      (p) => p.id === participantId,
    );
    if (!participant) {
      throw new GameError('FORBIDDEN', 'Participant not in this match');
    }

    const newDeadline = new Date(Date.now() + 10000);
    await this.prisma.gameRound.update({
      where: { id: roundId },
      data: {
        buzz_winner_id: participantId,
        phase: GameRoundPhase.ANSWER,
        deadline_at: newDeadline,
      },
    });

    return {
      roundId,
      participantId,
      userId: participant.user_id,
      deadlineAt: newDeadline.toISOString(),
    };
  }

  async submitAnswer(
    roundId: string,
    participantId: string,
    optionIndex?: number,
  ) {
    const round = await this.prisma.gameRound.findUnique({
      where: { id: roundId },
      include: {
        match: {
          include: { participants: true, teams: true },
        },
        question: true,
      },
    });

    if (!round) {
      throw new GameError('NOT_FOUND', 'Round not found');
    }

    if (round.phase !== GameRoundPhase.ANSWER) {
      throw new GameError('FORBIDDEN', 'Round is not in answer phase');
    }

    if (round.deadline_at && new Date() > round.deadline_at) {
      throw new GameError('TOO_LATE', 'Answer deadline expired');
    }

    if (round.buzz_winner_id !== participantId) {
      throw new GameError('FORBIDDEN', 'Only buzz winner can submit answer');
    }

    const participant = round.match.participants.find(
      (p) => p.id === participantId,
    );
    if (!participant) {
      throw new GameError('FORBIDDEN', 'Participant not found');
    }

    let correctIndex: number | undefined;
    if (round.question) {
      const parsed = this.parsePackQuestion(round.question);
      correctIndex = parsed.correctIndex;
    } else {
      correctIndex = FALLBACK_QUESTIONS[round.round_type]?.correctIndex;
    }

    const isCorrect =
      typeof optionIndex === 'number' && optionIndex === correctIndex;

    await this.prisma.gameAnswer.create({
      data: {
        round_id: roundId,
        participant_id: participantId,
        option_index: optionIndex ?? null,
        is_correct: isCorrect,
        submitted_at: new Date(),
      },
    });

    const scores = await this.getTeamScores(round.match_id);

    return {
      roundId,
      userId: participant.user_id,
      correct: isCorrect,
      scores,
      kindnessDelta: 0,
    };
  }

  async submitQ2Answer(
    roundId: string,
    participantId: string,
    freeText?: string,
  ) {
    const round = await this.prisma.gameRound.findUnique({
      where: { id: roundId },
      include: {
        match: {
          include: { participants: true, teams: true },
        },
      },
    });

    if (!round) {
      throw new GameError('NOT_FOUND', 'Round not found');
    }

    if (round.deadline_at && new Date() > round.deadline_at) {
      throw new GameError('TOO_LATE', 'Answer deadline expired');
    }

    const participant = round.match.participants.find(
      (p) => p.id === participantId,
    );
    if (!participant) {
      throw new GameError('FORBIDDEN', 'Participant not found');
    }

    const isNonEmpty =
      typeof freeText === 'string' && freeText.trim().length > 0;

    await this.prisma.gameAnswer.create({
      data: {
        round_id: roundId,
        participant_id: participantId,
        free_text: freeText ?? null,
        is_correct: isNonEmpty,
        submitted_at: new Date(),
      },
    });

    let kindnessDelta = 0;
    if (isNonEmpty && participant.user_id) {
      const existingLedger = await this.prisma.pointsLedger.findFirst({
        where: {
          user_id: participant.user_id,
          ref_type: 'GameRound',
          ref_id: roundId,
          source: PointsSource.GAME_KINDNESS,
        },
      });

      if (!existingLedger) {
        let kindnessAmount = 50;
        const rule = await this.prisma.pointRule.findFirst({
          where: {
            school_id: round.match.school_id,
            key: 'KINDNESS_ROUND',
          },
        });
        if (rule && typeof rule.value_int === 'number') {
          kindnessAmount = rule.value_int;
        }

        await this.prisma.pointsLedger.create({
          data: {
            user_id: participant.user_id,
            source: PointsSource.GAME_KINDNESS,
            amount: kindnessAmount,
            kindness_amount: kindnessAmount,
            label: 'Kindness Round',
            ref_type: 'GameRound',
            ref_id: roundId,
          },
        });

        await this.prisma.gameTeam.update({
          where: { id: participant.team_id },
          data: {
            score_kindness: { increment: kindnessAmount },
          },
        });

        kindnessDelta = kindnessAmount;
      }
    }

    const scores = await this.getTeamScores(round.match_id);

    return {
      roundId,
      userId: participant.user_id,
      correct: true,
      scores,
      kindnessDelta,
    };
  }

  async usePower(roundId: string, participantId: string, powerCode: PowerCode) {
    const participant = await this.prisma.gameParticipant.findUnique({
      where: { id: participantId },
    });

    if (!participant) {
      throw new GameError('NOT_FOUND', 'Participant not found');
    }

    if (participant.power_used) {
      throw new GameError('FORBIDDEN', 'Power already used');
    }

    const round = await this.prisma.gameRound.findUnique({
      where: { id: roundId },
      include: {
        match: {
          include: {
            participants: true,
          },
        },
      },
    });

    if (!round) {
      throw new GameError('NOT_FOUND', 'Round not found');
    }

    if (
      powerCode === PowerCode.HARMONY &&
      (round.match?.mode === MatchMode.ONE_V_ONE ||
        round.match?.mode === MatchMode.SINGLE ||
        (round.match?.participants &&
          round.match.participants.filter(
            (p) => p.team_id === participant.team_id,
          ).length <= 1))
    ) {
      throw new GameError('FORBIDDEN', 'Harmony not allowed in 1v1 mode');
    }

    await this.prisma.gameParticipant.update({
      where: { id: participantId },
      data: { power_used: true },
    });

    const effect = POWER_EFFECT_MAP[powerCode] || {
      type: 'hint',
      value: 'Power activated',
    };

    if (effect.type === 'extraMs' && round.deadline_at) {
      const extraMs = effect.value || 10000;
      const newDeadline = new Date(round.deadline_at.getTime() + extraMs);
      await this.prisma.gameRound.update({
        where: { id: roundId },
        data: { deadline_at: newDeadline },
      });
    }

    return {
      roundId,
      userId: participant.user_id,
      powerCode,
      effect,
    };
  }

  async pass(roundId: string, participantId: string) {
    const round = await this.prisma.gameRound.findUnique({
      where: { id: roundId },
      include: {
        match: {
          include: {
            participants: {
              include: { user: true },
            },
            teams: true,
          },
        },
      },
    });

    if (!round) {
      throw new GameError('NOT_FOUND', 'Round not found');
    }

    if (
      round.round_type !== RoundType.Q1_WARMUP &&
      round.round_type !== RoundType.Q3_HOBBY
    ) {
      throw new GameError('FORBIDDEN', 'Pass only allowed in Q1 and Q3');
    }

    if (round.phase !== GameRoundPhase.ANSWER) {
      throw new GameError('FORBIDDEN', 'Round is not in answer phase');
    }

    if (round.deadline_at && new Date() > round.deadline_at) {
      throw new GameError('TOO_LATE', 'Answer deadline expired');
    }

    if (round.buzz_winner_id !== participantId) {
      throw new GameError('FORBIDDEN', 'Only current answerer can pass');
    }

    if (
      round.match.mode === MatchMode.ONE_V_ONE ||
      round.match.mode === MatchMode.SINGLE
    ) {
      throw new GameError('FORBIDDEN', 'Pass not allowed in 1v1 mode');
    }

    if (this.passedRoundIds.has(roundId)) {
      throw new GameError('FORBIDDEN', 'Pass already used for this question');
    }

    const passer = round.match.participants.find((p) => p.id === participantId);
    if (!passer) {
      throw new GameError('FORBIDDEN', 'Participant not found');
    }

    const eligibleTeammates = round.match.participants.filter(
      (p) =>
        p.team_id === passer.team_id &&
        p.id !== passer.id &&
        p.is_connected !== false &&
        !p.left_at,
    );

    if (eligibleTeammates.length === 0) {
      throw new GameError(
        'FORBIDDEN',
        'No connected teammate available to pass to',
      );
    }

    eligibleTeammates.sort((a, b) => {
      const ja = a.jersey_number ?? Number.MAX_SAFE_INTEGER;
      const jb = b.jersey_number ?? Number.MAX_SAFE_INTEGER;
      if (ja !== jb) return ja - jb;
      return a.id.localeCompare(b.id);
    });

    const newAnswerer = eligibleTeammates[0];
    this.passedRoundIds.add(roundId);

    const newDeadline = new Date(Date.now() + 10000);
    await this.prisma.gameRound.update({
      where: { id: roundId },
      data: {
        buzz_winner_id: newAnswerer.id,
        deadline_at: newDeadline,
      },
    });

    return {
      roundId,
      participantId: newAnswerer.id,
      userId: newAnswerer.user_id,
      deadlineAt: newDeadline.toISOString(),
      newAnswerer,
      match: round.match,
    };
  }

  async recordVote(
    roundId: string,
    participantId: string,
    optionIndex: number,
  ) {
    const round = await this.prisma.gameRound.findUnique({
      where: { id: roundId },
      include: {
        match: {
          include: { participants: true },
        },
      },
    });

    if (!round) {
      throw new GameError('NOT_FOUND', 'Round not found');
    }

    if (round.phase !== GameRoundPhase.VOTE) {
      throw new GameError('FORBIDDEN', 'Round is not in vote phase');
    }

    if (round.deadline_at && new Date() > round.deadline_at) {
      throw new GameError('TOO_LATE', 'Voting deadline expired');
    }

    const participant = round.match.participants.find(
      (p) => p.id === participantId,
    );
    if (!participant) {
      throw new GameError('FORBIDDEN', 'Participant not in this match');
    }

    if (typeof optionIndex !== 'number' || optionIndex < 0) {
      throw new GameError('FORBIDDEN', 'Invalid option index');
    }

    if (typeof this.prisma.gameAnswer?.findFirst === 'function') {
      const existingVote = await this.prisma.gameAnswer.findFirst({
        where: {
          round_id: roundId,
          participant_id: participantId,
          voted_option_index: { not: null },
        },
      });
      if (existingVote) {
        throw new GameError('FORBIDDEN', 'Vote already submitted');
      }
    }

    await this.prisma.gameAnswer.create({
      data: {
        round_id: roundId,
        participant_id: participantId,
        voted_option_index: optionIndex,
        submitted_at: new Date(),
      },
    });

    const answers = await this.prisma.gameAnswer.findMany({
      where: {
        round_id: roundId,
        voted_option_index: { not: null },
      },
    });

    let targetTeamId = participant.team_id;
    if (round.buzz_winner_id) {
      const buzzer = round.match.participants.find(
        (p) => p.id === round.buzz_winner_id,
      );
      if (buzzer) {
        targetTeamId = buzzer.team_id;
      }
    }

    const connectedTeamMembers = round.match.participants.filter(
      (p) =>
        p.team_id === targetTeamId && p.is_connected !== false && !p.left_at,
    );

    const teamAnswers = answers.filter(
      (a) =>
        !a.participant_id ||
        connectedTeamMembers.some((m) => m.id === a.participant_id),
    );

    const submittedCount = teamAnswers.length;
    const teamSize = connectedTeamMembers.length;
    const allVoted = teamSize > 0 && submittedCount >= teamSize;

    return {
      roundId,
      submittedCount,
      teamSize,
      allVoted,
    };
  }

  async resolveVote(roundId: string) {
    const round = await this.prisma.gameRound.findUnique({
      where: { id: roundId },
      include: {
        match: {
          include: {
            teams: true,
            participants: true,
          },
        },
        question: true,
        answers: {
          where: { voted_option_index: { not: null } },
        },
      },
    });

    if (!round) {
      throw new GameError('NOT_FOUND', 'Round not found');
    }

    const answers = round.answers;
    const tallies: Record<number, number> = {};
    for (const a of answers) {
      if (a.voted_option_index !== null) {
        tallies[a.voted_option_index] =
          (tallies[a.voted_option_index] || 0) + 1;
      }
    }

    let winningOptionIndex: number | null = null;
    let maxVotes = 0;
    let topOption: number | null = null;
    let isTie = false;

    for (const [optStr, count] of Object.entries(tallies)) {
      const opt = Number(optStr);
      if (count > maxVotes) {
        maxVotes = count;
        topOption = opt;
        isTie = false;
      } else if (count === maxVotes) {
        isTie = true;
      }
    }

    const totalSubmitted = answers.length;
    if (!isTie && topOption !== null && maxVotes > totalSubmitted / 2) {
      winningOptionIndex = topOption;
    } else {
      winningOptionIndex = null;
    }

    let correctIndex: number | undefined;
    if (round.question) {
      const parsed = this.parsePackQuestion(round.question);
      correctIndex = parsed.correctIndex;
    } else {
      correctIndex = FALLBACK_QUESTIONS[round.round_type]?.correctIndex;
    }

    const isCorrect =
      winningOptionIndex !== null && winningOptionIndex === correctIndex;

    let designatedShooterId: string | null = null;
    if (isCorrect) {
      const winningAnswer = answers.find(
        (a) => a.voted_option_index === winningOptionIndex,
      );
      designatedShooterId =
        winningAnswer?.participant_id ??
        round.match.participants[0]?.id ??
        null;
      if (designatedShooterId) {
        await this.prisma.gameRound.update({
          where: { id: roundId },
          data: { buzz_winner_id: designatedShooterId },
        });
      }
    }

    return {
      roundId,
      winningOptionIndex,
      tallies,
      correct: isCorrect,
      designatedShooterId,
    };
  }

  async requestHelp(roundId: string, participantId: string) {
    const round = await this.prisma.gameRound.findUnique({
      where: { id: roundId },
      include: {
        match: {
          include: {
            participants: true,
          },
        },
        question: true,
      },
    });

    if (!round) {
      throw new GameError('NOT_FOUND', 'Round not found');
    }

    if (round.round_type !== RoundType.Q3_HOBBY) {
      throw new GameError('FORBIDDEN', 'Help request only allowed in Q3');
    }

    if (round.phase !== GameRoundPhase.ANSWER) {
      throw new GameError('FORBIDDEN', 'Round is not in answer phase');
    }

    if (round.deadline_at && new Date() > round.deadline_at) {
      throw new GameError('TOO_LATE', 'Answer deadline expired');
    }

    if (round.buzz_winner_id !== participantId) {
      throw new GameError(
        'FORBIDDEN',
        'Only current answerer can request help',
      );
    }

    if (
      round.match.mode === MatchMode.ONE_V_ONE ||
      round.match.mode === MatchMode.SINGLE
    ) {
      throw new GameError('FORBIDDEN', 'Help request not allowed in 1v1 mode');
    }

    const requester = round.match.participants.find(
      (p) => p.id === participantId,
    );
    if (!requester) {
      throw new GameError('FORBIDDEN', 'Participant not found');
    }

    const connectedTeammates = round.match.participants.filter(
      (p) =>
        p.team_id === requester.team_id &&
        p.id !== requester.id &&
        p.is_connected !== false &&
        !p.left_at,
    );

    if (connectedTeammates.length === 0) {
      throw new GameError(
        'FORBIDDEN',
        'No connected teammates available for help',
      );
    }

    let prompt = '';
    let options: string[] = [];
    if (round.question) {
      const parsed = this.parsePackQuestion(round.question);
      prompt = parsed.prompt;
      options = parsed.options;
    } else {
      const fallback = FALLBACK_QUESTIONS[round.round_type];
      prompt = fallback?.prompt ?? '';
      options = fallback?.options ?? [];
    }

    return {
      roundId,
      prompt,
      options,
      connectedTeammates,
    };
  }

  async suggestHelp(
    roundId: string,
    senderUserId: string,
    forUserId: string,
    optionIndex: number,
  ) {
    if (senderUserId === forUserId) {
      throw new GameError('FORBIDDEN', 'Cannot suggest to yourself');
    }

    if (this.roundSuggestions.has(roundId)) {
      throw new GameError(
        'FORBIDDEN',
        'A suggestion has already been submitted for this round',
      );
    }

    const round = await this.prisma.gameRound.findUnique({
      where: { id: roundId },
      include: {
        match: {
          include: {
            participants: true,
          },
        },
        question: true,
      },
    });

    if (!round) {
      throw new GameError('NOT_FOUND', 'Round not found');
    }

    if (round.round_type !== RoundType.Q3_HOBBY) {
      throw new GameError('FORBIDDEN', 'Help suggest only allowed in Q3');
    }

    if (round.phase !== GameRoundPhase.ANSWER) {
      throw new GameError('FORBIDDEN', 'Round is not in answer phase');
    }

    if (round.deadline_at && new Date() > round.deadline_at) {
      throw new GameError('TOO_LATE', 'Answer deadline expired');
    }

    if (
      round.match.mode === MatchMode.ONE_V_ONE ||
      round.match.mode === MatchMode.SINGLE
    ) {
      throw new GameError('FORBIDDEN', 'Help suggest not allowed in 1v1 mode');
    }

    const sender = round.match.participants.find(
      (p) => p.user_id === senderUserId,
    );
    const target = round.match.participants.find(
      (p) => p.user_id === forUserId,
    );

    if (!sender || !target) {
      throw new GameError('FORBIDDEN', 'Participant not in match');
    }

    if (sender.team_id !== target.team_id) {
      throw new GameError('FORBIDDEN', 'Opponents cannot suggest help');
    }

    if (round.buzz_winner_id !== target.id) {
      throw new GameError('FORBIDDEN', 'Target is not the current answerer');
    }

    let optionsCount = 4;
    if (round.question) {
      const parsed = this.parsePackQuestion(round.question);
      optionsCount = parsed.options.length;
    } else {
      optionsCount = FALLBACK_QUESTIONS[round.round_type]?.options.length ?? 4;
    }

    if (
      typeof optionIndex !== 'number' ||
      optionIndex < 0 ||
      optionIndex >= optionsCount
    ) {
      throw new GameError('FORBIDDEN', 'Option index outside options list');
    }

    this.roundSuggestions.set(roundId, {
      fromUserId: senderUserId,
      optionIndex,
    });

    return {
      roundId,
      fromUserId: senderUserId,
      forUserId,
      optionIndex,
    };
  }

  async startShootout(roundId: string, shooterParticipantId: string) {
    const round = await this.prisma.gameRound.findUnique({
      where: { id: roundId },
    });

    if (!round) {
      throw new GameError('NOT_FOUND', 'Round not found');
    }

    const deadlineAt = new Date(Date.now() + 60000);

    await this.prisma.gameRound.update({
      where: { id: roundId },
      data: {
        phase: GameRoundPhase.SHOOTOUT,
        buzz_winner_id: shooterParticipantId,
        deadline_at: deadlineAt,
      },
    });

    return {
      roundId,
      shooterParticipantId,
      deadlineAt: deadlineAt.toISOString(),
      multiplier: 1,
    };
  }

  async submitShootoutSwipe(
    roundId: string,
    participantId: string,
    made: boolean,
  ) {
    const round = await this.prisma.gameRound.findUnique({
      where: { id: roundId },
      include: {
        match: {
          include: { participants: true, teams: true },
        },
      },
    });

    if (!round) {
      throw new GameError('NOT_FOUND', 'Round not found');
    }

    if (round.phase !== GameRoundPhase.SHOOTOUT) {
      throw new GameError('FORBIDDEN', 'Round is not in shootout phase');
    }

    if (round.deadline_at && new Date() > round.deadline_at) {
      throw new GameError('TOO_LATE', 'Shootout deadline expired');
    }

    if (round.buzz_winner_id !== participantId) {
      throw new GameError('FORBIDDEN', 'Only designated shooter can swipe');
    }

    const participant = round.match.participants.find(
      (p) => p.id === participantId,
    );
    if (!participant) {
      throw new GameError('FORBIDDEN', 'Participant not found');
    }

    const xp = made ? 3 : 0;

    const shootout = await this.prisma.gameShootout.create({
      data: {
        round_id: roundId,
        shooter_participant_id: participantId,
        made,
        xp_awarded: xp,
        multiplier: 1,
      },
    });

    if (made) {
      await this.prisma.gameTeam.update({
        where: { id: participant.team_id },
        data: {
          score_xp: { increment: xp },
          score_baskets: { increment: 1 },
        },
      });
    }

    const teamScores = await this.getTeamScores(round.match_id);

    return {
      made,
      xp,
      teamScores,
      shootout,
    };
  }

  async completeRound(roundId: string) {
    const round = await this.prisma.gameRound.update({
      where: { id: roundId },
      data: { phase: GameRoundPhase.COMPLETE },
    });

    const teamScores = await this.getTeamScores(round.match_id);

    return {
      roundId,
      roundType: round.round_type,
      teamScores,
    };
  }

  async finishMatch(matchId: string) {
    const match = await this.prisma.gameMatch.findUnique({
      where: { id: matchId },
      include: { teams: true },
    });

    if (!match) {
      throw new GameError('NOT_FOUND', 'Match not found');
    }

    const teams = match.teams;
    let winnerTeamId: string | null = null;

    if (teams.length === 1) {
      winnerTeamId = teams[0].id;
    } else if (teams.length >= 2) {
      const sorted = [...teams].sort((a, b) => b.score_xp - a.score_xp);
      if (sorted[0].score_xp > sorted[1].score_xp) {
        winnerTeamId = sorted[0].id;
      } else {
        winnerTeamId = null;
      }
    }

    const updatedMatch = await this.prisma.gameMatch.update({
      where: { id: matchId },
      data: {
        phase: MatchPhase.FINISHED,
        finished_at: new Date(),
        winner_team_id: winnerTeamId,
      },
    });

    const scores = teams.reduce(
      (acc, t) => {
        acc[t.id] = { xp: t.score_xp, baskets: t.score_baskets };
        return acc;
      },
      {} as Record<string, { xp: number; baskets: number }>,
    );

    const kindness = teams.reduce(
      (acc, t) => {
        acc[t.id] = t.score_kindness;
        return acc;
      },
      {} as Record<string, number>,
    );

    return {
      matchId,
      winnerTeamId,
      scores,
      kindness,
      match: updatedMatch,
    };
  }

  async enterSafeSpace(userId: string, matchId?: string) {
    return this.prisma.safeSpaceVisit.create({
      data: {
        user_id: userId,
        match_id: matchId ?? null,
      },
    });
  }

  async exitSafeSpace(userId: string, matchId?: string) {
    return { matchId };
  }
}
