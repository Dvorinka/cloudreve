# Usage

`cloudreve-cli` and `cr` are equivalent. Help is available with `cr --help`, `cr help COMMAND`,
and `cr GROUP --help`.

## Files

Remote paths use `/my/`, `/trash/`, `/shared_with_me/`, or `/share/ID/`. Relative remote paths
resolve against `--cwd`, which defaults to `/my/`. Local operands always use `local:`.

```sh
cr ls /my/
cr stat /my/report.pdf
cr mkdir /my/Documents
cr cp local:./report.pdf /my/Documents/
cr cp local:./photos /my/Photos --recursive
cr cp /my/Documents/report.pdf local:./report.pdf
cr mv /my/report.pdf /my/renamed.pdf
cr cat /my/notes.txt
cr rm /my/renamed.pdf
```

`rm` moves entries to trash. Permanent deletion requires `--permanent --yes`, plus
`--recursive` for directories. Overwriting downloads or uploads requires `--overwrite`.
`touch` creates an absent empty file; it does not change existing timestamps. Downloads
finalize atomically. Interrupted transfers can be inspected with `cr transfer list` and
continued with `cr transfer resume ID`.

## Accounts

```sh
cr auth login --name personal --server https://cloud.example --email you@example.com
cr auth login --name work --server https://team.example --email you@company.example
cr auth status
cr auth switch personal
cr ls /my/ --profile work
cr auth logout work
```

A login saves and selects its named account. `--profile` selects only the current invocation;
otherwise `CLOUDREVE_PROFILE`, then the saved selection applies. Logging out never silently
switches to another account. Config lives under `~/.config/cloudreve` unless overridden by
`CLOUDREVE_CONFIG_DIR` or `--config-dir`.

macOS uses Keychain by default. Other platforms use the native credential store. Headless
hosts without a usable native store can explicitly choose `--credential-store file` during
login. File storage is plaintext with restrictive filesystem permissions; protect the config
directory and transfer checkpoints. There is no automatic plaintext fallback.

Passwords and other secrets are never ordinary command arguments. Login also accepts
`--password-stdin`, `--credential-stdin`, or `--secrets-stdin` for explicit piped input.

## Browser sign-in

```sh
cr auth login --server https://cloud.example
cr auth login --server https://cloud.example --no-open
```

Browser OAuth is the default. A temporary listener binds to a random port on `127.0.0.1`.
The browser returns an authorization code and state to that listener; tokens are exchanged
through the CLI's connection to the server. The listener closes after success, denial,
cancellation, or timeout. Incomplete login never saves credentials.

`--no-open` prints the authorization URL for a browser on the same computer. `--timeout`
sets the callback deadline in milliseconds. The default built-in login deadline is ten minutes.

The server must have the built-in Cloudreve CLI OAuth application enabled and support loopback
redirect ports. Generic OAuth exists from Cloudreve 4.12.0; the CLI otherwise requires 4.17.0
or later. Built-in application availability is checked directly. Custom registered loopback
clients remain supported through `--authorize-url` and a client secret in `--secrets-stdin`.

Password sign-in supports email/password and OTP. CAPTCHA cannot be solved interactively in
the terminal; it needs a supplied answer (and ticket when required) via `--secrets-stdin`, or
browser sign-in.

## Automation

```sh
cr ls /my/ --json
cr cat /my/notes.txt > notes.txt
cr watch /my/ --json
```

Data goes to stdout; diagnostics and prompts go to stderr. `--json` produces versioned
`{ "schemaVersion": 1, "data": ... }` envelopes; `watch --json` uses NDJSON. JSON errors go to
stderr. `cat` streams bytes and rejects `--json`. Always check exit status before consuming
output: interrupted streams can be incomplete.

Listings traverse all pages unless explicitly limited with `--limit`. JSON includes
pagination metadata. `--no-prompt`, redirected streams, and JSON mode disable interactive
prompts. Color respects `NO_COLOR` and `TERM=dumb`.

| Exit status | Meaning                                |
| ----------- | -------------------------------------- |
| 0           | Success                                |
| 1           | Operation failure                      |
| 2           | Invalid input or confirmation required |
| 4           | Authentication required                |
| 130 / 143   | Interrupted by SIGINT / SIGTERM        |
