/**
 * Centralized logging utility for Gatehouse
 * Provides structured logging with context and levels
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogContext {
  component?: string
  [key: string]: unknown
}

class Logger {
  private minLevel: LogLevel = 'info'
  private isDevelopment = process.env.NODE_ENV !== 'production'

  private levelPriority: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  }

  // ANSI color codes for terminal output
  private colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',

    // Level colors
    debug: '\x1b[36m',    // Cyan
    info: '\x1b[32m',     // Green
    warn: '\x1b[33m',     // Yellow
    error: '\x1b[31m',    // Red

    // Component colors
    component: '\x1b[35m', // Magenta

    // Context colors
    context: '\x1b[90m',   // Gray
  }

  /**
   * Set minimum log level
   */
  setLevel(level: LogLevel): void {
    this.minLevel = level
  }

  /**
   * Check if level should be logged
   */
  private shouldLog(level: LogLevel): boolean {
    return this.levelPriority[level] >= this.levelPriority[this.minLevel]
  }

  /**
   * Format log message
   */
  private format(level: LogLevel, message: string, context?: LogContext): string {
    const timestamp = new Date().toISOString()
    const component = context?.component || 'App'

    if (this.isDevelopment) {
      // Development: Clean, readable format with colors
      const levelColor = this.colors[level]
      const levelTag = level.toUpperCase().padEnd(5)
      const contextStr = context ?
        Object.entries(context)
          .filter(([key]) => key !== 'component')
          .map(([key, val]) => `${key}=${val}`)
          .join(', ')
        : ''

      const contextPart = contextStr ? ` ${this.colors.context}(${contextStr})${this.colors.reset}` : ''

      return `${levelColor}${this.colors.bright}${levelTag}${this.colors.reset} | ${this.colors.component}${component.padEnd(20)}${this.colors.reset} | ${levelColor}${message}${this.colors.reset}${contextPart}`
    }

    // Production: JSON structured logs
    const logData = {
      timestamp,
      level,
      component,
      message,
      ...context,
    }
    return JSON.stringify(logData)
  }

  /**
   * Log debug message
   */
  debug(message: string, context?: LogContext): void {
    if (!this.shouldLog('debug')) return
    console.debug(this.format('debug', message, context))
  }

  /**
   * Log info message
   */
  info(message: string, context?: LogContext): void {
    if (!this.shouldLog('info')) return
    console.log(this.format('info', message, context))
  }

  /**
   * Log warning
   */
  warn(message: string, context?: LogContext): void {
    if (!this.shouldLog('warn')) return
    console.warn(this.format('warn', message, context))
  }

  /**
   * Log error
   */
  error(message: string, error?: Error | unknown, context?: LogContext): void {
    if (!this.shouldLog('error')) return
    
    const errorDetails = error instanceof Error ? {
      error_message: error.message,
      error_stack: error.stack,
    } : { error: String(error) }

    const finalContext: LogContext = context ? { ...context, ...errorDetails } as LogContext : errorDetails as LogContext
    console.error(this.format('error', message, finalContext))
  }

  /**
   * Create scoped logger for a component
   */
  scope(component: string): ScopedLogger {
    return new ScopedLogger(this, component)
  }
}

/**
 * Scoped logger for a specific component
 */
class ScopedLogger {
  constructor(
    private logger: Logger,
    private component: string
  ) {}

  private withContext(additionalContext?: Partial<LogContext>): LogContext {
    return {
      component: this.component,
      ...additionalContext,
    }
  }

  debug(message: string, context?: Partial<LogContext>): void {
    this.logger.debug(message, this.withContext(context))
  }

  info(message: string, context?: Partial<LogContext>): void {
    this.logger.info(message, this.withContext(context))
  }

  warn(message: string, context?: Partial<LogContext>): void {
    this.logger.warn(message, this.withContext(context))
  }

  error(message: string, error?: Error | unknown, context?: Partial<LogContext>): void {
    this.logger.error(message, error, this.withContext(context))
  }
}

// Export singleton
export const logger = new Logger()

// Export factory for scoped loggers
export const createLogger = (component: string) => logger.scope(component)

