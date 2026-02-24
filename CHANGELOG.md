## **v2.0.0** (2026-02-24)

- **Breaking:** Require Node.js `>=18`
- **Breaking:** Package is now published as `@softcreatr/wspackager`
- **Breaking:** Package is now native ESM (CommonJS `require()` is no longer supported)
- **Breaking:** Enforce strict direct file existence checks (no case-insensitive path fallback)
- **Breaking:** Script/database paths must exist explicitly in source tree (implicit `files.tar`-only paths are rejected)
- Rebrand npm package to `@softcreatr/wspackager`
- Update project metadata URLs to the new `SoftCreatRMedia/wspackager` repository
- Modernize internals to Promise-based packaging flow
- Replace Babel build pipeline with native TypeScript (`tsc`) build output
- Replace Jest with Vitest test runner
- Remove global `process.chdir()` usage and make all packaging paths source-root aware
- Switch archive creation to stream-based tar pipelines
- Add structured error classes for clearer failure modes
- Expand test coverage for cwd safety and destination placeholder resolution
- Fix style instruction handling for `.tar`, `.tar.gz`, and `.tgz` archives
- Rebuild style archives from unpacked style directories when present and validate `style.xml` during rebuild
- Remove temporary rebuilt style archives from source after packaging (same cleanup behavior as other prepacks)
- Improve error reporting when prepack source directories are missing or invalid
- Accept direct script/database references when they are provided via exactly one prepack source directory (for example `files/`)
- Show missing file validation errors as a readable list instead of a comma-separated string
- Upgrade core dependencies and tooling

## **v1.5.0** (2022-07-27)

- Add support for the `<void/>` package instruction

## **v1.4.0** (2022-04-21)

Thanks to @Sir-Will for these additions!

- Add main file for usage in node scripts
- Add option to define source directory
- Add basic jest tests
- Updat all dependencies
- Add .tar.gzip output

## **v1.3.1** (2017-05-05)

- Fix a bug that includes an empty directory in the resulting package

## **v1.3.0** (2017-05-04)

- Replace some of the manual path separation in the packager with code using node's `path` module
- Add the `-d/--destination` command line option to specify the destination of the package

## **v1.2.1** (2017-03-18)

- Fix bug where `style.xml` file options with attributes weren't loaded

## **v1.2.0** (2017-03-18)

- Add support for intermediate packages that should not be packaged into the final archive (only via styles)
- Extend support for the `style` PIP that also reads the `style.xml` and packages its files as well

## **v1.1.0** (2017-02-18)

- Added additional default file names for XML based PIPs

## **v1.0.5** (2017-01-27) (+ **v1.0.6**)

- Fixed a bug where folders wouldn't be packaged on Windows

## **v1.0.3** (2017-01-14)

- Change main file to `lib/gulp/wspackager.js` in first step to create a gulp plugin
- Parse `optionalpackage` and `requiredpackage` xml tags and also package the archives specified by them
