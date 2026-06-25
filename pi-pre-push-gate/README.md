# pi-pre-push-gate

**5-Layer Pre-Push Review Pipeline for Pi Coding Agent**

Cross-model quality gate that runs before `git push`. Automatically triggered after plan execution — or manually via `/gate`.

```
Compaction → Self-Review → Structured → Security → Tests → Human → ✅ Push
```

## Why?

AI agents make mistakes. They miss edge cases, introduce typos, forget error handling. A single review pass catches some issues — but multiple passes with **different models** and **different perspectives** catches 60-70% more.

This extension automates the entire review pipeline so you don't have to remember to run each step.

## Install

```bash
pi install git:github.com/ujang/pirevuew
# or locally:
pi install ./pi-pre-push-gate
```

Optional integrations (auto-detected):
```bash
pi install git:github.com/earendil-works/pi-review    # Layer 2
pi install npm:@vigolium/piolium                       # Layer 3 (security)
pi install npm:pi-slopchop                              # Layer 5 (human)
```

### Git Hook

```bash
/gate hook install    # Blocks push until gate passes
/gate hook uninstall  # Removes hook
/gate hook status     # Check if hook is active
```

## How It Works

### 5-Layer Pipeline

| # | Layer | Duration | Auto | What |
|---|-------|----------|------|------|
| 0 | 🧹 **Compaction** | ~2s | ✅ | Strip implementation details for unbiased review |
| 1 | 🔍 **Self-Review** | 30-90s | ✅ | Agent reviews itself 3-5x until clean |
| 2 | 📋 **Structured** | 20-60s | ✅ | Multi-perspective deep review + quality metrics |
| 3 | 🛡 **Security** | 60-300s | ✅ | Vulnerability scan (piolium) |
| 4 | 🧪 **Tests** | 10-60s | ✅ | Run tests + check coverage |
| 5 | 👁 **Human** | Manual | — | Interactive diff review (slopchop) |

### Severity Gating

| Severity | Action |
|----------|--------|
| 🔴 **P0 Critical** | **BLOCK push** — must fix |
| ⚠️ **P1 Warn** | Required review |
| ℹ️ **P2 Info** | Non-blocking |

### Cross-Model Review

Gate always uses **different models** than your session — no bias.

**Default: Mistral lineup** (rate-limit optimized):

| Layer | Default Model | Tok/min | Why |
|-------|--------------|---------|-----|
| L1 Self-Review | `ministral-8b-2512` | 1M | 12.5 RPS — handles 5 iterations |
| L2 Structured | `mistral-medium-2508` | 1M | Best quality for deep review |
| L3 Security | `mistral-medium-2508` | 1M | Precision vuln detection |
| L4 Test Gate | `ministral-3b-2512` | 2M | 50 RPS — ultra-fast test gen |

**Switch models instantly:**

```bash
/gate model show                  # See current config
/gate model presets               # List all presets
/gate model anthropic             # Switch to Anthropic lineup
/gate model google                # Switch to Google lineup
/gate model openai                # Switch to OpenAI lineup
/gate model deepseek              # Switch to DeepSeek lineup
/gate model l2 anthropic/claude-opus-4  # Change single layer
```

Or set manually in `~/.pi/agent/settings.json`:

```jsonc
{
  "prePushGate": {
    "models": {
      "selfReview": "mistral/ministral-8b-2512",
      "structuredReview": "mistral/mistral-medium-2508",
      "securityAudit": "mistral/mistral-medium-2508",
      "testGate": "mistral/ministral-3b-2512"
    }
  }
}
```

## Commands

| Command | Description |
|---------|-------------|
| `/gate` | Start full 5-layer pipeline |
| `/gate quick` | Fast path — skip security + human |
| `/gate status` | Show current progress |
| `/gate report` | Generate/open pi-review-report.md |
| `/gate approve` | Approve human review (Layer 5) |
| `/gate reject` | Reject human review → blocked |
| `/gate abort` | Cancel pipeline |
| `/gate hook install` | Install pre-push git hook |
| `/gate hook uninstall` | Remove hook |
| `/gate hook status` | Check hook status |
| `/gate model` | Show current model config |
| `/gate model <preset>` | Switch to preset (mistral/anthropic/google/openai/deepseek) |
| `/gate model <l1\|l2\|l3\|l4> <id>` | Change single layer model |
| `/gate config` | Show full configuration |

