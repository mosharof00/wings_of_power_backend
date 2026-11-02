import { OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import {
  GameRoundPhase,
  JoinRequestStatus,
  MatchMode,
  MatchPhase,
  PowerCode,
  Role,
  RoundType,
  TicketStatus,
  UserStatus,
} from 'prisma/generated/client';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../../prisma/prisma.service';
import { ProgressService } from '../progress/progress.service';
import { MatchFoundPayload, MatchmakingService } from './matchmaking.service';
import { QueueService } from './queue.service';
import { RoundService } from './round.service';

@WebSocketGateway({
  cors: { origin: '*' },
})
export class GameGateway
  implements
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleInit,
    OnModuleDestroy
{
  @WebSocketServer()
  server: Server;

  private readonly timers: Map<string, NodeJS.Timeout> = new Map();
  public roundService: RoundService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly progressService: ProgressService,
    private readonly queueService: QueueService,
    private readonly matchmakingService: MatchmakingService,
    @Optional() roundService?: RoundService,
  ) {
    this.roundService = roundService || new RoundService(this.prisma);
  }

  async onModuleInit(): Promise<void> {
    await this.cancelStaleMatches();

    this.queueService.onQueueChange(async (mode) => {
      await this.broadcastQueueUpdate(mode);
      await this.checkAndRunMatchmaking(mode);
    });
  }

  onModuleDestroy(): void {
    this.clearAllTimers();
  }

  async cancelStaleMatches(): Promise<number> {
    const result = await this.prisma.gameMatch.updateMany({
      where: {
        phase: {
          notIn: [MatchPhase.FINISHED, MatchPhase.CANCELLED],
        },
      },
      data: {
        phase: MatchPhase.CANCELLED,
      },
    });
    return result.count;
  }

  async handleConnection(client: Socket): Promise<void> {
    const rawAuthHeader =
      client.handshake?.headers?.authorization ??
      (client.handshake?.headers?.Authorization as string | undefined);
    const token =
      client.handshake?.auth?.token ||
      (typeof rawAuthHeader === 'string'
        ? rawAuthHeader.replace(/^Bearer\s+/i, '')
        : undefined);

    if (!token) {
      client.disconnect(true);
      return;
    }

    let payload: any;
    try {
      payload = this.jwtService.verify(token);
    } catch {
      client.disconnect(true);
      return;
    }

    const userId = payload?.sub ?? payload?.userId;
    if (!userId) {
      client.disconnect(true);
      return;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        memberships: {
          where: { status: JoinRequestStatus.APPROVED },
          include: { class: true },
        },
      },
    });

    if (
      !user ||
      user.role !== Role.STUDENT ||
      user.status !== UserStatus.ACTIVE
    ) {
      client.disconnect(true);
      return;
    }

    client.data = client.data || {};
    client.data.user = user;
    client.data.userId = user.id;

    await client.join(`user:${user.id}`);

    // Check if player has an open match (reconnect)
    const openParticipant = await this.prisma.gameParticipant.findFirst({
      where: {
        user_id: user.id,
        left_at: null,
        match: {
          phase: { in: [MatchPhase.COUNTDOWN, MatchPhase.PLAYING] },
        },
      },
      orderBy: { created_at: 'desc' },
    });

    if (openParticipant) {
      await client.join(`match:${openParticipant.match_id}`);
      const snapshot = await this.getSnapshot(
        user.id,
        openParticipant.match_id,
      );
      if (snapshot && !('error' in snapshot)) {
        client.emit('match:snapshot', snapshot);
      }
    }
  }

  async handleDisconnect(client: Socket): Promise<void> {
    const userId = client.data?.userId;
    if (!userId) {
      return;
    }

    if (this.queueService.isQueued(userId)) {
      this.queueService.removeFromAll(userId);
      await this.prisma.matchmakingTicket.updateMany({
        where: { user_id: userId, status: TicketStatus.WAITING },
        data: { status: TicketStatus.CANCELLED },
      });
    }

    await this.prisma.gameParticipant.updateMany({
      where: {
        user_id: userId,
        match: { phase: { in: [MatchPhase.COUNTDOWN, MatchPhase.PLAYING] } },
      },
      data: { is_connected: false },
    });
  }

  @SubscribeMessage('queue:join')
  async handleQueueJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { mode: MatchMode; fixtureCode?: string },
  ): Promise<void> {
    const user = client.data?.user;
    if (!user) {
      client.disconnect(true);
      return;
    }

    const eligibility = await this.progressService.eligibilityFor(user.id);
    if (!eligibility.eligible) {
      client.emit('queue:error', {
        code: 'INELIGIBLE',
        message: 'Student is not eligible for game show',
      });
      return;
    }

    const activeTicket = await this.prisma.matchmakingTicket.findFirst({
      where: { user_id: user.id, status: TicketStatus.WAITING },
    });
    if (this.queueService.isQueued(user.id) || activeTicket) {
      client.emit('queue:error', {
        code: 'ALREADY_QUEUED',
        message: 'Already queued for matchmaking',
      });
      return;
    }

    const schoolId =
      user.school_id ?? user.memberships?.[0]?.class?.school_id ?? '';

    if (data.mode === MatchMode.SINGLE) {
      const match = await this.prisma.gameMatch.create({
        data: {
          school_id: schoolId,
          mode: MatchMode.SINGLE,
          phase: MatchPhase.COUNTDOWN,
          started_at: new Date(),
          teams: {
            create: {
              label: 'Single Player',
              score_xp: 0,
              score_kindness: 0,
              score_baskets: 0,
            },
          },
        },
        include: { teams: true },
      });

      const team = match.teams[0];
      await this.prisma.gameParticipant.create({
        data: {
          match_id: match.id,
          team_id: team.id,
          user_id: user.id,
          is_bot: false,
          jersey_number: 1,
          hero_id: user.selected_hero_id ?? null,
          is_connected: true,
          power_used: false,
        },
      });

      await this.prisma.matchmakingTicket.create({
        data: {
          user_id: user.id,
          mode: MatchMode.SINGLE,
          status: TicketStatus.MATCHED,
          match_id: match.id,
        },
      });

      await client.join(`match:${match.id}`);

      const foundPayload: MatchFoundPayload = {
        matchId: match.id,
        mode: MatchMode.SINGLE,
        teams: [
          {
            id: team.id,
            label: 'Single Player',
            members: [
              {
                userId: user.id,
                nickname: user.nickname,
                avatarUrl: user.avatar_url,
                heroId: user.selected_hero_id,
              },
            ],
          },
        ],
      };

      client.emit('match:found', foundPayload);
      await this.startCountdown(match.id);
      return;
    }

    const ticket = await this.prisma.matchmakingTicket.create({
      data: {
        user_id: user.id,
        mode: data.mode,
        status: TicketStatus.WAITING,
      },
    });

    this.queueService.enqueue({
      ticketId: ticket.id,
      userId: user.id,
      schoolId,
      mode: data.mode,
      fixtureCode: data.fixtureCode,
      nickname: user.nickname,
      avatarUrl: user.avatar_url,
    });

    await client.join(`queue:${data.mode}`);
    await this.broadcastQueueUpdate(data.mode);
    await this.checkAndRunMatchmaking(data.mode);
  }

  @SubscribeMessage('queue:cancel')
  async handleQueueCancel(@ConnectedSocket() client: Socket): Promise<void> {
    const userId = client.data?.userId;
    if (!userId) {
      return;
    }

    await this.prisma.matchmakingTicket.updateMany({
      where: { user_id: userId, status: TicketStatus.WAITING },
      data: { status: TicketStatus.CANCELLED },
    });

    this.queueService.removeFromAll(userId);

    client.leave(`queue:${MatchMode.ONE_V_ONE}`);
    client.leave(`queue:${MatchMode.FIVE_V_FIVE}`);

    await this.broadcastQueueUpdate(MatchMode.ONE_V_ONE);
    await this.broadcastQueueUpdate(MatchMode.FIVE_V_FIVE);
  }

  async broadcastQueueUpdate(mode: MatchMode): Promise<void> {
    if (mode === MatchMode.SINGLE) {
      return;
    }
    const queue = this.queueService.getQueue(mode);
    const required = this.matchmakingService.getRequiredPlayerCount(mode);

    const players = queue.map((p) => ({
      userId: p.userId,
      nickname: p.nickname ?? null,
      avatarUrl: p.avatarUrl ?? null,
    }));

    const payload = {
      mode,
      filled: queue.length,
      required,
      players,
    };

    if (this.server) {
      this.server.to(`queue:${mode}`).emit('queue:update', payload);
    }
  }

  async checkAndRunMatchmaking(mode: MatchMode): Promise<void> {
    const matchResult = await this.matchmakingService.tryMatch(mode);
    if (matchResult) {
      await this.handleMatchFound(matchResult);
    }
  }

  async handleMatchFound(matchResult: MatchFoundPayload): Promise<void> {
    const matchId = matchResult.matchId;

    if (this.server) {
      for (const team of matchResult.teams) {
        for (const member of team.members) {
          if (typeof this.server.in === 'function') {
            const roomOp = this.server.in(`user:${member.userId}`);
            if (roomOp && typeof roomOp.socketsJoin === 'function') {
              roomOp.socketsJoin(`match:${matchId}`);
            }
          }
        }
      }

      this.server.to(`match:${matchId}`).emit('match:found', matchResult);
    }

    await this.startCountdown(matchId);
  }

  async startCountdown(
    matchId: string,
    durationMs: number = 3000,
  ): Promise<void> {
    const deadlineAt = new Date(Date.now() + durationMs).toISOString();

    if (this.server) {
      this.server.to(`match:${matchId}`).emit('match:countdown', {
        matchId,
        deadlineAt,
        value: 3,
      });
    }

    this.clearTimer(matchId);

    const timer = setTimeout(async () => {
      this.clearTimer(matchId);
      await this.advanceToPlaying(matchId);
    }, durationMs);

    this.setTimer(matchId, timer);
  }

  async advanceToPlaying(matchId: string): Promise<void> {
    await this.prisma.gameMatch.update({
      where: { id: matchId },
      data: {
        phase: MatchPhase.PLAYING,
        started_at: new Date(),
      },
    });

    if (this.server) {
      this.server.to(`match:${matchId}`).emit('match:phase', {
        matchId,
        phase: MatchPhase.PLAYING,
      });
    }

    if (this.roundService) {
      await this.startNextRound(matchId).catch(() => {});
    }
  }

  async startNextRound(matchId: string): Promise<void> {
    const match = await this.prisma.gameMatch.findUnique({
      where: { id: matchId },
      include: {
        rounds: { orderBy: { number: 'asc' } },
        teams: true,
      },
    });

    if (
      !match ||
      match.phase === MatchPhase.FINISHED ||
      match.phase === MatchPhase.CANCELLED
    ) {
      return;
    }

    const roundTypesOrder: RoundType[] = [
      RoundType.Q1_WARMUP,
      RoundType.Q2_DEFENSE,
      RoundType.Q3_HOBBY,
      RoundType.Q4_FINALS,
    ];

    const completedRoundCount = (match.rounds || []).filter(
      (r) => r.phase === GameRoundPhase.COMPLETE,
    ).length;

    if (completedRoundCount >= roundTypesOrder.length) {
      const finishResult = await this.roundService.finishMatch(matchId);
      if (this.server) {
        this.server.to(`match:${matchId}`).emit('match:finished', finishResult);
      }
      return;
    }

    const nextRoundType = roundTypesOrder[completedRoundCount];
    const roundNumber = completedRoundCount + 1;

    const { round, question, durationMs } = await this.roundService.createRound(
      matchId,
      nextRoundType,
      roundNumber,
    );

    const titles: Record<RoundType, string> = {
      [RoundType.Q1_WARMUP]: 'Warm-Up',
      [RoundType.Q2_DEFENSE]: 'Upstander Defense',
      [RoundType.Q3_HOBBY]: 'Hobby & Trivia',
      [RoundType.Q4_FINALS]: 'Championship Finals',
    };

    const blurbs: Record<RoundType, string> = {
      [RoundType.Q1_WARMUP]:
        'Quick-fire anti-bullying trivia. Buzz in first to answer!',
      [RoundType.Q2_DEFENSE]:
        'Write your kindness action plan. Non-empty answers earn kindness points!',
      [RoundType.Q3_HOBBY]: 'Show your passions and unlock your Power Wings!',
      [RoundType.Q4_FINALS]:
        'Discuss with your team and vote. Majority wins the shot!',
    };

    if (this.server) {
      this.server.to(`match:${matchId}`).emit('round:intro', {
        roundType: nextRoundType,
        title: titles[nextRoundType],
        blurb: blurbs[nextRoundType],
        deadlineAt: round.deadline_at?.toISOString(),
      });

      const outboundQuestion = this.roundService.toClientQuestion(
        round.id,
        question,
        roundNumber,
        roundTypesOrder.length,
        round.deadline_at?.toISOString() || new Date().toISOString(),
      );

      this.server
        .to(`match:${matchId}`)
        .emit('round:question', outboundQuestion);
    }

    this.scheduleRoundTimer(matchId, round.id, durationMs);
  }

  scheduleRoundTimer(
    matchId: string,
    roundId: string,
    durationMs: number,
  ): void {
    this.clearTimer(matchId);

    const timer = setTimeout(async () => {
      this.clearTimer(matchId);
      await this.handleRoundTimeout(matchId, roundId);
    }, durationMs);

    this.setTimer(matchId, timer);
  }

  async handleRoundTimeout(matchId: string, roundId: string): Promise<void> {
    const round = await this.prisma.gameRound.findUnique({
      where: { id: roundId },
    });

    if (!round || round.phase === GameRoundPhase.COMPLETE) {
      return;
    }

    if (
      round.phase === GameRoundPhase.BUZZ ||
      round.phase === GameRoundPhase.ANSWER
    ) {
      const complete = await this.roundService.completeRound(roundId);
      if (this.server) {
        this.server.to(`match:${matchId}`).emit('round:complete', complete);
      }
      await this.startNextRound(matchId);
    } else if (round.phase === GameRoundPhase.VOTE) {
      const voteResult = await this.roundService.resolveVote(roundId);
      if (this.server) {
        this.server
          .to(`match:${matchId}`)
          .emit('round:vote_result', voteResult);
      }
      if (voteResult.correct && voteResult.designatedShooterId) {
        const shoot = await this.roundService.startShootout(
          roundId,
          voteResult.designatedShooterId,
        );
        if (this.server) {
          this.server.to(`match:${matchId}`).emit('shootout:start', shoot);
        }
        this.scheduleRoundTimer(matchId, roundId, 60000);
      } else {
        const complete = await this.roundService.completeRound(roundId);
        if (this.server) {
          this.server.to(`match:${matchId}`).emit('round:complete', complete);
        }
        await this.startNextRound(matchId);
      }
    } else if (round.phase === GameRoundPhase.SHOOTOUT) {
      const result = await this.roundService
        .submitShootoutSwipe(roundId, round.buzz_winner_id || '', false)
        .catch(() => ({ made: false, xp: 0, teamScores: {} }));
      if (this.server) {
        this.server.to(`match:${matchId}`).emit('shootout:result', {
          made: false,
          xp: 0,
          teamScores: result.teamScores,
        });
      }
      const complete = await this.roundService.completeRound(roundId);
      if (this.server) {
        this.server.to(`match:${matchId}`).emit('round:complete', complete);
      }
      await this.startNextRound(matchId);
    }
  }

  @SubscribeMessage('round:buzz')
  async handleBuzz(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roundId: string },
  ): Promise<void> {
    const userId = client.data?.userId;
    if (!userId || !data?.roundId) return;

    try {
      const participant = await this.prisma.gameParticipant.findFirst({
        where: {
          user_id: userId,
          match: { rounds: { some: { id: data.roundId } } },
        },
      });
      if (!participant) {
        client.emit('error', {
          code: 'FORBIDDEN',
          message: 'Participant not in match',
        });
        return;
      }

      const buzzResult = await this.roundService.buzz(
        data.roundId,
        participant.id,
      );

      const match = await this.prisma.gameMatch.findFirst({
        where: { rounds: { some: { id: data.roundId } } },
        include: { participants: true },
      });

      if (this.server && match) {
        this.server
          .to(`match:${match.id}`)
          .emit('round:buzz_winner', buzzResult);

        for (const p of match.participants) {
          if (p.id !== participant.id && p.user_id) {
            const reason =
              p.team_id === participant.team_id ? 'TEAMMATE' : 'OPPONENT';
            this.server.to(`user:${p.user_id}`).emit('round:waiting', {
              roundId: data.roundId,
              reason,
            });
          }
        }

        this.scheduleRoundTimer(match.id, data.roundId, 10000);
      }
    } catch (err: any) {
      client.emit('error', {
        code: err.code || 'FORBIDDEN',
        message: err.message,
      });
    }
  }

  @SubscribeMessage('round:answer')
  async handleAnswer(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { roundId: string; optionIndex?: number; freeText?: string },
  ): Promise<void> {
    const userId = client.data?.userId;
    if (!userId || !data?.roundId) return;

    try {
      const round = await this.prisma.gameRound.findUnique({
        where: { id: data.roundId },
        include: { match: { include: { participants: true } } },
      });
      if (!round) {
        client.emit('error', {
          code: 'NOT_FOUND',
          message: 'Round not found',
        });
        return;
      }

      const participant = round.match.participants.find(
        (p) => p.user_id === userId,
      );
      if (!participant) {
        client.emit('error', {
          code: 'FORBIDDEN',
          message: 'Participant not in match',
        });
        return;
      }

      let answerResult: any;
      if (round.round_type === RoundType.Q2_DEFENSE) {
        answerResult = await this.roundService.submitQ2Answer(
          data.roundId,
          participant.id,
          data.freeText,
        );
      } else {
        answerResult = await this.roundService.submitAnswer(
          data.roundId,
          participant.id,
          data.optionIndex,
        );
      }

      if (this.server) {
        this.server
          .to(`match:${round.match_id}`)
          .emit('round:answer_result', answerResult);
      }

      if (
        round.round_type === RoundType.Q1_WARMUP ||
        round.round_type === RoundType.Q3_HOBBY
      ) {
        if (answerResult.correct) {
          const shoot = await this.roundService.startShootout(
            data.roundId,
            participant.id,
          );
          if (this.server) {
            this.server
              .to(`match:${round.match_id}`)
              .emit('shootout:start', shoot);
          }
          this.scheduleRoundTimer(round.match_id, data.roundId, 60000);
        } else {
          const complete = await this.roundService.completeRound(data.roundId);
          if (this.server) {
            this.server
              .to(`match:${round.match_id}`)
              .emit('round:complete', complete);
          }
          await this.startNextRound(round.match_id);
        }
      }
    } catch (err: any) {
      client.emit('error', {
        code: err.code || 'FORBIDDEN',
        message: err.message,
      });
    }
  }

  @SubscribeMessage('round:pass')
  async handlePass(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roundId: string },
  ): Promise<void> {
    const userId = client.data?.userId;
    if (!userId || !data?.roundId) return;

    try {
      const participant = await this.prisma.gameParticipant.findFirst({
        where: {
          user_id: userId,
          match: { rounds: { some: { id: data.roundId } } },
        },
        include: { team: { include: { participants: true } } },
      });
      if (!participant) {
        client.emit('error', {
          code: 'FORBIDDEN',
          message: 'Participant not in match',
        });
        return;
      }

      if (participant.team.participants.length <= 1) {
        client.emit('error', {
          code: 'FORBIDDEN',
          message: 'Cannot pass with single-player team',
        });
        return;
      }
    } catch (err: any) {
      client.emit('error', {
        code: err.code || 'FORBIDDEN',
        message: err.message,
      });
    }
  }

  @SubscribeMessage('round:vote')
  async handleVote(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roundId: string; optionIndex: number },
  ): Promise<void> {
    const userId = client.data?.userId;
    if (!userId || !data?.roundId) return;

    try {
      const participant = await this.prisma.gameParticipant.findFirst({
        where: {
          user_id: userId,
          match: { rounds: { some: { id: data.roundId } } },
        },
      });
      if (!participant) {
        client.emit('error', {
          code: 'FORBIDDEN',
          message: 'Participant not in match',
        });
        return;
      }

      const voteUpdate = await this.roundService.recordVote(
        data.roundId,
        participant.id,
        data.optionIndex,
      );

      const round = await this.prisma.gameRound.findUnique({
        where: { id: data.roundId },
      });

      if (this.server && round) {
        this.server
          .to(`match:${round.match_id}`)
          .emit('round:vote_update', voteUpdate);
      }
    } catch (err: any) {
      client.emit('error', {
        code: err.code || 'FORBIDDEN',
        message: err.message,
      });
    }
  }

  @SubscribeMessage('power:use')
  async handlePowerUse(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roundId: string; powerCode: PowerCode },
  ): Promise<void> {
    const userId = client.data?.userId;
    if (!userId || !data?.roundId || !data?.powerCode) return;

    try {
      const participant = await this.prisma.gameParticipant.findFirst({
        where: {
          user_id: userId,
          match: { rounds: { some: { id: data.roundId } } },
        },
      });
      if (!participant) {
        client.emit('error', {
          code: 'FORBIDDEN',
          message: 'Participant not in match',
        });
        return;
      }

      const powerResult = await this.roundService.usePower(
        data.roundId,
        participant.id,
        data.powerCode,
      );

      const round = await this.prisma.gameRound.findUnique({
        where: { id: data.roundId },
      });

      if (this.server && round) {
        this.server
          .to(`match:${round.match_id}`)
          .emit('power:effect', powerResult);
      }
    } catch (err: any) {
      client.emit('error', {
        code: err.code || 'FORBIDDEN',
        message: err.message,
      });
    }
  }

  @SubscribeMessage('power:help_request')
  async handleHelpRequest(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roundId: string },
  ): Promise<void> {
    const userId = client.data?.userId;
    if (!userId || !data?.roundId) return;

    const round = await this.prisma.gameRound.findUnique({
      where: { id: data.roundId },
    });
    if (this.server && round) {
      this.server.to(`match:${round.match_id}`).emit('power:help_request', {
        roundId: data.roundId,
        userId,
      });
    }
  }

  @SubscribeMessage('power:help_suggest')
  async handleHelpSuggest(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { roundId: string; forUserId: string; optionIndex: number },
  ): Promise<void> {
    const userId = client.data?.userId;
    if (!userId || !data?.roundId || !data?.forUserId) return;

    if (this.server) {
      this.server.to(`user:${data.forUserId}`).emit('power:help_suggest', {
        roundId: data.roundId,
        fromUserId: userId,
        forUserId: data.forUserId,
        optionIndex: data.optionIndex,
      });
    }
  }

  @SubscribeMessage('shootout:swipe')
  async handleShootoutSwipe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roundId: string; made: boolean },
  ): Promise<void> {
    const userId = client.data?.userId;
    if (!userId || !data?.roundId) return;

    try {
      const participant = await this.prisma.gameParticipant.findFirst({
        where: {
          user_id: userId,
          match: { rounds: { some: { id: data.roundId } } },
        },
      });
      if (!participant) {
        client.emit('error', {
          code: 'FORBIDDEN',
          message: 'Participant not in match',
        });
        return;
      }

      const swipeResult = await this.roundService.submitShootoutSwipe(
        data.roundId,
        participant.id,
        data.made,
      );

      const round = await this.prisma.gameRound.findUnique({
        where: { id: data.roundId },
      });

      if (this.server && round) {
        this.server
          .to(`match:${round.match_id}`)
          .emit('shootout:result', swipeResult);

        this.clearTimer(round.match_id);
        const complete = await this.roundService.completeRound(data.roundId);
        this.server
          .to(`match:${round.match_id}`)
          .emit('round:complete', complete);
        await this.startNextRound(round.match_id);
      }
    } catch (err: any) {
      client.emit('error', {
        code: err.code || 'FORBIDDEN',
        message: err.message,
      });
    }
  }

  @SubscribeMessage('safespace:enter')
  async handleSafeSpaceEnter(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { matchId: string },
  ): Promise<void> {
    const userId = client.data?.userId;
    if (!userId) return;

    await this.roundService.enterSafeSpace(userId, data?.matchId);
  }

  @SubscribeMessage('safespace:exit')
  async handleSafeSpaceExit(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { matchId: string },
  ): Promise<void> {
    await this.handleSnapshot(client, data);
  }

  @SubscribeMessage('match:leave')
  async handleLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { matchId: string },
  ): Promise<void> {
    const userId = client.data?.userId;
    if (!userId || !data?.matchId) {
      return;
    }

    const participant = await this.prisma.gameParticipant.findFirst({
      where: {
        match_id: data.matchId,
        user_id: userId,
      },
      include: {
        user: {
          select: {
            id: true,
            nickname: true,
          },
        },
        match: true,
      },
    });

    if (!participant) {
      return;
    }

    await this.prisma.gameParticipant.update({
      where: { id: participant.id },
      data: {
        left_at: new Date(),
        is_connected: false,
      },
    });

    await client.leave(`match:${data.matchId}`);

    if (this.server) {
      this.server.to(`match:${data.matchId}`).emit('match:peer_left', {
        userId: participant.user_id,
        nickname: participant.user?.nickname ?? null,
      });
    }
  }

  @SubscribeMessage('match:snapshot')
  async handleSnapshot(
    @ConnectedSocket() client: Socket,
    @MessageBody() data?: { matchId?: string },
  ): Promise<any> {
    const userId = client.data?.userId;
    let matchId = data?.matchId;

    if (!matchId && userId) {
      const active = await this.prisma.gameParticipant.findFirst({
        where: {
          user_id: userId,
          left_at: null,
          match: {
            phase: { in: [MatchPhase.COUNTDOWN, MatchPhase.PLAYING] },
          },
        },
        orderBy: { created_at: 'desc' },
      });
      matchId = active?.match_id;
    }

    if (!matchId) {
      const err = { code: 'MATCH_GONE', message: 'No active match found' };
      client.emit('error', err);
      client.emit('match:error', err);
      return err;
    }

    const result = await this.getSnapshot(userId, matchId);
    if ('error' in result) {
      client.emit('error', { code: result.code, message: result.message });
      client.emit('match:error', {
        code: result.code,
        message: result.message,
      });
      return result;
    }

    await client.join(`match:${matchId}`);
    client.emit('match:snapshot', result);
    return result;
  }

  @SubscribeMessage('match:reconnect')
  async handleReconnect(
    @ConnectedSocket() client: Socket,
    @MessageBody() data?: { matchId?: string },
  ): Promise<any> {
    return this.handleSnapshot(client, data);
  }

  async getSnapshot(userId: string, matchId: string): Promise<any> {
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
                avatar_url: true,
              },
            },
          },
        },
        rounds: {
          orderBy: { number: 'asc' },
          include: { question: true },
        },
      },
    });

    if (!match) {
      return {
        error: 'MATCH_GONE',
        code: 'MATCH_GONE',
        message: 'Match not found',
      };
    }

    const participant = match.participants.find((p) => p.user_id === userId);
    if (!participant) {
      return {
        error: 'MATCH_GONE',
        code: 'MATCH_GONE',
        message: 'Not a participant',
      };
    }

    if (participant.left_at !== null) {
      return {
        error: 'MATCH_GONE',
        code: 'MATCH_GONE',
        message: 'Participant left permanently',
      };
    }

    if (match.phase === MatchPhase.CANCELLED) {
      return {
        error: 'MATCH_GONE',
        code: 'MATCH_GONE',
        message: 'Match cancelled',
      };
    }

    await this.prisma.gameParticipant.update({
      where: { id: participant.id },
      data: { is_connected: true },
    });

    const teams = match.teams.map((t) => ({
      id: t.id,
      label: t.label,
      scoreXp: t.score_xp,
      scoreKindness: t.score_kindness,
      scoreBaskets: t.score_baskets,
      members: match.participants
        .filter((p) => p.team_id === t.id)
        .map((p) => ({
          userId: p.user_id,
          nickname: p.user?.nickname ?? null,
          avatarUrl: p.user?.avatar_url ?? null,
          heroId: p.hero_id,
          jerseyNumber: p.jersey_number,
          isConnected: p.is_connected,
          leftAt: p.left_at,
          powerUsed: p.power_used,
        })),
    }));

    const you = {
      participantId: participant.id,
      canBuzz: false,
      powerUsed: participant.power_used,
      heroId: participant.hero_id,
      jerseyNumber: participant.jersey_number,
    };

    const scores = match.teams.reduce(
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

    if (match.phase === MatchPhase.FINISHED) {
      return {
        matchId: match.id,
        phase: MatchPhase.FINISHED,
        serverNow: new Date().toISOString(),
        teams,
        you,
        scores,
      };
    }

    const currentRound =
      match.rounds.find((r) => r.phase !== 'COMPLETE') ??
      match.rounds[match.rounds.length - 1];

    let questionPayload: any = null;
    if (currentRound && this.roundService) {
      questionPayload =
        await this.roundService.getSnapshotQuestion(currentRound);
    }

    return {
      matchId: match.id,
      phase: match.phase,
      roundType: currentRound?.round_type ?? null,
      roundId: currentRound?.id ?? null,
      deadlineAt: currentRound?.deadline_at
        ? currentRound.deadline_at.toISOString()
        : null,
      serverNow: new Date().toISOString(),
      teams,
      question: questionPayload ?? null,
      you,
      scores,
    };
  }

  setTimer(matchId: string, timer: NodeJS.Timeout): void {
    this.clearTimer(matchId);
    this.timers.set(matchId, timer);
  }

  clearTimer(matchId: string): void {
    const existing = this.timers.get(matchId);
    if (existing) {
      clearTimeout(existing);
      this.timers.delete(matchId);
    }
  }

  clearAllTimers(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }
}
