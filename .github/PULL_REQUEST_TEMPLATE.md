<!--
Thanks for contributing. The full guide is CONTRIBUTING.md; this is the short version of its
checklist. Explain *why* in the description — the what is in the diff.
-->

## What this changes, and why

<!-- If it fixes an issue, link it. If it exists because something broke, say what broke. -->

## Checklist

- [ ] `npm run typecheck`, `npm run lint` and `npm test` are green
- [ ] `npm run build` passes, including the single-file check (`scripts/check-bundle-size.mjs`)
- [ ] Nothing from a real installation appears in any example, fixture, test, comment or screenshot
- [ ] New or changed UI strings are in all four catalogues, with `{name}` placeholders, and every
      text-bearing component subscribes to `s.locale`
- [ ] No component invents a colour — every value comes from a token, or from the validated
      categorical palette
- [ ] Nothing new reaches off-disk: no external URL, no dynamic `import()`, no Web Worker
- [ ] `test/fixtures/` is untouched — or the storage format moved, and I have read
      [the cross-repo procedure](https://motrix-energy.github.io/contribute/storage-format-changes/)
- [ ] If this touches retention or follow mode, I ran the manual harness
      (`npx vitest run --config vitest.manual.config.ts`)
- [ ] Any new rule that matters has a test or a lint rule behind it, not just a comment
