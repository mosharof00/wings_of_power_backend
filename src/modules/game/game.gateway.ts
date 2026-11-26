import {
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
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
import { FALLBACK_QUESTIONS, RoundService } from './round.service';

const QUARTERS = [
  RoundType.Q1_WARMUP,
  RoundType.Q2_DEFENSE,
  RoundType.Q3_HOBBY,
  RoundType.Q4_FINALS,
] as const;

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

  private readonly logger = new Logger(GameGateway.name);
  private readonly quarterSizes = new Map<
    string,
    Awaited<ReturnType<RoundService['getQuarterSizes']>>
  >();
  private readonly quarterResults = new Map<
    string,
    Awaited<ReturnType<RoundService['completeRound']>> & {
      roundNumber: number;
      deadlineAt: string;
    }
  >();
  private readonly roundActions = new Map<string, Promise<unknown>>();
  private readonly stealTeams = new Map<string, string>();
  private readonly botTimers = new Map<string, NodeJS.Timeout>();
  private readonly disconnectGrace = new Map<string, NodeJS.Timeout>();
  private readonly presenceTimers = new Map<
    string,
    { outcome: string; timer: NodeJS.Timeout }
  >();
  private queueSweep?: NodeJS.Timeout;
  private readonly countdownDeadlines = new Map<string, string>();
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

    await this.prisma.matchmakingTicket.updateMany({
      where: { status: TicketStatus.WAITING },
      data: { status: TicketStatus.CANCELLED },
    });
    this.queueSweep = setInterval(() => {
      void this.expireQueue().catch((error: unknown) =>
        this.logger.error('Queue expiry failed', error),
      );
    }, 15000);
    this.queueSweep.unref();
    this.queueService.onQueueChange((mode) => {
      void this.broadcastQueueUpdate(mode)
        .then(() => this.checkAndRunMatchmaking(mode))
        .catch((error: unknown) =>
          this.logger.error('Matchmaking failed', error),
        );
    });
  }

  onModuleDestroy(): void {
    this.clearAllTimers();
    clearInterval(this.queueSweep);
    for (const timer of this.disconnectGrace.values()) clearTimeout(timer);
    for (const timer of this.botTimers.values()) clearTimeout(timer);
    for (const { timer } of this.presenceTimers.values()) clearTimeout(timer);
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

  handleConnection(client: Socket): Promise<void> {
    client.data ??= {};
    const authentication = this.authenticate(client);
    client.data.authentication = authentication;
    return authentication;
  }

  private async authenticate(client: Socket): Promise<void> {
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
    clearTimeout(this.disconnectGrace.get(user.id));
    this.disconnectGrace.delete(user.id);

    // Check if player has an open match (reconnect)
    const openParticipant = await this.prisma.gameParticipant.findFirst({
      where: {
        user_id: user.id,
        left_at: null,
        match: {
          phase: {
            in: [MatchPhase.QUEUED, MatchPhase.COUNTDOWN, MatchPhase.PLAYING],
          },
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
        if (
          snapshot.mode === MatchMode.SINGLE &&
          snapshot.phase === MatchPhase.COUNTDOWN &&
          !this.countdownDeadlines.has(openParticipant.match_id)
        ) {
          await this.startCountdown(openParticipant.match_id);
        }
        await this.evaluatePresence(openParticipant.match_id);
      }
    }
  }

  async handleDisconnect(client: Socket): Promise<void> {
    const userId = client.data?.userId;
    if (!userId || (await this.hasUserSocket(userId))) return;

    clearTimeout(this.disconnectGrace.get(userId));
    this.disconnectGrace.set(
      userId,
      setTimeout(() => {
        this.disconnectGrace.delete(userId);
        void this.markDisconnected(userId).catch((error: unknown) =>
          this.logger.error('Disconnect recovery failed', error),
        );
      }, 15000),
    );
  }

  private async hasUserSocket(userId: string): Promise<boolean> {
    const sockets = await this.server?.in(`user:${userId}`).fetchSockets?.();
    return Boolean(sockets?.length);
  }

  private async markDisconnected(userId: string): Promise<void> {
    if (await this.hasUserSocket(userId)) return;
    this.queueService.removeFromAll(userId);
    await this.prisma.matchmakingTicket.updateMany({
      where: { user_id: userId, status: TicketStatus.WAITING },
      data: { status: TicketStatus.CANCELLED },
    });
    const active = await this.prisma.gameParticipant.findFirst({
      where: {
        user_id: userId,
        left_at: null,
        match: {
          phase: {
            in: [MatchPhase.QUEUED, MatchPhase.COUNTDOWN, MatchPhase.PLAYING],
          },
        },
      },
    });
    if (!active) return;
    await this.prisma.gameParticipant.update({
      where: { id: active.id },
      data: { is_connected: false },
    });
    await this.evaluatePresence(active.match_id);
  }

  private async expireQueue(): Promise<void> {
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const mode of Object.values(MatchMode)) {
      for (const player of this.queueService.getQueue(mode)) {
        if (player.enqueuedAt.getTime() > cutoff) continue;
        const expired = await this.prisma.matchmakingTicket.updateMany({
          where: { id: player.ticketId, status: TicketStatus.WAITING },
          data: { status: TicketStatus.CANCELLED },
        });
        if (!expired.count) continue;
        this.queueService.removeByTicketId(player.ticketId);
        this.server?.to(`user:${player.userId}`).emit('queue:error', {
          code: 'EXPIRED',
          message: 'No match was found. You can join again anytime.',
        });
      }
    }
  }

  private async evaluatePresence(matchId: string): Promise<void> {
    const match = await this.prisma.gameMatch.findUnique({
      where: { id: matchId },
      include: { participants: true },
    });
    if (!match) return;
    const online = match.participants.filter(
      (seat) => !seat.left_at && seat.is_connected,
    );
    const teams = new Set(online.map((seat) => seat.team_id));
    const connectedHumans = online.filter((seat) => !seat.is_bot);
    if (match.phase === MatchPhase.QUEUED) {
      if (online.length < match.participants.length)
        await this.cancelReadyRoom(matchId);
      return;
    }
    if (match.phase !== MatchPhase.PLAYING) return;

    const activeTimer = this.presenceTimers.get(matchId);
    let outcome: string | undefined;
    if (!connectedHumans.length) {
      outcome = 'empty';
    } else if (match.mode !== MatchMode.SINGLE && teams.size === 1) {
      outcome = online[0].team_id;
    }
    if (activeTimer && activeTimer.outcome === outcome) return;
    if (activeTimer) clearTimeout(activeTimer.timer);
    this.presenceTimers.delete(matchId);
    if (!outcome) return;

    const duration =
      match.mode === MatchMode.FIVE_V_FIVE && outcome !== 'empty' ? 0 : 60000;
    const timer = setTimeout(() => {
      this.presenceTimers.delete(matchId);
      void this.finishAbandonedMatch(matchId, outcome).catch((error: unknown) =>
        this.logger.error('Could not settle abandoned match', error),
      );
    }, duration);
    this.presenceTimers.set(matchId, { outcome, timer });
  }

  private async finishAbandonedMatch(
    matchId: string,
    outcome?: string,
  ): Promise<void> {
    this.clearTimer(matchId);
    this.clearBotTimer(matchId);
    clearTimeout(this.presenceTimers.get(matchId)?.timer);
    this.presenceTimers.delete(matchId);
    this.quarterSizes.delete(matchId);
    this.quarterResults.delete(matchId);
    if (outcome === 'empty') {
      const cancelled = await this.prisma.gameMatch.updateMany({
        where: { id: matchId, phase: MatchPhase.PLAYING },
        data: { phase: MatchPhase.CANCELLED, finished_at: new Date() },
      });
      if (cancelled.count)
        this.server?.to(`match:${matchId}`).emit('match:error', {
          code: 'MATCH_GONE',
          message: 'The match ended after both teams left.',
        });
      return;
    }
    const result = await this.roundService.finishMatch(
      matchId,
      outcome ?? null,
    );
    this.server?.to(`match:${matchId}`).emit('match:finished', result);
  }

  private async cancelReadyRoom(matchId: string): Promise<void> {
    const cancelled = await this.prisma.gameMatch.updateMany({
      where: { id: matchId, phase: MatchPhase.QUEUED },
      data: { phase: MatchPhase.CANCELLED, finished_at: new Date() },
    });
    if (!cancelled.count) return;
    this.clearTimer(matchId);
    this.server?.to(`match:${matchId}`).emit('queue:error', {
      code: 'ROOM_CLOSED',
      message: 'A player left the room. Choose a mode to find a new match.',
    });
  }

  @SubscribeMessage('queue:join')
  async handleQueueJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { mode: MatchMode; fixtureCode?: string },
  ): Promise<void> {
    await client.data?.authentication;
    const user = client.data?.user;
    if (!user || client.disconnected) return;
    if (!Object.values(MatchMode).includes(data?.mode)) {
      client.emit('queue:error', {
        code: 'INVALID_MODE',
        message: 'Choose a basketball play mode.',
      });
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

    const activeMatch = await this.prisma.gameParticipant.findFirst({
      where: {
        user_id: user.id,
        left_at: null,
        match: {
          phase: {
            in: [MatchPhase.QUEUED, MatchPhase.COUNTDOWN, MatchPhase.PLAYING],
          },
        },
      },
      select: { match_id: true, match: { select: { mode: true } } },
    });
    if (activeMatch) {
      if (activeMatch.match.mode === data.mode) {
        await this.handleSnapshot(client, { matchId: activeMatch.match_id });
      } else {
        client.emit('queue:error', {
          code: 'ACTIVE_MATCH',
          message: 'Return to your current play mode to rejoin your match.',
        });
      }
      return;
    }

    const schoolId = user.school_id ?? user.memberships?.[0]?.class?.school_id;
    if (!schoolId) {
      client.emit('queue:error', {
        code: 'INELIGIBLE',
        message: 'Join a school before playing.',
      });
      return;
    }
    const fixtureCode =
      data.mode === MatchMode.SINGLE &&
      process.env.GAME_FIXTURES === '1' &&
      typeof data.fixtureCode === 'string' &&
      /^[a-z0-9-]{1,30}$/i.test(data.fixtureCode)
        ? data.fixtureCode.toUpperCase()
        : undefined;
    const queueRoom = this.queueRoom(data.mode, schoolId, fixtureCode);
    const activeTicket = await this.prisma.matchmakingTicket.findFirst({
      where: { user_id: user.id, status: TicketStatus.WAITING },
    });
    if (activeTicket) {
      if (activeTicket.mode !== data.mode) {
        client.emit('queue:error', {
          code: 'ALREADY_QUEUED',
          message: 'Leave your current waiting room before joining another.',
        });
      } else {
        await client.join(queueRoom);
        await this.broadcastQueueUpdate(data.mode);
      }
      return;
    }

    if (data.mode === MatchMode.SINGLE && !fixtureCode) {
      const { matchId } = await this.matchmakingService.createPractice(
        user.id,
        schoolId,
        user.selected_hero_id,
      );
      const snapshot = await this.getSnapshot(user.id, matchId);
      await client.join(`match:${matchId}`);
      client.emit('match:found', snapshot);
      await this.startCountdown(matchId);
      return;
    }

    await client.join(queueRoom);
    if (client.disconnected) return;

    const ticket = await this.prisma.matchmakingTicket.create({
      data: {
        user_id: user.id,
        mode: data.mode,
        status: TicketStatus.WAITING,
      },
    });

    if (client.disconnected || (client.rooms && !client.rooms.has(queueRoom))) {
      await this.prisma.matchmakingTicket.updateMany({
        where: { id: ticket.id, status: TicketStatus.WAITING },
        data: { status: TicketStatus.CANCELLED },
      });
      return;
    }

    this.queueService.enqueue({
      ticketId: ticket.id,
      userId: user.id,
      schoolId,
      mode: data.mode,
      fixtureCode,
      nickname: user.nickname,
      avatarUrl: user.avatar_url,
    });
  }

  @SubscribeMessage('queue:cancel')
  async handleQueueCancel(@ConnectedSocket() client: Socket): Promise<void> {
    const userId = client.data?.userId;
    if (!userId) {
      return;
    }

    for (const room of client.rooms ?? []) {
      if (room.startsWith('queue:')) await client.leave(room);
    }

    await this.prisma.matchmakingTicket.updateMany({
      where: { user_id: userId, status: TicketStatus.WAITING },
      data: { status: TicketStatus.CANCELLED },
    });

    this.queueService.removeFromAll(userId);

    await this.broadcastQueueUpdate(MatchMode.ONE_V_ONE);
    await this.broadcastQueueUpdate(MatchMode.FIVE_V_FIVE);
  }

  private queueRoom(
    mode: MatchMode,
    schoolId: string,
    fixtureCode?: string,
  ): string {
    return `queue:${mode}:${schoolId}:${fixtureCode ?? ''}`;
  }

  async broadcastQueueUpdate(mode: MatchMode): Promise<void> {
    const rooms = new Map<
      string,
      { userId: string; nickname: string | null; avatarUrl: string | null }[]
    >();
    const required = this.matchmakingService.getRequiredPlayerCount(mode);
    for (const player of this.queueService.getQueue(mode)) {
      const room = this.queueRoom(mode, player.schoolId, player.fixtureCode);
      const players = rooms.get(room) ?? [];
      players.push({
        userId: player.userId,
        nickname: player.nickname ?? null,
        avatarUrl: player.avatarUrl ?? null,
      });
      rooms.set(room, players);
    }
    for (const [room, players] of rooms) {
      this.server?.to(room).emit('queue:update', {
        mode,
        filled: players.length,
        required,
        players,
      });
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

      this.server.to(`match:${matchId}`).emit('match:found', {
        ...matchResult,
        phase: MatchPhase.QUEUED,
      });
    }

    this.setTimer(
      matchId,
      setTimeout(() => {
        void this.startReadyMatch(matchId).catch((error: unknown) =>
          this.logger.error('Could not start the ready match', error),
        );
      }, 20000),
    );
  }

  @SubscribeMessage('match:start')
  async handleStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { matchId: string },
  ): Promise<void> {
    await client.data?.authentication;
    const userId = client.data?.userId;
    if (!userId || !data?.matchId) return;
    const participant = await this.prisma.gameParticipant.findFirst({
      where: { match_id: data.matchId, user_id: userId, left_at: null },
    });
    if (participant) await this.startReadyMatch(data.matchId);
  }

  private async startReadyMatch(matchId: string): Promise<void> {
    const match = await this.prisma.gameMatch.updateMany({
      where: { id: matchId, phase: MatchPhase.QUEUED },
      data: { phase: MatchPhase.COUNTDOWN },
    });
    if (match.count === 1) await this.startCountdown(matchId);
  }

  async startCountdown(
    matchId: string,
    durationMs: number = 3000,
  ): Promise<void> {
    const deadlineAt = new Date(Date.now() + durationMs).toISOString();
    this.countdownDeadlines.set(matchId, deadlineAt);

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
      this.countdownDeadlines.delete(matchId);
      await this.advanceToPlaying(matchId);
    }, durationMs);

    this.setTimer(matchId, timer);
  }

  async advanceToPlaying(matchId: string): Promise<void> {
    const changed = await this.prisma.gameMatch.updateMany({
      where: { id: matchId, phase: MatchPhase.COUNTDOWN },
      data: {
        phase: MatchPhase.PLAYING,
        started_at: new Date(),
      },
    });

    if (!changed.count) return;

    await this.evaluatePresence(matchId);
    if (this.server) {
      this.server.to(`match:${matchId}`).emit('match:phase', {
        matchId,
        phase: MatchPhase.PLAYING,
      });
    }

    if (this.roundService) {
      await this.startNextRound(matchId).catch((error: unknown) =>
        this.logger.error('Could not open the first quarter', error),
      );
    }
  }

  private async runRoundAction<T>(
    roundId: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const previous = this.roundActions.get(roundId);
    const next = (previous ?? Promise.resolve()).catch(() => {}).then(action);
    this.roundActions.set(roundId, next);
    try {
      return await next;
    } finally {
      if (this.roundActions.get(roundId) === next)
        this.roundActions.delete(roundId);
    }
  }

  async startNextRound(matchId: string): Promise<void> {
    const match = await this.prisma.gameMatch.findUnique({
      where: { id: matchId },
      include: { rounds: { orderBy: { number: 'asc' } } },
    });
    if (
      match?.phase !== MatchPhase.PLAYING ||
      match.rounds.some((round) => round.phase !== GameRoundPhase.COMPLETE)
    )
      return;

    let sizes = this.quarterSizes.get(matchId);
    if (!sizes) {
      sizes = await this.roundService.getQuarterSizes(matchId);
      this.quarterSizes.set(matchId, sizes);
    }
    for (const type of QUARTERS) {
      const index =
        match.rounds.filter((round) => round.round_type === type).length + 1;
      if (index > sizes[type]) continue;

      const { round, question, durationMs } =
        await this.roundService.createRound(
          matchId,
          type,
          match.rounds.length + 1,
          index,
          index === 1,
        );
      if (index === 1) {
        this.server
          ?.to(`match:${matchId}`)
          .emit('round:intro', this.roundIntro(type, round.deadline_at));
      } else {
        this.server
          ?.to(`match:${matchId}`)
          .emit(
            'round:question',
            this.roundService.toClientQuestion(
              round.id,
              question,
              index,
              sizes[type],
              round.deadline_at!.toISOString(),
            ),
          );
      }
      this.scheduleRoundTimer(matchId, round.id, durationMs);
      if (round.phase === GameRoundPhase.BUZZ)
        await this.scheduleBotBuzz(matchId, round.id);
      return;
    }

    this.quarterSizes.delete(matchId);
    clearTimeout(this.presenceTimers.get(matchId)?.timer);
    this.presenceTimers.delete(matchId);
    const result = await this.roundService.finishMatch(matchId);
    this.server?.to(`match:${matchId}`).emit('match:finished', result);
  }

  private roundIntro(type: RoundType, deadline: Date | null) {
    const copy: Record<RoundType, [string, string]> = {
      Q1_WARMUP: [
        'Warm-Up Hoops',
        'Buzz in first for a chance to answer and take a shot.',
      ],
      Q2_DEFENSE: [
        'Defense Round',
        'Share what you would do. Every thoughtful response earns Kindness Points.',
      ],
      Q3_HOBBY: [
        'Hobby Hoops',
        'Answer hobby questions and use your Power Wing to help your team.',
      ],
      Q4_FINALS: [
        'Wings Final',
        'Buzz in and vote with your team. A correct choice earns a championship shot.',
      ],
    };
    const [title, blurb] = copy[type];
    return {
      roundType: type,
      title,
      blurb,
      deadlineAt: deadline?.toISOString(),
    };
  }

  @SubscribeMessage('round:intro_ack')
  async handleIntroAck(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roundType: RoundType },
  ): Promise<void> {
    const userId = client.data?.userId;
    if (!userId || !data?.roundType) return;
    const round = await this.prisma.gameRound.findFirst({
      where: {
        phase: GameRoundPhase.INTRO,
        round_type: data.roundType,
        match: {
          phase: MatchPhase.PLAYING,
          participants: { some: { user_id: userId, left_at: null } },
        },
      },
    });
    if (round) await this.openQuarter(round.match_id, round.id);
  }

  private async openQuarter(matchId: string, roundId: string): Promise<void> {
    const round = await this.prisma.gameRound.findUnique({
      where: { id: roundId },
      include: { question: true },
    });
    if (round?.phase !== GameRoundPhase.INTRO) return;

    const timing = this.roundService.questionTiming(round.round_type);
    const deadline = new Date(Date.now() + timing.durationMs);
    const opened = await this.prisma.gameRound.updateMany({
      where: { id: roundId, phase: GameRoundPhase.INTRO },
      data: { phase: timing.phase, deadline_at: deadline },
    });
    if (!opened.count) return;

    const question = this.roundService.getSnapshotQuestion(
      { ...round, deadline_at: deadline },
      1,
      this.quarterSizes.get(matchId)?.[round.round_type],
    );
    this.server?.to(`match:${matchId}`).emit('round:question', question);
    this.scheduleRoundTimer(matchId, roundId, timing.durationMs);
    if (timing.phase === GameRoundPhase.BUZZ)
      await this.scheduleBotBuzz(matchId, roundId);
  }

  scheduleRoundTimer(
    matchId: string,
    roundId: string,
    durationMs: number,
  ): void {
    this.setTimer(
      matchId,
      setTimeout(() => {
        this.timers.delete(matchId);
        void this.runRoundAction(roundId, () =>
          this.handleRoundTimeout(matchId, roundId),
        ).catch((error: unknown) =>
          this.logger.error('Could not advance game timer', error),
        );
      }, durationMs),
    );
  }

  @SubscribeMessage('round:advance')
  async handleRoundAdvance(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { matchId: string; roundId: string },
  ): Promise<void> {
    const userId = client.data?.userId;
    if (
      !userId ||
      !data?.matchId ||
      !data.roundId ||
      this.quarterResults.get(data.matchId)?.roundId !== data.roundId
    )
      return;
    const participant = await this.prisma.gameParticipant.findFirst({
      where: { match_id: data.matchId, user_id: userId, left_at: null },
    });
    if (participant) await this.advanceQuarter(data.matchId, data.roundId);
  }

  private async advanceQuarter(
    matchId: string,
    roundId: string,
  ): Promise<void> {
    if (this.quarterResults.get(matchId)?.roundId !== roundId) return;
    this.quarterResults.delete(matchId);
    this.clearTimer(matchId);
    await this.startNextRound(matchId);
  }

  private async finishQuestion(
    matchId: string,
    roundId: string,
    pauseMs = 0,
  ): Promise<void> {
    this.clearTimer(matchId);
    this.stealTeams.delete(roundId);
    this.clearBotTimer(matchId);
    const result = await this.roundService.completeRound(roundId);
    const played = await this.prisma.gameRound.count({
      where: { match_id: matchId, round_type: result.roundType },
    });
    const total = this.quarterSizes.get(matchId)?.[result.roundType] ?? 1;
    const advance = async () => {
      if (played < total) {
        await this.startNextRound(matchId);
        return;
      }
      const resultDuration = 12000;
      const summary = {
        ...result,
        roundNumber: QUARTERS.indexOf(result.roundType) + 1,
        deadlineAt: new Date(Date.now() + resultDuration).toISOString(),
      };
      this.quarterResults.set(matchId, summary);
      this.server?.to(`match:${matchId}`).emit('round:complete', summary);
      this.setTimer(
        matchId,
        setTimeout(() => {
          void this.advanceQuarter(matchId, roundId).catch((error: unknown) =>
            this.logger.error('Could not advance the quarter', error),
          );
        }, resultDuration),
      );
    };
    if (pauseMs) {
      this.setTimer(
        matchId,
        setTimeout(() => {
          void advance().catch((error: unknown) =>
            this.logger.error('Could not finish the question', error),
          );
        }, pauseMs),
      );
    } else {
      await advance();
    }
  }

  private async handleDefenseProgress(
    matchId: string,
    roundId: string,
    timedOut = false,
  ): Promise<void> {
    const players = await this.prisma.gameParticipant.findMany({
      where: { match_id: matchId, is_bot: false, left_at: null },
    });
    const answers = await this.prisma.gameAnswer.findMany({
      where: { round_id: roundId },
      orderBy: { submitted_at: 'asc' },
    });
    if (
      !timedOut &&
      players.some(
        (player) =>
          !answers.some((answer) => answer.participant_id === player.id),
      )
    )
      return;
    const shooter = answers.find(
      (answer) =>
        answer.is_correct &&
        players.some(
          (player) =>
            player.id === answer.participant_id && player.is_connected,
        ),
    );
    if (shooter) {
      await this.openShootout(matchId, roundId, shooter.participant_id);
    } else {
      await this.finishQuestion(matchId, roundId);
    }
  }

  private async openShootout(
    matchId: string,
    roundId: string,
    shooterId: string,
  ): Promise<void> {
    const shootout = await this.roundService.startShootout(roundId, shooterId);
    this.server?.to(`match:${matchId}`).emit('shootout:start', shootout);
    this.scheduleRoundTimer(matchId, roundId, 60000);
    const shooter = await this.prisma.gameParticipant.findUnique({
      where: { id: shooterId },
      select: { is_bot: true },
    });
    if (shooter?.is_bot) {
      this.setBotTimer(matchId, roundId, 2500, async () => {
        const result = await this.roundService.submitShootoutSwipe(
          roundId,
          shooterId,
          true,
        );
        this.server?.to(`match:${matchId}`).emit('shootout:result', result);
        await this.finishQuestion(matchId, roundId, 1600);
      });
    }
  }

  private async openSteal(
    matchId: string,
    roundId: string,
    losingTeamId: string,
  ): Promise<void> {
    if (this.stealTeams.has(roundId)) {
      await this.finishQuestion(matchId, roundId, 1400);
      return;
    }
    const opponent = await this.prisma.gameTeam.findFirst({
      where: {
        match_id: matchId,
        id: { not: losingTeamId },
        participants: { some: { is_connected: true, left_at: null } },
      },
    });
    if (!opponent) {
      await this.finishQuestion(matchId, roundId, 1400);
      return;
    }
    const deadline = new Date(Date.now() + 10000);
    this.stealTeams.set(roundId, opponent.id);
    await this.prisma.gameRound.update({
      where: { id: roundId },
      data: {
        phase: GameRoundPhase.BUZZ,
        buzz_winner_id: null,
        deadline_at: deadline,
      },
    });
    this.server?.to(`match:${matchId}`).emit('round:steal_open', {
      roundId,
      eligibleTeamId: opponent.id,
      deadlineAt: deadline.toISOString(),
    });
    this.scheduleRoundTimer(matchId, roundId, 10000);
    await this.scheduleBotBuzz(matchId, roundId, opponent.id);
  }

  async handleRoundTimeout(matchId: string, roundId: string): Promise<void> {
    const round = await this.prisma.gameRound.findUnique({
      where: { id: roundId },
      include: { buzz_winner: true },
    });
    if (!round || round.phase === GameRoundPhase.COMPLETE) return;
    if (round.deadline_at && round.deadline_at.getTime() > Date.now()) {
      this.scheduleRoundTimer(
        matchId,
        roundId,
        round.deadline_at.getTime() - Date.now(),
      );
      return;
    }

    if (round.phase === GameRoundPhase.INTRO) {
      await this.openQuarter(matchId, roundId);
    } else if (round.phase === GameRoundPhase.VOTE) {
      await this.resolveVoteAndAdvance(matchId, roundId);
    } else if (
      round.phase === GameRoundPhase.ANSWER &&
      round.round_type === RoundType.Q2_DEFENSE
    ) {
      await this.handleDefenseProgress(matchId, roundId, true);
    } else if (round.phase === GameRoundPhase.ANSWER && round.buzz_winner) {
      await this.openSteal(matchId, roundId, round.buzz_winner.team_id);
    } else if (round.phase === GameRoundPhase.SHOOTOUT) {
      const scores = await this.roundService.getTeamScores(matchId);
      this.server
        ?.to(`match:${matchId}`)
        .emit('shootout:result', { made: false, xp: 0, teamScores: scores });
      await this.finishQuestion(matchId, roundId, 1400);
    } else {
      await this.finishQuestion(matchId, roundId);
    }
  }

  private clearBotTimer(matchId: string): void {
    clearTimeout(this.botTimers.get(matchId));
    this.botTimers.delete(matchId);
  }

  private setBotTimer(
    matchId: string,
    roundId: string,
    delay: number,
    action: () => Promise<void>,
  ): void {
    this.clearBotTimer(matchId);
    this.botTimers.set(
      matchId,
      setTimeout(() => {
        this.botTimers.delete(matchId);
        void this.runRoundAction(roundId, action).catch((error: unknown) =>
          this.logger.warn('Practice turn could not advance: ' + String(error)),
        );
      }, delay),
    );
  }

  private async scheduleBotBuzz(
    matchId: string,
    roundId: string,
    stealTeam?: string,
  ): Promise<void> {
    const bot = await this.prisma.gameParticipant.findFirst({
      where: {
        match_id: matchId,
        is_bot: true,
        ...(stealTeam ? { team_id: stealTeam } : {}),
      },
    });
    if (!bot) return;
    this.setBotTimer(matchId, roundId, stealTeam ? 3000 : 7000, async () => {
      const round = await this.prisma.gameRound.findUnique({
        where: { id: roundId },
        include: { question: true, match: true },
      });
      if (
        round?.phase !== GameRoundPhase.BUZZ ||
        round.match.phase !== MatchPhase.PLAYING
      )
        return;

      const buzz = await this.roundService.buzz(roundId, bot.id);
      this.server?.to(`match:${matchId}`).emit('round:buzz_winner', buzz);
      this.scheduleRoundTimer(matchId, roundId, buzz.durationMs);
      this.setBotTimer(matchId, roundId, 2000, async () => {
        const question = round.question
          ? this.roundService.parsePackQuestion(round.question)
          : FALLBACK_QUESTIONS[round.round_type];
        if (round.round_type === RoundType.Q4_FINALS) {
          if (question.correctIndex !== undefined) {
            await this.roundService.recordVote(
              roundId,
              bot.id,
              question.correctIndex,
            );
          }
          await this.resolveVoteAndAdvance(matchId, roundId);
          return;
        }
        const answer = await this.roundService.submitAnswer(
          roundId,
          bot.id,
          question.correctIndex,
        );
        this.server?.to(`match:${matchId}`).emit('round:answer_result', answer);
        if (answer.correct) await this.openShootout(matchId, roundId, bot.id);
        else await this.finishQuestion(matchId, roundId, 1400);
      });
    });
  }

  @SubscribeMessage('round:buzz')
  async handleBuzz(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roundId: string },
  ): Promise<void> {
    const userId = client.data?.userId;
    if (!userId || !data?.roundId) return;

    try {
      await this.runRoundAction(data.roundId, async () => {
        const participant = await this.prisma.gameParticipant.findFirst({
          where: {
            user_id: userId,
            match: { rounds: { some: { id: data.roundId } } },
          },
        });
        if (
          !participant ||
          participant.left_at ||
          participant.is_connected === false
        ) {
          client.emit('error', {
            code: 'FORBIDDEN',
            message: 'Participant not in match',
          });
          return;
        }

        const eligibleTeam = this.stealTeams.get(data.roundId);
        if (eligibleTeam && eligibleTeam !== participant.team_id) return;
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

          this.scheduleRoundTimer(
            match.id,
            data.roundId,
            buzzResult.durationMs,
          );
        }
      });
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
      await this.runRoundAction(data.roundId, async () => {
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
        if (
          !participant ||
          participant.left_at ||
          participant.is_connected === false
        ) {
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

        if (round.round_type === RoundType.Q2_DEFENSE) {
          await this.handleDefenseProgress(round.match_id, data.roundId);
        } else if (answerResult.correct) {
          await this.openShootout(round.match_id, data.roundId, participant.id);
        } else {
          await this.openSteal(
            round.match_id,
            data.roundId,
            participant.team_id,
          );
        }
      });
    } catch (err: any) {
      client.emit('error', {
        code: err.code || 'FORBIDDEN',
        message: err.message,
      });
    }
  }

  async resolveVoteAndAdvance(matchId: string, roundId: string): Promise<void> {
    this.clearTimer(matchId);

    const round = await this.prisma.gameRound.findUnique({
      where: { id: roundId },
    });
    if (!round || round.phase !== GameRoundPhase.VOTE) {
      return;
    }

    const voteResult = await this.roundService.resolveVote(roundId);
    if (this.server) {
      this.server.to(`match:${matchId}`).emit('round:vote_result', voteResult);
    }
    if (voteResult.correct && voteResult.designatedShooterId) {
      this.setTimer(
        matchId,
        setTimeout(() => {
          void this.openShootout(
            matchId,
            roundId,
            voteResult.designatedShooterId!,
          ).catch((error: unknown) =>
            this.logger.error('Could not start the final shot', error),
          );
        }, 2300),
      );
    } else {
      await this.finishQuestion(matchId, roundId, 2300);
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
      });
      if (
        !participant ||
        participant.left_at ||
        participant.is_connected === false
      ) {
        client.emit('error', {
          code: 'FORBIDDEN',
          message: 'Participant not in match',
        });
        return;
      }

      const passResult = await this.roundService.pass(
        data.roundId,
        participant.id,
      );

      if (this.server) {
        this.server
          .to(`match:${passResult.match.id}`)
          .emit('round:buzz_winner', {
            roundId: passResult.roundId,
            participantId: passResult.participantId,
            userId: passResult.userId,
            deadlineAt: passResult.deadlineAt,
          });

        for (const p of passResult.match.participants) {
          if (p.id !== passResult.participantId && p.user_id) {
            const reason =
              p.team_id === passResult.newAnswerer.team_id
                ? 'TEAMMATE'
                : 'OPPONENT';
            this.server.to(`user:${p.user_id}`).emit('round:waiting', {
              roundId: data.roundId,
              reason,
            });
          }
        }

        this.scheduleRoundTimer(passResult.match.id, data.roundId, 10000);
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
      await this.runRoundAction(data.roundId, async () => {
        const participant = await this.prisma.gameParticipant.findFirst({
          where: {
            user_id: userId,
            match: { rounds: { some: { id: data.roundId } } },
          },
        });
        if (
          !participant ||
          participant.left_at ||
          participant.is_connected === false
        ) {
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
          this.server.to(`match:${round.match_id}`).emit('round:vote_update', {
            roundId: voteUpdate.roundId,
            submittedCount: voteUpdate.submittedCount,
            teamSize: voteUpdate.teamSize,
          });

          if (voteUpdate.allVoted) {
            await this.resolveVoteAndAdvance(round.match_id, data.roundId);
          }
        }
      });
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
      await this.runRoundAction(data.roundId, async () => {
        const participant = await this.prisma.gameParticipant.findFirst({
          where: {
            user_id: userId,
            match: { rounds: { some: { id: data.roundId } } },
          },
        });
        if (
          !participant ||
          participant.left_at ||
          participant.is_connected === false
        ) {
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
          // Other players see the effect and timer change without seeing the private hint.
          const room = this.server.to(`match:${round.match_id}`);
          const privateEffect = ['hint', 'weights', 'removedOptions'].includes(
            powerResult.effect.type,
          );
          if (privateEffect) {
            client.emit('power:effect', powerResult);
            client.to(`match:${round.match_id}`).emit('power:effect', {
              ...powerResult,
              effect: { type: powerResult.effect.type },
            });
          } else {
            room.emit('power:effect', powerResult);
          }
        }
      });
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

    try {
      const participant = await this.prisma.gameParticipant.findFirst({
        where: {
          user_id: userId,
          match: { rounds: { some: { id: data.roundId } } },
        },
      });
      if (
        !participant ||
        participant.left_at ||
        participant.is_connected === false
      ) {
        client.emit('error', {
          code: 'FORBIDDEN',
          message: 'Participant not in match',
        });
        return;
      }

      const result = await this.roundService.requestHelp(
        data.roundId,
        participant.id,
      );

      if (this.server) {
        for (const teammate of result.connectedTeammates) {
          if (teammate.user_id) {
            this.server
              .to(`user:${teammate.user_id}`)
              .emit('power:help_request', {
                roundId: result.roundId,
                prompt: result.prompt,
                options: result.options,
              });
          }
        }
      }
    } catch (err: any) {
      client.emit('error', {
        code: err.code || 'FORBIDDEN',
        message: err.message,
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

    try {
      const result = await this.roundService.suggestHelp(
        data.roundId,
        userId,
        data.forUserId,
        data.optionIndex,
      );

      if (this.server) {
        this.server.to(`user:${result.forUserId}`).emit('power:help_suggest', {
          roundId: result.roundId,
          fromUserId: result.fromUserId,
          optionIndex: result.optionIndex,
        });
      }
    } catch (err: any) {
      client.emit('error', {
        code: err.code || 'FORBIDDEN',
        message: err.message,
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
      await this.runRoundAction(data.roundId, async () => {
        const participant = await this.prisma.gameParticipant.findFirst({
          where: {
            user_id: userId,
            match: { rounds: { some: { id: data.roundId } } },
          },
        });
        if (
          !participant ||
          participant.left_at ||
          participant.is_connected === false
        ) {
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

          await this.finishQuestion(round.match_id, data.roundId, 1600);
        }
      });
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
  ): Promise<boolean> {
    const userId = client.data?.userId;
    if (!userId || !data?.matchId) {
      return false;
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
      return false;
    }

    await this.prisma.gameParticipant.update({
      where: { id: participant.id },
      data: {
        left_at: new Date(),
        is_connected: false,
      },
    });

    await client.leave(`match:${data.matchId}`);

    if (participant.match.phase === MatchPhase.QUEUED) {
      await this.cancelReadyRoom(data.matchId);
      return true;
    }

    if (
      participant.match.mode === MatchMode.SINGLE &&
      (participant.match.phase === MatchPhase.PLAYING ||
        participant.match.phase === MatchPhase.COUNTDOWN)
    ) {
      await this.finishAbandonedMatch(data.matchId);
      return true;
    }

    if (this.server) {
      this.server.to(`match:${data.matchId}`).emit('match:peer_left', {
        userId: participant.user_id,
        nickname: participant.user?.nickname ?? null,
      });
    }
    await this.evaluatePresence(data.matchId);
    return true;
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
            phase: {
              in: [MatchPhase.QUEUED, MatchPhase.COUNTDOWN, MatchPhase.PLAYING],
            },
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
            hero: { select: { power_code: true } },
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

    const teams = [...match.teams]
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((t) => ({
        id: t.id,
        label: t.label,
        scoreXp: t.score_xp,
        scoreKindness: t.score_kindness,
        scoreBaskets: t.score_baskets,
        members: match.participants
          .filter((p) => p.team_id === t.id)
          .map((p) => ({
            id: p.id,
            userId: p.user_id,
            isBot: p.is_bot,
            nickname: p.user?.nickname ?? (p.is_bot ? 'Practice Bot' : null),
            avatarUrl: p.user?.avatar_url ?? null,
            heroId: p.hero_id,
            powerCode: p.hero?.power_code,
            jerseyNumber: p.jersey_number,
            isConnected: p.id === participant.id || p.is_connected,
            leftAt: p.left_at,
            powerUsed: p.power_used,
          })),
      }));

    const scoresForClient = await this.roundService.getTeamScores(matchId);
    const you = {
      participantId: participant.id,
      canBuzz: false,
      powerUsed: participant.power_used,
      heroId: participant.hero_id,
      powerCode: participant.hero?.power_code,
      jerseyNumber: participant.jersey_number,
    };

    if (match.phase === MatchPhase.FINISHED) {
      return {
        matchId: match.id,
        mode: match.mode,
        phase: match.phase,
        serverNow: new Date().toISOString(),
        teams,
        you,
        winnerTeamId: match.winner_team_id,
        scores: scoresForClient,
        kindness: Object.fromEntries(
          teams.map((team) => [team.id, team.scoreKindness]),
        ),
      };
    }

    const round = match.rounds.find(
      (item) => item.phase !== GameRoundPhase.COMPLETE,
    );
    const sizes = this.quarterSizes.get(matchId);
    const index = round
      ? match.rounds.filter(
          (item) =>
            item.round_type === round.round_type && item.number <= round.number,
        ).length
      : 1;
    const buzzer =
      round &&
      match.participants.find((seat) => seat.id === round.buzz_winner_id);
    const eligibleTeam = round && this.stealTeams.get(round.id);
    const submitted = round
      ? await this.prisma.gameAnswer.findFirst({
          where: { round_id: round.id, participant_id: participant.id },
          select: { id: true },
        })
      : null;
    const deadlineAt =
      round?.deadline_at?.toISOString() ??
      this.countdownDeadlines.get(match.id);
    let questionPayload: ReturnType<
      RoundService['getSnapshotQuestion']
    > | null = null;
    if (round && round.phase !== GameRoundPhase.INTRO) {
      questionPayload = this.roundService.getSnapshotQuestion(
        round,
        index,
        sizes?.[round.round_type],
      );
    }
    you.canBuzz =
      round?.phase === GameRoundPhase.BUZZ &&
      (!eligibleTeam || eligibleTeam === participant.team_id);

    return {
      matchId: match.id,
      mode: match.mode,
      phase: match.phase,
      roundPhase: round?.phase ?? null,
      roundType: round?.round_type ?? null,
      roundId: round?.id ?? null,
      deadlineAt: deadlineAt ?? null,
      intro:
        round?.phase === GameRoundPhase.INTRO
          ? this.roundIntro(round.round_type, round.deadline_at)
          : null,
      roundComplete: this.quarterResults.get(matchId) ?? null,
      buzzWinner: buzzer
        ? {
            participantId: buzzer.id,
            userId: buzzer.user_id,
            teamId: buzzer.team_id,
          }
        : null,
      shootout:
        round?.phase === GameRoundPhase.SHOOTOUT && buzzer
          ? {
              roundId: round.id,
              shooterParticipantId: buzzer.id,
              deadlineAt,
              multiplier: round.round_type === RoundType.Q4_FINALS ? 3 : 2,
            }
          : null,
      submitted: Boolean(submitted),
      eligibleTeamId: eligibleTeam ?? null,
      serverNow: new Date().toISOString(),
      teams,
      question: questionPayload ?? null,
      you,
      scores: scoresForClient,
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
