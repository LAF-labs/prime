# Adoption map: non-developer UX and the MCP data agent

Research run 2026-08-14 against both product goals: (1) easier than Codex or
Claude Code for students, office workers, and small-business owners; (2) an
agent that reads data out of the databases and DNS of websites we own or that
are outsourced to us, over MCP. Two survey reports were commissioned for this;
their findings are distilled here with what we did and did not adopt.

## What already shipped from this research

**The MCP bridge (833b0b0).** The app's sidebar has written `mcpServers`
entries into the harness settings for weeks, and in the everyday profile they
did nothing: the harness consumes MCP through its Python kernel and built-in
skills, both of which the everyday profile removes. Measured before the fix,
a configured server's tool simply did not exist — asked "어제 우리 웹사이트
신규 가입자 수 알려줘" with an analytics server configured, the model
invented a URL and web_fetched it. The gate now opens configured servers with
the official SDK (MIT), registers each tool behind the existing approval
dialog, and the same question is answered from the server's data with one
approval click. stdio + Streamable HTTP; OAuth remotes deliberately out of v1.

## License reality check (survey finding worth keeping)

The desktop-AI space relicensed heavily in 2025–26. Cleanly adoptable today:
**Goose (Apache-2.0), AnythingLLM (MIT), LibreChat (MIT), Jan (Apache-2.0),
NextChat (MIT), DeepChat (Apache-2.0)**, and Witsy only at tags ≤ v2.0.0.
Study-only (copyleft or branded licenses): Cherry Studio (AGPL), Lobe Chat
("Community License"), Open WebUI (branding clause), Chatbox (GPL), 5ire
(modified Apache). Verify the LICENSE at the exact commit before copying
anything.

## The adoption queue, in order

1. **Goose's permission model** (Apache-2.0; `ui/desktop/src/components/`
   `ToolCallConfirmation.tsx`, settings/extensions/). Four modes with
   "Smart Approval" risk-tiering — auto-approve reads, dialog on writes.
   Our gate already distinguishes READ_ONLY_TOOLS; the missing piece is the
   per-tool "always allow / ask / never" memory, which our allow-rules
   (`isAllowedByRule`) half-implement. Goose is the only surveyed project
   with our exact architecture (harness + desktop GUI + permission gate).
2. **Gallery-first onboarding** (pattern; layout ideas from NextChat's Masks,
   MIT). Every successful non-dev product opens on a gallery of things to do,
   never a blank prompt. Our skills are invisible plumbing today; a "what can
   I ask?" gallery on new-thread is the single highest-leverage UX change.
3. **Goose Recipes as the skill-sharing shape** — prompt + tools + settings
   bundled, parameterized with a form, shareable. Our laf-skills are already
   this minus the UI; when skills become user-visible, copy the recipe frame.
4. **AnythingLLM's onboarding wizard** (MIT;
   `frontend/src/pages/OnboardingFlow/Steps/`) as reference for making our
   existing wizard friendlier, and its skill-as-toggle-panel UX.
5. **LibreChat's prompt-variable forms** (MIT; `client/src/components/`
   `Prompts/forms|fields`) — the best MIT implementation of "structured
   input before chat", and the natural donor for our dead QuestionCards
   (either revive with a real format or replace with MCP elicitation-style
   typed forms).
6. **Cherry Studio's bundled-runtime idea** (AGPL — idea only, code from
   DeepChat if needed): MCP servers that need `uvx`/`npx` should get runtimes
   we bundle, not system ones. We already bundle Node; stdio servers written
   in Node work today with `command: <our node>`.

## The data-agent verdict (from the MCP ecosystem survey)

**Ship DNS first.** The two motivating examples have opposite risk profiles:
"is my DNS pointing at the new server?" needs only public lookups — a keyless
MIT server (patrickdappollonio/mcp-netutils, ofershap/mcp-server-dns) or a
native dig/whois tool, zero credentials, near-zero risk. "How many signups
yesterday?" needs the full credential + consent stack. The DNS path is
shippable on today's bridge; the DB path has prerequisites.

**DB servers worth pointing customers at** (all verified maintained,
permissive, with read-only support):

| Need | Server | License | Read-only mechanism |
|---|---|---|---|
| Postgres | crystaldba/postgres-mcp | MIT | `--access-mode=restricted` + SQL-parse guard |
| MySQL | benborla/mcp-server-mysql | MIT | writes off by default, per-class opt-in |
| MongoDB | mongodb-js official | Apache-2.0 | `--readOnly` + `--disabledTools` |
| Redis | redis/mcp-redis official | MIT | Redis ACL `+@read -@write` (engine-level) |
| ClickHouse | official | Apache-2.0 | read-only **by default** |
| Supabase | official (hosted) | Apache-2.0 | `read_only=true` → restricted PG role — needs OAuth 2.1 |
| Cloudflare DNS | official (hosted) | Apache-2.0 | analytics/settings only, cannot mutate — needs OAuth 2.1 |

**Security requirements before touching a client's production site** (from
the Supabase MCP data-leak post-mortem, the GitHub MCP toxic-flow write-up,
and the MCP spec's security best practices):

1. Read-only enforced **in the database engine** (dedicated role, replica,
   statement timeouts) — the tool-layer flag is the second lock, never the
   only one.
2. Per-call human approval stays on, and DB output is treated as hostile
   input. Our bridge does both today: every MCP call raises the dialog, and
   tool descriptions carry a "data, not instructions" note. The remaining gap
   is the lethal-trifecta combination — private-data access plus web tools in
   one session is an exfiltration channel; a per-server "no web tools in this
   session" toggle is future work.
3. One scoped credential per client site, in the keychain, never in argv.
   For OAuth-gated vendor servers (Supabase, Cloudflare, PlanetScale) we need
   an OAuth 2.1 client (PKCE, RFC 8707, dynamic registration, loopback
   redirect) — that is v2 of the bridge, and the reason those two rows above
   are marked "needs OAuth".

Sources: the two survey reports of 2026-08-14 (agent transcripts), plus
https://simonwillison.net/2025/Jul/6/supabase-mcp-lethal-trifecta/,
https://supabase.com/blog/defense-in-depth-mcp,
https://invariantlabs.ai/blog/mcp-github-vulnerability,
https://modelcontextprotocol.io/specification/2025-06-18/basic/security_best_practices,
https://goose-docs.ai/docs/guides/managing-tools/goose-permissions/.
