/**
 * Typed events, and a disposal contract that is visible in the type system.
 *
 * Both replace decorator machinery from the legacy codebase. The legacy
 * `@eventable` added untyped on/off/trigger to four classes, and `@disposable`
 * added dispose() to four more without giving the type system any way to know
 * it had been added.
 */

/** Maps event names to their payload types. */
export type EventMap = Record<string, unknown>

/** A wildcard listener is told the type as well as the payload. */
export type WildcardListener<M extends EventMap> = <K extends keyof M & string>(
  type: K,
  event: M[K]
) => void

/**
 * A minimal typed event emitter.
 *
 * Two deliberate differences from the legacy Eventable:
 *
 * - `on()` returns its own unsubscribe function. The common listener leak is a
 *   handler registered as an inline arrow, which cannot be named at teardown
 *   time; returning the remover makes the correct thing easier than the wrong
 *   thing.
 * - Dispatch iterates a copy, so a listener that unsubscribes during dispatch
 *   does not cause the following listener to be skipped.
 */
export class EventEmitter<M extends EventMap> {
  #listeners = new Map<keyof M & string, Set<(event: never) => void>>()
  #wildcards = new Set<WildcardListener<M>>()

  /**
   * Subscribes to an event, or to `'*'` for every event.
   *
   * @returns A function that removes this subscription. Safe to call twice.
   */
  on<K extends keyof M & string> (type: K, fn: (event: M[K]) => void): () => void
  on (type: '*', fn: WildcardListener<M>): () => void
  on (type: string, fn: (...args: never[]) => void): () => void {
    if (type === '*') {
      const wildcard = fn as unknown as WildcardListener<M>
      this.#wildcards.add(wildcard)
      return () => { this.#wildcards.delete(wildcard) }
    }

    let set = this.#listeners.get(type)
    if (!set) {
      set = new Set()
      this.#listeners.set(type, set)
    }
    set.add(fn as (event: never) => void)
    return () => { this.off(type as keyof M & string, fn as unknown as (event: M[keyof M & string]) => void) }
  }

  /** Removes one subscription. Unknown type/function pairs are ignored. */
  off<K extends keyof M & string> (type: K, fn: (event: M[K]) => void): void {
    const set = this.#listeners.get(type)
    if (!set) return
    set.delete(fn as (event: never) => void)
    if (set.size === 0) this.#listeners.delete(type)
  }

  /** Removes every subscription, including wildcards. */
  removeAllListeners (): void {
    this.#listeners.clear()
    this.#wildcards.clear()
  }

  /**
   * Dispatches an event.
   *
   * Public, and deliberately so. The classes that fire events here (a source, a
   * viewer) *hold* an emitter rather than extending one, so a `protected`
   * modifier would make their own emitter unreachable -- TypeScript checks
   * protected access against the class doing the accessing, and a composing
   * class is not a subclass.
   *
   * What actually keeps events unforgeable is ownership, not the modifier: the
   * emitter instance is a private field of its owner, and `on()` hands out only
   * the unsubscribe function. Nothing outside the owner ever holds the emitter,
   * so nothing outside the owner can call this.
   */
  emit<K extends keyof M & string> (type: K, event: M[K]): void {
    // Copy before iterating. A listener that unsubscribes would otherwise
    // mutate the Set mid-iteration and skip its neighbour.
    const set = this.#listeners.get(type)
    if (set) {
      for (const fn of [...set]) (fn as (event: M[K]) => void)(event)
    }
    for (const fn of [...this.#wildcards]) fn(type, event)
  }
}

/**
 * Base class for anything with a lifetime.
 *
 * Subclasses override `dispose`, do their own teardown, and call `super.dispose()`
 * last. The base is idempotent, so a double dispose -- reachable from both the
 * public API and from device-loss handling -- runs teardown once.
 */
export abstract class Disposable {
  #disposed = false

  /** True once `dispose()` has run. */
  get isDisposed (): boolean { return this.#disposed }

  /**
   * Throws if this object has been disposed.
   *
   * Called at public boundaries -- roughly eight places, not a hundred. The
   * legacy `@undisposed` guarded every member, but the use-after-dispose that
   * actually happens is internal: a rAF callback reaching a dead renderer, a
   * media event reaching a dead texture. Those paths never touch a public
   * member, so guarding every public member bought a layer of protection in
   * the wrong place at the cost of a hundred wrapped functions.
   */
  assertAlive (): void {
    if (this.#disposed) {
      throw new Error(`${this.constructor.name} has been disposed`)
    }
  }

  /** Releases resources. Idempotent. */
  dispose (): void {
    if (this.#disposed) return
    this.#disposed = true
    // The subclass convention is "own teardown, then super.dispose() last", so
    // an override's body has already run by the time this base method executes,
    // and a guard here cannot stop a second public dispose() from re-entering
    // that override -- dynamic dispatch finds it before this method. Instead,
    // the first dispose shadows the method (override included) with an own
    // no-op property: property lookup consults own properties before the
    // prototype chain, which is what makes the second call a true no-op.
    Object.defineProperty(this, 'dispose', {
      value: () => {},
      writable: true,
      configurable: true
    })
  }
}
