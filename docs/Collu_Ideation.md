# Collu Ideation

## Working concept

**Collu is a security control plane for agent collaboration.** It sits in the path of agent-to-agent communication, delegation, shared-state access, and consequential tool use. It builds a causal graph of how agents influence one another, detects attacks and unsafe collective behavior that no single-agent monitor can see, and can interrupt the smallest part of the collaboration needed to contain the threat.

The shorthand is **“CrowdStrike for agent collaboration.”** The more precise product description is:

> An inline agent-collaboration gateway, backed by a temporal interaction graph, a collaboration-aware policy engine, and an investigation-and-response console.

The foundational insight is:

> Every agent can pass its own security check while the collective workflow still violates policy.

Traditional application and AI security products usually evaluate an individual request, response, agent, identity, or tool call. Collu treats the **coalition, delegation chain, and complete causal trajectory** as the security principal.

---

## 1. Why this category should exist

Agents are moving from isolated assistants to systems that:

- Delegate work to one another.
- Share memory, artifacts, task queues, and retrieval systems.
- Call tools and APIs with real credentials.
- Modify other agents’ prompts, skills, code, or configuration.
- Review and approve one another’s work.
- Negotiate, transact, price, allocate, or bid against other agents.
- Operate across company and trust boundaries through A2A, MCP, APIs, queues, and SaaS platforms.

That creates a new attack surface. The risk does not live only inside a model or prompt. It lives in the **relationships between agents** and in the way authority, information, and trust move through a collaborative system.

The collaboration layer can turn into:

- A lateral-movement network for an outside attacker.
- A privilege-amplification mechanism.
- A propagation channel for prompt injection.
- A persistence layer through poisoned shared memory.
- A way to distribute a malicious operation across individually benign actions.
- A false-consensus machine in which correlated agents appear independent.
- A market-manipulation mechanism for pricing, bidding, or allocation agents.
- A feedback loop that turns one hallucination into a collective action.

The product opportunity is not merely to log this activity. It is to provide **detection and response at the collaboration layer**.

---

## 2. Three different problems hiding inside “agent collusion”

The phrase *agent collusion* currently combines three threat classes. Collu should distinguish them because they require different detections, controls, and buyers.

### 2.1 Emergent or endogenous collusion

No outside attacker is required. Agents independently discover that cooperation, information sharing, reciprocal behavior, price signaling, or boundary pushing helps maximize their objectives. The resulting behavior can be unsafe or anticompetitive even though no agent was explicitly instructed to collude.

Examples:

- Pricing agents converge on supra-competitive prices.
- Bidding agents rotate winners or divide a market.
- Reviewer agents repeatedly validate one another without independent evidence.
- A set of optimization agents learns to route around human controls.
- Agents reinforce a shared hallucination until it becomes an executed plan.

### 2.2 Adversarially induced collaboration

An outside attacker manipulates otherwise legitimate agents into collaborating toward the attacker’s objective. This is the clearest near-term security wedge.

Examples:

- A poisoned webpage compromises a research agent, whose summary influences a planner, coder, reviewer, and deployment agent.
- A low-privilege agent is induced to delegate a task through several peers until it reaches an agent with sensitive access.
- An attacker plants instructions in shared memory that influence many later workflows.
- A malicious bidder sends signals that cause honest bidding agents to coordinate around an attacker-selected outcome.

### 2.3 Collaboration-plane compromise

The attacker compromises the infrastructure that makes collaboration possible.

Examples:

- Stealing an agent identity or delegation token.
- Registering a malicious worker, reviewer, bidder, or MCP server.
- Forging or replaying an A2A message or approval.
- Compromising the orchestrator, router, policy engine, agent registry, task queue, or shared-memory service.
- Modifying an agent’s system prompt, tool manifest, skill, model, or configuration.
- Capturing a consensus or approval mechanism with Sybil agents.

The initial Collu product should primarily address **adversarially induced collaboration** and **collaboration-plane compromise**. True tacit algorithmic collusion is a longer-term analytics and market-surveillance module.

---

## 3. The external-attacker model

The central security claim is:

> An attacker should not need to compromise every agent. They should only need to compromise one trusted input, participant, identity, or shared state, then use collaboration as the propagation and execution fabric.

### 3.1 Collaboration attack paths

