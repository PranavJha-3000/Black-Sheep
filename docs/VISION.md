# BLACK SHEEP
## Project Vision, Research Objectives & Engineering Constitution

> A Long-Horizon Autonomous Financial Agent Laboratory.

**Status:** Authoritative product direction as of 2026-11-02. Supersedes the player-vs-AI game design in `docs/archive/BLACK-SHEEP-DESIGN-DOC.md` (archived in the Stage 1 cleanup). It does not override an already approved implementation stage or the `docs/ai/` working agreement.

**Inspiration sources (references, not templates):**
- Emergence World — https://www.emergence.ai/blog/emergence-world-a-laboratory-for-evaluating-long-horizon-agent-autonomy
- Project Napoleon — https://napole0n.ai/
- https://www.instagram.com/p/DfICrB-s3AU/

---

# 1. WHAT WE ARE BUILDING

BLACK SHEEP is a persistent, instrumented, multi-agent financial simulation platform designed to study autonomous AI behaviour over extended periods.

It contains a fictional financial economy populated by autonomous AI hedge funds. Each fund operates independently, with its own investment mandate, personality, underlying AI model, capital, risk appetite, tools and persistent memory.

The agents analyse economic conditions, research companies, develop investment theses, execute trades, manage portfolios, respond to competitors and experience the consequences of their decisions.

An intelligent Game Master, powered by Jev (TypeSafe System One), directs the economic environment through bounded market interventions.

Humans primarily observe, investigate, configure and experiment with this world rather than directly controlling a personal hedge fund.

**This is not fundamentally a stock-trading game. It is an experimental environment for studying autonomous intelligence in a complex, competitive economic system.**

# 2. PRODUCT INSPIRATION

Study the design philosophy and research methodology of:

- **Emergence World:** Persistent autonomous agents, long-horizon behaviour, memory systems, tools, world simulation, cross-model experimentation and behavioural analysis.
- **Project Napoleon:** Autonomous agents with different capabilities, strategies, objectives and competitive interactions.
- **Real financial institutions:** Investment mandates, portfolio management, risk, leverage, market dynamics and economic competition.
- **Institutional trading systems:** Information-dense interfaces, financial observability and decision analytics.

These are references for inspiration, not templates to copy.

Develop an original platform with financial markets as its experimental domain.

# 3. TWO IDENTITIES, ONE PLATFORM

BLACK SHEEP has two interconnected identities.

### A. Autonomous Financial World

A continuously evolving simulated economy where AI hedge funds operate independently.

The world should remain interesting without human intervention. Market events, investment decisions, competitive interactions, failures and recoveries should produce consequential histories.

### B. AI Research Laboratory

An experimental infrastructure for investigating:

- Autonomous agent behaviour.
- Long-horizon decision-making.
- Persistent memory and reflection.
- Multi-agent competition and emergent behaviour.
- Cross-model performance differences.
- Agent adaptation.
- AI Game Master effectiveness.
- Reasoning quality versus inference expenditure.

The research laboratory studies what happens inside the financial world.

Do not build two disconnected products. The financial simulation generates the experimental environment; the research platform instruments and evaluates it.

# 4. CORE RESEARCH QUESTIONS

BLACK SHEEP should eventually support controlled experiments around the following questions.

### Model intelligence
Do different LLMs develop different investment behaviours under identical mandates and market conditions?

### Long-horizon autonomy
Can autonomous funds maintain coherent strategies, investment theses and decision-making over extended periods?

### Persistent memory
Does episodic memory, reflection and historical context improve decision quality and reduce repeated mistakes?

### Multi-agent emergence
Do autonomous hedge funds develop herding, competition, strategic counter-positioning, behavioural influence or other emergent patterns?

### World Director
Does an intelligent Game Master produce more meaningful economic challenges than a deterministic or rule-based event director?

### Intelligence versus cost
How much additional decision quality and performance is gained through more capable models, longer context, additional reasoning and higher inference budgets?

These are research hypotheses, not predetermined conclusions. The system must collect evidence capable of supporting or rejecting them.

# 5. THE FINANCIAL WORLD

Build one persistent shared fictional economy.

The environment contains:

- Fictional companies and sectors.
- Stock prices and fundamentals.
- Market capitalization and liquidity.
- Volatility and market sentiment.
- Earnings and financial performance.
- Economic conditions and macroeconomic factors.
- Corporate announcements.
- Acquisitions, lawsuits and bankruptcies.
- Market shocks and financial crises.

Financial principles must be internally consistent.

