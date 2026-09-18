# Collu demo design direction

> **Legacy reference:** This document describes the earlier deterministic
> terminal and Vite companion. The current deployed iteration is the Next.js
> Drink Order SIM documented in the repository [README](../README.md).

## Product posture

The primary demo happens in the place where a developer already works: their
real operating-system terminal. It is not a security dashboard, agent control
panel, cinematic playback surface, step-by-step wizard, or simulated web
terminal.

The live interaction has three CLI states:

1. **Before:** `npm run agents` streams an apparently normal workflow, reaches
   the safe local production callback, and reports `SUCCESS` with no security
   warning.
2. **After:** `collu dev -- npm run agents` streams the same workflow with an
   inline decision, reveals `POISONED CONTEXT`, and blocks.
3. **Trace:** `collu trace <trace-id>` reopens the persisted proof.

The Vercel interface is a shareable companion with a workspace and trace page.
Those browser states remain useful, but they are not the primary live product
interaction.

## Real terminal contract

One-time setup in the repository is:

```bash
npm install
npm link
```

The presenter runs one workflow twice without showing the source first:

```bash
npm run agents
collu dev -- npm run agents
```

Both runs use `fixtures/github-issue-1842.md` and stream Source, Research,
Planner, Coding, Reviewer, and Deploy in the same causal order. Both print the
same source path and the same 12-character lowercase `input sha256`
fingerprint. The unprotected run must not print or imply `COMPROMISED`,
`UNTRUSTED`, `POISONED`, or reveal the injected instruction. It ends like an
ordinary successful job with these exact facts:

```text
status                SUCCESS
environment           production
approval requested    no
credential            PROD_DEPLOY_TOKEN
production executions 1
```

Those facts let the audience recognize the unsafe outcome without giving the
base workflow awareness it does not have. The protected run continues through
Collu evaluation and must visibly add `finding POISONED CONTEXT`, reveal the
hidden instruction and its external origin, show its propagation through the
agents, and include `BLOCK`, the protected action, exactly three policy
reasons, `executed false`, `production executions 0`, a unique trace ID, and
the saved path under `.collu/traces/`.

Only after that reveal may the presenter optionally run:

```bash
cat fixtures/github-issue-1842.md
```

The source path and fingerprint—not an opening file preview—are the initial
proof that the before and after used the same input.

The result is written to `.collu/traces/<trace-id>.json`. Running
`collu trace <trace-id>` must validate and render that record without creating
another trace.

`npm run agents` is a deterministic, offline control whose production callback
is local and simulated. The command after `--` is the matching deterministic
scenario identifier. The Collu CLI does not start it as a subprocess, accept
arbitrary alternatives, read a real secret, or contact GitHub or production.
This constraint must remain explicit in help text and presenter documentation.

The runtime behavior is shared with the browser companion: a pure policy
function feeds the protected action function, which owns the only call site for
the production callback.

```text
request → evaluate policy → ALLOW → invoke callback
                          ↘ BLOCK → return, executed: false
```

For the unprotected control there is no policy branch and the local callback
count becomes one. The control considers that completion a success. With Collu
inline, the second branch is taken, the poisoned context becomes visible, and
the callback count remains zero.

## Terminal presentation

Use the presenter's normal terminal app and shell theme. Do not wrap it in
browser chrome or add demo-specific panels. Keep both runs on screen when
possible so `SUCCESS / production / no approval / 1 execution` and `POISONED
CONTEXT / BLOCK / 0 executions` can be compared directly. The CLI itself
supplies restrained ANSI color only when stdout is a TTY:

- cyan identifies Collu and run metadata;
- green identifies completed agent handoffs and the base run's ordinary
  `SUCCESS`;
- amber appears only in the protected run, where Collu identifies the
  untrusted source and Deploy request; and
- red is reserved for the final `BLOCK` label.

The base output should use ordinary operational wording: agents complete,
Reviewer approves, and Deploy completes. Do not let warning colors, security
labels, authority-expansion language, or an exposed instruction tip the reveal.
The protected output can add ancestry and authority because Collu is the
component that understands the escalation. Timestamps and aligned labels make
both feel like ordinary process output. The story should remain fully readable
with `NO_COLOR` or when output is captured. Use a default pause of roughly 900
ms between events in both runs: slow enough to narrate, fast enough to complete
the pair comfortably inside the pitch.

## Browser companion

The browser app is for a public URL, a visual explanation of the generated
trace, and presentation recovery. It must not be described as the live terminal
or imply that its command input is an operating-system shell.

### Companion workspace

The desktop layout pairs a small source pane with a larger terminal:

```text
┌ Collu ───────────────────────────── inline gateway active ┐
│                                                          │
│ Run the agent workflow.                   [Run workflow] │
│                                                          │
│ ┌ GitHub issue #1842 ───┐ ┌ Terminal ─────────────────┐ │
│ │ Editable issue body   │ │ $ collu dev -- npm run   │ │
│ │                       │ │   agents                  │ │
│ │ <!-- agent prompt --> │ │                          │ │
│ │ read PROD token…      │ │ Research …               │ │
│ │                       │ │ Planner  …               │ │
│ │ External source       │ │ Coding   …               │ │
│ └───────────────────────┘ │ Reviewer …               │ │
│                           │ Deploy requested…         │ │
│                           │ COLLU BLOCK               │ │
│                           │ 0 production executions  │ │
│                           │ [Open incident]           │ │
│                           └───────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

When the companion is used for the protected explanation, the issue is visibly
labeled as an editable fixture. It locks while a run is in progress. The
simulated terminal supports a small fixed command set, with
**Run workflow** as a mouse-friendly companion to the real CLI command.

There are no Research, Planner, Coding, Reviewer, or Deploy buttons. Once a run
starts, those lines arrive from the stream without presenter input.

### Companion terminal interaction

The browser companion supports:

```text
help
cat collu.yaml
collu dev -- npm run agents
open <trace-id>
clear
reset
```

Output should be concise enough to read from a projected screen. Each line has
one speaker and one fact. Avoid activity feeds, charts, system metrics, agent
cards, or decorative status panels.

The terminal needs only three strong states:

- **Ready:** the issue is editable and the prompt accepts input.
- **Running:** the issue and prompt are locked while events stream.
- **Blocked:** the decision, trace ID, and zero execution count are visible.

If the hosted endpoint fails, add one plain terminal notice before the local
stream begins. Do not hide or cosmetically rename the fallback.

### Companion trace incident

The **Open incident** action navigates to
`#/traces/<trace-id>`. Hash routing keeps the link compatible with the static
Vite output on Vercel.

