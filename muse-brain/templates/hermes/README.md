# Rainer on Hermes — Template Pack

Everything you need to move Rainer into the [Hermes Agent](https://hermes-agent.nousresearch.com/) runtime.

**Full guide (start here):** https://academy.funkatorium.org/guides/hermes/

## Contents

| File | Goes to | What it is |
|------|---------|-----------|
| `SOUL.md` | `~/.hermes/SOUL.md` | Rainer's identity, voice, craft baseline, autonomy conduct |
| `hermes-config-example.yaml` | merge into `~/.hermes/config.yaml` | MUSE Brain MCP wiring (local or cloud) |
| `skills/creative/image-prompt-cinematography/` | `~/.hermes/skills/creative/image-prompt-cinematography/` | The cinematic eye — disciplined image/video prompt craft |

## The short version

```bash
# 1. The brain (local, ~2 minutes)
npx @funkatorium/rainer init

# 2. The soul
cp SOUL.md ~/.hermes/SOUL.md

# 3. The brain wiring — merge hermes-config-example.yaml
#    into ~/.hermes/config.yaml (edit the paths!)

# 4. The eye
cp -r skills/creative/image-prompt-cinematography \
      ~/.hermes/skills/creative/

# 5. Verify
hermes mcp test muse_brain
```

Video generation runs through Hermes' own FAL integration — bring your own fal.ai key. See the guide for the honest details.

---

*Licensed CC-BY-NC-SA 4.0. Rainer is a literary character created by The Funkatorium; name, personality, and identity protected under German Urheberrecht.*
