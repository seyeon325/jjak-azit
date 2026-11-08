/** 작은 타입 안전 이벤트 발행기 */
export class Emitter<Events extends Record<string, unknown[]>> {
  private handlers: { [K in keyof Events]?: Set<(...args: Events[K]) => void> } = {};

  on<K extends keyof Events>(ev: K, fn: (...args: Events[K]) => void): () => void {
    (this.handlers[ev] ??= new Set()).add(fn);
    return () => this.handlers[ev]?.delete(fn);
  }

  emit<K extends keyof Events>(ev: K, ...args: Events[K]) {
    this.handlers[ev]?.forEach((fn) => fn(...args));
  }
}
