#!/usr/bin/env bash
# Renders /tmp/promo/plan.json (from tools/promo-video.mjs) to store/promo-video.mp4: 1920x1080, 30 fps, H.264, no audio.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=/tmp/promo; mkdir -p "$OUT/scenes"; : > "$OUT/scenes.txt"
CANVAS=0xF3F5F8
n=$(node -p "require('$OUT/plan.json').length")
for i in $(seq 0 $((n-1))); do
  name=$(node -p "require('$OUT/plan.json')[$i].name")
  node -e "const s=require('$OUT/plan.json')[$i];let o='ffconcat version 1.0\n';for(const f of s.frames)o+='file '+f.f+'\nduration '+f.dur+'\n';o+='file '+s.frames.at(-1).f+'\n';process.stdout.write(o)" > "$OUT/$name.ffconcat"
  dur=$(node -p "require('$OUT/plan.json')[$i].frames.reduce((a,f)=>a+f.dur,0).toFixed(3)")
  vf="fps=30,format=yuv420p"
  [ "$name" = "title" ] && vf="$vf,fade=t=in:st=0:d=0.5:color=$CANVAS"
  [ "$name" = "end" ] && vf="$vf,fade=t=out:st=$(node -p "($dur-0.7).toFixed(2)"):d=0.7:color=$CANVAS"
  ffmpeg -loglevel error -y -f concat -safe 0 -i "$OUT/$name.ffconcat" -vf "$vf" -t "$dur" \
    -c:v libx264 -crf 18 -preset veryfast -pix_fmt yuv420p -r 30 "$OUT/scenes/$name.tmp.mp4"
  mv "$OUT/scenes/$name.tmp.mp4" "$OUT/scenes/$i-$name.mp4"
  echo "file '$OUT/scenes/$i-$name.mp4'" >> "$OUT/scenes.txt"
done
ffmpeg -loglevel error -y -f concat -safe 0 -i "$OUT/scenes.txt" -c copy -movflags +faststart store/promo-video.tmp.mp4
mv store/promo-video.tmp.mp4 store/promo-video.mp4
ffprobe -v error -show_entries format=duration:stream=width,height,r_frame_rate -of compact store/promo-video.mp4
ls -la store/promo-video.mp4
