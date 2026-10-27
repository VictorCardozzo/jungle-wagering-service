export class OutboxMessage {
  constructor(
    public readonly id: string,
    public readonly aggregateId: string,
    public readonly eventType: string,
    public readonly payload: Record<string, any>,
    public readonly occurredAt: Date = new Date(),
  ) {}

  static enqueue(aggregateId: string, eventType: string, payload: Record<string, any>): OutboxMessage {
    return new OutboxMessage(crypto.randomUUID(), aggregateId, eventType, payload);
  }
}