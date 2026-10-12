import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { Effect, Schema, type Scope } from 'effect'
import { IPC } from '@shared/ipc'
import { toPromiseApi, type CoreApi, type CoreApiEffect } from '@mysticals/core/api'

/** Maps IPC channels to the api, each call run with `run` (rejections keep the error's message). */
export function registerApi(api: CoreApiEffect, run: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>): void {
  registerApiPromises(toPromiseApi(api, run))
}

/** Every api channel rejects with `message`: the backend did not start, but a call should say why, not hang or be missing. */
export function registerApiError(message: string): void {
  const reject = (): Promise<never> => Promise.reject(new Error(message))
  const all = new Proxy({}, { get: () => new Proxy({}, { get: () => reject }) }) as CoreApi
  registerApiPromises(all)
}

function registerApiPromises(api: CoreApi): void {
  const h = (ch: string, fn: (...a: never[]) => unknown): void => {
    ipcMain.removeHandler(ch)
    ipcMain.handle(ch, (_e, ...args) => (fn as (...a: unknown[]) => unknown)(...args))
  }
  h(IPC.accountsList, api.accounts.list)
  h(IPC.accountsAddGoogle, api.accounts.addGoogle)
  h(IPC.accountsAddCaldav, api.accounts.addCaldav)
  h(IPC.accountsUpdate, api.accounts.update)
  h(IPC.accountsRemove, api.accounts.remove)
  h(IPC.accountsReauth, api.accounts.reauth)
  h(IPC.calendarsList, api.calendars.list)
  h(IPC.calendarsSetVisible, api.calendars.setVisible)
  h(IPC.eventsList, api.events.list)
  h(IPC.eventsCreate, api.events.create)
  h(IPC.eventsUpdate, api.events.update)
  h(IPC.eventsDelete, api.events.delete)
  h(IPC.eventsRespond, api.events.respond)
  h(IPC.eventsRecurrence, api.events.recurrence)
  h(IPC.syncNow, api.sync.now)
}

type Args = Schema.Top & { readonly DecodingServices: never }

/**
 * Serves `channel` with an Effect over the renderer's arguments, decoded with `args` (a Tuple) first; `invalid` turns a
 * decode failure into the message the UI expects. Runs with the caller's services; the handler goes when the scope closes.
 */
export const handle = <S extends Args, A, E, R>(
  channel: string,
  args: S,
  fn: (args: S['Type'], e: IpcMainInvokeEvent) => Effect.Effect<A, E, R>,
  invalid?: (args: unknown[]) => string
): Effect.Effect<void, never, R | Scope.Scope> =>
  Effect.gen(function* () {
    const run = Effect.runPromiseWith(yield* Effect.context<R>())
    const decode = Schema.decodeUnknownEffect(args)
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        ipcMain.removeHandler(channel)
        ipcMain.handle(channel, (e, ...raw) =>
          run(
            decode(raw).pipe(
              Effect.mapError((err) => (invalid ? new Error(invalid(raw)) : err)),
              Effect.flatMap((a) => fn(a, e))
            )
          )
        )
      }),
      () => Effect.sync(() => ipcMain.removeHandler(channel))
    )
  })

/** Arguments the handler checks itself, or ignores. */
export const AnyArgs = Schema.Array(Schema.Unknown)
