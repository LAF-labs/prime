# The agent runtime lives here — but not in git

This folder holds the bundled agent runtime: the Node binary, the compiled
harness, and its `node_modules`. It is ~165 MB, so it is generated rather than
committed, and everything in it except this file is ignored.

To fill it:

```bash
./scripts/build-sidecar.sh
```

That clones the pinned harness fork (`HARNESS_REF` + `HARNESS_SHA` in the
script), builds it, copies in the Node runtime and the gate extension, and
writes `HARNESS.json` recording exactly what went in.

This file is tracked on purpose. `tauri.conf.json` bundles
`resources/lafagent/**/*`, and Tauri fails the build when a resource glob
matches nothing — so a fresh clone that has not run the script yet could not
even `cargo check`. One tracked file keeps the glob satisfied and gives the
folder something to say for itself.
