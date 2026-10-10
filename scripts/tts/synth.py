# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = ["kokoro==0.9.4", "soundfile>=0.13", "pip"]
# ///
# Speech synthesis for scripts/audio.ts: Kokoro-82M (Apache-2.0) running locally, no API keys.
# Input: a JSON file with [{"file": "<id>", "text": "<what to say>"}]; output: <out_dir>/<id>.mp3.
# Run through uv, which installs the dependencies above on first use (pip is there for spaCy's model download):
#   uv run scripts/tts/synth.py jobs.json public/audio --voice am_michael --speed 1.0
import argparse
import json
import os
import warnings
from pathlib import Path

warnings.filterwarnings('ignore')
os.environ.setdefault('TRANSFORMERS_VERBOSITY', 'error')

import numpy as np
import soundfile as sf
from kokoro import KPipeline

RATE = 24000
GAP = np.zeros(int(RATE * 0.15), dtype=np.float32)  # between the chunks Kokoro splits long texts into

ap = argparse.ArgumentParser()
ap.add_argument('jobs')
ap.add_argument('out_dir')
ap.add_argument('--voice', default='am_michael')
ap.add_argument('--speed', type=float, default=1.0)
args = ap.parse_args()

jobs = json.loads(Path(args.jobs).read_text())
out = Path(args.out_dir)
out.mkdir(parents=True, exist_ok=True)
# The voice prefix says the accent: a… American, b… British.
pipe = KPipeline(lang_code=args.voice[0], repo_id='hexgrad/Kokoro-82M')

for i, job in enumerate(jobs, 1):
    parts = []
    for _, _, audio in pipe(job['text'], voice=args.voice, speed=args.speed):
        if audio is not None:
            parts += [audio.numpy() if hasattr(audio, 'numpy') else audio, GAP]
    if not parts:
        print(f"[{i}/{len(jobs)}] ✗ no audio for: {job['text'][:60]}", flush=True)
        continue
    tmp = out / f".{job['file']}.mp3"
    sf.write(tmp, np.concatenate(parts[:-1]), RATE, format='MP3')
    tmp.rename(out / f"{job['file']}.mp3")
    print(f"[{i}/{len(jobs)}] {job['file']}  {job['text'][:70]}", flush=True)