| Attack | What the attacker does | What Collu observes | What Collu can do |
|---|---|---|---|
| Prompt-injection worm | Places malicious instructions in an email, issue, document, webpage, tool result, or retrieved record. One agent reads it and forwards its influence to peers. | The original source, every transformation, the agents and memories it entered, and the sensitive actions it later influenced. | Preserve untrusted provenance, prevent trust laundering, quarantine contaminated context, or block the downstream action. |
| Malicious agent entry | Registers or compromises a worker, reviewer, planner, bidder, or tool-using agent. | Agent identity, owner, runtime, model, prompt hash, skills, tool manifest, permissions, attestation, and first-seen relationships. | Refuse admission, restrict its trust domain, or quarantine it. |
| Agent impersonation | Steals credentials, forges A2A messages, or replays an earlier approval. | Signature validity, short-lived identity, nonce, message sequence, runtime attestation, and impossible lineage. | Reject the message, revoke the identity, and invalidate descendant approvals or actions. |
| Confused-deputy and permission laundering | Persuades a low-privilege agent to ask more privileged agents to perform an action it could not perform directly. | The original principal, complete delegation chain, scope changes, and effective coalition authority. | Enforce non-increasing capabilities and reauthorize the final action against the original requester. |
| Shared-memory poisoning | Writes malicious instructions or false facts into a vector store, scratchpad, task board, or long-term memory used by many agents. | Writer identity, source trust, version history, readers, derivative messages, and influenced actions. | Isolate a memory segment, revert a version, expire contaminated data, or pause affected workflows. |
| Coordinator takeover | Modifies routing, policies, agent membership, task allocation, or approval rules. | Signed configuration changes, policy diffs, roster changes, routing anomalies, and unusual reassignment. | Require dual control, reject unsigned changes, restore a known-good configuration, or freeze the control plane. |
| Sybil or quorum capture | Introduces multiple nominally independent agents that share an owner, model, infrastructure, context, or objective. | Common ancestry, ownership, model and prompt fingerprints, synchronized timing, correlated errors, and reciprocal voting. | Discount correlated votes, require independent trust domains, or escalate to a human. |
| Distributed attack chain | Splits reconnaissance, credential access, collection, encoding, and exfiltration among different agents so each local action looks harmless. | The complete causal path and the combined permissions and outcome of the coalition. | Apply path-level policy and block the final step or sever the minimum set of edges needed to break the attack. |
| Market manipulation | Uses spoofed bidders, information leakage, signaling bids, bid rotation, or strategic withdrawals to steer other agents. | Identity clusters, communication and data flow, bid timing, retaliation patterns, allocation patterns, and deviations from competitive baselines. | Freeze or review transactions, remove suspect participants, or trigger a market-integrity investigation. |
| Evidence suppression | Deletes, mutates, or selectively omits messages and logs after an attack. | Gaps in sequence, broken signatures, missing parents, inconsistent replicas, and attempted telemetry tampering. | Maintain an out-of-band, append-only record and mark all descendant activity as unverifiable. |

### 3.2 The prompt-injection worm

This is likely the clearest first attack story:

```text
Malicious GitHub issue, email, or webpage
                  ↓
        Research agent reads it
                  ↓
      Planner receives a summary
                  ↓
      Coding agent changes code
                  ↓
      Reviewer agent approves it
                  ↓
     Deployment agent executes it
```

The attacker never authenticates to the company. They exploit a public input read by one agent and let trusted internal collaboration carry the malicious influence into a privileged system.

The important control is not a keyword filter. It is **end-to-end influence provenance**. If the instruction began in untrusted external content, summarizing or forwarding it cannot silently upgrade it to trusted internal intent.

---

## 4. What Collu actually is

Collu is composed of five concrete product components.

### 4.1 Agent instrumentation

Collu observes agent activity at the runtime or framework layer.

Integration modes:

1. **Framework SDK**  
   A package hooks into frameworks such as LangGraph, OpenAI Agents SDK, AutoGen, CrewAI, or internal orchestrators. It captures agent messages, delegation, memory access, model calls, approval events, and tool calls.

2. **A2A and MCP proxy**  
   Cross-process agent traffic, MCP requests, and agent-to-tool connections route through an inline gateway. This provides a control point without requiring every agent to implement custom security logic.

3. **Sidecar or local runtime sensor**  
   A local process observes agent execution, configuration, filesystem or process actions, and communication while keeping enforcement close to the workload.

4. **Log and platform connector**  
   For hosted systems where Collu cannot sit inline, it ingests audit events in monitor-only mode. This offers detection and investigation but weaker prevention.

If Collu cannot observe or intercept the collaboration edge, it is only a dashboard. The inline SDK, proxy, or sidecar is what makes it a security product.

### 4.2 Collaboration gateway

The gateway evaluates every consequential collaboration event:

- Agent-to-agent message.
- Task assignment or delegation.
- Agent creation or registration.
- Shared-memory read or write.
- Prompt, skill, tool, or policy modification.
- Approval, vote, consensus, or review.
- MCP request or response.
- Tool call or external API request.
- Bid, offer, transaction, allocation, or market message.

For each event, the gateway can return:

```text
ALLOW
ALLOW_WITH_REDACTION
REQUIRE_APPROVAL
BLOCK
QUARANTINE_AGENT_OR_SESSION
```

Fast deterministic checks should run inline. More expensive semantic, graph, and counterfactual analysis can run asynchronously unless the action is high risk.

### 4.3 Security envelope and event model

Every observed event receives a signed security envelope containing, at minimum:

- Event, trace, session, and parent-event IDs.
- Initiating human, service, or external source.
- Sending and receiving agent identities.
- Agent owner and trust domain.
- Agent runtime, model, prompt, skill, and tool-manifest versions.
- Source trust and data classifications.
- Delegated capabilities and effective permissions.
- Requested action and intended target.
- External artifacts or memories that influenced the event.
- Policy decision and reason.
- Timestamp, sequence, and integrity signature.

