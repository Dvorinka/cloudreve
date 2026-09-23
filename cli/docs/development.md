# Development

## Architecture

Commander defines command grammar in `src/program.ts`. Command handlers receive services
from composition; the SDK owns backend protocols. Platform adapters own filesystem, process,
credential, and terminal I/O. Only the entry point owns process lifecycle. Architecture tests
reject backend endpoints, SDK internals, and sibling-source imports.

Use `mise run lint:fix`, then `mise run format` before `mise run check`. The check task runs
formatting, linting, type checking, build, and all-source coverage. Pre-commit uses that same
gate. Dependencies reference versioned GitHub release archives and a committed lockfile. SDK and Foundation changes are explicit version updates; sibling source imports are rejected.

## Formatting

[Foundation](https://github.com/cloudreve/foundation) supplies shared ESLint and Prettier policies through the versioned `@cloudreve/quality` development dependency. Runtime code remains independent of Foundation.

Formatting uses two-space indentation, 100-column wrapping, and one blank line between imports and code, declarations and execution, control-flow blocks, functions, types, class methods, and section comments. Keep related short declarations together; use braces for every control-flow body and one variable per declaration. `mise run format` applies ESLint fixes and Prettier, then checks spacing after wrapping; `mise run check` enforces both.

## End-to-end tests

Dependency lifecycle scripts are disabled during installation. Project builds run explicitly through mise; optional native dependency optimizations are not required for these checks.

GitHub Actions uses standard Ubuntu runners and isolated Community Docker fixtures. The
[version matrix](compatibility-matrix.json) pins backend and auxiliary-service image digests.
The installed npm package is tested across supported versions and the unsupported boundary.
Fixtures have ownership labels and are removed after each run; no personal server is needed.

```sh
# Linux amd64 with Docker
mise run test:e2e
CR_CI_VERSION=4.17.0 mise run test:e2e

# Run the actual GitHub Actions jobs locally, including on Docker Desktop
mise run ci:local -- --job validate
mise run ci:local -- --job community
```

`act` uses the pinned Linux image in `.actrc`. Sanitized receipts and coverage are generated
under ignored `.artifacts/` and `coverage/`; fixture state stays under ignored `.runtime/`.

## Releases

`mise run release:build` compiles a standalone executable with Bun, embeds the native credential binding, and verifies both command names from an extracted archive without a JavaScript runtime on PATH.

The release workflow accepts an explicit stable version or a semantic version increment. Build, unit, binary and Community E2E checks run against the exact release commit. Publication occurs only after validation succeeds; existing release versions are never overwritten.

Release archives include Linux, macOS, and Windows binaries plus SHA-256 checksums. Registry publication is separate from GitHub releases.
