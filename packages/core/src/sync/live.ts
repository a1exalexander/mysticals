import { Effect, Fiber, Queue, Result, Stream } from 'effect'

/** Subscribes to change pushes (`onChanged`); returns an unsubscribe. */
export type Subscribe = (cb: () => void) => () => void

/**
 * Runs `load` now, then again after every burst of change pushes (one sync pass pushes start, end and data changes:
 * `quietMs` folds them into one reload). A reload that a newer one overtakes is interrupted, so a stale answer
 * never lands. Calls `onResult` with each load's outcome; returns a stop function.
 */
export function live<A, E>(subscribe: Subscribe, load: Effect.Effect<A, E>, onResult: (r: Result.Result<A, E>) => void, quietMs = 150): () => void {
  // Subscribed before anything runs, so a push arriving while the stream starts is queued, not missed.
  const pushes = Effect.runSync(Queue.unbounded<void>())
  const unsubscribe = subscribe(() => void Queue.offerUnsafe(pushes, undefined))
  const loads = Stream.concat(Stream.succeed(undefined), Stream.fromQueue(pushes).pipe(Stream.debounce(quietMs))).pipe(
    Stream.switchMap(() => Stream.fromEffect(Effect.result(load)))
  )
  const fiber = Effect.runFork(Stream.runForEach(loads, (r) => Effect.sync(() => onResult(r))))
  return () => {
    unsubscribe()
    Effect.runFork(Fiber.interrupt(fiber))
  }
}
