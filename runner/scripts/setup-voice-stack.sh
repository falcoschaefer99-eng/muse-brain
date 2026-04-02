#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RUNNER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
STACK_DIR="${MUSE_VOICE_STACK_DIR:-$RUNNER_DIR/voice-stack}"
MUSE_TTS_REPO="${MUSE_TTS_REPO:-https://github.com/falcoschaefer99-eng/muse-tts.git}"

mkdir -p "$STACK_DIR"

clone_if_missing() {
  local repo_url="$1"
  local target_dir="$2"
  if [ -d "$target_dir/.git" ]; then
    echo "[voice-stack] already present: $target_dir"
  else
    echo "[voice-stack] cloning $repo_url -> $target_dir"
    git clone "$repo_url" "$target_dir"
  fi
}

clone_if_missing "$MUSE_TTS_REPO" "$STACK_DIR/muse-tts"

echo ""
echo "[voice-stack] bootstrap complete"
echo "  STACK_DIR: $STACK_DIR"
echo "  MUSE TTS:  $STACK_DIR/muse-tts"
echo "  STT sidecar: $RUNNER_DIR/stt"
echo ""
echo "Next:"
echo "  1) See runner/docs/FULL_VOICE_STACK.md"
echo "  2) Copy runner/.env.example -> runner/.env and set voice vars"
echo "  3) Run npm run voice-bridge"
