"""Style-3 Reel ("how to use it"): the seller's own product video cut to a Hebrew voice-over.

    python3 reels/style3.py <spec.json> <out.mp4>

spec.json (scripts/daily-reel.js): video, voice (24 kHz mono wav), words (Whisper, with times), ends (the index in words of
each sentence's last word: hook, scenes..., proof, end), shots (one per sentence: name, a, b, half), keep ([top, bottom]
fractions of the frame height to keep), pills (hook text, per scene {text, step}), proof (sold, rate, price), track
({file, bpm, start}). Writes <out.mp4> and <out>-contact.png.

Ported from the owner-approved hand builds (~/Desktop/panda-reels/build-style3/style3-7.py and -8.py, 2026-11-15): every
cut on the quietest 10 ms between two sentences, moved to the music beat when within 0.15 s; pauses of 0.35 s+ cut to 0.2 s;
each shot slowed (never sped up) to fill its sentence; the shot fitted unstretched over a blurred copy of itself; white pills,
the hook pill burned in from frame 0; the end shot dissolves into the hook's first frame (loop); house track from its first
beat, ducked 12 dB under the voice; -15 LUFS, -1.5 dBTP."""
import array, hashlib, json, math, os, re, subprocess, sys, wave

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import kit as k  # noqa: E402

FPS, W, H = 30, 1080, 1920
BLUE = "#2AABEE"
ENC = ["-c:v", "libx264", "-preset", "medium", "-crf", "15", "-pix_fmt", "yuv420p", "-r", "30", "-an", *k.TAGS]
CSS = k.CSS.replace(".wrap{position:absolute;top:210px", ".wrap{position:absolute;top:300px")  # under Instagram's top bar
assert "top:300px" in CSS
# AI-written lines can be long: the pill's 900 px include its padding, so a wrapped pill stays inside Meta's safe zone
CSS = CSS.replace("</style>", ".pill:not(.end){box-sizing:border-box}.big{font-size:70px}</style>")
SR, HOP = 24000, 240                 # voice sample rate, 10 ms frames
SIL_DB, LONG, KEEP, V0 = -45.0, 0.35, 0.10, 0.10
SEAM = 9                             # loop-seam dissolve, frames
VOICE_LUFS, DUCK_DB = -16.0, 12.0


def esc(s):
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def hook_body(text):
    return f'<div class="wrap"><div class="pill big"><span>{esc(text)}</span></div></div>'


def step_body(text, n):
    return f'<div class="wrap"><div class="pill"><span>{esc(text)}</span><div class="n">{n}</div></div></div>'


def plain_body(text):
    return f'<div class="wrap"><div class="pill"><span>{esc(text)}</span></div></div>'


def proof_body(sold, rate, price):
    return (f'<div class="wrap"><div class="pill" style="flex-direction:column;gap:8px;padding:34px 56px">'
            f'<span><b style="color:{BLUE}">{sold:,}</b> קנו לאחרונה</span><span>{esc(rate)} ביקורות חיוביות</span>'
            f'<span style="font-size:66px">₪{esc(price)}</span></div></div>')


END = ('<div class="wrap mid"><div class="pill end"><span>רוצים את הקישור?</span>'
       '<small>כתבו <b>פנדה</b> בתגובות, ואשלח לכם בפרטי</small></div></div>')


def pill(work, body):
    doc = CSS + body + "</body></html>"
    png = os.path.join(work, "pills", hashlib.sha1(doc.encode()).hexdigest()[:12] + ".png")
    if not os.path.exists(png):
        os.makedirs(os.path.dirname(png), exist_ok=True)
        html = png[:-4] + ".html"
        open(html, "w", encoding="utf-8").write(doc)
        subprocess.run([k.CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", *k.CHROME_FLAGS,
                        "--default-background-color=00000000", "--force-device-scale-factor=1", f"--window-size={W},{H}",
                        f"--screenshot={png}", f"file://{html}"], check=True, capture_output=True, timeout=90)
    return png