The envelope makes the causal ancestry portable. A receiver does not merely see “PlannerAgent asked me to deploy.” It sees that the request ultimately descends from an external GitHub issue, passed through three agents, and acquired additional authority along the way.

### 4.4 Temporal interaction graph

Collu stores the environment as a continuously changing graph.

Nodes can include:

- Agents and subagents.
- Humans and service principals.
- Models, prompts, skills, and versions.
- Tools, APIs, MCP servers, and applications.
- Memories, files, databases, queues, and retrieval sources.
- Tasks, approvals, bids, transactions, and outcomes.

Edges can include:

- Messaged.
- Delegated to.
- Approved.
- Modified.
- Read from or wrote to.
- Called.
- Shared credentials with.
- Influenced.
- Bid against or transacted with.

The graph enables Collu to evaluate a **path or coalition**, rather than only the latest message.

### 4.5 Investigation-and-response console

The application has four principal surfaces.

#### Agent map

A continuously updated inventory of agents, owners, models, versions, prompts, permissions, connected peers, shared memories, tools, MCP servers, data, and trust zones.

#### Collaboration replay

A sequence diagram showing the complete session: messages, delegation, external inputs, transformations, memory activity, evidence, approvals, tool calls, policy decisions, and outcomes. An investigator can select any action and trace it back to its originating human or external source.

#### Incidents

Collaboration-specific findings such as:

- Injection propagation.
- Agent impersonation.
- Permission laundering.
- Untrusted shared-state influence.
- Circular approval.
- False consensus.
- Coalition-level exfiltration.
- Unexpected communication or delegation edges.
- Distributed policy evasion.
- Market-manipulation indicators.

#### Policies and response

Security teams create rules, deploy them in monitor mode, review what would have been blocked, and then enable enforcement. Response actions include:

- Block or redact a message.
- Deny a tool call.
- Pause a workflow.
- Require independent approval.
- Revoke a delegated capability or identity.
- Sever one collaboration edge.
- Quarantine an agent or coalition.
- Isolate or revert shared memory.
- Invalidate descendant approvals.
- Freeze a transaction or bid.
- Roll back a prompt, tool, skill, or configuration version.

---

## 5. A complete runtime example

Assume a developer asks a research agent to inspect a GitHub issue. The issue contains an indirect prompt injection.

1. The Collu sensor records the GitHub issue as `UNTRUSTED_EXTERNAL`.
2. The research agent summarizes it for the planner.
3. The exact language changes, but the provenance label remains attached.
4. The planner delegates a code change to a coding agent.
5. The coding agent asks a deployment agent to read a secret and push an update.
6. Collu evaluates the entire path:

```text
GitHub issue
→ ResearchAgent
→ PlannerAgent
→ CodingAgent
→ DeployAgent
→ deploy.production.execute
```

7. Collu blocks the deployment because:

   - The causal chain originated in external content.
   - The requested authority expanded beyond the original task.
   - The approval was derived from the same contaminated context and therefore was not independent.
   - Untrusted influence reached a high-risk tool without a clean authorization boundary.

The incident presented to the security team could read:

```text
INCIDENT: External instruction reached a production tool

Root source
github.com/org/repo/issues/1842

Collaboration path
ResearchAgent → PlannerAgent → CodingAgent → DeployAgent

Blocked action
deploy.production.execute

Reasons
• External provenance remained active
• Delegated authority increased across the chain
• Reviewer was not independent of the originating context

Actions
[Replay session] [Quarantine agents] [Approve once]
[Revoke delegated credentials] [Roll back memory]
```

This incident experience—not merely a graph of messages—is the product.

---

## 6. Detection model

Collu should not use another LLM as the sole judge of collusion or malicious collaboration. That would be expensive, difficult to validate, and easy to evade. The detection system should be layered.

### 6.1 Hard security invariants

Deterministic controls provide the most reliable initial product:

- Delegated capability may not exceed the delegator’s capability.
- An action must be authorized against the original principal, not only the immediate caller.
- An agent cannot approve an action descended from its own request or contaminated context.
- An unknown or unattested agent cannot enter a protected workflow.
- External-origin content cannot reach specified high-risk tools without an independent approval.
- Shared-memory content cannot modify trusted policy, system prompts, or tool manifests.
- Delegation depth, fan-out, spend, and tool access are bounded.
- A previous approval cannot be replayed in a new causal context.

### 6.2 Information-flow and influence tracking

Collu attaches provenance and trust labels to external input, retrieved context, messages, summaries, memory, artifacts, and tool results. The labels survive transformation so the system can answer not only where a string moved, but which later decisions it influenced.

### 6.3 Behavioral baselines

Collu learns normal collaboration patterns for agents and roles:

- Expected peers and communication frequency.
- Normal delegation depth and fan-out.
- Typical memories, tools, data, and applications.
- Expected approval relationships.
- Normal bid, price, timing, and transaction patterns.
- Expected model, prompt, skill, and configuration changes.

