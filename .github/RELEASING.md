# Releasing

Release workflows execute on **KERN** (`kern.tdvorak.dev`), which runs the
same `.github/workflows/*.yml` files on the self-hosted fleet (Linux, macOS,
and Windows runners — the Windows runner also signs the sparse-identity
package). GitHub Actions is disabled on this fork at the account level:
pushes, tag pushes, and `workflow_dispatch` produce no GitHub-side runs, and
the repo's Actions toggle cannot lift it. CI status still reports back as the
`kern/CI` commit check.

## How to cut a release

Push the tag — that is the entire trigger:

| Tag          | Workflow                | Artifacts                                          |
| ------------ | ----------------------- | -------------------------------------------------- |
| `v*`         | `release.yml`           | server binaries, Docker images, all platform bundles |
| `desktop-v*` | `desktop-release.yml`   | Windows NSIS, `.deb`, AppImage, `.app.tar.gz`, `latest.json` updater manifest |
| `android-v*` | `android-release.yml`   | APK + AAB                                          |

```bash
git tag desktop-v0.3.16 && git push origin desktop-v0.3.16
kern runs list --workflow "Desktop Release"   # watch the run
```

KERN ingests the tag push and starts the workflow automatically; no manual
dispatch is needed. `latest.json` and the rolling `desktop-updater`
prerelease are published by the `updater-manifest` job, gated on `ref_name`
so both tag pushes and tag dispatches update it.

Manual fallback (e.g. re-run a failed leg):

```bash
kern runs trigger cloudreve "Desktop Release" --ref desktop-v0.3.16 --event workflow_dispatch
```
