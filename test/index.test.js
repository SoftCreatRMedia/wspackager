import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import * as tar from 'tar'
import * as wspackager from '../lib/index.js'
import TestRunner from './TestRunner.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

describe('usage tests', () => {
  const EXPECTED_CONTENT = ['files.tar', 'templates.tar', 'package.xml', 'page.xml']

  test('it should create a tar.gz file (direct)', async () => {
    await new TestRunner('simple-package', EXPECTED_CONTENT).run()
  })

  test('it should create a tar.gz file (cli)', async () => {
    await new TestRunner('simple-package', EXPECTED_CONTENT).runCli()
  })

  test('it should create tar.gz files for packages with void instructions', async () => {
    await new TestRunner('void-instructions', ['files.tar', 'package.xml']).runCli()
  })

  test('it should create a tar.gz file (directory name with dots)', async () => {
    await new TestRunner('special.package.name', EXPECTED_CONTENT).runCli(
      false,
      'com.example.test_v1.0.0.tar.gz'
    )
  })

  test('it should allow --source without an explicit value', async () => {
    await new TestRunner('simple-package', EXPECTED_CONTENT).runCli(
      true,
      'com.example.test_v1.0.0-cli-source.tar',
      '-s'
    )
  })
})

describe('include package tests', () => {
  const EXPECTED_CONTENT = [
    'files.tar',
    'templates.tar',
    'package.xml',
    'page.xml',
    'requirements/',
    'requirements/com.example.test.level2.tar.gz',
  ]

  test('it should include requirements', async () => {
    await new TestRunner(
      'include-package',
      EXPECTED_CONTENT.concat('requirements/com.example.test.level2.tar')
    ).run()
  })

  test('it should prepack requirements and include', async () => {
    await new TestRunner('prepack-include-package', EXPECTED_CONTENT).run()
  })
})