def body_box(png, thr=200):
    a = subprocess.check_output(["ffmpeg", "-v", "error", "-i", png, "-vf", "format=rgba,alphaextract", "-f", "rawvideo", "-pix_fmt", "gray", "-"])
    rows = [y for y in range(H) if max(a[y * W:(y + 1) * W]) > thr]
    hit = re.compile(rb"[%s-\xff]" % bytes([thr + 1]))
    xs = [hit.search(a[y * W:(y + 1) * W]).start() for y in rows]
    xe = [W - 1 - hit.search(a[y * W:(y + 1) * W][::-1]).start() for y in rows]
    return min(xs), rows[0], max(xe), rows[-1]


# ---------------- the voice ----------------
def frames_db(x):
    return [10 * math.log10(sum(v * v for v in x[i:i + HOP]) / HOP / 32768 ** 2 + 1e-12) for i in range(0, len(x) - HOP + 1, HOP)]


def silences(db, min_len):
    """internal runs of 10 ms frames under SIL_DB lasting >= min_len s, as (start, end) in s"""
    out, st = [], None
    for i, d in enumerate(db + [0.0]):
        if d < SIL_DB and st is None: st = i
        elif d >= SIL_DB and st is not None:
            if (i - st) / 100 >= min_len and st > 0 and i < len(db): out.append((st / 100, i / 100))
            st = None
    return out


