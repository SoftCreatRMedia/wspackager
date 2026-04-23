# Migration Guide: 1.x -> 2.x

## Summary

`wspackager` has been modernized and republished under a scoped package name.

## Breaking changes

1. npm package name changed:

- Old: `wspackager`
- New: `@softcreatr/wspackager`

2. Minimum supported Node.js version is now `20`.

3. Runtime behavior no longer mutates global working directory:

- `process.cwd()` is no longer changed internally.
- All paths are resolved from the provided `cwd`/`source` options.

4. Direct file validation is now strict:

- Paths must exist exactly as specified in `package.xml`.
- Case-insensitive fallback resolution has been removed.
- Script/database paths can be resolved via exactly one prepack source directory (for example `files/`).

5. Error model is now structured:

- Internal errors may include `code` and `meta` fields.
- Message text may differ from 1.x in some failure paths.

6. Programmatic API is now native ESM:

- Use `import` instead of `require`.
- Package now ships TypeScript declarations.

## What stayed compatible

1. CLI binary name remains `wspackager`.
2. Main programmatic entry point remains `run(options)`.
3. Package output semantics remain compatible with existing tests and expected archive contents.

## Upgrade steps

1. Update install command:

```bash
npm install -g @softcreatr/wspackager
```

2. Ensure your runtime is Node.js 20+.

3. Ensure all direct script/database paths in `package.xml` point to real source files with exact casing, either directly or via one prepack source directory.

4. If you consume errors programmatically, migrate checks to use `error.code` when available.

5. If you used CommonJS, migrate to ESM imports:

```js
import { run } from '@softcreatr/wspackager'
```

6. Re-run your packaging pipeline and compare resulting archive contents once.