Price movement, liquidity, price impact, portfolio accounting, leverage, shorting, margin and liquidation must follow deterministic and testable rules.

Use fictional companies initially. Do not depend on external financial APIs or real-world market data for V1.

Separate the following:

1. Fundamental company changes.
2. Market sentiment.
3. Market participant trading pressure.
4. Random economic uncertainty.
5. World Director interventions.

Do not allow an LLM to arbitrarily determine stock prices or financial outcomes.

# 6. AUTONOMOUS AI HEDGE FUNDS

Start with approximately three distinct AI hedge funds.

Possible initial personalities:

- **STERLING & VALE:** Conservative value and macro investor.
- **HALDEN WHITMORE:** Aggressive short seller and event-driven investor.
- **CROWN MERIDIAN:** Quantitative and systematic investment fund.

Each fund must have:

| Component | Responsibility |
|---|---|
| Identity | Name, personality and mandate |
| Model | Underlying LLM and version |
| Capital | Initial and current NAV |
| Portfolio | Holdings and trading history |
| Strategy | Investment philosophy |
| Risk | Exposure, leverage and limits |
| Memory | Past experiences and investment theses |
| Tools | Research and execution capabilities |
| Performance | Financial and behavioural history |
| Budget | Inference expenditure and limits |

Each fund operates independently.

Do not assume that different system prompts automatically create genuinely different personalities. Evaluate behavioural differences using actual decisions and measurable outcomes.

## Agent decision cycle

Every fund follows:

OBSERVE → RESEARCH → REASON → DECIDE → VALIDATE → EXECUTE → EXPERIENCE → REMEMBER → REFLECT

LLMs propose structured actions.

The deterministic financial engine validates and executes those actions.

Agents never directly mutate financial state or bypass execution rules.

# 7. AGENT MEMORY AND LONG-HORIZON AUTONOMY

Implement progressively sophisticated memory.

### Episodic memory
Record significant trades, events, decisions, outcomes and failures.

### Reflective memory
Summarise experiences into investment lessons, changing beliefs and strategy observations.

### Relationship memory
Record patterns of interaction with other funds, including public investment behaviour and competitive tendencies.

Memory must survive simulation restarts.

Distinguish:

- Remembering previous experiences.
- Reflecting on previous outcomes.
- Adapting future behaviour.
- Actually updating the underlying model or policy.

Do not claim learning when only persistent memory has been implemented.

# 8. JEV — THE WORLD DIRECTOR

Jev (TypeSafe System One) acts as the economic Game Master.

It is a separate intelligence system, not another hedge fund.

Its responsibilities include:

- Observing public economic conditions.
- Assessing market pressure.
- Selecting from eligible market interventions.
- Introducing economic challenges when warranted.
- Maintaining variation in the simulated environment.

Use structured, bounded decisions wherever possible.

Investigate Jev's current official API, capabilities, pricing, response contracts and usage reporting before implementation.

Its decision outputs must be validated by application logic.

The deterministic event engine remains responsible for generating and applying financial consequences.

Jev must never:
- Secretly decide which fund wins.
- Arbitrarily manipulate individual stock prices.
- Access private fund reasoning.
- Access hidden fund positions.
- Know future scheduled or unfired events.
- Bypass event cooldowns or simulation constraints.

## Evaluate the Game Master

Eventually support three experimental configurations:

1. No World Director.
2. Deterministic rule-based Director.
3. Jev-powered Director.

Compare their impact on agent behaviour, event diversity, market conditions and simulation outcomes.

The Director must be allowed to choose no intervention.

# 9. AGENT TOOL ECOSYSTEM

Agents should interact with the world through controlled tools rather than unrestricted database or application access.

Organise tools into three layers.

### Core tools
- Inspect market.
- Inspect own portfolio.
- Calculate exposure and risk.
- Research company fundamentals.
- Open and close positions.
- Short stocks.
- Inspect recent events.
- Access relevant memory.

### Complementary tools
- Compare competitors.
- Analyse sectors.
- Examine earnings.
- Investigate public disclosures.
- Analyse market correlations.
- Evaluate investment theses.

### Adaptive tools
- Advanced research capabilities.
- Conditional intelligence sources.
- Special market operations.
- Scenario-specific capabilities.

Tool availability should depend on agent permissions, simulation state and experiment configuration.

Log tool invocations, inputs, outputs, latency and consequences.

Agents must never have unrestricted access to the database or another fund's private information.

# 10. RESEARCH LAB AND EXPERIMENTATION

