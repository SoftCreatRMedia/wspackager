import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { glob, hasMagic } from 'glob'
import * as tar from 'tar'
import { buildTree, outputTree } from './TreeBuilder.js'
import PackageXmlParser from './PackageXmlParser.js'
import TaskRunner from './TaskRunner.js'
import Util from './Util.js'
import ConsoleStyle from './ConsoleStyle.js'
import { FileAccessError, PackageLookupError } from './errors.js'
import type { FileInstruction, PackageInfo, RunResult } from './types.js'

const normalizePath = (value: string): string =>
  path.normalize(value).replace(/\\/g, '/').replace(/^\.\//, '')

interface ProcessingInstruction {
  original: string
  isPackage?: boolean
  identifier?: string
  forcePrepack?: boolean
  originalExists: boolean
  paths: string[]
}

interface PackagingPlan {
  prepack: ProcessingInstruction[]
  direct: string[]
}

interface CachedPathState {
  exists: boolean
  isDirectory: boolean
  isReadable: boolean
}

const getErrorCode = (err: unknown): string | undefined => {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    return String((err as { code?: unknown }).code)
  }
  return undefined
}

export default class Packager {
  private readonly packageInfo: PackageInfo
  private readonly sourceRoot: string
  private readonly filesToPackage: FileInstruction[]
  private readonly intermediateFiles = new Set<string>()
  private readonly intermediateFolders = new Set<string>()
  private destination = ''
  private packagingPlan: PackagingPlan | null = null
  private readonly pathStateCache = new Map<string, Promise<CachedPathState>>()
  private readonly directoryEntriesCache = new Map<string, Promise<string[]>>()

  constructor(files: FileInstruction[], packageInfo: PackageInfo, sourceRoot: string) {
    this.packageInfo = packageInfo
    this.sourceRoot = sourceRoot

    // Order by intermediate files
    files.sort((a, b) => {
      if (a.intermediate > b.intermediate) return -1
      return 1
    })

    // Remove duplicates from array by path
    const unique = new Map<string, FileInstruction>()
    files.forEach((item) => {
      unique.set(item.path, item)
    })

    this.filesToPackage = [...unique.values()].map((item) => ({
      ...item,
      path: normalizePath(item.path),
    }))

    for (const file of this.filesToPackage) {
      if (!file.intermediate) {
        continue
      }

      const normalized = normalizePath(file.path)
      this.intermediateFiles.add(normalized)
      this.intermediateFolders.add(normalized.replace(/\.tar$/, ''))
    }
  }

  private resolveInputPath(filePath: string): string {
    if (path.isAbsolute(filePath)) {
      return filePath
    }

    return path.join(this.sourceRoot, filePath)
  }

  private async loadPathState(resolved: string): Promise<CachedPathState> {
    try {
      const stats = await fs.promises.stat(resolved)
      return {
        exists: true,
        isDirectory: stats.isDirectory(),
        isReadable: true,
      }
    } catch (err) {
      if (getErrorCode(err) === 'ENOENT' || getErrorCode(err) === 'ENOTDIR') {
        return {
          exists: false,
          isDirectory: false,
          isReadable: false,
        }
      }

      throw err
    }
  }

  private getPathState(filePath: string): Promise<CachedPathState> {
    const resolved = this.resolveInputPath(filePath)
    const cached = this.pathStateCache.get(resolved)

    if (cached) {
      return cached
    }

    const pending = this.loadPathState(resolved)

    this.pathStateCache.set(resolved, pending)
    return pending
  }

  private getDirectoryEntries(directory: string): Promise<string[]> {
    const resolved = this.resolveInputPath(directory)
    const cached = this.directoryEntriesCache.get(resolved)

    if (cached) {
      return cached
    }

    const pending = fs.promises.readdir(resolved)
    this.directoryEntriesCache.set(resolved, pending)
    return pending
  }

  async run(destination: string, quiet: boolean): Promise<RunResult> {
    this.destination = destination

    let error: unknown = null
    let results: RunResult | null = null

    try {
      await this.findLocalFiles()
      await this.writeTreeStructure(quiet)
      await this.prepackage()

      const outputPath = await this.packageAll()
      const filesize = await this.getFileStats()

      results = {
        filename: outputPath === undefined ? outputPath : path.basename(outputPath),
        path: outputPath,
        filesize,
      }

      if (!quiet) {
        console.log(`-> ${ConsoleStyle.boldGreen('Package generated')} (${results.filesize})`)
      }
    } catch (err) {
      error = err
    }

    try {
      await this.cleanup()
    } catch (cleanupError) {
      if (!error) {
        error = cleanupError
      }
    }

    if (error) {
      throw error
    }

    return results as RunResult
  }

