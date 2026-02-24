# Changesets

Use `npm run changeset` to create version change notes.

Release flow:

1. `npm run changeset`
2. Commit the generated `.changeset/*.md`
3. Run `npm run version-packages` when preparing a release PR
4. Publish with `npm run release` or your CI release workflow