## Configuration

All settings in `~/.pi/agent/settings.json` under `"prePushGate"`:

```jsonc
{
  "prePushGate": {
    // Layers — which run?
    "layers": {
      "compaction": true,
      "selfReview": true,
      "structured": true,
      "security": "auto",      // "on" | "off" | "auto"
      "testGate": true,
      "humanReview": "on-warn"  // "always" | "on-warn" | "never"
    },

    // Models — always explicit, preset-switchable via /gate model
    "models": {
      "selfReview": "mistral/ministral-8b-2512",
      "structuredReview": "mistral/mistral-medium-2508",
      "securityAudit": "mistral/mistral-medium-2508",
      "testGate": "mistral/ministral-3b-2512"
    },

    // Self-review loop
    "maxIterations": 5,
    "freshContext": true,

    // Trigger
    "autoTrigger": true,

    // Git
    "baseBranch": "origin/main",
    "hookMode": "block",
    "autoPushOnPass": false,

    // Severity gate minimum
    "minSeverity": "warn",

    // Quality metrics (Maggy-inspired)
    "qualityMetrics": {
      "maxLinesPerFunction": 20,
      "maxParamsPerFunction": 3,
      "maxNestingDepth": 2
    }
  }
}
```

## Integration with `piolium`

If `piolium` is installed (`pi install npm:@vigolium/piolium`), Layer 3 automatically uses it for deep security scanning with 17 phases and PoC generation. Without it, Layer 3 falls back to prompt-based security review.

## Model Presets Reference

| Preset | L1 Self-Review | L2 Structured | L3 Security | L4 Test Gate |
|--------|---------------|---------------|-------------|-------------|
| **mistral** (default) | `ministral-8b-2512` | `mistral-medium-2508` | `mistral-medium-2508` | `ministral-3b-2512` |
| **anthropic** | `claude-haiku-4-5` | `claude-sonnet-4` | `claude-sonnet-4` | `claude-haiku-4-5` |
| **google** | `gemini-2.5-flash` | `gemini-2.5-pro` | `gemini-2.5-pro` | `gemini-2.5-flash` |
| **openai** | `gpt-4o-mini` | `gpt-4o` | `gpt-4o` | `gpt-4o-mini` |
| **deepseek** | `deepseek-chat` | `deepseek-reasoner` | `deepseek-reasoner` | `deepseek-chat` |

Switch anytime: `/gate model anthropic`

### Rate Limits Context (Mistral)

Default Mistral lineup is optimized for Mistral API rate limits:

| Model | Tokens/Min | RPS |
|-------|-----------|-----|
| `ministral-8b-2512` | **1,000,000** | 12.5 |
| `mistral-medium-2508` | **1,000,000** | 4.17 |
| `ministral-3b-2512` | **2,000,000** | 50 |

Avoid `mistral-small-2603` (100K tok/min) and `mistral-large-2512` (400K tok/min) — too restrictive for multi-iteration review pipeline.

## Credits

Inspired by:
- [pi-review-loop](https://github.com/nicobailon/pi-review-loop) — self-review loop pattern
- [pi-review](https://github.com/earendil-works/pi-review) — structured review workflow
- [piolium](https://github.com/vigolium/piolium) — security audit agent
- [pi-slopchop](https://github.com/robzolkos/pi-slopchop) — terminal annotation
- [maggy](https://github.com/alinaqi/maggy) — quality gates & multi-model routing
- [context-workflow](https://github.com/owainlewis/pi-extensions) — context compaction
- [Vibe Coding Best Practices](https://getautonoma.com/blog/quality-gate-vibe-coding) — 5-layer CI/CD gate stack

## License

MIT