def tighten(spec, work):
    """lead trimmed so speech starts at V0 + 0.1 s; pauses of LONG+ cut to 0.2 s. Returns what the cuts and the mix need."""
    raw = subprocess.check_output(["ffmpeg", "-v", "error", "-i", spec["voice"], "-f", "s16le", "-ac", "1", "-ar", str(SR), "-"])
    x0 = array.array("h", raw)
    db0 = frames_db(x0)
    lead = max(0.0, next(i for i, d in enumerate(db0) if d >= SIL_DB) / 100 - 0.10)
    x = x0[int(lead * SR):]
    db = frames_db(x)
    gaps = silences(db, LONG)
    cuts = [(a + KEEP, b - KEEP) for a, b in gaps]
    XF = int(0.01 * SR)
    y, pos = array.array("h"), 0
    for a, b in cuts:
        ia, ib = int(a * SR), int(b * SR)
        y.extend(x[pos:ia - XF])
        y.extend(array.array("h", [int(x[ia - XF + j] * (1 - j / XF) + x[ib - XF + j] * j / XF) for j in range(XF)]))
        pos = ib
    y.extend(x[pos:])
    out = os.path.join(work, "voice-tight.wav")
    with wave.open(out, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(y.tobytes())

    def new_t(t):
        return t - sum(min(max(t - a, 0), b - a) for a, b in cuts) + V0
    ydb = frames_db(y)
    end = V0 + max(i for i, d in enumerate(ydb) if d >= SIL_DB) / 100 + 0.01
    quiet = [(V0 + a, V0 + b) for a, b in silences(ydb, 0.12)]
    words = [{**w, "start": w["start"] - lead, "end": w["end"] - lead} for w in spec["words"]]
    return dict(path=out, db=db, new_t=new_t, end=end, quiet=quiet, words=words)


def boundary(v, i, beat):
    """the quietest 10 ms frame (middle of its near-quiet run) between word i and word i+1, widened 0.15 s each side for
    Whisper's loose word ends; moved to the beat when within 0.15 s"""
    words, db = v["words"], v["db"]
    e, s = words[i]["end"], words[i + 1]["start"]
    lo, hi = max(0, int((min(e, s) - 0.15) * 100)), min(len(db), int((max(e, s) + 0.15) * 100))
    j = min(range(lo, hi), key=lambda f: db[f])
    a = b = j
    while a > lo and db[a - 1] < db[j] + 3: a -= 1
    while b < hi - 1 and db[b + 1] < db[j] + 3: b += 1
    t = v["new_t"]((a + b + 1) / 200)
    snap = round(t / beat) * beat
    return snap if abs(snap - t) <= 0.15 else t


# ---------------- the picture ----------------
def src_size(f):
    w, h = subprocess.check_output(["ffprobe", "-v", "error", "-select_streams", "v", "-show_entries", "stream=width,height", "-of", "csv=p=0", f]).decode().strip().split(",")[:2]
    return int(w), int(h)


def active_area(f, sw, sh):
    """the picture inside black bars (some seller videos are a portrait clip letterboxed in a landscape frame):
    the widest cropdetect answer over the whole video, as (x, y, w, h)"""
    r = subprocess.run(["ffmpeg", "-hide_banner", "-i", f, "-vf", "fps=2,cropdetect=limit=24:round=2:reset=0", "-f", "null", "-"],
                       capture_output=True, text=True).stderr
    found = [tuple(map(int, m)) for m in re.findall(r"crop=(\d+):(\d+):(\d+):(\d+)", r)]
    w, h, x, y = found[-1] if found else (sw, sh, 0, 0)  # reset=0: the last answer covers every frame seen
    return (x, y, w, h) if w >= sw * 0.25 and h >= sh * 0.25 else (0, 0, sw, sh)


def cuts(f, area, dur, th=0.25):
    """the seller video's own cuts (scene changes measured inside the picture, so black bars don't hide them), as seconds;
    cuts closer than 0.4 s to another cut or to either end are dropped"""
    x, y, w, h = area
    r = subprocess.run(["ffmpeg", "-hide_banner", "-i", f, "-vf", f"crop={w}:{h}:{x}:{y},select='gt(scene,{th})',showinfo", "-f", "null", "-"],
                       capture_output=True, text=True).stderr
    out = []
    for t in sorted(float(m) for m in re.findall(r"pts_time:([\d.]+)", r)):
        if 0.4 <= t <= dur - 0.4 and (not out or t - out[-1] >= 0.4): out.append(round(t, 2))
    return out


def probe(f):
    sw, sh = src_size(f)
    area = active_area(f, sw, sh)
    return {"area": area, "duration": round(k.dur(f), 2), "cuts": cuts(f, area, k.dur(f))}


def box_for(spec, half, area):
    """inside the picture: the keep band (no burned-in text), narrowed to one half of a split-screen frame when asked"""
    ax, ay, aw, ah = area
    top, bottom = spec["keep"]
    y0, y1 = ay + top * ah, ay + bottom * ah
    if half == "top": y1 = min(y1, ay + ah / 2)
    if half == "bottom": y0 = max(y0, ay + ah / 2)
    y0, y1 = int(y0) // 2 * 2, int(y1) // 2 * 2
    assert y1 - y0 >= ah * 0.3, (half, y0, y1)
    return ax // 2 * 2, y0, aw // 2 * 2, y1 - y0


def fill_box(box, focus=0.5):
    """the 9:16 part of `box` that fills the whole screen (owner 2026-11-16: "full screen like a pro Reel", no blurred
    bands); a wider picture is cut at the sides around `focus` (0 = left edge, 1 = right edge), a taller one top and bottom"""
    x, y, w, h = box
    if w / h > 9 / 16:
        nw = int(h * 9 / 16) // 2 * 2
        return x + int((w - nw) * min(1.0, max(0.0, focus))) // 2 * 2, y, nw, h
    nh = int(w * 16 / 9) // 2 * 2
    return x, y + (h - nh) // 2 // 2 * 2, w, nh


def clip(spec, work, name, a, b, frames, box, punch=False, push=0.0, sec=None, focus=0.5):
    """source a..b slowed (never sped up, at most to 0.5x) to fill `frames`; under 0.8x motion-interpolated. A short shot
    grows only inside its own section `sec` of the seller video (never into the next shot); the last frame is held if
    it is still short (scripts/daily-reel.js asks for a longer shot before it comes to that)"""
    need = frames / FPS + 0.03
    lo, hi = sec or (a, b)
    if b - a < need * 0.5: b = min(hi, a + need * 0.5)
    if b - a < need * 0.5: a = max(lo, b - need * 0.5)
    speed = max(0.5, min(1.0, round((b - a) / need, 3)))
    fill = spec.get("fill", True)
    x, y, w, h = fill_box(box, focus) if fill else box
    slow = "minterpolate=fps=30:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1," if speed < 0.8 else ""
    z = f"(1+{push}*t/{frames / FPS:.3f})"
    zoom = f"format=gbrp,scale=w='1080*{z}':h='1920*{z}':eval=frame:flags=bicubic,crop=1080:1920," if push else ""
    look = "unsharp=5:5:0.45,colorlevels=romax=0.93:gomax=0.93:bomax=0.93"  # a touch under white so the white pills stand out
    fc = (f"[0:v]crop={w}:{h}:{x}:{y},setpts=(PTS-STARTPTS)/{speed},{slow}fps=30,"
          + (f"scale=1080:1920:flags=lanczos,{look},setsar=1,{zoom}" if fill else
             "split[f][g];[g]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=45,eq=brightness=-0.16:saturation=0.8[bg];"
             f"[f]scale=1080:1920:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,{look}[fg];"
             f"[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1,{zoom}")
          + f"{k.punch() + ',' if punch else ''}tpad=stop_mode=clone:stop_duration={need:.3f},{k.TO_YUV}")
    out = os.path.join(work, f"{name}.mp4")
    k.run(["-ss", f"{a:.3f}", "-to", f"{b:.3f}", "-i", spec["video"], "-filter_complex", fc, *ENC, "-frames:v", str(frames), out])
    return out


def mix(spec, v, D, work, out):
    """house track from its first beat, ducked DUCK_DB under the voice (speech-keyed sidechain); whole mix to -15 LUFS"""
    tr = spec["track"]
    bed, voice, key, raw = (os.path.join(work, f) for f in ("bed.wav", "voice.wav", "key.wav", "mix-raw.wav"))
    k.run(["-i", tr["file"], "-af", f"atrim=start={tr['start']:.4f}:duration={D:.3f},asetpts=PTS-STARTPTS,aresample=48000,"
           f"aformat=channel_layouts=stereo,afade=t=in:d=0.01,afade=t=out:st={D - 1.2:.3f}:d=1.2", "-c:a", "pcm_f32le", bed])
    k.run(["-i", v["path"], "-af", f"aresample=48000,aformat=channel_layouts=stereo,adelay={int(V0 * 1000)}:all=1,apad,atrim=0:{D:.3f}",
           "-c:a", "pcm_f32le", voice + ".tmp.wav"])
    k.run(["-i", voice + ".tmp.wav", "-af", f"volume={VOICE_LUFS - k.ebur(voice + '.tmp.wav')[0]:.2f}dB", "-c:a", "pcm_f32le", voice])
    edges = [V0] + [t for q in v["quiet"] if q[1] < v["end"] for t in q] + [v["end"]]
    on = list(zip(edges[::2], edges[1::2]))
    n, ramp, KEY = int(D * 48000), int(0.015 * 48000), 0.1
    g = array.array("f", [0.0]) * n
    for s, e in on:
        i0, i1 = int(s * 48000), min(int(e * 48000), n)
        for i in range(i0, i1): g[i] = KEY * min(1.0, (i - i0) / ramp, (i1 - i) / ramp)
    with wave.open(key, "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(48000)
        w.writeframes(array.array("h", [int(s * 32767) for s in g for _ in (0, 1)]).tobytes())
    ratio = 20
    thr = 10 ** ((20 * math.log10(KEY) - DUCK_DB / (1 - 1 / ratio)) / 20)
    duck = f"sidechaincompress=threshold={thr:.5f}:ratio={ratio}:knee=1:attack=40:release=1000:detection=peak:makeup=1"
    music_db = VOICE_LUFS - k.ebur(bed)[0]  # music as loud as the voice when it is up, so it never covers him
    k.run(["-i", bed, "-i", key, "-i", voice, "-filter_complex",
           f"[0:a]volume={music_db:.2f}dB[m];[m][1:a]{duck}[md];[md][2:a]amix=inputs=2:normalize=0[a]", "-map", "[a]", "-c:a", "pcm_f32le", raw])
    gain = k.MIX_LUFS - k.ebur(raw)[0]
    for _ in range(3):  # the limiter takes some loudness off: add it back and limit again
        k.run(["-i", raw, "-af", f"volume={gain:.2f}dB,alimiter=limit={10 ** ((k.MIX_TP - 1) / 20):.4f}:level=false:attack=3:release=60",
               "-t", f"{D:.3f}", "-c:a", "pcm_s16le", out])
        miss = k.MIX_LUFS - k.ebur(out)[0]
        if abs(miss) < 0.2: break
        gain += miss
    lufs, tp, _ = k.ebur(out)
    assert tp <= k.MIX_TP and abs(lufs - k.MIX_LUFS) < 0.5, (lufs, tp)
    return lufs, tp


def main(spec_path, out):
    spec = json.load(open(spec_path, encoding="utf-8"))
    work = os.path.join(os.path.dirname(os.path.abspath(out)), "work")
    os.makedirs(work, exist_ok=True)
    sw, sh = src_size(spec["video"])
    area = active_area(spec["video"], sw, sh)
    print(f"source {sw}x{sh}, picture {area}")
    beat = 60 / spec["track"]["bpm"]
    v = tighten(spec, work)
    shots, ends = spec["shots"], spec["ends"]
    assert len(shots) == len(ends) >= 6, (len(shots), len(ends))
    starts = [0.0] + [boundary(v, ends[i], beat) for i in range(len(ends) - 1)]
    D = math.ceil((v["end"] + 2.0) / beat - 1e-9) * beat  # end on the first beat >= 2 s after the voice
    F = [round(t * FPS) for t in starts] + [round(D * FPS)]
    assert all(a < b for a, b in zip(F, F[1:])), F
    N = [b - a for a, b in zip(F, F[1:])]
    print(f"voice ends {v['end']:.2f} s; reel {D:.2f} s; cuts {[round(f / FPS, 2) for f in F]}")

    # shots: hook, scenes, proof, end. Punch-in on the first scene; slow push-in on the proof and the end.
    last = len(shots) - 1
    files = []
    for i, s in enumerate(shots):
        box = box_for(spec, s.get("half", "full"), area)
        files.append(clip(spec, work, f"shot{i}", s["a"], s["b"], N[i], box, punch=(i == 1), push=0.08 if i >= last - 1 else 0.0, sec=s.get("sec"), focus=s.get("focus", 0.5)))
    hook = shots[0]
    if hook["a"] - (hook.get("sec") or [0])[0] >= 0.35:  # the end dissolves into the hook's first frame (same shot), so the replay has no seam
        pre = clip(spec, work, "pre", hook["a"] - 0.32, hook["a"], SEAM, box_for(spec, hook.get("half", "full"), area), focus=hook.get("focus", 0.5))
        endx = os.path.join(work, "end-seam.mp4")
        k.run(["-i", files[last], "-i", pre, "-filter_complex",
               f"[0][1]xfade=transition=fade:duration={(SEAM - 1) / FPS:.4f}:offset={(N[last] - SEAM) / FPS:.4f},{k.TO_YUV}", *ENC, "-frames:v", str(N[last]), endx])
        files[last] = endx

    # the hook pill is burned into the hook shot, so it is fully in on frame 0 (thumbnail, replay)
    P = spec["pills"]
    hook_png = pill(work, hook_body(P["hook"]))
    hookp = os.path.join(work, "hookp.mp4")
    k.run(["-i", files[0], "-loop", "1", "-framerate", "30", "-t", f"{N[0] / FPS:.3f}", "-i", hook_png, "-filter_complex",
           "[0:v]fps=30,scale=in_color_matrix=bt709:in_range=tv,format=gbrp[b];"
           f"[1:v]format=rgba,fade=out:st={(N[0] - 2) / FPS:.4f}:d={2 / FPS:.4f}:alpha=1[p];[b][p]overlay=0:0:format=gbrp,{k.TO_YUV}", *ENC, "-frames:v", str(N[0]), hookp])
    files[0] = hookp
    body = os.path.join(work, "body.mp4")
    k.run([*[a for f in files for a in ("-i", f)], "-filter_complex", "".join(f"[{i}:v]" for i in range(len(files))) + f"concat=n={len(files)}:v=1:a=0,fps=30,settb=1/30", *ENC, body])
    D = k.dur(body)

    t = [f / FPS for f in F]
    pr = spec["proof"]
    pills = [(pill(work, step_body(p["text"], p["step"]) if p.get("step") else plain_body(p["text"])), t[i + 1], t[i + 2]) for i, p in enumerate(P["scenes"])]
    pills += [(pill(work, proof_body(pr["sold"], pr["rate"], pr["price"])), t[last - 1], t[last]), (pill(work, END), t[last], D + 1)]
    for png, _, _ in pills + [(hook_png, 0, 0)]:
        x0, y0, x1, y1 = body_box(png)
        assert 269 <= y0 and y1 <= 1248 and x0 >= 65 and x1 <= 1015, ("pill outside Meta's safe zone", png, x0, y0, x1, y1)

    audio = os.path.join(work, "audio.wav")
    lufs, tp = mix(spec, v, D, work, audio)
    FI, FO = 0.1, 0.07
    inp, fc, lab = ["-i", body], ["[0:v]scale=in_color_matrix=bt709:in_range=tv,format=gbrp[b]"], "b"
    for i, (png, s, e) in enumerate(pills, 1):
        s, e = s - FI / 2, e + FO / 2
        inp += ["-loop", "1", "-framerate", "30", "-t", f"{D:.3f}", "-i", png]
        fc.append(f"[{i}:v]format=rgba,fade=in:st={max(s, 0):.3f}:d={FI}:alpha=1,fade=out:st={e - FO:.3f}:d={FO}:alpha=1[p{i}]")
        fc.append(f"[{lab}][p{i}]overlay=0:0:format=gbrp:enable='between(t,{max(s, 0):.2f},{e:.2f})'[v{i}]"); lab = f"v{i}"
    fc.append(f"[{lab}]{k.TO_YUV}[vout]")
    k.run([*inp, "-i", audio, "-filter_complex", ";".join(fc), "-map", "[vout]", "-map", f"{len(pills) + 1}:a", "-t", f"{D:.3f}",
           "-c:v", "libx264", "-preset", "medium", "-profile:v", "high", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "30", "-g", "60",
           "-keyint_min", "60", "-sc_threshold", "0", *k.TAGS, "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", out])
    sheet = out.replace(".mp4", "-contact.png")
    k.run(["-i", out, "-vf", "fps=2,scale=216:-1,tile=10x5:padding=4", "-frames:v", "1", sheet])
    size = os.path.getsize(out)
    assert size < 20e6, f"{size / 1e6:.1f} MB: the approve bot can't download over 20 MB"
    print(f"{out}: {k.dur(out):.2f} s, {size / 1e6:.1f} MB, mix {lufs:.2f} LUFS {tp:.2f} dBTP, sheet {sheet}")


if __name__ == "__main__":
    if sys.argv[1] == "--probe": print(json.dumps(probe(sys.argv[2])))  # scripts/daily-reel.js, before Gemini
    else: main(sys.argv[1], sys.argv[2])
