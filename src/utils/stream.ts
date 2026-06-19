// Throttled message-edit helper. Telegram limits us to roughly one edit per
// second per chat; we batch token deltas and only edit when worthwhile.

export class StreamEditor {
  private last = 0;
  private pending: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly edit: (text: string) => Promise<void>,
    private readonly minIntervalMs = 900
  ) {}

  /** Schedule (or immediately apply) an edit with the latest full text. */
  push(text: string): void {
    this.pending = text;
    const now = Date.now();
    const wait = Math.max(0, this.minIntervalMs - (now - this.last));
    if (wait === 0) {
      void this.flush();
    } else if (!this.timer) {
      this.timer = setTimeout(() => void this.flush(), wait);
    }
  }

  /** Force-apply the latest pending edit (call when stream ends). */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pending === null) return;
    const text = this.pending;
    this.pending = null;
    this.last = Date.now();
    try {
      await this.edit(text);
    } catch {
      // Ignore "message is not modified" and similar Telegram 400s.
    }
  }
}