### 6.4 Temporal graph detection

Graph-level findings can include:

- A new or unusually dense collaboration cluster.
- Reciprocal approvals or favors.
- Coordinated boundary probing.
- Distributed collection and exfiltration.
- A contaminated node influencing multiple sensitive workflows.
- Multiple supposedly independent agents sharing the same ancestry.
- A coalition whose combined access creates a prohibited capability.

### 6.5 Counterfactual and causal analysis

Collu can replay a workflow while removing or changing one message, agent, artifact, or market condition. If the unsafe outcome depends on a particular collaboration path, the difference provides stronger evidence than semantic similarity alone.

### 6.6 Economic and market-surveillance analysis

For bidding and pricing agents, future Collu modules could measure:

- Bid rotation and market allocation.
- Persistent prices unexplained by cost or demand.
- Punishment or retaliation after competitive deviations.
- Signaling through price, quantity, withdrawal, timing, or metadata.
- Unexpected responsiveness to a particular competitor.
- Common ownership or shared-model dependence among nominal competitors.
- Information leakage between rivals.

This is much harder than enterprise runtime security because tacit collusion may involve no direct communication, and common market conditions can make innocent agents look coordinated. It should not be the first product promise.

---

## 7. Collaboration-aware policies

Examples of policies that would make Collu concrete:

- **No trust laundering:** content that begins as external and untrusted remains untrusted until an explicit verification step.
- **No privilege laundering:** an agent may not accomplish through delegation what it could not do directly.
- **Capability attenuation:** tool and data permissions may only narrow as a task moves down a delegation chain.
- **Independent approval:** approval is valid only if the approver has an independent owner, context, and evidence path.
- **No circular approval:** an agent or descendant may not approve work originating from the same causal branch.
- **Evidence diversity:** multiple agreeing agents do not constitute consensus if they share the same model, prompt, retrieval context, owner, or contaminated memory.
- **Sensitive-path control:** external input cannot cause a payment, deployment, credential, destructive database, or outbound communication action without a clean trust boundary.
- **Coalition access control:** no collaboration may combine access to both protected data and an unapproved egress channel.
- **Memory integrity:** shared-memory writes carry writer identity, provenance, expiry, and trust level; untrusted data cannot silently become durable instruction.
- **Change control:** prompt, skill, tool, policy, or agent-roster changes require signatures, version history, and appropriate approval.
- **Market separation:** bidding agents may not exchange certain information or use unapproved communication channels during an auction.

---

## 8. The initial product wedge

### Recommended first market: enterprise coding and operations agents

Coding and operations workflows offer the cleanest starting point because:

- They already use multiple specialized agents.
- They interact with untrusted repositories, issues, documentation, and webpages.
- They hold valuable credentials and can execute consequential tools.
- The attack chains are demonstrable and understandable.
- Security and platform teams have a clear reason to pay.
- Collu can integrate at the framework, MCP, CI/CD, repository, and tool layers.

A representative protected workflow is:

```text
Planner → Researcher → Coder → Reviewer → CI agent → Deployment agent
```

Collu can immediately detect or prevent:

- Malicious repository or issue instructions propagating between agents.
- A coder creating or selecting its own reviewer through an alias.
- Reviewers sharing the same contaminated context as the author.
- A low-privilege agent obtaining production access through delegation.
- Poisoned shared memory influencing later tasks.
- A coding agent modifying another agent’s tools, prompt, or policy.
- Several agents splitting an exfiltration path across individually permitted actions.

### Additional future verticals

- Financial and payment operations.
- Procurement and autonomous purchasing.
- Customer support, refunds, and account recovery.
- Healthcare and regulated decision workflows.
- Autonomous security operations.
- Agent marketplaces and cross-company A2A systems.
- Pricing, auctions, ad markets, trading, and resource allocation.

The market-surveillance buyer may be compliance, model risk, a marketplace operator, or a regulator rather than the CISO. Collu should not mix that go-to-market motion into the initial enterprise-security sale.

---

## 9. A realistic MVP

The first product should be narrow enough to build and specific enough to prove.

### Integrations

- LangGraph.
- OpenAI Agents SDK.
- MCP traffic and tool calls.
- One shared-memory or vector-store integration.
- GitHub and a representative deployment or cloud tool.

### Captured events

- Agent registration and version.
- Agent-to-agent message.
- Delegation.
- Memory read and write.
- External artifact ingestion.
- Approval or review.
- MCP and tool request/response.
- High-risk action and outcome.

### Initial controls

1. External-source data cannot directly or indirectly trigger designated high-risk actions without independent approval.
2. Delegated permissions cannot exceed the initiating principal’s permissions.
3. An agent cannot approve an action within the same causal branch.
4. Shared-memory writes from untrusted sources retain provenance and cannot become policy.
5. Unknown or modified agents cannot join protected workflows without attestation.

### Initial product surfaces