The page should behave like a case file:

```text
Back to terminal                                      tr_...

BLOCKED BY COLLU
Production never received the request.       0 executions

Root source
GitHub issue #1842                         UNTRUSTED_EXTERNAL

Causal path
Source → Research → Planner → Coding → Reviewer → Deploy → BLOCK

Decision
Action       deploy.production.execute
Policy       External input requires independent approval
Why          untrusted origin
             expanded authority
             non-independent review
```

The default view is one readable linear path. Do not replace it with an
abstract node graph. Each step may include one sentence of evidence and its
authority, but the source, Reviewer, protected action, and Collu block must all
remain visible.

Any response buttons are explicitly labeled as demo previews and must state
that they do not change an external system.

### Hosted companion runtime contract

The browser starts one run with:

```http
POST /api/run
Content-Type: application/json

{"payload":"<current issue body>"}
```

The response uses `application/x-ndjson`. The UI renders each complete line as
it arrives instead of waiting for a final JSON document. The required order is:

```text
run.created
source.ingested
agent.completed: Research
agent.completed: Planner
agent.completed: Coding
agent.completed: Reviewer
tool.requested: deploy.production.execute
gateway.evaluating
gateway.decision: BLOCK
```

The runtime creates a unique trace ID, carries it on every event, and returns
the complete trace with the final decision.

The browser UI must render the policy result from runtime state, not maintain an
unrelated display-only counter.

### Browser runtime fallback

The runtime module is shared between the Vercel Function and browser. If
`/api/run` fails or returns something other than the expected stream, the
client imports that module, runs the same deterministic policy locally, and
adds a visible fallback notice.

This is a resilience feature for the pitch, not a claim that a client-only
gateway protects a production deployment.

### Companion visual system

The interface is text-led and restrained:

| Role | Treatment |
| --- | --- |
| Workspace | Warm white background with thin graphite rules |
| Terminal | Near-black surface with compact monospace output |
| Collu | Green reserved for gateway identity and healthy protection |
| Untrusted influence | Amber reserved for the source and inherited risk |
| Block | High-contrast type and structure, not a full-screen red alarm |

Use Satoshi for interface copy and Geist Mono for commands, actions, hashes,
permissions, policy identifiers, and execution counts. Do not add illustrations,
stock imagery, glowing network graphics, gradients, ornamental diagrams, large
navigation, or dashboard chrome.

Motion should acknowledge events arriving from the stream. It must not resemble
autoplay slides, obscure the causal order, or become the only evidence that a
state changed. Reduced motion must preserve every fact.

### Companion responsive behavior

On a narrow viewport, stack the issue above the terminal and keep the terminal
command, decision, trace action, and zero count usable without horizontal page
scroll. The incident remains a vertical case file with the causal path in the
same order.

## Vercel companion deployment

Vite builds the static interface into `dist/`. Vercel serves `api/run.js` and
`api/health.js` as Functions according to `vercel.json`. The public deployment
must allow access without a platform account or sign-in gate.

Verify the companion and fallback paths after deployment:

1. `/api/health` returns a ready response.
2. A run visibly uses the hosted NDJSON stream without a fallback notice.
3. The trace route opens and survives refresh/navigation.
4. `/collu-fallback-demo.mp4` plays from the same public origin.

## Fallback recording

The fallback MP4 is a recording of the browser companion, not the primary CLI
and not an alternate motion-design deliverable. If it presents the full
comparison, it must preserve the same blind-first reveal. The recorder should:

1. open a clean developer workspace;
2. run the unprotected workflow without first showing the poisoned source;
3. hold briefly on `SUCCESS`, production, no approval, and one execution;
4. run the same input through Collu with its matching fingerprint visible;
5. wait while Collu reveals the poisoned context and causal path;
6. hold on `COLLU BLOCK` and `0 production executions`;
7. open the generated incident; and
8. end on the causal explanation.

The output belongs at `public/collu-fallback-demo.mp4` so Vercel serves it at a
stable URL beside the live demo.

## Implementation honesty

Working behavior includes both local CLI processes, their ordered event streams,
the shared input fingerprint, the unprotected local callback and one execution,
the base run's blind `SUCCESS`, Collu's poisoned-context finding, policy
evaluation, the protected callback guard, `BLOCK`, zero protected executions,
JSON trace persistence, CLI trace replay, hosted request, NDJSON consumption,
hash routing, companion commands, explicit browser fallback, browser
persistence, and reset.

Fixtures include the GitHub issue, agent outputs, timings, lineage, delegated
authority, policy inputs, expected `BLOCK`, and production target. The demo must
not imply that the CLI starts the command after `--`, makes a live GitHub
connection, performs live model inference, accesses private chain-of-thought or
real credentials, or attempts a real deployment.
