import fs from 'node:fs'
import path from 'node:path'
import xml2js from 'xml2js'
import PipParser from './PipParser.js'
import Util from './Util.js'
import { FileAccessError, InvalidXmlError } from './errors.js'
import type { FileInstruction, PackageInfo, ParsedInstruction } from './types.js'

interface RunnerContext {
  options: {
    pips: Record<string, string>
  }
  filesToPackage: FileInstruction[]
  xmlInfo: PackageInfo
}

type PackageXml = {
  package: {
    $: { name: string }
    authorinformation: Array<{ author: string[] }>
    packageinformation: Array<{ version: string[] }>
    instructions: Array<{ instruction?: Array<{ $: { type: string }; _?: string }>; void?: unknown }>
    optionalpackages?: Array<{ optionalpackage?: Array<{ $: { file?: string }; _: string }> }>
    requiredpackages?: Array<{ requiredpackage?: Array<{ $: { file?: string }; _: string }> }>
  }
}

type StyleXml = {
  style: {
    files?: Array<Record<string, Array<string | { _: string }>>>
  }
}

const getErrorCode = (err: unknown): string | undefined => {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    return String((err as { code?: unknown }).code)
  }

  return undefined
}

export default class PackageXmlParser {
  private readonly sourceRoot: string
  private pips: Record<string, string>
  private xml!: PackageXml
  private filesToPackage: FileInstruction[] = []
  public info!: PackageInfo

  constructor(sourceRoot = process.cwd(), pips: Record<string, string> = {}) {
    this.sourceRoot = sourceRoot
    this.pips = pips
  }

  async parse(runner: RunnerContext): Promise<void> {
    this.pips = runner.options.pips

    await this.readXml('package.xml')
    this.parseInfo()
    await this.parsePips()
    this.parseAdditionalPackages()

    runner.filesToPackage = this.filesToPackage
    runner.xmlInfo = this.info
  }

  private resolvePath(file: string): string {
    if (path.isAbsolute(file)) {
      return file
    }

    return path.join(this.sourceRoot, file)
  }

  async readXml(file: string): Promise<void> {
    const resolved = this.resolvePath(file)

    try {
      const data = await fs.promises.readFile(resolved)
      const parser = new xml2js.Parser()
      this.xml = (await parser.parseStringPromise(data)) as PackageXml
    } catch (err) {
      if (getErrorCode(err) === 'ENOENT') {
        throw new FileAccessError('The package.xml could not be read.', {
          code: 'PACKAGE_XML_READ_ERROR',
          cause: err,
          meta: { file: resolved },
        })
      }

      throw new InvalidXmlError('The package.xml does not appear to be a valid XML document.', {
        code: 'PACKAGE_XML_INVALID',
        cause: err,
        meta: { file: resolved },
      })
    }
  }

  parseInfo(): void {
    const pack = this.xml.package

    this.info = {
      name: pack.$.name,
      author: pack.authorinformation[0].author[0],
      version: pack.packageinformation[0].version[0],
    }
  }

  private async parsePips(): Promise<void> {
    const instructions: ParsedInstruction[] = []

    this.xml.package.instructions.forEach((element) => {
      const instruction = element.instruction

      if (element.void || !instruction) return

      instruction.forEach((current) => {
        instructions.push({
          type: current.$.type,
          path: current._,
        })
      })
    })

    const parser = new PipParser(this.pips, this.sourceRoot)
    const list = parser.run(instructions)

    this.filesToPackage = list.files.map((item) => ({ path: item, intermediate: false }))

    for (const stylePath of list.styles) {
      await this.parseStyleInstruction(stylePath)
    }
  }

  private async parseStyleInstruction(stylePath: string): Promise<void> {
    if (!stylePath) {
      return
    }

    if (Util.isTarball(stylePath)) {
      const styleDir = Util.stripTarballExtension(stylePath)
      const resolvedStyleDir = this.resolvePath(styleDir)

      try {
        const dirStats = await fs.promises.stat(resolvedStyleDir)

        if (dirStats.isDirectory()) {
          // Prefer rebuilding from unpacked style directory when available.
          await this.parseStyleXML(styleDir)
          this.markInstructionForPrepack(stylePath)

          return
        }
      } catch (err) {
        if (getErrorCode(err) !== 'ENOENT') {
          throw err
        }
      }

      const archivePath = this.resolvePath(stylePath)
      try {
        await fs.promises.access(archivePath, fs.constants.R_OK)

        // If the archive already exists, include it as-is and do not parse style.xml.
        return
      } catch (err) {
        if (getErrorCode(err) !== 'ENOENT') {
          throw new FileAccessError('The style archive could not be read.', {
            code: 'STYLE_ARCHIVE_READ_ERROR',
            cause: err,
            meta: { file: archivePath },
          })
        }
      }

      await this.parseStyleXML(styleDir)
      this.markInstructionForPrepack(stylePath)
      return
    }

    await this.parseStyleXML(stylePath)
  }

  private markInstructionForPrepack(styleArchivePath: string): void {
    const instruction = this.filesToPackage.find((item) => item.path === styleArchivePath)

    if (instruction) {
      instruction.forcePrepack = true
    }
  }

  private async parseStyleXML(stylePath: string): Promise<void> {
    const resolved = this.resolvePath(path.join(stylePath, 'style.xml'))

    try {
      const data = await fs.promises.readFile(resolved)
      const parser = new xml2js.Parser()
      const result = (await parser.parseStringPromise(data)) as StyleXml
      const additionalPackages: FileInstruction[] = []

      if (result.style.files) {
        // Only one files section should be parsed
        for (const file of Object.keys(result.style.files[0])) {
          if (file === 'templates' || file === 'images') {
            const tag = result.style.files[0][file][0]
            const filename = typeof tag === 'object' ? tag._ : tag

            additionalPackages.push({ path: path.join(stylePath, filename), intermediate: true })
          }
        }
      }

      this.filesToPackage = this.filesToPackage.concat(additionalPackages)
    } catch (err) {
      if (getErrorCode(err) === 'ENOENT') {
        throw new FileAccessError('The style.xml could not be read.', {
          code: 'STYLE_XML_READ_ERROR',
          cause: err,
          meta: { file: resolved },
        })
      }
      throw new InvalidXmlError('The style.xml does not appear to be a valid XML document.', {
        code: 'STYLE_XML_INVALID',
        cause: err,
        meta: { file: resolved },
      })
    }
  }

  private parseAdditionalPackages(): void {
    const packages: FileInstruction[] = []
    const optionals = this.xml.package.optionalpackages
    const requireds = this.xml.package.requiredpackages

    const addPackagePaths = (
      paths: Array<{
        requiredpackage?: Array<{ $: { file?: string }; _: string }>
        optionalpackage?: Array<{ $: { file?: string }; _: string }>
      }>
    ) => {
      for (const currentPath of paths) {
        let query: Array<{ $: { file?: string }; _: string }> = []

        if (currentPath.requiredpackage) query = currentPath.requiredpackage
        if (currentPath.optionalpackage) query = currentPath.optionalpackage

        for (const pack of query) {
          if (pack.$.file) {
            packages.push({
              path: pack.$.file,
              intermediate: false,
              isPackage: true,
              identifier: pack._,
            })
          }
        }
      }
    }

    if (optionals) addPackagePaths(optionals)
    if (requireds) addPackagePaths(requireds)

    this.filesToPackage = this.filesToPackage.concat(packages)
  }
}
