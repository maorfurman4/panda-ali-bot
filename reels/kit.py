"""Shared helpers for the Reels builders (ported from the owner-approved hand-made kit, ~/Desktop/panda-reels/build/reelkit.py):
ffmpeg runs, the approved white-pill CSS (rendered by headless Chrome), the beat grid, and the music mix at -15 LUFS."""
import os, re, shutil, subprocess

# Chrome: $CHROME, else the Mac app, else Linux's google-chrome (preinstalled on GitHub's ubuntu-latest).
CHROME = os.environ.get("CHROME") or next((c for c in ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"] if os.path.exists(c)), None) \
    or shutil.which("google-chrome") or shutil.which("google-chrome-stable") or shutil.which("chromium")
# GitHub's Ubuntu 24.04 blocks the user namespaces Chrome's sandbox needs; it only ever opens our own local HTML here.
CHROME_FLAGS = ["--no-sandbox"] if os.environ.get("CI") else []
TAGS = ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv"]
TO_YUV = "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv"


def run(args, timeout=900):
    subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", *args], check=True, timeout=timeout)


def dur(f):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]))


def size(f):
    return tuple(map(int, subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", f]).decode().split(",")[:2]))


# the approved pill CSS (style 1 draft 4); Heebo comes from the installed font (reels/fonts on the GitHub runner)
CSS = """<!doctype html><html lang="he"><head><meta charset="utf-8"><style>
html,body{margin:0;width:1080px;height:1920px;background:transparent;font-family:'Heebo','Arial Hebrew',sans-serif}
.wrap{position:absolute;top:210px;left:0;right:0;display:flex;justify-content:center}
.pill{direction:rtl;display:flex;align-items:center;gap:26px;background:#fff;border-radius:46px;padding:26px 40px 26px 46px;
 box-shadow:0 10px 34px rgba(0,0,0,.28);color:#16181d;font-weight:800;font-size:54px;line-height:1.22;text-align:center;max-width:900px}
.n{flex:none;width:76px;height:76px;border-radius:50%;background:#2AABEE;color:#fff;font-size:46px;display:flex;align-items:center;justify-content:center}
.big{font-size:76px;padding:36px 60px}.big b,.end b{color:#2AABEE}
.dim{position:absolute;inset:0;background:rgba(0,0,0,.45)}
.mid{top:700px}.end{flex-direction:column;gap:14px;padding:44px 60px;font-size:74px}.end small{font-size:48px;font-weight:600;color:#3b3f47}
.tap{position:absolute;left:0;top:0;width:150px;height:150px;border-radius:50%;background:rgba(255,255,255,.45);border:7px solid #fff;box-sizing:border-box;box-shadow:0 0 0 3px rgba(0,0,0,.25),0 6px 22px rgba(0,0,0,.35)}
</style></head><body>"""


def beat_frames(beats, bpm, fps=30):
    """beats per scene -> cut frames from 0. The music starts on a beat at t=0, so cut k sits on beat sum(beats[:k]),
    snapped to the nearest frame."""
    out, b = [0], 0
    for n in beats:
        b += n; out.append(round(b * 60 / bpm * fps))
    return out


def ebur(path):
    """(integrated LUFS, true peak dBTP, max momentary LUFS)"""
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"],
                       capture_output=True, text=True).stderr
    mom = [float(m) for m in re.findall(r"M:\s*(-?\d+\.\d+)", r)]
    return (float(re.findall(r"I:\s+(-?\d+\.\d+) LUFS", r)[-1]), float(re.findall(r"Peak:\s+(-?\d+\.\d+) dBFS", r)[-1]), max(mom))


MIX_LUFS, MIX_TP = -15.0, -1.5
SFX_UNDER = 6.0  # loudest sound effect (400 ms momentary) sits this many LU under the music's integrated level


def mix_track(sfx, D, work, out, track, offset, fade=1.2):
    """The track from `offset` s (a beat) as the bed, sound effects tucked SFX_UNDER LU beneath it, no ducking; whole mix to
    MIX_LUFS with true peak <= MIX_TP. Returns (LUFS, dBTP)."""
    bed = os.path.join(work, "bed.wav")
    run(["-i", track, "-af", f"atrim=start={offset:.4f}:duration={D:.3f},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,"
         f"afade=t=in:d=0.01,afade=t=out:st={D - fade:.3f}:d={fade}", "-c:a", "pcm_s16le", bed])
    g_sfx = ebur(bed)[0] - SFX_UNDER - ebur(sfx)[2]
    raw = os.path.join(work, "mix-raw.wav")
    run(["-i", bed, "-i", sfx, "-filter_complex", f"[1:a]volume={g_sfx:.2f}dB[s];[0:a][s]amix=inputs=2:normalize=0[a]",
         "-map", "[a]", "-c:a", "pcm_f32le", raw])
    g = MIX_LUFS - ebur(raw)[0]
    # shortcut: alimiter limits sample peaks, so it sits 1 dB under MIX_TP to leave room for inter-sample peaks; checked below
    run(["-i", raw, "-af", f"volume={g:.2f}dB,alimiter=limit={10 ** ((MIX_TP - 1) / 20):.4f}:level=false:attack=3:release=60",
         "-t", f"{D:.3f}", "-c:a", "pcm_s16le", out])
    lufs, tp, _ = ebur(out)
    assert tp <= MIX_TP and abs(lufs - MIX_LUFS) < 1, (lufs, tp)
    return lufs, tp


PUNCH = "zoompan=z='if(lt(in\\,{n})\\,1+{z}*pow(1-in/{n}\\,2)\\,1)':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s={w}x{h}:fps=30"


def punch(w=1080, h=1920, z=0.07, n=8):
    """a light punch-in on a beat cut: the frame starts z bigger and eases back over n frames"""
    return PUNCH.format(n=n, z=z, w=w, h=h)
