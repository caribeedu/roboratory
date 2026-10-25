// Counts the permission requests a machine is waiting on a person for. The machine's time limit stops while any
// waits (D44): the clock runs only while the agent works.
export class Waits {
  private n = 0;
  private subs = new Set<(waiting: number) => void>();

  get count() { return this.n; }

  /** Calls back each time the count changes; returns the way to stop listening. */
  on(cb: (waiting: number) => void): () => void { this.subs.add(cb); return () => this.subs.delete(cb); }

  add(delta: number) {
    this.n = Math.max(0, this.n + delta);
    for (const cb of [...this.subs]) cb(this.n);
  }
}
