# Takumi Fresh ArXiv Research Report — 2025–2026

> Research date: March 2026
> Scope: Reinforcement Learning, Deep Learning, Neural Networks, Unsupervised Learning / Dimensionality Reduction — as applicable to AI coding agents (Takumi).
> Cross-referenced with: pi-mono codebase analysis + Takumi gap table.

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Category A — Reinforcement Learning for Agentic Tool Use](#category-a--reinforcement-learning-for-agentic-tool-use)
3. [Category B — Agent Memory, Context Compression & Dimensionality Reduction](#category-b--agent-memory-context-compression--dimensionality-reduction)
4. [Category C — Deep Learning Architectures for Agents](#category-c--deep-learning-architectures-for-agents)
5. [Category D — Skills, Self-Evolution & Agent Ecosystems](#category-d--skills-self-evolution--agent-ecosystems)
6. [Pi-Mono Gap Table (Updated)](#pi-mono-gap-table-updated)
7. [Proposed Takumi Phases](#proposed-takumi-phases)

---

## Executive Summary

The arXiv landscape for coding agent research in 2025–2026 has **exploded** along three major axes:

1. **Agentic RL** — Moving far beyond simple RLHF to multi-turn, multi-step tool-use RL with structured rewards (checklist rewards, error-localized credit, entropy-aware token reweighting).
2. **Memory Architecture** — Indexed experience memory (Memex), hierarchical compression (Hippocampus), reversible context compression (R³Mem), and goal-directed search over uncompressed memory (SUMER) are replacing naive summarization.
3. **Skill Ecosystems** — The `SKILL.md` specification, progressive context loading, and autonomous skill discovery (SEAgent) have been formalized as a research area.

**Key insight for Takumi**: The gap between Takumi and SOTA is not in the LLM loop or TUI — it's in **memory architecture** (our compaction is lossy) and **skills/tool discovery** (we have none). These are now well-studied with concrete frameworks we can adapt.

---

## Category A — Reinforcement Learning for Agentic Tool Use

### A1. CM² — Checklist Rewards for Multi-Turn Tool Use
- **Paper**: [arXiv:2602.12268](https://arxiv.org/abs/2602.12268) (Feb 2026)
- **Key Idea**: Replaces verifiable outcome rewards with **checklist rewards** — each turn's intended behavior decomposes into fine-grained binary criteria with evidence grounding.
- **Takumi Relevance**: Our tool invocation quality scoring could adopt checklist-style evaluation. Instead of binary "did it work?", each tool call gets scored on: correct params? right timing? minimal redundancy? output used?
- **Impact**: HIGH — applies directly to Chitragupta observation quality scoring (C6-C8).

### A2. ELPO — Error-Localized Policy Optimization
- **Paper**: [arXiv:2602.09598](https://arxiv.org/abs/2602.09598) (Feb 2026)
- **Key Idea**: Localizes the **first irrecoverable step** in a trajectory via binary-search rollout trees. Applies error-localized adaptive clipping to strengthen corrective updates.
- **Takumi Relevance**: Our reflexion-lite system already does trajectory analysis. ELPO's binary-search for first-failure is a concrete algorithm we could adopt for post-mortem analysis.
- **Impact**: MEDIUM-HIGH — upgrades reflexion-lite from pattern matching to principled credit assignment.

### A3. ResT — Entropy-Informed Token Reweighting for Tool Use
- **Paper**: [arXiv:2509.21826](https://arxiv.org/abs/2509.21826) (Sep 2025, ICLR 2026)
- **Key Idea**: Establishes theoretical link between policy entropy and training stability. Progressively upweights reasoning tokens as training proceeds. Entropy-aware scheme enables smooth shift from structural correctness to semantic reasoning.
- **Takumi Relevance**: For local model fine-tuning or when Chitragupta does model training — token-level awareness of tool-call structure vs. reasoning.
- **Impact**: MEDIUM — more relevant to model training (Chitragupta-side) than agent runtime.

### A4. ASTER — Interaction-Dense Cold Start for Tool RL
- **Paper**: [arXiv:2602.01204](https://arxiv.org/abs/2602.01204) (Feb 2026)
- **Key Idea**: Addresses "interaction collapse" where models degenerate into heavy internal reasoning with trivial tool use. Just **4K interaction-dense trajectories** as cold-start yields best downstream RL performance.
- **Takumi Relevance**: Our tool-call patterns could benefit from a curated set of "exemplar trajectories" that demonstrate dense, multi-tool workflows as context priming.
- **Impact**: MEDIUM — could improve system prompt design / skill examples.

### A5. SGE — Strategy-Guided Exploration
- **Paper**: [arXiv:2603.02045](https://arxiv.org/abs/2603.02045) (Mar 2026)
- **Key Idea**: Explores in **strategy space** rather than action space. Generates natural-language strategies first, then conditions actions on them. Mixed-temperature sampling for diverse strategies + strategy reflection grounded on previous outcomes.
- **Takumi Relevance**: Directly applicable to our agent loop. Instead of just sending "use tools to solve X", we could have a strategy-generation phase that plans the approach, then the execution phase uses that strategy. Strategy reflection maps cleanly to reflexion-lite.
- **Impact**: HIGH — fits naturally into dual-loop architecture (pi-mono's follow-up queue pattern).

### A6. CLEANER — Self-Purified Trajectories
- **Paper**: [arXiv:2601.15141](https://arxiv.org/abs/2601.15141) (Jan 2026)
- **Key Idea**: SAAR (Similarity-Aware Adaptive Rollback) mechanism autonomously constructs clean trajectories by replacing failures with successful self-corrections. Adaptively regulates replacement granularity via semantic similarity.
- **Takumi Relevance**: For our compaction system — instead of summarizing the full messy trajectory, we could first "purify" it by replacing error-recovery loops with just the successful resolution.
- **Impact**: MEDIUM — improves compaction quality.

### A7. ASTRA — Automated Trajectory Synthesis + Verifiable RL
- **Paper**: [arXiv:2601.21558](https://arxiv.org/abs/2601.21558) (Jan 2026)
- **Key Idea**: Two components: (1) pipeline synthesizing diverse trajectories from tool-call graph topology, (2) environment synthesis converting decomposed QA traces into code-executable, rule-verifiable environments. Integrates SFT with online RL using trajectory-level rewards.
- **Takumi Relevance**: The tool-call graph topology idea is powerful — we could model our tool registry as a graph and discover common execution patterns automatically.
- **Impact**: MEDIUM — applies to tool orchestration patterns.

### A8. VerlTool — Unified Framework for Agentic RL with Tools
- **Paper**: [arXiv:2509.01055](https://arxiv.org/abs/2509.01055) (Sep 2025)
- **Key Idea**: Standardized tool management APIs supporting diverse modalities. **Asynchronous rollout execution** achieving near 2× speedup by eliminating synchronization bottlenecks. Modular plugin architecture for rapid tool integration.
- **Takumi Relevance**: Our tool registry already has a plugin pattern but lacks async rollout capability. The standardized tool API concept aligns with MCP.
- **Impact**: MEDIUM — validates our architecture direction.

### A9. Agent World Model — Synthetic Environments for RL
- **Paper**: [arXiv:2602.10090](https://arxiv.org/abs/2602.10090) (Feb 2026)
- **Key Idea**: Fully synthetic, code-driven environments backed by databases for reliable state transitions. Scales to 1000 environments with 35 tools per environment. Enables reliable reward functions via accessible database states.
- **Takumi Relevance**: For evaluation/testing — we could generate synthetic coding scenarios with known-correct outcomes to evaluate agent behavior.
- **Impact**: LOW-MEDIUM — more relevant to evaluation infrastructure.

### A10. ToolTrain — Tool-Integrated RL for Repo Deep Search
- **Paper**: [arXiv:2508.03012](https://arxiv.org/abs/2508.03012) (Aug 2025)
- **Key Idea**: Two-stage framework: rejection-sampled SFT + tool-integrated RL for issue localization. 32B model surpasses Claude-3.7 on function-level localization.
- **Takumi Relevance**: Our codebase navigation tools (grep, semantic search, file read) could benefit from RL-trained selection patterns.
- **Impact**: MEDIUM — the localization pipeline maps to our search strategy.

### A11. AutoTool — Dynamic Tool Selection with KL-Regularized Ranking
- **Paper**: [arXiv:2512.13278](https://arxiv.org/abs/2512.13278) (Dec 2025, Best Paper ICCV 2025 Workshop)
- **Key Idea**: KL-regularized Plackett-Luce ranking for consistent multi-step tool selection across 1000+ tools. Dual-phase: supervised stabilization + RL ranking refinement.
- **Takumi Relevance**: Our model-router could use similar ranking for tool selection when many tools are available. Currently we rely on the LLM's native tool selection which degrades with more tools.
- **Impact**: HIGH — directly applicable to tool selection optimization.

### A12. CaveAgent — LLM as Stateful Runtime Operator
- **Paper**: [arXiv:2601.01569](https://arxiv.org/abs/2601.01569) (Jan 2026)
- **Key Idea**: Dual-stream architecture: persistent Python runtime as central state locus, lightweight semantic stream as orchestrator. Runtime-integrated skill management extending Agent Skills open standard. Objects persist across turns.
- **Takumi Relevance**: We could adopt the "stateful runtime" concept where tool results persist in a structured state object rather than just conversation context. Aligns with pi-mono's file operation tracking.
- **Impact**: HIGH — addresses our context drift problem in long sessions.

### A13. ToolMaster — Trial-and-Execution for Unseen Tools
- **Paper**: [arXiv:2601.12762](https://arxiv.org/abs/2601.12762) (Jan 2026)
- **Key Idea**: Shifts from memorizing tool trajectories to **trial-and-execution paradigm** — agents first trial tool usage with self-correction, then RL optimizes the joint process.
- **Takumi Relevance**: For MCP tool discovery — when we encounter a new MCP server's tools, we could use a trial phase to learn tool behavior before committing to a strategy.
- **Impact**: MEDIUM — applies to MCP tool onboarding.

### A14. daVinci-Dev — Agent-Native Mid-Training for SE
- **Paper**: [arXiv:2601.18418](https://arxiv.org/abs/2601.18418) (Jan 2026)
- **Key Idea**: "Agent-native data" — two types: contextually-native trajectories (complete information flow) and environmentally-native trajectories (from executable repos with actual tool invocations). 56.1% on SWE-Bench Verified with 32B model.
- **Takumi Relevance**: Validates the approach of capturing complete agent trajectories for training. Our Chitragupta telemetry already captures this data format.
- **Impact**: MEDIUM — confirms our telemetry architecture direction (Darpana + Chitragupta).

### A15. CRINN — Contrastive RL for Approximate Nearest Neighbor Search
- **Paper**: [arXiv:2508.02091](https://arxiv.org/abs/2508.02091) (Aug 2025)
- **Key Idea**: Treats ANNS optimization as RL problem where execution speed is the reward. LLMs + RL automatically generate progressively faster ANNS implementations.
- **Takumi Relevance**: Could apply to our semantic search / RAG indexing — RL-optimized vector search for codebase navigation.
- **Impact**: LOW-MEDIUM — niche but interesting for our search subsystem.

---

## Category B — Agent Memory, Context Compression & Dimensionality Reduction

### B1. Memex(RL) — Indexed Experience Memory ⭐⭐⭐
- **Paper**: [arXiv:2603.04257](https://arxiv.org/abs/2603.04257) (Mar 2026)
- **Key Idea**: **Compresses context without discarding evidence.** Maintains compact working context of structured summaries + stable indices. Full-fidelity interactions stored in external experience database under those indices. Agent learns **what to summarize, what to archive, how to index, when to retrieve** via RL with reward shaping for memory usage under context budget.
- **Takumi Relevance**: THIS IS THE PAPER. Our compaction is lossy — Memex solves exactly this problem. Instead of summarizing and losing detail, we should index and retrieve on demand. Maps directly to pi-mono's "file operation tracking in compaction" gap.
- **Impact**: CRITICAL — should be the foundation for our next compaction phase.

### B2. SUMER — Goal-Directed Search Over Uncompressed Memory
- **Paper**: [arXiv:2511.21726](https://arxiv.org/abs/2511.21726) (Nov 2025)
- **Key Idea**: End-to-end RL agent learns to use search tools to gather information from uncompressed memory. Outperforms ALL memory compression approaches and full-context baseline (43% gain). Key insight: **a simple search over raw data outperforms goal-agnostic compression**.
- **Takumi Relevance**: Instead of compressing conversation history, we store raw turns and teach the agent to search through them. Our compaction could be replaced with indexed raw storage + search.
- **Impact**: HIGH — validates the "don't compress, search instead" paradigm.

### B3. ACON — Agent Context Optimization (Microsoft)
- **Paper**: [arXiv:2510.00615](https://arxiv.org/abs/2510.00615) (Oct 2025)
- **Key Idea**: Compression guideline optimization in natural language space. Given paired trajectories where full context succeeds but compressed fails, an LLM analyzes failure causes and updates the guideline. Distill into smaller models. **Reduces memory 26-54% while preserving 95%+ accuracy.**
- **Takumi Relevance**: Our compaction guidelines could be auto-optimized this way. Instead of hand-crafted compaction prompts, we learn them from failure analysis.
- **Impact**: HIGH — practical, immediately applicable to our compaction system.

### B4. Hippocampus — Binary-Signature Memory with Dynamic Wavelet Matrix
- **Paper**: [arXiv:2602.13594](https://arxiv.org/abs/2602.13594) (Feb 2026)
- **Key Idea**: Compact binary signatures for semantic search + lossless token-ID streams for exact reconstruction. Dynamic Wavelet Matrix compresses and co-indexes both streams. **31× reduction in retrieval latency, 14× cut in per-query token footprint.**
- **Takumi Relevance**: For our session storage and history retrieval. Instead of JSONL files, we could use wavelet-indexed binary storage for O(1) semantic search.
- **Impact**: MEDIUM-HIGH — relevant to session management, less directly to compaction.

### B5. R³Mem — Reversible Context Compression
- **Paper**: [arXiv:2502.15957](https://arxiv.org/abs/2502.15957) (Feb 2025)
- **Key Idea**: Virtual memory tokens compress infinitely long histories. Hierarchical compression from document-level to entity-level. **Reversible architecture** — reconstructs raw data by invoking model backward with compressed info. Parameter-efficient fine-tuning, plug-in for any Transformer.
- **Takumi Relevance**: The reversibility concept is powerful — compress aggressively but be able to reconstruct when needed. Pairs with Memex's index-and-retrieve paradigm.
- **Impact**: MEDIUM — requires model-level integration, not just orchestration changes.

### B6. RocketKV — Two-Stage KV Cache Compression
- **Paper**: [arXiv:2502.14051](https://arxiv.org/abs/2502.14051) (Feb 2025, ICML 2025)
- **Key Idea**: Two-stage KV cache compression for long-context inference. Reduces memory footprint while maintaining performance.
- **Takumi Relevance**: Less directly applicable since we use API-based LLMs, but relevant if we ever run local models.
- **Impact**: LOW — API-dependent, not applicable now.

---

## Category C — Deep Learning Architectures for Agents

### C1. DeepAgent — Autonomous Memory Folding + ToolPO ⭐⭐
- **Paper**: [arXiv:2510.21618](https://arxiv.org/abs/2510.21618) (Oct 2025, WWW 2026)
- **Key Idea**: **Autonomous memory folding** compresses past interactions into structured episodic, working, and tool memories. **ToolPO** — tool-call advantage attribution assigns fine-grained credit to tool invocation tokens.
- Three memory types:
  - **Episodic memory**: Past interaction summaries
  - **Working memory**: Current task context
  - **Tool memory**: Tool usage patterns and results
- **Takumi Relevance**: Our compaction produces a single flat summary. DeepAgent's tripartite memory (episodic/working/tool) is a much better model, especially tool memory tracking — directly addresses our "loses file awareness after compaction" gap with pi-mono.
- **Impact**: HIGH — tripartite memory model should inform our next compaction redesign.

### C2. Agent0 — Self-Evolving Agents via Curriculum Co-Evolution
- **Paper**: [arXiv:2511.16043](https://arxiv.org/abs/2511.16043) (Nov 2025)
- **Key Idea**: Two agents from same base: **curriculum agent** proposes increasingly challenging tasks, **executor agent** solves them. Symbiotic competition creates self-reinforcing improvement cycle. +18% math reasoning, +24% general reasoning from base.
- **Takumi Relevance**: For our eval/benchmarking system. Instead of static test cases, we could have an adversarial curriculum that generates increasingly hard coding tasks.
- **Impact**: MEDIUM — applies to evaluation infrastructure (Darpana evolution).

### C3. EvolveR — Self-Evolving via Experience-Driven Lifecycle
- **Paper**: [arXiv:2510.16079](https://arxiv.org/abs/2510.16079) (Oct 2025)
- **Key Idea**: Two stages: (1) Offline Self-Distillation — synthesize interaction trajectories into abstract, reusable strategic principles; (2) Online Interaction — retrieve principles to guide decisions. Policy reinforcement updates based on performance.
- **Takumi Relevance**: Our extension system could support "principle extraction" from successful sessions. The agent distills what worked into reusable strategies, stored as skills or preferences.
- **Impact**: MEDIUM-HIGH — aligns with our extension evolution hooks (Phase 54).

### C4. CodeGym — Synthetic Multi-Turn Tool-Use Environments
- **Paper**: [arXiv:2509.17325](https://arxiv.org/abs/2509.17325) (Sep 2025)
- **Key Idea**: Rewrites static coding problems into interactive environments by extracting atomic functions into callable tools. Verifiable tasks spanning various tool-execution workflows. Qwen2.5-32B achieves +8.7 on τ-Bench OOD.
- **Takumi Relevance**: For testing our agent — we could decompose known coding problems into tool-use scenarios and validate our loop handles them correctly.
- **Impact**: LOW-MEDIUM — testing infrastructure.

---

## Category D — Skills, Self-Evolution & Agent Ecosystems

### D1. Agent Skills Survey — Architecture, Acquisition, Security ⭐⭐⭐
- **Paper**: [arXiv:2602.12430](https://arxiv.org/abs/2602.12430) (Feb 2026)
- **Key Idea**: Comprehensive survey of the agent skills landscape. Four axes:
  1. **Architecture**: `SKILL.md` specification, progressive context loading, MCP complementarity
  2. **Acquisition**: RL with skill libraries, autonomous skill discovery (SEAgent), compositional synthesis
  3. **Deployment**: CUA stack, GUI grounding, SWE-bench
  4. **Security**: 26.1% of community skills have vulnerabilities → **Skill Trust and Lifecycle Governance Framework** with four-tier gate-based permission model
- **Takumi Relevance**: We have NO skills system. Pi-mono has one (lazy-loaded markdown, 3-tier discovery). This paper provides the complete academic framework for building one.
- **Impact**: CRITICAL — foundational reference for our skills system phase.

### D2. Klear-AgentForge — Open-Source Agentic Post-Training Pipeline
- **Paper**: [arXiv:2511.05951](https://arxiv.org/abs/2511.05951) (Nov 2025)
- **Key Idea**: Fully open-source pipeline for training high-performance agentic models. Addresses the gap of missing critical post-training details in the open-source community.
- **Takumi Relevance**: Reference for when we build local model training capabilities in Chitragupta.
- **Impact**: LOW-MEDIUM — future reference.

---

## Pi-Mono Gap Table (Updated with ArXiv Insights)

| Pi Feature | Takumi Status | ArXiv Paper(s) | Recommended Approach |
|---|---|---|---|
| **Iterative compaction** (update summary, don't re-summarize) | Full re-summarize | **Memex(RL)** [B1], **ACON** [B3], **DeepAgent** [C1] | Adopt Memex indexed memory + ACON guideline optimization + DeepAgent tripartite memory model |
| **File operation tracking in compaction** | Not tracked | **DeepAgent** [C1] tool memory, **CaveAgent** [A12] stateful runtime | Implement persistent tool-state that survives compaction |
| **Skills system** (markdown, 3-tier discovery) | None | **Agent Skills Survey** [D1], **CaveAgent** [A12] runtime skills | Build SKILL.md-compatible system with progressive disclosure |
| **Steering interruption** (skip in-flight tools) | Basic steering | **ResT** [A3] entropy-aware reweighting | Add tool-call cancellation with entropy-based priority |
| **Dual-loop architecture** | Single loop | **SGE** [A5] strategy-then-action | Add strategy-generation phase before tool execution |
| **Session tree + branch summarization** | Linear sessions | **Memex(RL)** [B1] indexed branching | Implement tree-structured sessions with indexed experience |
| **RPC mode** (headless JSON) | No headless mode | (architecture, not research) | Standard implementation |
| **Model glob scoping** | Manual switching | **AutoTool** [A11] dynamic selection + ranking | KL-regularized tool/model ranking |
| **`transformContext` hook** | No pre-LLM transform | (architecture, not research) | Extension event: `agent_before_llm` |
| **Fuzzy edit matching** | Basic matching | (engineering, not research) | Unicode normalization, BOM-aware |
| **Prompt templates** with substitution | None | **Agent Skills** [D1] progressive context loading | `$1`/`$@` bash-style in skill system |
| **Extension tool wrapping** | Simpler extensions | **CaveAgent** [A12] runtime skill injection | Add `tool_before_invoke` / `tool_after_invoke` hooks |

---

## Proposed Takumi Phases

Based on the combined insights from arXiv research and pi-mono gap analysis, here are the recommended next phases, **ordered by impact and feasibility**:

### Phase 55: Indexed Experience Memory (Memex-Style Compaction)
**Priority: P0 — Critical**
**Papers**: Memex(RL), SUMER, ACON, DeepAgent

Replace our current lossy compaction with indexed experience memory:
- Maintain compact working context with structured summaries + stable indices
- Store full-fidelity interactions in an external session database (JSONL segments)
- Agent can dereference indices to recover exact past evidence
- Tripartite memory: episodic (session summaries), working (current task), tool (file ops + tool results)
- Compression guidelines auto-optimized via ACON's failure-analysis approach
- File operation tracking persists across compactions

**Why now**: This is our #1 gap — lossy compaction causes the most user-visible failures in long sessions.

### Phase 56: Skills System
**Priority: P0 — Critical**
**Papers**: Agent Skills Survey, CaveAgent

Build a `SKILL.md`-compatible skills ecosystem:
- Skills = markdown files with YAML frontmatter (title, description, tools, permissions)
- Progressive context loading (3-tier: name-only → summary → full body)
- `.gitignore`-aware scanning of project `.takumi/skills/` and global `~/.takumi/skills/`
- `disable-model-invocation` flag for security-sensitive skills
- Skill Trust governance: built-in → verified → community → untrusted tiers
- XML formatting in system prompt for discovered skills
- Prompt templates with `$1`/`$@` substitution

**Why now**: Pi-mono has it, the research provides the security framework, and users are asking for it.

### Phase 57: Strategy-Guided Dual Loop
**Priority: P1 — High**
**Papers**: SGE, ELPO

Restructure agent loop into strategy-then-execution:
- Strategy phase: generate natural-language strategy for the task
- Execution phase: tool calls conditioned on strategy
- Strategy reflection: after execution, evaluate strategy effectiveness
- Error localization: binary-search style identification of first-failure point
- Follow-up queue (pi-mono pattern): separate from main loop steering

**Why now**: This addresses our single-loop limitation and directly improves task completion rates.

### Phase 58: Stateful Tool Runtime
**Priority: P1 — High**
**Papers**: CaveAgent

Introduce persistent state for tool results:
- Tool outputs stored in structured state object, not just conversation context
- State survives compaction (it IS the tool memory from Phase 55's tripartite model)
- File read results, grep results, directory listings cached in state
- Tools can reference previous tool outputs by key rather than repeating content
- Extension hooks: `tool_before_invoke`, `tool_after_invoke` for wrapping/interception

**Why now**: Directly addresses context drift in long sessions. CaveAgent's approach is proven.

### Phase 59: Dynamic Tool Selection & Ranking
**Priority: P2 — Medium**
**Papers**: AutoTool, ToolMaster

When many tools are available (native + MCP), optimize selection:
- KL-regularized Plackett-Luce ranking for consistent multi-step tool selection
- Trial-and-execution paradigm for unfamiliar MCP tools
- Checklist-style quality scoring for tool invocations (CM² approach)
- Tool-call graph topology analysis for pattern discovery

### Phase 60: Self-Evolving Agent Principles
**Priority: P2 — Medium**
**Papers**: EvolveR, Agent0

Enable the agent to distill successful strategies:
- Offline: Synthesize session trajectories into abstract strategic principles
- Online: Retrieve relevant principles to guide decision-making
- Store as skills (ties into Phase 56)
- Policy reinforcement: track which principles lead to better outcomes
- Curriculum co-evolution for self-testing (ties into Darpana)

---

## Research Bibliography

| ID | Paper | Date | Venue | Key Technique |
|---|---|---|---|---|
| A1 | CM² (2602.12268) | Feb 2026 | — | Checklist rewards for agentic tool RL |
| A2 | ELPO (2602.09598) | Feb 2026 | — | Error-localized policy optimization |
| A3 | ResT (2509.21826) | Sep 2025 | ICLR 2026 | Entropy-informed token reweighting |
| A4 | ASTER (2602.01204) | Feb 2026 | — | Interaction-dense cold start for tool RL |
| A5 | SGE (2603.02045) | Mar 2026 | — | Strategy-guided exploration |
| A6 | CLEANER (2601.15141) | Jan 2026 | — | Self-purified trajectories via SAAR |
| A7 | ASTRA (2601.21558) | Jan 2026 | — | Automated trajectory synthesis |
| A8 | VerlTool (2509.01055) | Sep 2025 | — | Unified async agentic RL framework |
| A9 | AWM (2602.10090) | Feb 2026 | — | Synthetic environments for RL |
| A10 | ToolTrain (2508.03012) | Aug 2025 | — | Tool-integrated RL for repo search |
| A11 | AutoTool (2512.13278) | Dec 2025 | Best Paper ICCV 2025 | Dynamic tool selection with ranking |
| A12 | CaveAgent (2601.01569) | Jan 2026 | — | Stateful runtime operator |
| A13 | ToolMaster (2601.12762) | Jan 2026 | — | Trial-and-execution tool learning |
| A14 | daVinci-Dev (2601.18418) | Jan 2026 | — | Agent-native mid-training for SE |
| A15 | CRINN (2508.02091) | Aug 2025 | — | Contrastive RL for ANN search |
| B1 | Memex(RL) (2603.04257) | Mar 2026 | — | Indexed experience memory |
| B2 | SUMER (2511.21726) | Nov 2025 | — | Goal-directed search over raw memory |
| B3 | ACON (2510.00615) | Oct 2025 | — | Agent context compression optimization |
| B4 | Hippocampus (2602.13594) | Feb 2026 | — | Binary-signature wavelet memory |
| B5 | R³Mem (2502.15957) | Feb 2025 | — | Reversible context compression |
| B6 | RocketKV (2502.14051) | Feb 2025 | ICML 2025 | KV cache compression |
| C1 | DeepAgent (2510.21618) | Oct 2025 | WWW 2026 | Tripartite memory + ToolPO |
| C2 | Agent0 (2511.16043) | Nov 2025 | — | Curriculum co-evolution |
| C3 | EvolveR (2510.16079) | Oct 2025 | — | Experience-driven self-evolution |
| C4 | CodeGym (2509.17325) | Sep 2025 | — | Synthetic tool-use environments |
| D1 | Agent Skills (2602.12430) | Feb 2026 | — | Skills architecture survey |
| D2 | Klear-AgentForge (2511.05951) | Nov 2025 | — | Open-source agentic post-training |

---

## Top Takeaways for Takumi

1. **Stop compressing, start indexing** — The strongest signal from recent research is that lossy compaction is fundamentally flawed. Memex(RL) and SUMER prove that indexed retrieval over full history outperforms any compression scheme.

2. **Tripartite memory is the new standard** — Episodic + Working + Tool memory (DeepAgent) is how SOTA agents organize context. Our flat summary approach must evolve.

3. **Skills are now formalized** — The Agent Skills paper gives us a complete blueprint including the security model we need. Pi-mono already has a working implementation we can reference.

4. **Strategy-first, then act** — SGE's "explore in strategy space" paradigm is a clean way to get the dual-loop architecture pi-mono has, backed by research.

5. **Checklist rewards over binary outcomes** — CM²'s approach to quality scoring is directly applicable to our Chitragupta observation quality pipeline.

6. **Stateful tools, not stateless** — CaveAgent's persistent runtime concept solves context drift. Tool results should be addressable state, not conversational ephemera.