This is a core product subsystem, not an optional analytics screen.

Create an experimental framework supporting:

### Model benchmarking
Compare different LLMs operating under equivalent conditions.

### Memory ablations
Compare stateless agents, episodic memory, reflective memory and combined memory architectures.

### Behavioural experiments
Investigate risk appetite, strategy drift, repeated mistakes, competition and adaptation.

### World Director experiments
Compare no Director, rule-based Director and Jev-powered Director.

### Inference efficiency experiments
Compare decision frequency, model capability, context size and inference budget.

## Two simulation modes

**Mode A — Shared Live World**

A persistent economy where agents genuinely influence one another through their actions.

Purpose: study interaction and emergent behaviour.

**Mode B — Controlled Experiment Worlds**

Independent simulations initialized with equivalent configurations and controlled random seeds.

Purpose: compare models, strategies, memory configurations and World Director variants.

Support repeated runs and paired experiments.

Changing one experimental variable at a time should be possible.

Do not use a single shared-world leaderboard as proof that one model is inherently superior. Competitive interactions create confounding effects.

## Experiment reproducibility

Record:

- Simulation seed and PRNG state.
- World configuration.
- Initial conditions.
- Agent model and version.
- System prompt and configuration hashes.
- Tool permissions.
- Memory configuration.
- Decision and event sequence.
- Model parameters, where available.
- Token usage and provider costs.
- Execution outcomes.

A simulation should be reproducible to the extent supported by its deterministic components. Do not claim exact reproducibility of external LLM outputs unless demonstrated.

# 11. EVALUATION AND METRICS

Financial return alone does not measure intelligence.

Evaluate each fund across multiple dimensions.

### Financial performance
- Total return.
- Sharpe ratio.
- Maximum drawdown.
- Volatility.
- Survival rate.
- Risk-adjusted performance.
- Trading turnover.
- Position concentration.

### Behavioural performance
- Strategy consistency.
- Risk adaptation.
- Repeated decision errors.
- Investment thesis consistency.
- Reaction to market shocks.
- Behavioural diversity.
- Memory usefulness.

### AI systems performance
- Decision latency.
- Token consumption.
- Cost per decision.
- Cost per simulated day.
- Fallback rate.
- Tool-use frequency.
- Context efficiency.
- Reliability and failure rate.

### World-level performance
- Market volatility.
- Liquidity conditions.
- Event diversity.
- Market concentration.
- Frequency of extreme events.
- Fund survival distribution.

Build statistical comparisons over multiple runs.

Include baselines, confidence intervals where appropriate and clearly documented limitations.

# 12. API COST AND COMPUTE EFFICIENCY

This is a fundamental engineering constraint.

**LLMs make strategic decisions. Deterministic code runs the world.**

Never call an LLM for ordinary financial calculations, market ticks, P&L, margin or deterministic event processing.

Implement:

- Scheduled and event-triggered decisions.
- Material-change detection.
- Per-agent cooldowns.
- Global and per-agent spending limits.
- Provider-aware usage metering.
- Atomic budget reservations.
- Concurrency limits.
- Structured compact prompts.
- Persistent summarised memory.
- Deterministic fallback policies.
- Usage, latency and failure analytics.

Track Jev and hedge-fund providers independently.

No agent should continue making API calls after its budget is exhausted.

Do not sacrifice information isolation to reduce API costs.

# 13. OBSERVABILITY INTERFACE

The UI should resemble an institutional financial intelligence terminal.

Dark, minimal, technical and information-dense.

It is an observation and research interface, not a conventional gaming dashboard.

Core navigation:

1. WORLD — overall financial conditions and market activity.
2. FUNDS — all autonomous hedge funds and performance.
3. FUND DETAIL — individual portfolio, memory, decisions and strategy.
4. ACTIVITY — live actions, tool invocations and event history.
5. TIMELINE — historical simulation replay.
6. RESEARCH LAB — experiment configuration and management.
7. ANALYTICS — model comparison, behavioural results and costs.

The observer should be able to investigate why a fund made a decision, what information it had, which tools it used and what happened afterward.

Public observation and privileged experiment configuration must have separate authorization boundaries.

# 14. TECHNICAL ARCHITECTURE

Preserve the existing repository and stack unless a concrete engineering reason justifies changing them.

Preferred stack:

- Frontend: React, TypeScript, Vite, Tailwind and Zustand.
- Backend: Node.js and Express.
- Database: PostgreSQL and Prisma.
- Financial simulation: Pure TypeScript shared engine.
- Agent orchestration: Server-side provider adapters.
- Persistence: Database-backed world, fund, event and decision state.
- Testing: Existing Vitest infrastructure.

