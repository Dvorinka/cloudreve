# Cloudreve CLI

A command-line client for Cloudreve. File operations, transfers, shares, and account management with **`cloudreve-cli`** or **`cr`**.

**Linux · macOS · Windows** · Standalone binaries · Text and JSON output

> [!IMPORTANT]
> Under active development. Features and interfaces may change. Stay tuned for updates.

[Command reference](docs/usage.md) · [Contributing](docs/development.md) · [Releases](https://github.com/cloudreve/cli/releases) · [MIT](LICENSE)

## Install

```sh
mise use -g github:cloudreve/cli@1.0.0
```

[Download an archive](https://github.com/cloudreve/cli/releases/latest) for direct installation. Each release includes both executable names and SHA-256 checksums. No separate Node.js or Bun installation is required.

## Usage

```sh
cr auth login --server https://cloud.example --email you@example.com
cr ls /my/
cr mkdir /my/Documents
cr cp local:./report.pdf /my/Documents/
cr cp /my/Documents/report.pdf local:./downloaded.pdf
```

Passwords are prompted securely. Remote paths start at `/my/`; local paths use `local:`.

## Output

Example listing:

```text
$ cr ls /my/
Modified times: UTC
TYPE        SIZE  MODIFIED          NAME
dir            —  2026-09-20 09:41  Documents/
file     2.3 MiB  2026-09-20 09:42  report.pdf
file     1.5 KiB  2026-09-20 09:43  notes.md
```

`--json` returns structured output. `--no-prompt` disables interactive prompts.

### Browser login · development builds

```sh
cr auth login --server https://cloud.example
```

The browser returns directly to a temporary local callback. No code copying is required. Browser and CLI run on the same computer; `--no-open` prints the URL instead. This requires a server with the built-in Cloudreve CLI OAuth application enabled and is not included in CLI 1.0.0.

Password login supports OTP and supplied CAPTCHA answers through `--secrets-stdin`. Interactive CAPTCHA is handled in the browser.

## Compatibility

Cloudreve **≥4.17.0 and <5**. `trash empty` requires 4.18.0 or later.

## Development

```sh
mise install
mise run setup
mise run check
mise run release:build
```

---

[Cloudreve](https://github.com/cloudreve/cloudreve) · [Foundation](https://github.com/cloudreve/foundation) · [SDK](https://github.com/cloudreve/sdk) · **CLI**