describe('modernization tests', () => {
  afterAll(async () => {
    await fs.promises.rm(path.join(__dirname, 'build'), { recursive: true, force: true })
    await fs.promises
      .unlink(path.join(__dirname, 'simple-package', 'com.example.test_v1.0.0-cwd.tar'))
      .catch(() => {})
  })

  test('it should not mutate process.cwd()', async () => {
    const before = process.cwd()
    const outputFilename = 'com.example.test_v1.0.0-cwd.tar'
    const runner = new TestRunner('simple-package', ['files.tar', 'templates.tar', 'package.xml', 'page.xml'])

    await runner.deletePreviousTestBuild(outputFilename)
    await wspackager.run({
      cwd: __dirname,
      source: 'simple-package',
      destination: path.join('simple-package', outputFilename),
      quiet: true,
    })

    expect(process.cwd()).toBe(before)
    await runner.expectPackageBuild(outputFilename)
  })

  test('it should resolve destination placeholders from cwd', async () => {
    const runner = new TestRunner('simple-package', ['files.tar', 'templates.tar', 'package.xml', 'page.xml'])
    const result = await runner.runWithOptions({
      cwd: __dirname,
      source: 'simple-package',
      destination: 'build/{name}/{version}.tar.gz',
      quiet: true,
    })

    const relativeOutput = path.relative(__dirname, result.path).replace(/\\/g, '/')
    expect(relativeOutput).toBe('build/com.example.test/1.0.0.tar.gz')
    expect(fs.existsSync(result.path)).toBe(true)
  })

  test('it should fail on missing direct file paths with a list output', async () => {
    const mixedCasePackageDir = path.join(__dirname, 'case-insensitive-paths')
    await fs.promises.rm(mixedCasePackageDir, { recursive: true, force: true })
    await fs.promises.mkdir(path.join(mixedCasePackageDir, 'acp', 'database'), { recursive: true })
    await fs.promises.writeFile(
      path.join(mixedCasePackageDir, 'package.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>\n<package name="com.example.case" xmlns="http://www.woltlab.com" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.woltlab.com http://www.woltlab.com/XSD/package.xsd">\n    <packageinformation>\n        <packagename>Case Test</packagename>\n        <packagedescription>Case Test</packagedescription>\n        <isapplication>0</isapplication>\n        <version>1.0.0</version>\n        <date>2026-01-01</date>\n    </packageinformation>\n    <authorinformation>\n        <author>softcreatr</author>\n        <authorurl>https://softcreatr.dev</authorurl>\n    </authorinformation>\n    <instructions type="install">\n        <instruction type="script">acp/database/install_com.example.case.php</instruction>\n    </instructions>\n</package>`
    )
    await fs.promises.writeFile(
      path.join(mixedCasePackageDir, 'acp', 'database', 'some_other_file.php'),
      '<?php // test'
    )

    await expect(
      wspackager.run({
        cwd: __dirname,
        source: 'case-insensitive-paths',
        destination: path.join('case-insensitive-paths', 'com.example.case_v1.0.0.tar'),
        quiet: true,
      })
    ).rejects.toThrow('The following files could not be found:\n- acp/database/install_com.example.case.php')
    await fs.promises.rm(mixedCasePackageDir, { recursive: true, force: true })
  })

  test('it should allow script paths when they exist in a single files.tar source folder', async () => {
    const fixtureDir = path.join(__dirname, 'script-only-in-files')
    const outputFile = 'com.example.legacy_v1.0.0.tar.gz'
    await fs.promises.rm(fixtureDir, { recursive: true, force: true })
    await fs.promises.mkdir(path.join(fixtureDir, 'files', 'acp', 'database'), { recursive: true })
    await fs.promises.writeFile(
      path.join(fixtureDir, 'package.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>\n<package name="com.example.legacy" xmlns="http://www.woltlab.com" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.woltlab.com http://www.woltlab.com/XSD/package.xsd">\n    <packageinformation>\n        <packagename>Legacy Test</packagename>\n        <packagedescription>Legacy Test</packagedescription>\n        <isapplication>0</isapplication>\n        <version>1.0.0</version>\n        <date>2026-01-01</date>\n    </packageinformation>\n    <authorinformation>\n        <author>softcreatr</author>\n        <authorurl>https://softcreatr.dev</authorurl>\n    </authorinformation>\n    <instructions type="install">\n        <instruction type="file"/>\n        <instruction type="script">acp/database/install_com.example.legacy.php</instruction>\n    </instructions>\n</package>`
    )
    await fs.promises.writeFile(
      path.join(fixtureDir, 'files', 'acp', 'database', 'install_com.example.legacy.php'),
      '<?php // legacy'
    )

    const runner = new TestRunner('script-only-in-files', ['files.tar', 'package.xml'])
    await runner.deletePreviousTestBuild(outputFile)
    await wspackager.run({
      cwd: __dirname,
      source: 'script-only-in-files',
      destination: path.join('script-only-in-files', outputFile),
      quiet: true,
    })
    await runner.expectPackageBuild(outputFile)
    await fs.promises.rm(fixtureDir, { recursive: true, force: true })
  })

  test('it should fail with a clear error when a prepack source directory is missing', async () => {
    const fixtureDir = path.join(__dirname, 'missing-prepack-directory')

    await fs.promises.rm(fixtureDir, { recursive: true, force: true })
    await fs.promises.mkdir(fixtureDir, { recursive: true })
    await fs.promises.writeFile(
      path.join(fixtureDir, 'package.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>\n<package name="com.example.prepack" xmlns="http://www.woltlab.com" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.woltlab.com http://www.woltlab.com/XSD/package.xsd">\n    <packageinformation>\n        <packagename>Prepack Test</packagename>\n        <packagedescription>Prepack Test</packagedescription>\n        <isapplication>0</isapplication>\n        <version>1.0.0</version>\n        <date>2026-01-01</date>\n    </packageinformation>\n    <authorinformation>\n        <author>softcreatr</author>\n        <authorurl>https://softcreatr.dev</authorurl>\n    </authorinformation>\n    <instructions type="install">\n        <instruction type="template">templates.tar</instruction>\n    </instructions>\n</package>`
    )

    await expect(
      wspackager.run({
        cwd: __dirname,
        source: 'missing-prepack-directory',
        destination: path.join('missing-prepack-directory', 'com.example.prepack_v1.0.0.tar.gz'),
        quiet: true,
      })
    ).rejects.toThrow("Unable to prepack 'templates.tar': source directory 'templates' could not be found")

    await fs.promises.rm(fixtureDir, { recursive: true, force: true })
  })

  test('it should include prebuilt style archives without parsing style.xml', async () => {
    const fixtureDir = path.join(__dirname, 'style-archive-direct')
    const styleArchive = 'style_6af19c433bc0f898827a26876995b31296091878.tgz'
    const outputFile = 'com.example.style_v1.0.0.tar.gz'

    await fs.promises.rm(fixtureDir, { recursive: true, force: true })
    await fs.promises.mkdir(fixtureDir, { recursive: true })
    await fs.promises.writeFile(
      path.join(fixtureDir, 'package.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>\n<package name="com.example.style" xmlns="http://www.woltlab.com" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.woltlab.com http://www.woltlab.com/XSD/package.xsd">\n    <packageinformation>\n        <packagename>Style Test</packagename>\n        <packagedescription>Style Test</packagedescription>\n        <isapplication>0</isapplication>\n        <version>1.0.0</version>\n        <date>2026-01-01</date>\n    </packageinformation>\n    <authorinformation>\n        <author>softcreatr</author>\n        <authorurl>https://softcreatr.dev</authorurl>\n    </authorinformation>\n    <instructions type="install">\n        <instruction type="style"><![CDATA[${styleArchive}]]></instruction>\n    </instructions>\n</package>`
    )
    await fs.promises.writeFile(path.join(fixtureDir, styleArchive), 'prebuilt-style-archive')

    const runner = new TestRunner('style-archive-direct', ['package.xml', styleArchive])
    await runner.deletePreviousTestBuild(outputFile)
    await wspackager.run({
      cwd: __dirname,
      source: 'style-archive-direct',
      destination: path.join('style-archive-direct', outputFile),
      quiet: true,
    })
    await runner.expectPackageBuild(outputFile)

    await fs.promises.rm(fixtureDir, { recursive: true, force: true })
  })

  test('it should rebuild a style archive from unpacked style directory when present', async () => {
    const fixtureDir = path.join(__dirname, 'style-rebuild-from-directory')
    const styleArchive = 'style_6af19c433bc0f898827a26876995b31296091878.tgz'
    const styleDir = path.join(fixtureDir, 'style_6af19c433bc0f898827a26876995b31296091878')
    const outputFile = 'com.example.style.rebuild_v1.0.0.tar.gz'

    await fs.promises.rm(fixtureDir, { recursive: true, force: true })
    await fs.promises.mkdir(styleDir, { recursive: true })
    await fs.promises.writeFile(
      path.join(fixtureDir, 'package.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>\n<package name="com.example.style.rebuild" xmlns="http://www.woltlab.com" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.woltlab.com http://www.woltlab.com/XSD/package.xsd">\n    <packageinformation>\n        <packagename>Style Rebuild Test</packagename>\n        <packagedescription>Style Rebuild Test</packagedescription>\n        <isapplication>0</isapplication>\n        <version>1.0.0</version>\n        <date>2026-01-01</date>\n    </packageinformation>\n    <authorinformation>\n        <author>softcreatr</author>\n        <authorurl>https://softcreatr.dev</authorurl>\n    </authorinformation>\n    <instructions type="install">\n        <instruction type="style"><![CDATA[${styleArchive}]]></instruction>\n    </instructions>\n</package>`
    )

    await fs.promises.writeFile(
      path.join(styleDir, 'style.xml'),
      '<style><files><templates>templates.tar</templates><images>images.tar</images></files></style>'
    )
    await fs.promises.writeFile(path.join(styleDir, 'templates.tar'), 'templates')
    await fs.promises.writeFile(path.join(styleDir, 'images.tar'), 'images')

    // Existing archive should be replaced from the unpacked directory.
    await fs.promises.writeFile(path.join(fixtureDir, styleArchive), 'stale-archive')

    const runner = new TestRunner('style-rebuild-from-directory', ['package.xml', styleArchive])
    await runner.deletePreviousTestBuild(outputFile)
    const result = await wspackager.run({
      cwd: __dirname,
      source: 'style-rebuild-from-directory',
      destination: path.join('style-rebuild-from-directory', outputFile),
      quiet: true,
    })
    await runner.expectPackageBuild(outputFile)

    const extracted = path.join(fixtureDir, '__extract')
    await fs.promises.mkdir(extracted, { recursive: true })
    await tar.x({ file: result.path, cwd: extracted })
    const innerEntries = []
    await tar.t({
      file: path.join(extracted, styleArchive),
      onentry: (entry) => {
        innerEntries.push(entry.path)
      },
    })

    expect(innerEntries.sort()).toEqual(['images.tar', 'style.xml', 'templates.tar'])
    expect(fs.existsSync(path.join(fixtureDir, styleArchive))).toBe(false)
    await fs.promises.rm(fixtureDir, { recursive: true, force: true })
  })

  test('it should validate style.xml when rebuilding a style archive from directory', async () => {
    const fixtureDir = path.join(__dirname, 'style-rebuild-invalid-xml')
    const styleArchive = 'style_6af19c433bc0f898827a26876995b31296091878.tgz'
    const styleDir = path.join(fixtureDir, 'style_6af19c433bc0f898827a26876995b31296091878')

    await fs.promises.rm(fixtureDir, { recursive: true, force: true })
    await fs.promises.mkdir(styleDir, { recursive: true })
    await fs.promises.writeFile(
      path.join(fixtureDir, 'package.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>\n<package name="com.example.style.invalid" xmlns="http://www.woltlab.com" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.woltlab.com http://www.woltlab.com/XSD/package.xsd">\n    <packageinformation>\n        <packagename>Style Invalid Test</packagename>\n        <packagedescription>Style Invalid Test</packagedescription>\n        <isapplication>0</isapplication>\n        <version>1.0.0</version>\n        <date>2026-01-01</date>\n    </packageinformation>\n    <authorinformation>\n        <author>softcreatr</author>\n        <authorurl>https://softcreatr.dev</authorurl>\n    </authorinformation>\n    <instructions type="install">\n        <instruction type="style"><![CDATA[${styleArchive}]]></instruction>\n    </instructions>\n</package>`
    )

    await fs.promises.writeFile(
      path.join(styleDir, 'style.xml'),
      '<style><files><templates>templates.tar</templates>'
    )
    await fs.promises.writeFile(path.join(styleDir, 'templates.tar'), 'templates')
    await fs.promises.writeFile(path.join(styleDir, 'images.tar'), 'images')
    await fs.promises.writeFile(path.join(fixtureDir, styleArchive), 'stale-archive')

    await expect(
      wspackager.run({
        cwd: __dirname,
        source: 'style-rebuild-invalid-xml',
        destination: path.join('style-rebuild-invalid-xml', 'com.example.style.invalid_v1.0.0.tar.gz'),
        quiet: true,
      })
    ).rejects.toThrow('The style.xml does not appear to be a valid XML document.')

    await fs.promises.rm(fixtureDir, { recursive: true, force: true })
  })
})
