import { randomUUID } from 'node:crypto';
import type { RouterEvent } from '@flash-router/shared';

type Listener = (event: RouterEvent) => void;

export class EventHub {
  private readonly listeners = new Set<Listener>();
  private readonly history: RouterEvent[] = [];

  publish(input: Omit<RouterEvent, 'event_id' | 'timestamp'>): RouterEvent {
    const event = { event_id: randomUUID(), timestamp: new Date().toISOString(), ...input };
    this.history.push(event);
    if (this.history.length > 200) this.history.shift();
    for (const listener of this.listeners) listener(event);
    return event;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  recent(): RouterEvent[] { return [...this.history]; }
}
