# Security policy

## Reporting a vulnerability

**Do not open a public issue, and do not send a pull request with the fix attached.** Use GitHub's
private vulnerability reporting on this repository — the **Security** tab → *Report a vulnerability*.
It is private to the maintainers, and it gives us a place to work on a fix with you before anything
becomes public.

Please include the version (release tag, or the commit you built), how the viewer was being run
(double-clicked from disk, or the container behind nginx), and the smallest reproduction you can
manage. **Redact anything from a real installation** before you attach it: device names, topics,
hostnames, credentials, `config.json` contents. The
[standing rule](CONTRIBUTING.md#standing-rule--this-repository-is-public) applies to security reports
too, and a report is more useful reduced to the shipped sample vocabulary anyway.

Expect an acknowledgement within a few days. This is a small project with no on-call: if something is
being actively exploited against you, say so in the first line.

## Supported versions

The latest release tag is the only supported version. Fixes land on `main` and go out in the next
tag; there are no backports to older tags.

## What this project is, and what that means for scope

Motrix Edge View is a **static single-page app with no backend of its own**. There is no server, no
database, and no code of ours running anywhere except in the reader's browser. Two consequences shape
every report:

- **A password checked inside the app protects nothing**, because whoever runs it already has the
  file. That is why the app has no authentication of its own and never will.
- **The only gate is nginx's, in the container**, and it gates `location /api/` only. The static
  shell stays public deliberately: it is the same file this project publishes as a release download,
  and gating it would break file mode for someone who only wanted to open a CSV.

### In scope

- Anything that makes the viewer reach off-disk when opened from `file://` — an external URL, a
  dynamic `import()`, a CDN reference that slipped past `scripts/check-bundle-size.mjs`.
- Anything that carries a credential, a host, a topic or a config path out of `src/core/topology.ts`
  into the parsed document, the rendered DOM, or a chart label. That module is an allowlist of twelve
  named paths precisely so this cannot happen by accident; a way around it is a real finding.
- Anything that builds an `Authorization` header, or reaches `/api`, outside
  `src/sources/live/api-client.ts`.
- A way to make the container's nginx serve `/api/` without the Basic auth gate, or to make
  `docker/docker-entrypoint.d/40-viewer-auth.sh` start with an empty or default credential rather
  than failing closed.
- Cross-site scripting through loaded data: a device name, field path, payload or `config.json` value
  that escapes into markup rather than being rendered as text.
- Supply-chain issues in what we ship — a dependency pinned to something compromised, a workflow
  action reference that is not a commit SHA.

### Not vulnerabilities

These are documented design decisions. Reporting them is not useful, though an argument that one of
them is *wrong* is welcome as a normal issue:

- **The static page is unauthenticated.** By design; see above.
- **Basic auth is reversibly encoded.** Over loopback that is fine, and the container warns about
  exactly this at every start. Put TLS or a VPN in front before the viewer leaves `127.0.0.1`.
- **The EMS's REST API has no authentication of its own.** That is a property of
  [motrix-edge](https://github.com/Motrix-Energy/motrix-edge), deliberate, and safe only because its
  port is never published — see that repository's `SECURITY.md`. A deployment that publishes port
  8000 has changed the model, and that is an operator decision, not a bug here.
- **The viewer reads whatever file you drag into it.** It parses locally, in your browser, and sends
  nothing anywhere.
- **Browser storage holds the chosen language and the sign-in header.** The language is in
  `localStorage`; the encoded `Basic …` value is in **`sessionStorage`**, deliberately — all three
  options are equally exposed to script in the origin, so what separates them is how long a
  credential outlives the person who typed it, and `localStorage` on a shared control-room machine
  keeps it forever. Base64 is encoding, not encryption, and the same string already crosses the wire
  on every request. An argument that the trade-off is wrong is welcome as a normal issue; a report
  that "credentials are stored in plain text in the browser" is a restatement of the design.

## Disclosure

We will confirm the report, agree a fix and a timeline with you, and credit you in the release notes
unless you would rather we did not. Please give us a reasonable window to ship before publishing.
