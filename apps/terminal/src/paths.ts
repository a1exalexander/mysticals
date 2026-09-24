import { createHash } from 'crypto'
import { homedir, tmpdir, userInfo } from 'os'
import { join } from 'path'

/** MYSTICALS_MOCK=1: in-memory mock api in the daemon, no real accounts touched. */
export const isMock = (): boolean => process.env.MYSTICALS_MOCK === '1'

/**
 * Data dir of the terminal app; fully separate from the desktop app's userData.
 * Mock runs share one temp dir per user so every TUI finds the same mock daemon.
 */
export function homeDir(): string {
  if (process.env.MYSTICALS_HOME) return process.env.MYSTICALS_HOME
  if (isMock()) return join(tmpdir(), `mysticals-mock-${userInfo().uid}`)
  return join(dataRoot(), 'mysticals-terminal')
}

/** Per-OS app data root: ~/Library/Application Support, %APPDATA%, or $XDG_DATA_HOME (~/.local/share). */
export function dataRoot(platform = process.platform, env = process.env): string {
  if (platform === 'darwin') return join(homedir(), 'Library', 'Application Support')
  if (platform === 'win32') return env.APPDATA || join(homedir(), 'AppData', 'Roaming')
  return env.XDG_DATA_HOME || join(homedir(), '.local', 'share')
}

// macOS caps unix socket paths at 104 bytes (sun_path).
const MAX_SOCKET_PATH = 100

const hash = (home: string): string => createHash('sha256').update(home).digest('hex').slice(0, 16)

/**
 * `<home>/daemon.sock`, or a hashed path in tmpdir when home is too deep for a unix socket.
 * Windows has no unix sockets in node's `net`; it gets a named pipe keyed by home instead.
 */
export function socketPath(home = homeDir(), platform = process.platform): string {
  if (platform === 'win32') return `\\\\.\\pipe\\mysticals-${hash(home)}`
  const p = join(home, 'daemon.sock')
  if (Buffer.byteLength(p) <= MAX_SOCKET_PATH) return p
  return join(tmpdir(), `mysticals-${hash(home)}.sock`)
}
