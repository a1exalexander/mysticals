import { createHash } from 'crypto'
import { homedir, tmpdir, userInfo } from 'os'
import { join } from 'path'

/** MULTICALS_MOCK=1: in-memory mock api in the daemon, no real accounts touched. */
export const isMock = (): boolean => process.env.MULTICALS_MOCK === '1'

/**
 * Data dir of the terminal app; fully separate from the desktop app's userData.
 * Mock runs share one temp dir per user so every TUI finds the same mock daemon.
 */
export function homeDir(): string {
  if (process.env.MULTICALS_HOME) return process.env.MULTICALS_HOME
  if (isMock()) return join(tmpdir(), `multicals-mock-${userInfo().uid}`)
  return join(homedir(), 'Library', 'Application Support', 'multicals-terminal')
}

// macOS caps unix socket paths at 104 bytes (sun_path).
const MAX_SOCKET_PATH = 100

/** `<home>/daemon.sock`, or a hashed path in tmpdir when home is too deep for a unix socket. */
export function socketPath(home = homeDir()): string {
  const p = join(home, 'daemon.sock')
  if (Buffer.byteLength(p) <= MAX_SOCKET_PATH) return p
  return join(tmpdir(), `multicals-${createHash('sha256').update(home).digest('hex').slice(0, 16)}.sock`)
}
