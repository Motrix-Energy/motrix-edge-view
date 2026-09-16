# test/fixtures/

**Vendored from the EMS repository. Do not hand-edit.**

```bash
npm run fixtures:update                              # from ../motrix-edge
EDGE_REPO=/path/to/motrix-edge npm run fixtures:update
```

`auto_toggle/expected/` is not a sample someone typed — it is the **actual bytes** the EMS
writes, produced there by running `main.py` over the two committed replay files. That is
what makes it an interface rather than an illustration, and it is why this directory is
tracked rather than gitignored.

`MANIFEST.json` carries a SHA-256 per generated file plus `storage_format_version`.
`test/fixtures.test.ts` verifies both: a drifted file fails, and a format bump fails
against `motrixStorageFormat` in `package.json` with a message saying what to read.

`edge_cases/` is the adversarial tier — hand-authored in the EMS repo, and carrying no
checksums because it is designed rather than observed. The EMS cannot produce most of
those rows; a `docker kill` mid-write, a truncating disk, an Excel round-trip or two
concatenated files can. `edge_cases/README.md` documents every row.

The normative description of the format is `docs/storage-format.md` in the EMS repository.
Read it before changing a parser here.
