import fs from 'node:fs'
import path from 'node:path'
import type { ParseResult, ParsedInstruction } from './types.js'

/**
 * A list of all PIPs shipped with WSC and their default file names.
 *
 * @see {@link https://github.com/WoltLab/WCF/tree/6.2/wcfsetup/install/files/lib/system/package/plugin}
 */
const DEFAULT_PIP_FILENAMES: Record<string, string | null> = {
  acpTemplate: 'acptemplates.tar',
  file: 'files.tar',
  language: 'language/*.xml',
  script: null,
  sql: 'install.sql',
  style: null,
  template: 'templates.tar',
}

export default class PipParser {
  private readonly additionalPips: Record<string, string>
  private readonly rootDir: string
  private readonly fileExistsCache = new Map<string, Promise<boolean>>()

  constructor(additionalPips: Record<string, string>, rootDir = process.cwd()) {
    this.additionalPips = additionalPips
    this.rootDir = rootDir
  }

  async run(instructions: ParsedInstruction[]): Promise<ParseResult> {
    const pips = this.getPipList()

    return {
      files: await Promise.all(instructions.map((instruction) => this.getFileName(instruction, pips))),
      styles: this.getStylePaths(instructions),
    }
  }

  private getStylePaths(instructions: ParsedInstruction[]): string[] {
    const result: string[] = []

    for (const pip of instructions) {
      if (pip.type === 'style' && pip.path) {
        result.push(pip.path)
      }
    }

    return result
  }

  private getPipList(): Record<string, string | null> {
    return {
      ...DEFAULT_PIP_FILENAMES,
      ...this.additionalPips,
    }
  }

  private pathExists(filePath: string): Promise<boolean> {
    const resolved = path.resolve(this.rootDir, filePath)
    const cached = this.fileExistsCache.get(resolved)

    if (cached) {
      return cached
    }

    const pending = fs.promises
      .access(resolved, fs.constants.R_OK)
      .then(() => true)
      .catch(() => false)

    this.fileExistsCache.set(resolved, pending)
    return pending
  }

  private async getFileName(
    instruction: ParsedInstruction,
    pips: Record<string, string | null>
  ): Promise<string> {
    if (instruction.path) {
      return instruction.path
    }

    const pipFileName = pips[instruction.type]
    if (typeof pipFileName === 'string' && pipFileName.length > 0) {
      return pipFileName
    }

    // default value for all xml based pips
    if (await this.pathExists(`${instruction.type}.xml`)) {
      return `${instruction.type}.xml`
    }

    throw new Error(
      `No file was found with the default filename and no filename was provided for the PIP "${instruction.type}"`
    )
  }
}
