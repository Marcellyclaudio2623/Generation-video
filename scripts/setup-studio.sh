#!/usr/bin/env bash
# Réinstalle le studio vidéo dans un conteneur Linux neuf (session cloud Claude Code).
# Idempotent : ne refait que ce qui manque.
#   bash scripts/setup-studio.sh
# Durée sur un conteneur vide : ~8 à 10 min (compilation whisper.cpp, modèle 548 Mo, 8 musiques générées).
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLS="${TOOLS_DIR:-$HOME/tools}"
MODEL="$HOME/.cache/whisper-cpp/ggml-large-v3-turbo-q5_0.bin"

# 1. FFmpeg (paquet système : x264, x265, aac, libass, loudnorm)
command -v ffmpeg >/dev/null || { apt-get update && apt-get install -y ffmpeg; }

# 2. whisper.cpp, compilé depuis github.com/ggml-org/whisper.cpp (binaire statique)
if ! command -v whisper-cli >/dev/null; then
  mkdir -p "$TOOLS"
  [ -d "$TOOLS/whisper.cpp" ] || git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git "$TOOLS/whisper.cpp"
  cmake -S "$TOOLS/whisper.cpp" -B "$TOOLS/whisper.cpp/build" -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_TESTS=OFF
  cmake --build "$TOOLS/whisper.cpp/build" -j"$(nproc)" --config Release --target whisper-cli
  install -m 755 "$TOOLS/whisper.cpp/build/bin/whisper-cli" /usr/local/bin/whisper-cli
fi
if [ ! -f "$MODEL" ]; then
  mkdir -p "$(dirname "$MODEL")"
  curl -fSL --retry 3 -o "$MODEL.part" "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/$(basename "$MODEL")"
  mv "$MODEL.part" "$MODEL"
fi

# 3. Treg (CLI + skill). La connexion au compte reste manuelle : treg login
command -v treg >/dev/null || [ -x "$HOME/.local/bin/treg" ] || curl -fsSL https://treg.to/install.sh | sh

# 4. Moteur de rendu (skill short-editing) : paquets npm, Chrome, musiques, icônes
node "$REPO/.claude/skills/short-editing/engine/setup.mjs"
