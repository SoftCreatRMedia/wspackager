import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
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

interface AdditionalPackage {
  file: string
  identifier: string
}

interface NormalizedPackageXml {
  package: {
    name: string
    author: string
    version: string
    instructions: ParsedInstruction[]
    additionalPackages: AdditionalPackage[]
  }
}

interface NormalizedStyleXml {
  files: FileInstruction[]
}

type XmlNode = Record<string, unknown>

const getErrorCode = (err: unknown): string | undefined => {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    return String((err as { code?: unknown }).code)
  }

  return undefined
}

const isRecord = (value: unknown): value is XmlNode =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export default class PackageXmlParser {
  private readonly sourceRoot: string
  private pips: Record<string, string>
  private xml!: NormalizedPackageXml
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

  private invalidPackageStructure(detail: string, file: string, cause?: unknown): never {
    throw new InvalidXmlError(`The package.xml is missing or has an invalid '${detail}' value.`, {
      code: 'PACKAGE_XML_STRUCTURE_INVALID',
      cause,
      meta: { file, field: detail },
    })
  }

  private invalidStyleStructure(detail: string, file: string, cause?: unknown): never {
    throw new InvalidXmlError(`The style.xml is missing or has an invalid '${detail}' value.`, {
      code: 'STYLE_XML_STRUCTURE_INVALID',
      cause,
      meta: { file, field: detail },
    })
  }

  private expectObject(
    value: unknown,
    detail: string,
    file: string,
    invalid: (d: string, f: string) => never
  ): XmlNode {
    if (isRecord(value)) {
      return value
    }

    return invalid(detail, file)
  }

  private expectArray(
    value: unknown,
    detail: string,
    file: string,
    invalid: (d: string, f: string) => never
  ): unknown[] {
    if (Array.isArray(value)) {
      return value
    }

    return invalid(detail, file)
  }

  private extractText(value: unknown): string | undefined {
    if (typeof value === 'string') {
      const normalized = value.trim()
      return normalized.length > 0 ? normalized : undefined
    }

    if (isRecord(value) && typeof value._ === 'string') {
      const normalized = value._.trim()
      return normalized.length > 0 ? normalized : undefined
    }

    return undefined
  }

  private expectText(
    value: unknown,
    detail: string,
    file: string,
    invalid: (d: string, f: string) => never
  ): string {
    const text = this.extractText(value)

    if (text !== undefined) {
      return text
    }

    return invalid(detail, file)
  }

  private expectFirstText(
    value: unknown,
    detail: string,
    file: string,
    invalid: (d: string, f: string) => never
  ): string {
    const list = this.expectArray(value, detail, file, invalid)

    if (list.length === 0) {
      return invalid(detail, file)
    }

    return this.expectText(list[0], detail, file, invalid)
  }

  private parseInstructionEntries(packageNode: XmlNode, file: string): ParsedInstruction[] {
    const instructionsNode = packageNode.instructions

    if (instructionsNode === undefined) {
      return []
    }

    const instructionGroups = this.expectArray(
      instructionsNode,
      'package/instructions',
      file,
      this.invalidPackageStructure.bind(this)
    )
    const instructions: ParsedInstruction[] = []

    for (const [groupIndex, groupValue] of instructionGroups.entries()) {
      const group = this.expectObject(
        groupValue,
        `package/instructions[${groupIndex}]`,
        file,
        this.invalidPackageStructure.bind(this)
      )

      if (group.void !== undefined) {
        continue
      }

      const instructionList = group.instruction
      if (instructionList === undefined) {
        continue
      }

      const items = this.expectArray(
        instructionList,
        `package/instructions[${groupIndex}]/instruction`,
        file,
        this.invalidPackageStructure.bind(this)
      )

      for (const [instructionIndex, instructionValue] of items.entries()) {
        const instruction = this.expectObject(
          instructionValue,
          `package/instructions[${groupIndex}]/instruction[${instructionIndex}]`,
          file,
          this.invalidPackageStructure.bind(this)
        )
        const attributes = this.expectObject(
          instruction.$,
          `package/instructions[${groupIndex}]/instruction[${instructionIndex}]/@type`,
          file,
          this.invalidPackageStructure.bind(this)
        )
        const type = this.expectText(
          attributes.type,
          `package/instructions[${groupIndex}]/instruction[${instructionIndex}]/@type`,
          file,
          this.invalidPackageStructure.bind(this)
        )

        instructions.push({
          type,
          path: this.extractText(instruction._),
        })
      }
    }

    return instructions
  }

  private parseAdditionalPackagesFromSection(
    section: unknown,
    sectionName: string,
    file: string
  ): AdditionalPackage[] {
    if (section === undefined) {
      return []
    }

    const groups = this.expectArray(
      section,
      `package/${sectionName}`,
      file,
      this.invalidPackageStructure.bind(this)
    )
    const attributeKey = sectionName === 'requiredpackages' ? 'requiredpackage' : 'optionalpackage'
    const packages: AdditionalPackage[] = []

    for (const [groupIndex, groupValue] of groups.entries()) {
      const group = this.expectObject(
        groupValue,
        `package/${sectionName}[${groupIndex}]`,
        file,
        this.invalidPackageStructure.bind(this)
      )
      const entries = group[attributeKey]

      if (entries === undefined) {
        continue
      }

      const entryList = this.expectArray(
        entries,
        `package/${sectionName}[${groupIndex}]/${attributeKey}`,
        file,
        this.invalidPackageStructure.bind(this)
      )

      for (const [entryIndex, entryValue] of entryList.entries()) {
        const entry = this.expectObject(
          entryValue,
          `package/${sectionName}[${groupIndex}]/${attributeKey}[${entryIndex}]`,
          file,
          this.invalidPackageStructure.bind(this)
        )
        const attributes = this.expectObject(
          entry.$,
          `package/${sectionName}[${groupIndex}]/${attributeKey}[${entryIndex}]/@file`,
          file,
          this.invalidPackageStructure.bind(this)
        )
        const packageFile = this.extractText(attributes.file)

        if (!packageFile) {
          continue
        }

        packages.push({
          file: packageFile,
          identifier: this.expectText(
            entry._,
            `package/${sectionName}[${groupIndex}]/${attributeKey}[${entryIndex}]`,
            file,
            this.invalidPackageStructure.bind(this)
          ),
        })
      }
    }

    return packages
  }

  private normalizePackageXml(document: unknown, file: string): NormalizedPackageXml {
    const root = this.expectObject(document, 'package', file, this.invalidPackageStructure.bind(this))
    const packageNode = this.expectObject(
      root.package,
      'package',
      file,
      this.invalidPackageStructure.bind(this)
    )
    const attributes = this.expectObject(
      packageNode.$,
      'package/@name',
      file,
      this.invalidPackageStructure.bind(this)
    )
    const name = this.expectText(
      attributes.name,
      'package/@name',
      file,
      this.invalidPackageStructure.bind(this)
    )
    const authorInformation = this.expectArray(
      packageNode.authorinformation,
      'package/authorinformation',
      file,
      this.invalidPackageStructure.bind(this)
    )
    const authorNode = this.expectObject(
      authorInformation[0],
      'package/authorinformation[0]',
      file,
      this.invalidPackageStructure.bind(this)
    )
    const author = this.expectFirstText(
      authorNode.author,
      'package/authorinformation[0]/author',
      file,
      this.invalidPackageStructure.bind(this)
    )
    const packageInformation = this.expectArray(
      packageNode.packageinformation,
      'package/packageinformation',
      file,
      this.invalidPackageStructure.bind(this)
    )
    const infoNode = this.expectObject(
      packageInformation[0],
      'package/packageinformation[0]',
      file,
      this.invalidPackageStructure.bind(this)
    )
    const version = this.expectFirstText(
      infoNode.version,
      'package/packageinformation[0]/version',
      file,
      this.invalidPackageStructure.bind(this)
    )

    return {
      package: {
        name,
        author,
        version,
        instructions: this.parseInstructionEntries(packageNode, file),
        additionalPackages: [
          ...this.parseAdditionalPackagesFromSection(packageNode.optionalpackages, 'optionalpackages', file),
          ...this.parseAdditionalPackagesFromSection(packageNode.requiredpackages, 'requiredpackages', file),
        ],
      },
    }
  }

  async readXml(file: string): Promise<void> {
    const resolved = this.resolvePath(file)

    try {
      const data = await fs.promises.readFile(resolved)
      const parser = new xml2js.Parser()
      const rawDocument = await parser.parseStringPromise(data)

      this.xml = this.normalizePackageXml(rawDocument, resolved)
    } catch (err) {
      if (err instanceof InvalidXmlError) {
        throw err
      }

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
      name: pack.name,
      author: pack.author,
      version: pack.version,
    }
  }

  private async parsePips(): Promise<void> {
    const parser = new PipParser(this.pips, this.sourceRoot)
    const list = await parser.run(this.xml.package.instructions)

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

  private normalizeStyleXml(document: unknown, file: string): NormalizedStyleXml {
    const root = this.expectObject(document, 'style', file, this.invalidStyleStructure.bind(this))
    const styleNode = this.expectObject(root.style, 'style', file, this.invalidStyleStructure.bind(this))
    const filesNode = styleNode.files

    if (filesNode === undefined) {
      return { files: [] }
    }

    const filesEntries = this.expectArray(
      filesNode,
      'style/files',
      file,
      this.invalidStyleStructure.bind(this)
    )

    if (filesEntries.length === 0) {
      return { files: [] }
    }

    const filesSection = this.expectObject(
      filesEntries[0],
      'style/files[0]',
      file,
      this.invalidStyleStructure.bind(this)
    )
    const additionalPackages: FileInstruction[] = []

    for (const entryName of ['templates', 'images']) {
      const value = filesSection[entryName]

      if (value === undefined) {
        continue
      }

      const filename = this.expectFirstText(
        value,
        `style/files[0]/${entryName}`,
        file,
        this.invalidStyleStructure.bind(this)
      )

      additionalPackages.push({ path: filename, intermediate: true })
    }

    return { files: additionalPackages }
  }

  private async parseStyleXML(stylePath: string): Promise<void> {
    const resolved = this.resolvePath(path.join(stylePath, 'style.xml'))

    try {
      const data = await fs.promises.readFile(resolved)
      const parser = new xml2js.Parser()
      const rawDocument = await parser.parseStringPromise(data)
      const result = this.normalizeStyleXml(rawDocument, resolved)

      this.filesToPackage = this.filesToPackage.concat(
        result.files.map((file) => ({
          path: path.join(stylePath, file.path),
          intermediate: true,
        }))
      )
    } catch (err) {
      if (err instanceof InvalidXmlError) {
        throw err
      }

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
    this.filesToPackage = this.filesToPackage.concat(
      this.xml.package.additionalPackages.map((pkg) => ({
        path: pkg.file,
        intermediate: false,
        isPackage: true,
        identifier: pkg.identifier,
      }))
    )
  }
}