  private async getFileStats(): Promise<string> {
    const stats = await fs.promises.stat(this.getDestinationPath())

    const bytesToSize = (bytes: number): string => {
      const sizes = ['Bytes', 'KB', 'MB', 'GB']

      if (bytes === 0) return '0 Byte'

      const i = parseInt(String(Math.floor(Math.log(bytes) / Math.log(1024))), 10)

      return `${Math.round(bytes / Math.pow(1000, i))} ${sizes[i]}`
    }

    return bytesToSize(stats.size)
  }

  private async processInstruction(item: FileInstruction): Promise<ProcessingInstruction> {
    const instructionPath = normalizePath(item.path)
    const adjustedPath = Util.stripTarballExtension(instructionPath)
    const newItem: ProcessingInstruction = {
      original: instructionPath,
      isPackage: item.isPackage,
      identifier: item.identifier,
      forcePrepack: item.forcePrepack,
      originalExists: false,
      paths: [],
    }

    if (hasMagic(adjustedPath)) {
      newItem.paths = (await glob(adjustedPath, { cwd: this.sourceRoot })).map(normalizePath)
      return newItem
    }

    const state = await this.getPathState(instructionPath)

    if (state.exists) {
      if (item.isPackage || Util.isTarball(instructionPath)) {
        // Include existing archives as-is.
        newItem.paths = [item.forcePrepack ? adjustedPath : instructionPath]
      } else {
        newItem.paths = [adjustedPath]
      }
      newItem.originalExists = true
    } else {
      newItem.paths = [adjustedPath]
    }

    return newItem
  }

  private async resolveDirectFileLocations(
    direct: string[],
    prepackRoots: string[]
  ): Promise<{
    existingDirect: string[]
    missing: string[]
    ambiguous: Array<{ file: string; roots: string[] }>
  }> {
    const resolutions = await Promise.all(
      direct.map(async (file) => {
        const directState = await this.getPathState(file)
        if (directState.isReadable) {
          return { type: 'direct' as const, file }
        }

        const matches = await Promise.all(
          prepackRoots.map(async (root) => {
            const candidate = normalizePath(path.join(root, file))
            const candidateState = await this.getPathState(candidate)
            return candidateState.isReadable ? root : null
          })
        )

        const matchingRoots = matches.filter((root): root is string => root !== null)

        if (matchingRoots.length === 1) {
          return { type: 'provided' as const }
        }

        if (matchingRoots.length > 1) {
          return { type: 'ambiguous' as const, file, roots: matchingRoots }
        }

        return { type: 'missing' as const, file }
      })
    )

    const existingDirect = resolutions
      .filter((entry): entry is { type: 'direct'; file: string } => entry.type === 'direct')
      .map((entry) => entry.file)

    const missing = resolutions
      .filter((entry): entry is { type: 'missing'; file: string } => entry.type === 'missing')
      .map((entry) => entry.file)

    const ambiguous = resolutions.filter(
      (entry): entry is { type: 'ambiguous'; file: string; roots: string[] } => entry.type === 'ambiguous'
    )

    return { existingDirect, missing, ambiguous }
  }

  private buildPackagingPlan(instructions: ProcessingInstruction[]): PackagingPlan {
    const prepack: ProcessingInstruction[] = []
    const direct: string[] = ['package.xml']

    instructions.forEach((instruction) => {
      if (
        instruction.forcePrepack ||
        (instruction.isPackage && !instruction.originalExists) ||
        (!instruction.isPackage && Util.isTarball(instruction.original) && !instruction.originalExists)
      ) {
        prepack.push(instruction)
        return
      }

      direct.push(...instruction.paths.map((value) => normalizePath(value.replace(/\.tar@$/, '.tar'))))
    })

    return { prepack, direct }
  }

