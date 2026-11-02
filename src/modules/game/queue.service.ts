import { Injectable } from '@nestjs/common';
import { MatchMode } from 'prisma/generated/client';

export interface QueuedPlayer {
  ticketId: string;
  userId: string;
  schoolId: string;
  mode: MatchMode;
  fixtureCode?: string;
  enqueuedAt: Date;
  nickname?: string;
  avatarUrl?: string;
}

export type QueueChangeListener = (mode: MatchMode) => void;

@Injectable()
export class QueueService {
  private readonly queues: Map<MatchMode, QueuedPlayer[]> = new Map([
    [MatchMode.SINGLE, []],
    [MatchMode.ONE_V_ONE, []],
    [MatchMode.FIVE_V_FIVE, []],
  ]);

  private readonly listeners: QueueChangeListener[] = [];

  onQueueChange(listener: QueueChangeListener): void {
    this.listeners.push(listener);
  }

  private notify(mode: MatchMode): void {
    for (const listener of this.listeners) {
      try {
        listener(mode);
      } catch {
        // ignore listener errors
      }
    }
  }

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
    this.notify(player.mode);
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
      const filtered = list.filter((p) => p.userId !== userId);
      if (filtered.length !== list.length) {
        this.queues.set(mode, filtered);
        this.notify(mode);
      }
    }
  }

  removeByTicketId(ticketId: string): void {
    for (const [mode, list] of this.queues.entries()) {
      const filtered = list.filter((p) => p.ticketId !== ticketId);
      if (filtered.length !== list.length) {
        this.queues.set(mode, filtered);
        this.notify(mode);
      }
    }
  }

  getQueue(mode: MatchMode): QueuedPlayer[] {
    return [...(this.queues.get(mode) ?? [])];
  }

  dequeueCandidates(mode: MatchMode, count: number): QueuedPlayer[] {
    const list = this.queues.get(mode) ?? [];
    if (list.length < count) {
      return [];
    }
    const candidates = list.slice(0, count);
    this.queues.set(mode, list.slice(count));
    this.notify(mode);
    return candidates;
  }

  clear(): void {
    for (const mode of this.queues.keys()) {
      this.queues.set(mode, []);
      this.notify(mode);
    }
  }
}
