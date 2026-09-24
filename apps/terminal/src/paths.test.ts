import { describe, expect, it } from 'vitest'
import { dataRoot, socketPath } from './paths'

describe('paths', () => {
  it('uses each OS data dir convention', () => {
    expect(dataRoot('darwin', {})).toMatch(/Library[/\\]Application Support$/)
    expect(dataRoot('win32', { APPDATA: 'C:\\Users\\me\\AppData\\Roaming' })).toBe('C:\\Users\\me\\AppData\\Roaming')
    expect(dataRoot('linux', { XDG_DATA_HOME: '/x/data' })).toBe('/x/data')
    expect(dataRoot('linux', {})).toMatch(/\.local[/\\]share$/)
  })

  it('uses a named pipe per home on Windows', () => {
    expect(socketPath('C:\\a', 'win32')).toMatch(/^\\\\\.\\pipe\\mysticals-[0-9a-f]{16}$/)
    expect(socketPath('C:\\a', 'win32')).not.toBe(socketPath('C:\\b', 'win32'))
    expect(socketPath('/tmp/h', 'linux')).toBe('/tmp/h/daemon.sock')
  })
})