## Architectural invariants

1. The server is authoritative for world state.
2. The global financial world must persist across restarts.
3. There must be one coordinated writer for shared world mutations.
4. AI decisions must be isolated by agent permissions.
5. External LLM calls must never hold financial-state locks.
6. All AI actions pass through validated execution paths.
7. Market randomness must be seedable and recorded.
8. Critical state changes must be auditable.
9. Provider credentials stay server-side.
10. The pure simulation engine has zero UI, network, database or provider dependencies.

Use asynchronous orchestration where appropriate without sacrificing deterministic financial-state processing.

# 15. INITIAL DEVELOPMENT SCOPE

Do not attempt to build the entire research laboratory immediately.

Establish the foundation progressively:

### Initial simulation
- One persistent financial world.
- Approximately 10 fictional companies.
- Three autonomous hedge funds.
- Distinct investment strategies.
- Basic financial trading and risk.
- Persistent agent decision histories.
- Market events.
- One rule-based fallback for each fund.
- Server-authoritative simulation.

### Initial research foundation
- Model and configuration registry.
- Seeded experiment configuration.
- Structured agent decision logs.
- Token and cost accounting.
- Basic performance and risk metrics.
- Reproducibility metadata.
- Observation dashboard.

### Progressive capabilities
- Jev World Director.
- Advanced episodic and reflective memory.
- Multiple controlled experiment worlds.
- Cross-model benchmarking.
- Ablation studies.
- Behavioural analysis.
- Historical replay.
- Automated research reports.

Complex derivatives, human-controlled trading, multiplayer, real-money functionality, NFTs, agent departments and unnecessary gamification are outside the initial scope.

# 16. RESEARCH AND PORTFOLIO DELIVERABLES

BLACK SHEEP should produce tangible engineering and research evidence.

Eventually develop:

1. **Architecture report:** Persistent multi-agent simulation and orchestration architecture.
2. **Model evaluation report:** Controlled comparison of LLM-based financial agents.
3. **Memory ablation report:** Impact of different memory architectures on long-horizon behaviour.
4. **World Director evaluation:** Comparison of rule-based and Jev-powered economic intervention.
5. **Inference efficiency report:** Intelligence, performance and cost trade-offs.
6. **Behavioural analysis:** Emergent patterns, failure modes and limitations.

Make research claims only when supported by reproducible experiments and measured outcomes.

The project should genuinely demonstrate AI research engineering, AI systems engineering, LLM evaluation, multi-agent architecture, experimental design, simulation engineering and inference optimisation.

Do not create research reports filled with fabricated or cherry-picked results.

# 17. ENGINEERING WORKFLOW AND CONSTRAINTS

The existing `docs/ai/` working agreement remains authoritative for implementation workflow.

Before substantial changes:

1. Inspect existing code and relevant documentation.
2. Read HANDOVER, CONSTRAINTS, ARCHITECTURE, FLOW and DECISIONS.
3. Produce a PLAN before implementation.
4. Explain files affected, execution paths, risks and verification.
5. Wait for approval.
6. Implement one logical change at a time.
7. Add tests alongside functionality.
8. Report CHANGED / WHY / VERIFY / NOT VERIFIED.

Additional requirements:

- No unnecessary dependencies.
- No opportunistic refactoring.
- No silent architectural decisions.
- No destructive migrations without rollback procedures.
- Every implementation stage should remain typecheckable and buildable.
- Never claim live integration or database verification when only static verification was performed.
- Keep documentation aligned with actual implementation.
- Preserve reusable financial infrastructure.
- Do not restart the project from scratch unless the existing architecture is demonstrably unsuitable.

This brief defines the long-term product direction. It does not override an already approved implementation stage or current repository handover instructions.

# 18. NORTH STAR

BLACK SHEEP succeeds when multiple autonomous AI hedge funds can operate inside a persistent financial world for extended periods, independently develop and execute investment strategies, respond to economic events, influence and react to competing agents, maintain meaningful memories and produce observable, measurable behaviour.

Researchers and engineers should be able to compare models, investigate decisions, reproduce experiments, study failures and understand how intelligence, autonomy, competition and resource constraints interact.

The system should remain interesting without human intervention and scientifically useful beyond the particular financial scenario in which it operates.

**Build a world where autonomous intelligence has to survive the consequences of its own decisions.**
