# Third-party notices

LAF Agent is distributed with the components below. Each remains under its own
license; the full texts ship inside the application bundle at
`Contents/Resources/resources/lafagent/node_modules/<package>/LICENSE` where
the package includes one, and are otherwise available at the linked sources.

## Bundled agent runtime

| Component | Version | License | Source |
|---|---|---|---|
| Prime Agent (`@earendil-works/pi-coding-agent`) | 0.7.0 | MIT | https://github.com/PrimeIntellect-ai/prime-agent |
| Node.js | 22.23.1 | MIT (with dependencies under their own terms) | https://github.com/nodejs/node |

Prime Agent derives from `pi-mono` by Mario Zechner, also MIT.

Node.js embeds OpenSSL, V8, zlib, libuv and others; their notices are in the
Node.js distribution's `LICENSE` file.

## Native modules shipped with the runtime

| Package | Version | License |
|---|---|---|
| cmake-ts | 1.0.2 | MIT |
| koffi | 2.16.2 | MIT |
| node-addon-api | 8.9.1 | MIT |
| undici | 7.28.0 | MIT |
| zeromq | 6.5.0 | MIT AND MPL-2.0 |
| @mariozechner/clipboard | 0.3.9 | MIT |
| @silvia-odwyer/photon-node | 0.3.4 | Apache-2.0 |

`zeromq` links libzmq, which is MPL-2.0. A copy of the MPL-2.0 text is
included with that package; its source is at https://github.com/zeromq/libzmq.

## Bundled for the permission gate

Pinned by `scripts/build-sidecar.sh` and resolved at runtime by
`resources/laf-agent-gate.ts`. They are not harness dependencies — the gate
is LAF Agent's own extension.

| Package | Version | License | Source |
|---|---|---|---|
| @anthropic-ai/sandbox-runtime | 0.0.70 | MIT | https://github.com/anthropics/sandbox-runtime |
| @mozilla/readability | 0.6.0 | Apache-2.0 | https://github.com/mozilla/readability |
| linkedom | 0.18.13 | ISC | https://github.com/WebReflection/linkedom |

Readability is the article-extraction library behind Firefox Reader View;
`linkedom` supplies it a DOM outside a browser.

## Downloaded at first run

Setting up the agent's Python kernel downloads, into the user's home
directory rather than the app bundle:

- a standalone CPython build (Python Software Foundation License), and
- `ipykernel`, `prime-agent-runtime`, `dill`, `requests`, `httpx`, `pyyaml`,
  `tomli`, `python-dotenv`, `pandas`, `numpy`, `scipy`, `beautifulsoup4`,
  `lxml`, `pydantic`, and `tyro`, each under its own license (predominantly
  BSD, MIT, or Apache-2.0).

These are not redistributed by LAF Agent.

## Application dependencies

The desktop application itself is built with Tauri (MIT/Apache-2.0), React
(MIT), and the Rust and npm packages listed in `src-tauri/Cargo.toml` and
`package.json`. Run `cargo license` or `npm ls --all` for the resolved set.

## Original codebase

Portions of this application derive from a desktop codebase by Sabeur Thabti,
used under the MIT License. See [LICENSE](LICENSE).
