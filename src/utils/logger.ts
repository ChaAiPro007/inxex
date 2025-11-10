/**
 * 日志工具
 */

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

export class Logger {
  private prefix: string

  constructor(prefix = 'IndexNow') {
    this.prefix = prefix
  }

  debug(message: string, ...args: any[]) {
    console.log(`[${this.prefix}] [DEBUG] ${message}`, ...args)
  }

  info(message: string, ...args: any[]) {
    console.log(`[${this.prefix}] [INFO] ${message}`, ...args)
  }

  warn(message: string, ...args: any[]) {
    console.warn(`[${this.prefix}] [WARN] ${message}`, ...args)
  }

  error(message: string, ...args: any[]) {
    console.error(`[${this.prefix}] [ERROR] ${message}`, ...args)
  }

  /**
   * 脱敏 API 密钥（仅显示前 4 位）
   */
  maskApiKey(key: string): string {
    return key.substring(0, 4) + '****'
  }
}

export const logger = new Logger()