- Agent inventory and relationship map.
- Multi-agent session replay.
- Provenance and delegation-chain viewer.
- Incident queue with an evidence-backed explanation.
- Policy editor with monitor and enforcement modes.
- Actions to block a call, pause a workflow, revoke a capability, or quarantine an agent.
- SIEM and webhook export.

### What not to promise in version one

- Universal semantic detection of “collusion.”
- Reliable inference from private chain-of-thought.
- Coverage of every proprietary hosted agent platform.
- Cross-company visibility without cooperation from both parties.
- Proof that correlated bidding behavior is legally anticompetitive.
- Fully automated enforcement for ambiguous behavioral anomalies.

The MVP should lead with deterministic attack-chain prevention. Behavioral and collusion models become credible only after Collu has collected real collaboration telemetry.

### MVP proof metrics

The first deployment should be judged against explicit operational targets rather than the breadth of the vision:

- **Instrumentation coverage:** percentage of agents, collaboration edges, memory stores, and high-risk tools that are enforced, observed, or blind.
- **Policy-path coverage:** percentage of consequential actions for which Collu can reconstruct the initiating principal, delegation chain, external influences, and approvals.
- **Inline overhead:** p50 and p95 added latency for deterministic policy checks at trust crossings and high-risk action boundaries.
- **Attack-suite recall:** percentage of a published, reproducible set of collaboration attacks that Collu blocks or surfaces with sufficient evidence.
- **False-positive rate:** legitimate sessions incorrectly interrupted or escalated, measured separately for deterministic rules and behavioral detections.
- **Investigation speed:** reduction in time required to identify the originating input, affected agents, permissions used, and final attempted action.
- **Containment quality:** percentage of incidents in which Collu stops the malicious path without terminating unaffected workflows.

---

## 10. Product principles

### Trust is never inherited merely because a message came from another agent

An internal agent can be compromised, mistaken, or carrying hostile external influence. Every receiver reauthorizes consequential activity using the complete provenance chain.

### Permissions only narrow during delegation

Delegation must not become a way to accumulate capabilities or route around policy.

### Independence must be proven, not counted

Five agents running the same model with the same context are not five independent reviewers.

### Actions and observable state matter more than private reasoning

Raw chain-of-thought is unreliable forensic evidence and creates major privacy and security exposure. Collu should prioritize messages, structured rationales, state mutations, permissions, actions, and outcomes.

### Security telemetry must be tamper-evident and outside the agent’s control

A compromised agent should not be able to delete or rewrite the evidence used to investigate it.

### Monitor before enforcing

Customers should be able to run policies in shadow mode, understand false positives, and gradually enable blocking for high-confidence rules.

### Contain the smallest necessary subgraph

The ideal response is not always “kill every agent.” Collu should isolate the smallest practical set of identities, capabilities, memory regions, or collaboration edges that breaks the attack while preserving the rest of the workflow. Exact minimum-cut containment is an attractive research direction, not a version-one promise.

---

## 11. CrowdStrike analogy

| Traditional endpoint and network security | Collu collaboration security |
|---|---|
| Endpoint | Agent runtime |
| Compromised host | Compromised agent |
| Process tree | Task and delegation tree |
| Network connection | Agent-to-agent interaction |
| Malicious payload | Injected instruction or poisoned context |
| Stolen credential | Stolen agent identity or delegated capability |
| Active Directory or domain controller | Orchestrator, registry, policy engine, or shared memory |
| Command-and-control traffic | A2A messages, bids, timing channels, and tool calls |
| Lateral movement | Influence propagation and cross-agent delegation |
| Privilege escalation | Permission aggregation or laundering through agents |
| Persistence | Poisoned memory, modified prompts, tools, or skills |
| Endpoint isolation | Quarantining an agent or severing a collaboration edge |
| EDR/XDR investigation | Multi-agent causal replay and coalition investigation |

“CrowdStrike for agent collaboration” is effective shorthand for detection and response. The actual architecture is also analogous to **an identity-aware service mesh or API gateway for agent interactions**.

---

## 12. Market landscape as of September 2026

The market already validates that agent runtime security and observability are becoming real categories. However, most vendors remain centered on individual agents, prompts, identities, or tool calls. Some capture A2A activity, but few make coordinated multi-agent behavior the primary unit of detection and response.

### 12.1 Leading security-first companies

