#!/usr/bin/env node

import path from 'node:path'
import process from 'node:process'
import { createRequire } from 'node:module'
import { Command } from 'commander'
import TaskRunner from './TaskRunner.js'
import ConsoleStyle from './ConsoleStyle.js'

const require = createRequire(import.meta.url)
const pkg = require('../package.json') as {
  name: string
  version: string
  description: string
  homepage?: string
}

interface CliOptions {
  pip: Record<string, string>
  source?: string | boolean
  destination?: string | boolean
  quiet?: boolean
}

const collectPips = (value: string, list: Record<string, string>): Record<string, string> => {
  const parts = value.split('=')

  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error('Invalid --pip value. Expected format: name=file')
  }

  list[parts[0]] = parts[1]

  return list
}

const program = new Command()

const ANSI_REGEX = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')
const stripAnsi = (value: string): string => String(value).replace(ANSI_REGEX, '')

const charWidth = (char: string): number => {
  const cp = char.codePointAt(0)

  if (cp === undefined) return 0

  // Combining marks.
  if ((cp >= 0x0300 && cp <= 0x036f) || (cp >= 0x1ab0 && cp <= 0x1aff)) {
    return 0
  }

  // Common wide/full-width ranges and emoji blocks.
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2329 && cp <= 0x232a) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe10 && cp <= 0xfe19) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff)
  ) {
    return 2
  }

  return 1
}

const visualLength = (value: string): number => {
  const clean = stripAnsi(value)
  let total = 0

  for (const ch of clean) {
    total += charWidth(ch)
  }
  return total
}

const padRight = (value: string, width: number): string => {
  const diff = width - visualLength(value)
  return diff > 0 ? `${value}${' '.repeat(diff)}` : value
}

const renderHeader = (cliOptions: { source: string }): void => {
  const resolvedSource = path.resolve(process.cwd(), cliOptions.source)

  const lines = [
    {
      plain: `📦  ${pkg.name}@${pkg.version}`,
      styled: `${ConsoleStyle.boldGreen('📦')}  ${ConsoleStyle.bold(pkg.name)}${ConsoleStyle.boldCyan(`@${pkg.version}`)}`,
    },
    {
      plain: `📂  ${resolvedSource}`,
      styled: `${ConsoleStyle.boldCyan('📂')}  ${resolvedSource}`,
    },
  ]

  if (pkg.homepage) {
    lines.push({
      plain: `🌍  ${pkg.homepage}`,
      styled: `${ConsoleStyle.boldCyan('🌍')}  ${pkg.homepage}`,
    })
  }

  const width = lines.reduce((max, entry) => Math.max(max, visualLength(entry.plain)), 0)
  const top = ConsoleStyle.dim(`╭${'─'.repeat(width + 2)}╮`)
  const bottom = ConsoleStyle.dim(`╰${'─'.repeat(width + 2)}╯`)

  console.log(top)
  lines.forEach((entry) => {
    console.log(`${ConsoleStyle.dim('│')} ${padRight(entry.styled, width)} ${ConsoleStyle.dim('│')}`)
  })
  console.log(bottom)
  console.log('')
}

const normalizeCliPath = (value: string | boolean | undefined): string => {
  if (typeof value === 'string' && value.length > 0) {
    return value
  }
  return '.'
}

program
  .name('wspackager')
  .description(pkg.description)
  .version(pkg.version)
  .option(
    '--pip <name=file>',
    'if default files for custom PIPs are used, use this parameter to specify the default',
    collectPips,
    {}
  )
  .option(
    '-s, --source [value]',
    'The path where the package files should be read from (defaults to cwd)',
    '.'
  )
  .option(
    '-d, --destination [value]',
    'The path the resulting archive will be saved to (defaults to cwd)',
    '.'
  )
  .option('-q, --quiet', 'omit any output')
  .parse(process.argv)

const options = program.opts<CliOptions>()
const normalizedOptions = {
  ...options,
  pip: options.pip ?? {},
  source: normalizeCliPath(options.source),
  destination: normalizeCliPath(options.destination),
  quiet: Boolean(options.quiet),
}

if (!normalizedOptions.quiet) {
  renderHeader({ source: normalizedOptions.source })
}

new TaskRunner({
  pips: normalizedOptions.pip,
  source: normalizedOptions.source,
  destination: normalizedOptions.destination,
  quiet: normalizedOptions.quiet,
})
  .run()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
