# pirevuew

**Pi Review Pipeline** — 5-layer pre-push quality gate for Pi Coding Agent.

> Cross-model, automated review pipeline that blocks `git push` until your code passes all gates.

## Quick Start

```bash
# Install extension
pi install ./pi-pre-push-gate

# Start a gate manually
/gate

# Or auto-triggered after plan execution

# Install git hook (blocks push until gate passes)
/gate hook install

# Push only after gate PASSED
git push
```

## Pipeline

```
🧹 Compaction → 🔍 Self-Review (5x) → 📋 Structured → 🛡 Security → 🧪 Tests → 👁 Human → ✅ Push
```

## Structure

```
pi-pre-push-gate/
├── index.ts              # Extension entry — commands, events, orchestration
├── state.ts              # GateState, state machine, severity model
├── settings.ts           # Default config, patterns, labels
├── layer0-compaction.ts  # Context stripping (fresh eyes)
├── layer1-self-review.ts # Self-review loop (pi-review-loop style)
├── layer2-structured.ts  # Multi-perspective deep review (pi-review)
├── layer3-security.ts    # Security audit (piolium)
├── layer4-test-gate.ts   # Test runner + coverage
├── layer5-human.ts       # Human review gate (slopchop)
├── quality-metrics.ts    # Maggy-style code quality checks
├── report.ts             # pi-review-report.md generator
├── footer.ts             # Pi TUI footer widget
├── git-hook.ts           # Pre-push hook installer
├── prompts/              # Review prompt templates
├── hooks/                # Git hook template
└── README.md
```

## Research Sources

Built from analysis of:

| Source | What we took |
|--------|-------------|
| [pi-review-loop](https://github.com/nicobailon/pi-review-loop) | Self-review loop pattern, smart exit detection |
| [pi-review](https://github.com/earendil-works/pi-review) | Structured review workflow, verdict system |
| [pi-reviewer](https://github.com/zeflq/pi-reviewer) | Severity filtering, CI integration inspiration |
| [pi-slopchop](https://github.com/robzolkos/pi-slopchop) | Terminal annotation, FIX/DISCUSS model |
| [pi-diff-review](https://github.com/badlogic/pi-diff-review) | Native diff review concept |
| [piolium](https://github.com/vigolium/piolium) | Security audit integration (Layer 3) |
| [maggy](https://github.com/alinaqi/maggy) | Quality metrics, multi-model routing, skill protocols |
| [Vibe Coding CI/CD](https://getautonoma.com/blog/quality-gate-vibe-coding) | 5-layer gate stack architecture |
| [Multi-Agent Review](https://tanhdev.com/series/ai-code-review-vibe-coding/part-4-review-pipeline-multi-agent/) | Generator-Critic pattern, severity gating |
| [context-workflow](https://github.com/owainlewis/pi-extensions) | Context compaction for unbiased review |

## License

MIT