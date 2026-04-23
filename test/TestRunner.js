import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { exec as execCb } from 'node:child_process'
import { promisify } from 'node:util'
import * as tar from 'tar'
import { expect } from 'vitest'
import * as wspackager from '../lib/index.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const exec = promisify(execCb)
const EXPECTED_FILE = 'com.example.test_v1.0.0-{test_name}.tar'

export default class TestRunner {
  constructor(testCasePath, expectedContent) {
    this.testCasePath = testCasePath
    this.expectedContent = expectedContent
  }

  async run() {
    const outputFilename = EXPECTED_FILE.replace('{test_name}', 'direct')
    const packageDir = this.getTestPackagePath(false)

    await this.deletePreviousTestBuild(outputFilename)

    const result = await wspackager.run({
      cwd: __dirname,
      source: packageDir,
      destination: path.join(packageDir, outputFilename),
      quiet: true,
    })

    await this.expectPackageBuild(result.filename)
    return result
  }

  async runWithOptions(options) {
    return wspackager.run(options)
  }

  async runCli(useDestination = true, outputFilename = false, extraArgs = '') {
    if (!outputFilename) {
      outputFilename = EXPECTED_FILE.replace('{test_name}', 'cli')
    }

    await this.deletePreviousTestBuild(outputFilename)

    let command = `cd "${this.getTestPackagePath()}" && node ../../lib/bin.js`
    if (useDestination) {
      command += ` -d "${outputFilename}"`
    }
    if (extraArgs) {
      command += ` ${extraArgs}`
    }

    const result = await exec(command)
    if (result.stderr) {
      throw new Error(result.stderr)
    }

    await this.expectPackageBuild(outputFilename)
    return outputFilename
  }

  async runCliJson(useDestination = true, outputFilename = false, extraArgs = '') {
    if (!outputFilename) {
      outputFilename = EXPECTED_FILE.replace('{test_name}', 'cli-json')
    }

    await this.deletePreviousTestBuild(outputFilename)

    let command = `cd "${this.getTestPackagePath()}" && node ../../lib/bin.js --json`
    if (useDestination) {
      command += ` -d "${outputFilename}"`
    }
    if (extraArgs) {
      command += ` ${extraArgs}`
    }

    const result = await exec(command)
    if (result.stderr) {
      throw new Error(result.stderr)
    }

    const payload = JSON.parse(result.stdout)
    await this.expectPackageBuild(outputFilename)
    return payload
  }

  async runCliJsonError(extraArgs = '') {
    let command = `cd "${this.getTestPackagePath()}" && node ../../lib/bin.js --json`
    if (extraArgs) {
      command += ` ${extraArgs}`
    }

    try {
      await exec(command)
      throw new Error('Expected CLI command to fail')
    } catch (error) {
      if (!error.stderr) {
        throw error
      }

      return JSON.parse(error.stderr)
    }
  }

  getTestPackagePath(absolutePath = true) {
    const dir = this.testCasePath
    if (absolutePath) {
      return path.join(__dirname, dir)
    }

    return dir
  }

  async deletePreviousTestBuild(filename) {
    try {
      await fs.promises.unlink(path.join(this.getTestPackagePath(), filename))
    } catch (err) {
      if (err && err.code !== 'ENOENT') {
        throw err
      }
    }
  }

  async expectPackageBuild(filename) {
    const createdPackage = path.join(this.getTestPackagePath(), filename)
    expect(fs.existsSync(createdPackage)).toBe(true)

    const content = []

    await tar.t({
      file: createdPackage,
      onentry: (entry) => {
        content.push(entry.path)
      },
    })

    expect(this.expectedContent.sort()).toEqual(content.sort())
  }
}