  private createDirectFileValidationError(
    missing: string[],
    ambiguous: Array<{ file: string; roots: string[] }>
  ): FileAccessError {
    const lines: string[] = []

    if (missing.length > 0) {
      lines.push('The following files could not be found:')
      missing.forEach((file) => {
        lines.push(`- ${file}`)
      })
    }

    if (ambiguous.length > 0) {
      if (lines.length > 0) {
        lines.push('')
      }

      lines.push('The following files matched multiple prepack source directories:')
      ambiguous.forEach((item) => {
        lines.push(`- ${item.file} (matched: ${item.roots.join(', ')})`)
      })
    }

    return new FileAccessError(lines.join('\n'), {
      code: ambiguous.length > 0 ? 'REQUIRED_FILES_AMBIGUOUS' : 'REQUIRED_FILES_MISSING',
      meta: { files: missing, ambiguous },
    })
  }

  private async findLocalFiles(): Promise<void> {
    const results = await Promise.all(this.filesToPackage.map((item) => this.processInstruction(item)))
    const preliminaryPlan = this.buildPackagingPlan(results)
    const uniqueDirect = [
      ...new Set(preliminaryPlan.direct.map((item) => normalizePath(item).replace(/^\/+/, ''))),
    ]
    const prepackRoots = [
      ...new Set(preliminaryPlan.prepack.filter((item) => !item.isPackage).map((item) => item.paths[0])),
    ]
    const resolved = await this.resolveDirectFileLocations(uniqueDirect, prepackRoots)

    if (resolved.missing.length > 0 || resolved.ambiguous.length > 0) {
      throw this.createDirectFileValidationError(resolved.missing, resolved.ambiguous)
    }

    this.packagingPlan = {
      prepack: preliminaryPlan.prepack,
      direct: resolved.existingDirect,
    }
  }

  private async createTarArchive({
    cwd,
    entries,
    outputPath,
    gzip = false,
    filter,
  }: {
    cwd: string
    entries: string[]
    outputPath: string
    gzip?: boolean
    filter: (filePath: string) => boolean
  }): Promise<void> {
    await fs.promises.mkdir(path.dirname(outputPath), { recursive: true })

    const output = fs.createWriteStream(outputPath)
    const packStream = tar.c(
      {
        cwd,
        portable: true,
        preservePaths: false,
        gzip,
        filter,
      },
      entries
    )

    await pipeline(packStream, output)
  }

  private async prepackage(): Promise<void> {
    if (!this.packagingPlan) {
      return
    }

    for (const instruction of this.packagingPlan.prepack) {
      if (instruction.isPackage) {
        // handle additional packages
        await this.prepackAdditionalPackages(instruction)
        continue
      }

      const dir = instruction.paths[0]
      const absoluteDir = this.resolveInputPath(dir)
      let entries: string[]
      const state = await this.getPathState(dir)

      if (!state.exists) {
        throw new FileAccessError(
          `Unable to prepack '${instruction.original}': source directory '${dir}' could not be found`,
          {
            code: 'PREPACK_SOURCE_MISSING',
            meta: { sourcePath: dir, archivePath: instruction.original },
          }
        )
      }

      if (!state.isDirectory) {
        throw new FileAccessError(
          `Unable to prepack '${instruction.original}': source path '${dir}' is not a directory`,
          {
            code: 'PREPACK_SOURCE_INVALID',
            meta: { sourcePath: dir, archivePath: instruction.original },
          }
        )
      }

      try {
        entries = await this.getDirectoryEntries(dir)
      } catch (err) {
        const code = getErrorCode(err)

        if (code === 'ENOENT' || code === 'ENOTDIR') {
          throw new FileAccessError(
            `Unable to prepack '${instruction.original}': source directory '${dir}' could not be found`,
            {
              code: 'PREPACK_SOURCE_MISSING',
              cause: err,
              meta: { sourcePath: dir, archivePath: instruction.original },
            }
          )
        }

        throw err
      }

      await this.createTarArchive({
        cwd: absoluteDir,
        entries,
        outputPath: this.resolveInputPath(instruction.original),
        gzip: Util.isGzipTarball(instruction.original),
        filter: (filePath) => {
          if (instruction.forcePrepack) {
            return true
          }

          const relative = normalizePath(path.join(dir, filePath))

          return !this.isIntermediateFile(relative)
        },
      })
    }
  }

  private async prepackAdditionalPackages(instruction: ProcessingInstruction): Promise<void> {
    const dir = this.resolveInputPath(instruction.paths[0])
    const destination = this.resolveInputPath(instruction.original)

    const runPackager = async (source: string) => {
      await new TaskRunner({ source, destination, quiet: true }).run()
    }

    const state = await this.getPathState(dir)

    if (state.exists) {
      await runPackager(dir)
      return
    }

    // try to find package directory
    const parentDir = path.dirname(dir)
    const result = await this.findAdditionalPackage(parentDir, instruction.identifier || '')

    if (!result) {
      throw new PackageLookupError(
        `Unable to locate package '${instruction.identifier}', which is defined to be included`,
        {
          code: 'INCLUDED_PACKAGE_NOT_FOUND',
          meta: { identifier: instruction.identifier, searchRoot: parentDir },
        }
      )
    }

    await runPackager(result)
  }