| Company | Relevant capability and signal |
|---|---|
| [Obsidian Security](https://www.obsidiansecurity.com/ai-agent-monitoring) | Monitors agent actions and MCP activity with identity correlation and runtime control. Raised an [$85M Series D at a $1.1B valuation](https://www.obsidiansecurity.com/news/unlocking-ai-potential-securely) and reports adoption by 60 Fortune 500 companies. |
| [Zenity](https://zenity.io/platform/ai-observability) | Maintains live agent inventory and step-level visibility into executions, tools, memory, permissions, and data, with pre-action runtime boundaries. Announced a [$125M Series C](https://zenity.io/company-overview/newsroom/company-news/zenity-raises-125-million-to-secure-the-era-of-1-billion-ai-agents). |
| [Onyx Security](https://www.onyx.security/platform/ai-observability) | Captures prompts, tool calls, model responses, identities, and sessions inline; supports alert, block, mask, steer, and human approval. Reports [$153M total funding](https://www.onyx.security/press-release/onyx-security-raises-113m-series-b-to-control-advanced-ai-quadrupling-revenue-since-stealth-launch-four-months-ago). |
| [Noma Security](https://noma.security/products/ai-dr) | Monitors full chains of agent actions, tools, handoffs, intent, data access, and behavioral drift; adds agent and MCP access control. Announced a [$100M Series B](https://noma.security/blog/noma-security-raises-100m-to-drive-adoption-of-ai-agent-security). |
| [HiddenLayer](https://www.hiddenlayer.com/platform/ai-runtime-security) | Reconstructs interactions across agents, tools, data, and workflows for threat hunting and enforcement. Announced a [$100M Series B](https://www.hiddenlayer.com/news/hiddenlayer-100m-series-b-ai-security). |
| [WitnessAI](https://witness.ai/blog/introducing-witnessai-agentic-security-extending-the-confidence-layer-to-ai-agents/) | Discovers agents, MCP servers, tools, APIs, commands, identities, and data movement, with runtime audit and control. Announced a [$58M strategic round](https://witness.ai/blog/witnessai-raises-58m-to-help-enterprises-move-faster-with-ai-safely/). |
| [Straiker](https://www.straiker.ai/products/defend-ai) | Inventories agents and MCP integrations, then inspects prompts, reasoning steps, and tool calls to block manipulation and exfiltration. Reports [$85M total funding](https://www.straiker.ai/blog/straiker-raises-64m-series-a-to-secure-the-agentic-workforce). |

### 12.2 Large platform companies

| Company | Relevant capability |
|---|---|
| [Palo Alto Networks](https://www.paloaltonetworks.com/ai-security/agent-security) | Prisma AIRS combines agent discovery, identity verification, action monitoring, MCP and A2A visibility, audit, and runtime policy. Palo Alto acquired Protect AI and Portkey. |
| [Cisco and Splunk](https://www.cisco.com/c/en/us/products/collateral/security/ai-defense/ai-defense-ds.html) | Cisco AI Defense inspects agent, LLM, and MCP activity; [Splunk Agent Observability and Guardrails](https://www.splunk.com/en_us/products/guardrails.html) add full traces and pre-tool-call controls. Cisco acquired Robust Intelligence and Galileo. |
| [Microsoft](https://learn.microsoft.com/en-us/security/security-for-ai/agent-365-security) | Agent 365 combines Defender, Purview, and Entra Agent ID for inventory, identity, interaction logs, DLP, and malicious-tool detection. Some runtime controls remain preview-stage. |
| [CrowdStrike](https://www.crowdstrike.com/en-us/platform/falcon-guardian-aidr/) | Falcon Guardian/AIDR correlates prompts, identities, MCP and tool activity, and downstream endpoint execution. CrowdStrike acquired Pangea. |
| [Proofpoint](https://www.proofpoint.com/us/products/agentic-ai-security) | Reconstructs transactions from originating user through agent reasoning and tool invocation, with data-aware runtime policy. Proofpoint acquired Acuvity. |
| [F5](https://www.f5.com/products/ai-guardrails) | Its CalypsoAI and SurePath-derived platform traces prompts, reasoning, MCP connections, and tool calls while recording and enforcing security decisions. |
| AWS | AgentCore provides cloud-native observability, identity, gateway, and policy controls for agents and tool calls. |
| Google Cloud | Agent Gateway, Model Armor, Security Command Center AI Protection, and Cloud Observability provide agent and tool visibility, though parts of the stack remain preview-stage. |

### 12.3 Relevant challengers and adjacent products

- Check Point / Lakera.
- SentinelOne / Prompt Security.
- Datadog AI Guard and Agent Observability.
- Fortinet / Virtue AI.
- Fiddler.
- Lasso Security.
- Geordie AI.
- Pillar Security.
- BlueRock.
- Mindgard.
- Arize AX.
- Splunk / Galileo.
- LangSmith and Langfuse as telemetry layers rather than full security control planes.

### 12.4 Consolidation matters

Several older names are now parts of larger platforms and should not be counted as independent competitors:

- Protect AI → Palo Alto Networks.
- Portkey → Palo Alto Networks.
- Robust Intelligence → Cisco.
- Galileo → Cisco / Splunk.
- Lakera → Check Point.
- Prompt Security → SentinelOne.
- Pangea → CrowdStrike.
- CalypsoAI → F5.
- Virtue AI → Fortinet.
- Acuvity → Proofpoint.

### 12.5 The market gap Collu must own

“We display agent collaboration” is not sufficient. Existing platforms can add more traces and graph views.

Collu’s defensible wedge must be:

- The coalition is a first-class security principal.
- Every action has end-to-end influence provenance.
- Policies operate across delegation chains and combined authority.
- Independence and consensus are measured rather than assumed.
- Distributed attacks are detected across locally benign steps.
- Investigation is causal and collaboration-native.
- Containment operates on agents, identities, capabilities, memories, and edges.
- Counterfactual replay and collaboration-specific red teaming improve confidence.

---

## 13. Positioning and category language

Possible category names:

- **Agent Collaboration Security**
- **Multi-Agent Detection and Response**
- **Multi-Agent Runtime Security**
- **Agent Mesh Security**
- **Coalition Detection and Response**

“Collusion detection” alone is probably too narrow for the first buyer. It sounds primarily like an antitrust or market-surveillance product and creates an expectation that Collu can infer intent from ambiguous behavior. Collusion should be the flagship long-term threat, while the initial category covers collaboration attacks and collective failures more broadly.

### One-sentence pitch

> Collu is the runtime security layer for multi-agent systems: it shows how agents influence one another, detects when individually valid actions combine into an attack, and stops the smallest part of the collaboration needed to contain it.

### Outside-attacker pitch

> An attacker only needs to compromise one agent or one piece of context. Collu prevents them from using agent collaboration as a network for lateral movement, privilege escalation, persistence, and coordinated execution.

### Product pitch

> Collu sits between collaborating agents, shared memory, and tools. It gives every interaction identity and provenance, evaluates actions against the complete causal chain, and can allow, redact, require approval, block, or quarantine in real time.

### Investor shorthand

> CrowdStrike for agent collaboration.

---

## 14. Buyer and workflow

### Likely initial buyers

- CISO or AI security leader.
- AI platform or infrastructure team.
- Application security and product security teams.
- SOC and incident-response teams.
- Model-risk and AI-governance teams in regulated enterprises.

### How the customer uses Collu

1. The AI platform team installs the SDK, sidecar, or collaboration gateway.
2. Collu discovers agents, relationships, tools, data, memories, and identities.
3. Security turns on monitor mode and receives collaboration replays and policy findings.
4. The team tunes high-confidence rules and integrates alerts with its SIEM or case-management system.
5. Enforcement is enabled first for high-risk actions such as payments, production deployment, credential access, destructive data operations, and unapproved egress.
6. During an incident, the SOC sees the complete causal chain and can quarantine only the affected subgraph.

### Deployment requirements

Because Collu will observe extremely sensitive prompts, data, identities, and actions, enterprise deployment likely requires:

- Customer-controlled VPC or self-hosted options.
- Encryption and strict data minimization.
- Configurable content capture and hashing.
- Strong tenant isolation.
- Tamper-evident audit storage.
- Low-latency local enforcement.
- Redaction before telemetry leaves the runtime.

---

## 15. Defensibility and moat

The UI and interaction graph are not the moat. Potential defensibility comes from:

- A normalized, cross-framework event and identity model for agent collaboration.
- Deep placement at A2A, MCP, orchestration, memory, and tool boundaries.
- A policy language for causal chains, delegation, independence, and coalition authority.
- A proprietary corpus of real multi-agent attacks and failures.
- Collaboration-specific detections and response playbooks.
- Counterfactual replay and adversarial simulation.
- Accurate behavioral baselines for roles and coalitions.
- An integration ecosystem spanning frameworks, cloud platforms, memories, tools, and SIEMs.
- Trust earned through privacy-preserving and self-hosted deployment.

The data moat is useful only if customers are willing to share or federate learnings. Collu should not assume it can centralize raw enterprise interaction data. Detection intelligence may need to be learned from red-team simulations, anonymized signals, customer-approved contributions, or local/federated approaches.

---

## 16. Major product risks and unresolved questions

### Control-point coverage

Can Collu reliably intercept collaboration across in-process agents, external agents, hosted SaaS agents, proprietary orchestrators, direct API calls, shared databases, and covert channels? Coverage will always be partial, so the product must clearly distinguish enforced, observed, and blind surfaces.

### Latency

Inline semantic and graph analysis could slow agents materially. Collu should not sit synchronously in front of every token or low-risk message. The product needs a fast path for deterministic identity, provenance, and policy checks at trust crossings and high-risk action boundaries, with lower-risk telemetry and expensive analysis handled asynchronously.

### False positives

Legitimate collaboration can resemble collusion. Correlated actions may come from common models, shared data, a common objective, or changing market conditions. Ambiguous findings should begin as evidence-backed alerts rather than automatic blocks.

### Provenance through transformation

Exact-string taint tracking is insufficient when an agent summarizes, paraphrases, encodes, or operationalizes an instruction. Collu needs an explainable, probabilistic influence model without pretending to read private model cognition. “Complete lineage” is defensible only for instrumented surfaces; semantic provenance through arbitrary transformation can produce evidence, not mathematical certainty.

### Cross-organizational systems

Collu may see only one side of an A2A interaction. Signed identity, attestation, capability tokens, and portable provenance can help, but full visibility requires ecosystem cooperation.

### Adversarial adaptation

Attackers and compromised agents may learn the monitoring policy, distribute activity below thresholds, use timing or other covert channels, or fabricate benign rationales. Detection cannot depend solely on agent-produced explanations.

### Sensitive telemetry

The product itself becomes a high-value repository of prompts, identities, data paths, and credentials—and an inline Collu component becomes part of the customer’s trust root. A Collu compromise could be catastrophic. Data minimization, customer-controlled deployment, scoped signing keys, hardware-backed key storage where appropriate, component attestation, immutable audit trails, and strict separation of policy administration from runtime enforcement are core product requirements, not compliance afterthoughts. Customers will also need explicit fail-open, fail-closed, degraded-mode, and audited break-glass behavior.

### Buyer urgency

True algorithmic collusion incidents may be too early or difficult to prove. The initial product must solve immediate problems—prompt-injection propagation, permission laundering, identity compromise, shared-memory poisoning, and distributed attack chains—without requiring the buyer to believe a future market thesis.

### Efficacy validation

The industry lacks neutral benchmarks for multi-agent attack detection. Collu will need a transparent evaluation suite with reproducible attack scenarios, latency measurements, false-positive rates, and explicit protection boundaries.

### Product boundary

Collu should decide whether it is primarily:

- A security gateway in the data path.
- An XDR-style investigation product.
- An identity and authorization layer.
- A multi-agent test and simulation platform.
- A market-surveillance product.

The working recommendation is: **gateway plus investigation and response**, with identity, testing, and market analytics supporting that core.

---

## 17. Product roadmap

### Phase 1: Deterministic collaboration security

Instrument one enterprise coding-and-deployment workflow. Establish agent identity, signed event envelopes, delegation ancestry, external-input provenance, independence checks, and inline policies at high-risk actions. Ship session replay, an incident graph, and a small set of containment actions. The central proof is that an external attacker’s instruction can traverse multiple individually legitimate agents yet still be stopped before impact.

### Phase 2: Multi-agent detection and response

Expand integrations and add role and coalition baselines, distributed low-and-slow attack detection, shared-memory poisoning detection, identity-drift alerts, counterfactual replay, and more selective containment. At this stage Collu becomes a true investigation-and-response layer across several agent frameworks rather than a policy gateway for one workflow.

### Phase 3: Emergent and algorithmic collusion

Apply the accumulated collaboration graph, attack corpus, and causal models to tacit coordination, false consensus, coalition formation, bidding and pricing behavior, and cross-organizational agent markets. This phase requires domain-specific evidence standards and may be sold to compliance, model-risk, marketplace, or regulatory buyers rather than through the original CISO motion.

The sequence matters: Collu earns the right to make behavioral-collusion claims by first becoming the trusted control and evidence layer for concrete collaboration attacks.

---

## 18. Recommended next steps

1. **Choose the initial workflow.**  
   Use a coding-agent chain with planner, researcher, coder, reviewer, and deployer roles.

2. **Write ten concrete attacks.**  
   Include external prompt-injection propagation, fake reviewer, replayed approval, privilege laundering, poisoned shared memory, malicious MCP server, agent modification, Sybil approval, distributed exfiltration, and telemetry suppression.

3. **Specify the event envelope.**  
   Define identities, parentage, provenance, capability delegation, trust labels, version hashes, policy decisions, and signatures.

4. **Define five deterministic policies.**  
   They should be demonstrably useful without an ML detector.

5. **Build one end-to-end demo.**  
   Poison a GitHub issue, allow the influence to traverse several agents, and have Collu block the production action while displaying the causal chain.

6. **Design the incident experience.**  
   The console must make the attack legible in seconds: root source, affected agents, delegated authority, planned action, policy violated, and available containment actions.

7. **Interview the right people.**  
   Speak with AI platform leads, product security, SOC leaders, and teams operating multi-agent coding or operations workflows. Test whether they will place an inline control in the agent data path.

8. **Perform a focused competitive teardown.**  
   Test how Palo Alto, Cisco/Splunk, Noma, Obsidian, Zenity, Onyx, and CrowdStrike represent A2A interaction, provenance, delegation, coalition risk, and containment.

9. **Create a collaboration-security benchmark.**  
   A public test suite could establish the category and become a distribution channel.

10. **Delay tacit-collusion claims until the telemetry exists.**  
    Build the collaboration graph and attack corpus first; then add graph, causal, and economic detectors.

---

## 19. Current synthesis

Collu should not begin as a broad promise to detect every form of agent collusion. It should begin as a concrete security product for a clear present-day problem:

> Multi-agent systems create attack paths that cross agent, identity, memory, and tool boundaries. Existing controls evaluate the pieces. Collu evaluates and controls the path.

The initial product is an inline collaboration gateway with a causal interaction graph and response console. It gives every collaboration event an identity and provenance envelope, evaluates consequential actions against the complete ancestry that produced them, and can block or contain malicious paths in real time.

The near-term wedge is externally induced collaboration attacks in enterprise coding and operations workflows. The longer-term platform expands into behavioral coalition detection, false-consensus analysis, autonomous-market surveillance, and true algorithmic collusion detection.

The enduring thesis is simple:

> The next security boundary is not the agent. It is the relationship between agents.
