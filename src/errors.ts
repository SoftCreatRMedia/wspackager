interface ErrorOptions {
  code?: string
  meta?: Record<string, unknown>
  cause?: unknown
}

export class WspackagerError extends Error {
  public readonly code: string
  public readonly meta: Record<string, unknown>

  constructor(message: string, options: ErrorOptions = {}) {
    super(message)

    this.name = this.constructor.name
    this.code = options.code || 'WSPACKAGER_ERROR'
    this.meta = options.meta || {}

    if (options.cause !== undefined) {
      ;(this as Error & { cause?: unknown }).cause = options.cause
    }
  }
}

export class FileAccessError extends WspackagerError {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, { ...options, code: options.code || 'FILE_ACCESS_ERROR' })
  }
}

export class InvalidXmlError extends WspackagerError {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, { ...options, code: options.code || 'INVALID_XML' })
  }
}

export class PackageLookupError extends WspackagerError {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, { ...options, code: options.code || 'PACKAGE_LOOKUP_ERROR' })
  }
}
