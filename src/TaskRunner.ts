import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import Packager from './Packager.js'
import PackageXmlParser from './PackageXmlParser.js'
import { FileAccessError } from './errors.js'
import type { FileInstruction, PackageInfo, RunResult, RunnerOptions } from './types.js'

export default class TaskRunner {
  public readonly options: RunnerOptions
  public filesToPackage: FileInstruction[] = []
  public xmlInfo!: PackageInfo

  constructor(options: Partial<RunnerOptions> = {}) {
    const merged = {
      quiet: false,
      source: '.',
      destination: '.',
      cwd: process.cwd(),
      ...options,
      pips: options.pips ?? {},
    }

    // resolve paths into absolute paths
    merged.source = path.resolve(merged.cwd, merged.source)
    merged.destination = path.resolve(merged.cwd, merged.destination)

    this.options = merged as RunnerOptions
  }

  async run(): Promise<RunResult> {
    await this.doesPackageXmlExist()
    await this.readAndParseFile()

    return this.runPackager()
  }

  private async doesPackageXmlExist(): Promise<void> {
    try {
      await fs.promises.access(path.join(this.options.source, 'package.xml'), fs.constants.R_OK)
    } catch (err) {
      throw new FileAccessError('The package.xml could not be accessed in this folder.', {
        code: 'PACKAGE_XML_INACCESSIBLE',
        cause: err,
        meta: { source: this.options.source },
      })
    }
  }

  private async readAndParseFile(): Promise<void> {
    const parser = new PackageXmlParser(this.options.source, this.options.pips)

    await parser.parse(this)
  }

  private async runPackager(): Promise<RunResult> {
    const packager = new Packager(this.filesToPackage, this.xmlInfo, this.options.source)

    return packager.run(this.options.destination, this.options.quiet)
  }
}
