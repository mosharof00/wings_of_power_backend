import { Injectable } from '@nestjs/common';
import { MatchMode } from 'prisma/generated/client';

export interface QueuedPlayer {
  ticketId: string;
  userId: string;
  schoolId: string;
  mode: MatchMode;
  fixtureCode?: string;
  enqueuedAt: Date;
}

@Injectable()
export class QueueService {
  private readonly queues: Map<MatchMode, QueuedPlayer[]> = new Map([
    [MatchMode.SINGLE, []],
    [MatchMode.ONE_V_ONE, []],
    [MatchMode.FIVE_V_FIVE, []],
  ]);

  enqueue(player: Omit<QueuedPlayer, 'enqueuedAt'>): void {
    const list = this.queues.get(player.mode) ?? [];
    const existingIndex = list.findIndex(
      (p) => p.userId === player.userId || p.ticketId === player.ticketId,
    );
    if (existingIndex !== -1) {
      list.splice(existingIndex, 1);
    }
    list.push({ ...player, enqueuedAt: new Date() });
    this.queues.set(player.mode, list);
  }

  isQueued(userId: string): boolean {
    for (const list of this.queues.values()) {
      if (list.some((p) => p.userId === userId)) {
        return true;
      }
    }
    return false;
  }

  removeFromAll(userId: string): void {
    for (const [mode, list] of this.queues.entries()) {
      this.queues.set(
        mode,
        list.filter((p) => p.userId !== userId),
      );
    }
  }

  removeByTicketId(ticketId: string): void {
    for (const [mode, list] of this.queues.entries()) {
      this.queues.set(
        mode,
        list.filter((p) => p.ticketId !== ticketId),
      );
    }
  }

  getQueue(mode: MatchMode): QueuedPlayer[] {
    return [...(this.queues.get(mode) ?? [])];
  }

  clear(): void {
    for (const mode of this.queues.keys()) {
      this.queues.set(mode, []);
    }
  }
}