  /**
   * Tries to find a package by reading all package.xml files
   * in the directory and comparing the identifier name.
   */
  private async findAdditionalPackage(directory: string, identifier: string): Promise<string | null> {
    const files = await glob('**/package.xml', { cwd: directory })

    if (files.length <= 0) {
      return null
    }

    let firstError: unknown = null

    for (const file of files) {
      const absoluteFile = path.join(directory, file)
      const parser = new PackageXmlParser(path.dirname(absoluteFile))

      try {
        await parser.readXml(absoluteFile)

        parser.parseInfo()

        if (parser.info?.name === identifier) {
          return path.dirname(absoluteFile)
        }
      } catch (err) {
        if (!firstError) {
          firstError = err
        }
      }
    }

    if (firstError) {
      throw firstError
    }

    return null
  }

  private isIntermediateFile(name: string, omitTar?: boolean): boolean {
    const testName = normalizePath(name)

    return (
      this.intermediateFolders.has(testName) || (Boolean(omitTar) && this.intermediateFiles.has(testName))
    )
  }

  private async packageAll(): Promise<string> {
    if (!this.packagingPlan) {
      throw new Error('Packaging plan is missing')
    }

    const files = this.packagingPlan.direct
      .concat(this.packagingPlan.prepack.map((item) => item.original))
      .map(normalizePath)

    const fileSet = new Set(files)
    const folderSet = new Set<string>()

    files.forEach((itemPath) => {
      // Don't include folders that only contain intermediate files
      if (this.isIntermediateFile(itemPath, true)) return

      let base = path.dirname(itemPath)

      while (base && base !== '.' && base !== path.sep) {
        folderSet.add(normalizePath(base))

        const next = path.dirname(base)

        if (next === base) {
          break
        }

        base = next
      }
    })

    const destination = this.getDestinationPath()
    const entries = await fs.promises.readdir(this.sourceRoot)

    await this.createTarArchive({
      cwd: this.sourceRoot,
      entries,
      outputPath: destination,
      gzip: Util.isGzipTarball(destination),
      filter: (filePath) => {
        const file = normalizePath(filePath)
        return !this.isIntermediateFile(file, true) && (folderSet.has(file) || fileSet.has(file))
      },
    })

    return destination
  }

  private getDestinationPath(): string {
    let destination = this.destination

    if (!Util.isTarball(destination)) {
      destination = path.join(destination, '{name}_v{version}.tar.gz')
    }

    destination = path.normalize(
      destination
        .replace('{name}', this.packageInfo.name)
        .replace('{version}', this.packageInfo.version.replace(/\s+/gi, '_'))
    )

    return destination
  }

  private async cleanup(): Promise<void> {
    if (!this.packagingPlan || this.packagingPlan.prepack.length <= 0) {
      return
    }

    const deleteTasks = this.packagingPlan.prepack
      .filter((item) => Util.isTarball(item.original) && (!item.originalExists || item.forcePrepack))
      .map(async (item) => {
        try {
          await fs.promises.unlink(this.resolveInputPath(item.original))
        } catch (err) {
          if (getErrorCode(err) !== 'ENOENT') {
            throw err
          }
        }
      })

    await Promise.all(deleteTasks)
  }

  private async writeTreeStructure(quiet: boolean): Promise<void> {
    if (quiet || !this.packagingPlan) {
      return
    }

    let tree = { _: [] as string[] }

    this.packagingPlan.direct.forEach((file) => {
      tree = buildTree(tree, normalizePath(file))
    })

    const nonIntermediatePrepacks = this.packagingPlan.prepack.filter(
      (item) => !this.isIntermediateFile(item.paths[0])
    )

    nonIntermediatePrepacks.forEach((item) => {
      tree = buildTree(tree, normalizePath(item.original))
    })

    console.log(ConsoleStyle.boldGreen(path.basename(this.getDestinationPath())))

    outputTree(tree, 0, [], {
      bold: ConsoleStyle.bold,
      tar: ConsoleStyle.boldCyan,
    })
  }
}
