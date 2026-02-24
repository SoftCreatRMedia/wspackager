export type FormatterFn = (value: string) => string

export interface PackageInfo {
  name: string
  author: string
  version: string
}

export interface FileInstruction {
  path: string
  intermediate: boolean
  isPackage?: boolean
  identifier?: string
  forcePrepack?: boolean
}

export interface ParsedInstruction {
  type: string
  path?: string
}

export interface ParseResult {
  files: string[]
  styles: string[]
}

export interface RunnerOptions {
  pips: Record<string, string>
  quiet: boolean
  source: string
  destination: string
  cwd: string
}

export interface RunResult {
  filename: string | undefined
  path: string
  filesize: string
}
