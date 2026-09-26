export interface PendingOperation<T> {
  operationId: string;
  body: T;
  state: 'pending' | 'confirmed' | 'unknown';
}

interface QueueEntry<T, R> extends PendingOperation<T> {
  resolve: (value: R) => void;
  reject: (reason: unknown) => void;
}

/** One FIFO, one-in-flight queue. Lost responses retain the exact operation ID and body. */
export class ThreadOperationQueue<T, R> {
  private readonly entries: QueueEntry<T, R>[] = [];
  private running = false;

  constructor(private readonly send: (operation: PendingOperation<T>) => Promise<R>) {}

  enqueue(operationId: string, body: T): Promise<R> {
    return new Promise<R>((resolve, reject) => {
      this.entries.push({ operationId, body, state: 'pending', resolve, reject });
      void this.drain();
    });
  }

  snapshot(): readonly PendingOperation<T>[] {
    return this.entries.map(({ operationId, body, state }) => ({ operationId, body, state }));
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    while (this.entries[0]) {
      const entry = this.entries[0];
      try {
        const result = await this.send(entry);
        entry.state = 'confirmed';
        this.entries.shift();
        entry.resolve(result);
      } catch (cause) {
        entry.state = 'unknown';
        entry.reject(cause);
        break;
      }
    }
    this.running = false;
  }

  retryUnknown(): void {
    if (this.entries[0]?.state !== 'unknown') return;
    this.entries[0].state = 'pending';
    void this.drain();
  }
}
