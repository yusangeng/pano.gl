/**
 * Typed events, and a disposal contract that is visible in the type system --
 * typed replacements for the legacy `@eventable`/`@disposable` decorators,
 * which added members with no trace in the types.
 */

/**
 * Maps event names to their payload types.
 *
 * Event maps must carry a string index signature to satisfy the emitters'
 * `M extends EventMap` constraint: write `interface MyEvents extends EventMap`
 * (or `extends Record<string, unknown>`). A plain interface without an index
 * signature does not satisfy it and fails at the `EventEmitter<...>` site.
 */
export type EventMap = Record<string, unknown>

/** A wildcard listener is told the type as well as the payload. */
export type WildcardListener<M extends EventMap> = <K extends keyof M & string>(
  type: K,
  event: M[K]
) => void

/**
 * A minimal typed event emitter.
 *
 * `on()` returns its own unsubscribe function: the common listener leak is an
 * inline-arrow handler that cannot be named at teardown time, and returning
 * the remover makes the correct thing easier than the wrong thing. Dispatch
 * iterates a copy, so a listener that unsubscribes during dispatch does not
 * skip the next one.
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
   * Public, and deliberately so: the classes that fire events here (a source,
   * a viewer) *hold* an emitter rather than extending one, and TypeScript
   * checks `protected` access against the accessing class -- a composing class
   * is not a subclass, so `protected` would make their own emitter
   * unreachable. What keeps events unforgeable is ownership: the emitter is a
   * private field, and `on()` hands out only the unsubscribe function.
   */
  emit<K extends keyof M & string> (type: K, event: M[K]): void {
    // Copy before iterating. A listener that unsubscribes a not-yet-visited
    // listener would otherwise skip it: a live Set tolerates removal of the
    // element being visited, but not of one still to come.
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
   * Called at public boundaries. The use-after-dispose that actually happens
   * is internal -- a rAF callback reaching a dead renderer, a media event
   * reaching a dead texture -- and never touches a public member, so guarding
   * every public member (as the legacy `@undisposed` did) protects the wrong
   * place.
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
