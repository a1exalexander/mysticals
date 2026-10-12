import { Effect, Fiber, Queue, Result, Stream } from 'effect'

/** Subscribes to change pushes (`onChanged`); returns an unsubscribe. */
export type Subscribe = (cb: () => void) => () => void

/**
 * Runs `load` now, then again on every change push. A reload that a newer one overtakes is interrupted, so a stale
 * answer never lands. (No debounce: it would lag the UI behind the user's own edits.) Calls `onResult` with each
 * load's outcome; returns a stop function.
 */
export function live<A, E>(subscribe: Subscribe, load: Effect.Effect<A, E>, onResult: (r: Result.Result<A, E>) => void): () => void {
  // Subscribed before anything runs, so a push arriving while the stream starts is queued, not missed.
  const pushes = Effect.runSync(Queue.unbounded<void>())
  const unsubscribe = subscribe(() => void Queue.offerUnsafe(pushes, undefined))
  const loads = Stream.concat(Stream.succeed(undefined), Stream.fromQueue(pushes)).pipe(
    Stream.switchMap(() => Stream.fromEffect(Effect.result(load)))
  )
  const fiber = Effect.runFork(Stream.runForEach(loads, (r) => Effect.sync(() => onResult(r))))
  return () => {
    unsubscribe()
    Effect.runFork(Fiber.interrupt(fiber))
  }
}
