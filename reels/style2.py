"""Style-2 Reel ("personal recommendation"): one hit product, its seller photos, three buyers with photos, the price.

    python3 reels/style2.py <workdir> <out.mp4>

<workdir> holds data.json (product, variants, stats, ratings, reviews: scripts/daily-reel.js), img/<id>.png (s0.. seller
photos, rNN_k review photos) and spec.json (captions, photo picks and the track: reel-style2.js). Writes <out.mp4> and
<out>-contact.png (a frame every 0.5 s).

Ported from the owner-approved hand-made build (~/Desktop/panda-reels/build-style2/build.py, v3 = style2-3.mp4): #111313
background, photo on a rounded card with a soft glow of its own colours, slow 5% zoom, hard cuts on the beat, white pills,
buyer photos full screen with a quote pill + 5 stars popping in + "buyer from X", then rating / struck price / price
counting down, and the end pill over the dimmed price scene. The music is a house track from reels/music (beats.json);
every scene is a whole number of beats, so the tempo sets the timing. Sound effects: reels/sfx.m4a (the reference video's
own effects, cut from it), moved so their peaks sit on the beats. Mix -15 LUFS / -1.5 dBTP.
Numbers (price, old price, stars, ratings) are read from data.json only, never from the spec."""
import hashlib, json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import kit as k  # noqa: E402

SFX = os.path.join(HERE, "sfx.m4a")
MUSIC = os.path.join(HERE, "music")
FPS, W, H = 30, 1080, 1920
BG = "#111313"

# timeline in beats (at 125 BPM 3 beats = 1.44 s, 4 = 1.92 s); cuts snap to the frame nearest the beat. The cta is not on
# the grid: it holds 2.27 s while the music fades out.
PLAN = [("hook", 4), ("winner", 3), ("result", 3), ("benefit0", 3), ("benefit1", 3), ("quote0", 3), ("quote1", 3), ("quote2", 3), ("price", 4)]
CTA_FRAMES = 68
PUNCH = {"winner", "quote0", "price"}  # the drop, the first buyer, the price
CARD = 880          # card scenes: 880 px wide, centred, top at 560
CARD_TOP = 560
PILL_IN, PILL_FADE = -0.03, 0.1  # pill pops in on the cut: 30% on the cut frame, full 2 frames later

EXTRA = """
.pill b{color:#2AABEE}.q{max-width:820px;padding:26px 46px}
.row{position:absolute;left:0;right:0;display:flex;justify-content:center}
.who{direction:rtl;background:#fff;border-radius:40px;padding:10px 30px;font-size:38px;font-weight:700;color:#16181d;box-shadow:0 8px 26px rgba(0,0,0,.28)}
.rate{font-size:50px;padding:20px 40px;gap:0}.rate .dot{margin:0 16px}
.old{direction:ltr;font-size:52px;font-weight:800;color:#a4a7ad;text-decoration:line-through;text-decoration-color:#e53935;text-decoration-thickness:6px}
.price{direction:ltr;background:#fff;border-radius:60px;padding:34px 76px;font-size:108px;font-weight:800;color:#16181d;
 font-variant-numeric:tabular-nums;box-shadow:0 10px 34px rgba(0,0,0,.28);line-height:1.1}
.var{direction:rtl;font-size:40px;font-weight:600;color:#c9ccd2}
"""
CSS = k.CSS.replace("</style>", EXTRA + "</style>")
STAR = ('<svg width="{s}" height="{s}" viewBox="0 0 24 24" style="display:block"><path fill="{c}" d="M12 1.8l3.1 6.6 7.2.8-5.4 '
        '4.9 1.5 7.1L12 17.6l-6.4 3.6 1.5-7.1L1.7 9.2l7.2-.8z"/></svg>')


def ff(args):
    k.run(args)


def chrome(name, body, w=W, h=H, css=CSS):
    """render html to a transparent PNG (cached on the html text)"""
    doc = css.replace("height:1920px", f"height:{h}px") + body + "</body></html>"
    key = hashlib.sha1(doc.encode()).hexdigest()[:10]
    png = os.path.join(R.pills, f"{name}-{key}.png")
    if not os.path.exists(png):
        html = png[:-4] + ".html"
        open(html, "w", encoding="utf-8").write(doc)
        subprocess.run([k.CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--allow-file-access-from-files",
                        *k.CHROME_FLAGS, "--default-background-color=00000000", "--force-device-scale-factor=1", f"--window-size={w},{h}",
                        f"--screenshot={png}", f"file://{html}"], check=True, capture_output=True, timeout=90)
    return png


def wrap(inner, top=210):
    return f'<div class="wrap" style="top:{top}px"><div class="pill">{inner}</div></div>'


# ---------------- layers ----------------
def frame_bg(name, img, x, y, w, h):
    """background for a card scene: #111313, a blurred dim copy of the photo as glow, the card's drop shadow"""
    body = (f'<div style="position:absolute;inset:0;background:{BG}"></div>'
            f'<img src="file://{img}" style="position:absolute;left:{x - w * 0.12}px;top:{y - h * 0.12}px;width:{w * 1.24}px;height:{h * 1.24}px;'
            f'object-fit:cover;filter:blur(80px) brightness(.55) saturate(1.2);opacity:.5;'
            f'-webkit-mask-image:radial-gradient(closest-side,#000 55%,transparent)">'
            f'<div style="position:absolute;left:{x}px;top:{y}px;width:{w}px;height:{h}px;border-radius:30px;background:{BG};'
            f'box-shadow:0 22px 60px rgba(0,0,0,.65)"></div>')
    return chrome(name, body)


def mask(w, h):
    return chrome(f"mask{w}x{h}", f'<div style="position:absolute;left:0;top:0;width:{w}px;height:{h}px;border-radius:30px;background:#fff"></div>',
                  css=CSS.replace("width:1080px", f"width:{w}px").replace("background:transparent", "background:#000"), w=w, h=h)


def prep(img, crop, out_w, out_h, scale):
    """crop fractions [x0,y0,x1,y1] of a photo, cover-fit to out_w:out_h, at `scale`x (zoompan needs headroom to move smoothly)"""
    src = os.path.join(R.img, img + ".png")
    x0, y0, x1, y1 = crop
    vf = (f"crop=iw*{x1 - x0}:ih*{y1 - y0}:iw*{x0}:ih*{y0},scale={out_w * scale}:{out_h * scale}:force_original_aspect_ratio=increase:flags=lanczos,"
          f"crop={out_w * scale}:{out_h * scale},format=rgb24")
    out = os.path.join(R.work, f"p-{img}-{out_w}x{out_h}-{hashlib.sha1(repr(crop).encode()).hexdigest()[:6]}.png")
    if not os.path.exists(out):
        ff(["-i", src, "-vf", vf, "-frames:v", "1", out])
    return out


def cover_crop(img, center, aspect):
    """largest crop of the given aspect around center (fractions), as fractions"""
    w, h = k.size(os.path.join(R.img, img + ".png"))
    cw, ch = (w, w / aspect) if w / h < aspect else (h * aspect, h)
    cx = min(max(center[0] * w - cw / 2, 0), w - cw); cy = min(max(center[1] * h - ch / 2, 0), h - ch)
    if max(W / cw, H / ch) > 1.05 and aspect == W / H:
        print(f"  WARNING {img}: {w}x{h} upscaled {max(W / cw, H / ch):.2f}x full screen")
    return [cx / w, cy / h, (cx + cw) / w, (cy + ch) / h]


def zoom_chain(i, n, w, h, z0=1.0, z1=1.05):
    return (f"[{i}:v]zoompan=z='{z0}+({z1 - z0})*on/{max(n - 1, 1)}':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d={n}:s={w}x{h}:fps={FPS},"
            f"setsar=1,format=rgba")


# ---------------- scenes ----------------
class Scene:
    def __init__(self, name, dur):
        self.name, self.dur, self.n = name, dur, round(dur * FPS)
        self.inputs, self.fc, self.last, self.i = [], [], None, 0
        self.punch = name in PUNCH

    def inp(self, args):
        self.inputs += args; self.i += 1
        return self.i - 1

    def still(self, png):
        return self.inp(["-loop", "1", "-framerate", str(FPS), "-t", f"{self.dur:.3f}", "-i", png])

    def base(self, png):
        j = self.still(png); self.fc.append(f"[{j}:v]format=rgba[b0]"); self.last = "b0"

    def over(self, label, x=0, y=0):
        nxt = f"o{len(self.fc)}"
        self.fc.append(f"[{self.last}][{label}]overlay={x}:{y}:format=auto[{nxt}]"); self.last = nxt

    def pill(self, png, t=PILL_IN, d=PILL_FADE):
        if self.punch:  # punch-in on the picture only, under the first pill
            self.fc.append(f"[{self.last}]{k.punch()},format=rgba[pz]"); self.last, self.punch = "pz", False
        j = self.still(png); lab = f"l{j}"
        pre = round(-t * FPS) if t < 0 else 0  # fade can't start before 0: pad frames in front, fade, cut them off again
        fade = (f"tpad=start={pre}:start_mode=clone,fade=in:st=0:d={d}:alpha=1,trim=start_frame={pre},setpts=PTS-STARTPTS" if pre
                else f"fade=in:st={t:.3f}:d={d}:alpha=1")
        self.fc.append(f"[{j}:v]format=rgba,{fade}[{lab}]"); self.over(lab)

    def card(self, img, crop, y=CARD_TOP, w=CARD, h=None, n=None):
        """zooming photo with rounded corners; returns its label (not yet placed)"""
        h = h or w; n = n or self.n
        j = self.inp(["-i", prep(img, crop, w, h, 4)]); m = self.still(mask(w, h)); lab = f"c{j}"  # one frame in: zoompan makes n
        self.fc.append(zoom_chain(j, n, w, h) + f"[z{j}];[{m}:v]format=gray,trim=end_frame={n}[m{j}];[z{j}][m{j}]alphamerge[{lab}]")
        return lab

    def render(self):
        out = os.path.join(R.work, f"{self.name}.mp4")
        self.fc.append(f"[{self.last}]trim=end_frame={self.n},{k.TO_YUV}[v]")
        ff([*self.inputs, "-filter_complex", ";".join(self.fc), "-map", "[v]", "-frames:v", str(self.n), "-r", str(FPS),
            "-c:v", "libx264", "-preset", "medium", "-crf", "10", "-pix_fmt", "yuv420p", *k.TAGS, out])
        return out


def card_scene(name, img, text, crop=(0, 0, 1, 1), h=CARD):
    s = Scene(name, T[name])
    x, y = (W - CARD) // 2, CARD_TOP + (CARD - h) // 2
    s.base(frame_bg(f"bg-{name}", prep(img, crop, CARD, h, 1), x, y, CARD, h))
    s.over(s.card(img, crop, h=h), x, y)
    s.pill(chrome(f"t-{name}", wrap(f"<span>{text}</span>")))
    return s


def result_scene(sp):
    dur = T["result"]; s = Scene("result", dur); x = (W - CARD) // 2
    w0, xf = BEAT * 0.75, 0.3  # before->after wipe: its middle near the scene's 2nd beat
    a_n, b_n = round((w0 + xf) * FPS), round((dur - w0) * FPS)
    s.base(frame_bg("bg-result", prep(sp["after"], (0, 0, 1, 1), CARD, CARD, 1), x, CARD_TOP, CARD, CARD))
    a = s.card(sp["before"], (0, 0, 1, 1), n=a_n); b = s.card(sp["after"], (0, 0, 1, 1), n=b_n)
    s.fc.append(f"[{a}]format=yuva444p[a2];[{b}]format=yuva444p[b2];[a2][b2]xfade=transition=smoothleft:duration={xf}:offset={w0:.3f},format=rgba[ab]")
    s.over("ab", x, CARD_TOP)
    s.pill(chrome("t-result", wrap(f"<span>{sp['text']}</span>")))
    return s


STAR_T = [0.12, 0.185, 0.25, 0.315, 0.38]  # the reference's five star ticks; its quote sound starts 0.10 s before the cut


def quote_scene(i, q):
    rv = D["reviews"][q["review"]]
    assert rv["stars"] >= 4 and q["img"].startswith(f"r{q['review']:02d}_"), f"quote {i}: photo must be from that 4-5 star review"
    s = Scene(f"quote{i}", T[f"quote{i}"])
    crop = cover_crop(q["img"], q.get("center", [0.5, 0.5]), W / H)
    iw, ih = k.size(os.path.join(R.img, q["img"] + ".png"))
    if q.get("fit", iw / ih > 0.8):  # near-square photo: whole photo full width under the pills, over a blurred dark copy of itself
        bg = os.path.join(R.work, f"blur-{q['img']}.png")
        ff(["-i", prep(q["img"], crop, W, H, 1), "-vf", "gblur=sigma=45,eq=brightness=-0.22:saturation=0.9", "-frames:v", "1", bg])
        s.base(bg)
        ph = min(round(W * ih / iw / 2) * 2, H - 640)
        j = s.inp(["-i", prep(q["img"], (0, 0, 1, 1), W, ph, 2)])
        s.fc.append(zoom_chain(j, s.n, W, ph, 1.0, 1.04) + "[ph]"); s.over("ph", 0, q.get("top", 640))
    else:
        j = s.inp(["-i", prep(q["img"], crop, W, H, 2)])
        s.fc.append(zoom_chain(j, s.n, W, H, 1.0, 1.04) + "[b0]"); s.last = "b0"
    s.pill(chrome(f"q{i}", wrap(f"<span>”{q['text']}”</span>").replace('class="pill"', 'class="pill q"')))
    for t, st in enumerate(STAR_T):  # stars pop in one by one, on the reference's ticks
        left = 540 - 2.5 * 76 + t * 76
        s.pill(chrome(f"star{t}", f'<div style="position:absolute;top:418px;left:{left + 5}px">{STAR.format(s=66, c="#FFC21A")}</div>'), st, 0.06)
    who = f"קונה {q['who']}".strip()
    s.pill(chrome(f"who-{hashlib.sha1(who.encode()).hexdigest()[:6]}", f'<div class="row" style="top:510px"><div class="who">{who}</div></div>'), 0.4, 0.12)
    return s


def price_scene():
    p, sp = D["product"], SPEC["price"]
    new, old = float(p["target_sale_price"]), float(p.get("target_original_price") or 0)
    stars, ratings = float(D["stats"]["evarageStar"]), int(D["ratings"])
    s = Scene("price", T["price"]); bw, bh = 760, 560; x, y = (W - bw) // 2, 1110
    s.base(frame_bg("bg-price", prep(sp["img"], sp.get("crop", (0, 0, 1, 1)), bw, bh, 1), x, y, bw, bh))
    s.over(s.card(sp["img"], sp.get("crop", (0, 0, 1, 1)), w=bw, h=bh), x, y)
    star = STAR.format(s=46, c="#16181d")
    s.pill(chrome("rating", f'<div class="wrap" style="top:380px"><div class="pill rate"><span>{stars:.1f}</span>&nbsp;{star}'
                            f'<span class="dot">·</span><span>{ratings:,} דירוגים</span></div></div>'), PILL_IN, PILL_FADE)
    drop = old > new * 1.02  # no real old price: no struck price, the price just shows
    label = f'<div class="row" style="top:900px"><div class="var">{sp["label"]}</div></div>' if sp.get("label") else ""
    if drop or label:
        s.pill(chrome("old", (f'<div class="row" style="top:560px"><div class="old">₪ {old:.2f}</div></div>' if drop else "") + label), 0.15, 0.12)
    # price counting down from the old price, ease-out, over the reference's tick run, chime on landing on the 3rd beat
    t0, t1, row = BEAT - 0.01, 3 * BEAT - 0.04, 240
    m = round((t1 - t0) * FPS) + 1
    vals = [old - (old - new) * (1 - (1 - f / (m - 1)) ** 3) if drop else new for f in range(m)]
    rows = "".join(f'<div class="row" style="top:{r * row}px;height:{row}px;align-items:center"><div class="price">₪ {val:.2f}</div></div>'
                   for r, val in enumerate(vals))
    strip = chrome("strip", rows, h=row * m)
    j = s.still(strip); n0 = round(t0 * FPS)
    s.fc.append(f"[{j}:v]format=rgba,crop={W}:{row}:0:'{row}*min(max(n-{n0},0),{m - 1})',fade=in:st={t0 - 0.05:.3f}:d=0.1:alpha=1[ps]")
    s.over("ps", 0, 640)
    return s


def cta_scene(prev):
    s = Scene("cta", T["cta"])
    last = os.path.join(R.work, "price-last.png")
    ff(["-sseof", "-0.1", "-i", prev, "-frames:v", "1", "-update", "1", last])
    s.base(last)
    c = SPEC["cta"]
    s.pill(chrome("cta", f'<div class="dim"></div><div class="wrap" style="top:1240px"><div class="pill end"><span>{c["big"]}</span><small>{c["small"]}</small></div></div>'),
           0.0, 0.15)
    return s


# ---------------- sound: the reference's own effects, re-placed on this video's cuts ----------------
def sound(cuts, total):
    ref = os.path.join(R.work, "ref.wav")
    if not os.path.exists(ref):
        ff(["-i", SFX, "-vn", "-ac", "2", "-ar", "48000", ref])
    hook, win, res, b1, b2, q1, q2, q3, pr, cta = cuts
    # (ref start, ref end, at): opening whoosh+chime; cut whooshes; reveal chime on the wipe; quote whoosh+pop+star ticks;
    # price whoosh+count ticks+register chime. Each moved so its peak (measured on the reference) lands on the beat of its
    # cut; the reveal chime on the wipe's beat; the price snippet split so its whoosh peaks on the cut and its register
    # chime on the 3rd beat (the snippet's chime is 0.46 s in).
    ev = [(0.00, 0.80, hook), (2.00, 2.40, win - 0.10), (3.80, 4.20, res - 0.18), (5.60, 6.32, res + BEAT), (6.40, 6.75, b1 - 0.12),
          (7.50, 7.82, b2 - 0.14), (10.18, 10.95, q1 - 0.10), (11.48, 12.20, q2 - 0.10), (12.78, 13.50, q3 - 0.10),
          (14.08, 14.46, pr - 0.21), (14.46, 16.40, pr + 2 * BEAT - 0.46), (9.28, 9.62, cta - 0.16)]
    fc, lab = [], []
    for i, (a, b, at) in enumerate(ev):
        fc.append(f"[0:a]atrim={a}:{b},asetpts=PTS-STARTPTS,afade=t=out:st={b - a - 0.03:.3f}:d=0.03,adelay={round(at * 1000)}:all=1[e{i}]")
        lab.append(f"[e{i}]")
    out = os.path.join(R.work, "sound.wav")
    ff(["-i", ref, "-filter_complex", ";".join(fc) + ";" + "".join(lab) + f"amix=inputs={len(lab)}:normalize=0,apad,atrim=0:{total:.3f}[a]",
        "-map", "[a]", "-c:a", "pcm_s16le", out])
    return out


class R:  # paths for this run
    pass


def main(workdir, out):
    global D, SPEC, BEAT, T
    R.dir = os.path.abspath(workdir); R.img = os.path.join(R.dir, "img")
    R.work = os.path.join(R.dir, "build"); R.pills = os.path.join(R.work, "pills")
    os.makedirs(R.pills, exist_ok=True)
    D = json.load(open(os.path.join(R.dir, "data.json")))
    SPEC = sp = json.load(open(os.path.join(R.dir, "spec.json")))
    tr = sp["track"]
    BEAT = 60 / tr["bpm"]
    F = k.beat_frames([b for _, b in PLAN], tr["bpm"])
    T = {n: (F[i + 1] - F[i]) / FPS for i, (n, _) in enumerate(PLAN)}
    T["cta"] = CTA_FRAMES / FPS
    scenes = [card_scene("hook", sp["hook"]["img"], sp["hook"]["text"]),
              card_scene("winner", sp["winner"]["img"], sp["winner"]["text"]),
              result_scene(sp["result"])]
    for i, b in enumerate(sp["benefits"]):
        crop = b.get("crop", (0, 0, 1, 1))
        ih = CARD
        if "crop" in b:  # keep the photo's shape: a wide crop gets a lower card
            w, h = k.size(os.path.join(R.img, b["img"] + ".png"))
            ih = min(CARD, round(CARD * (crop[3] - crop[1]) * h / ((crop[2] - crop[0]) * w) / 2) * 2)
        scenes.append(card_scene(f"benefit{i}", b["img"], b["text"], crop, ih))
    scenes += [quote_scene(i, q) for i, q in enumerate(sp["quotes"])]
    assert [s.name for s in scenes] + ["price"] == [n for n, _ in PLAN], "PLAN must list the spec's scenes in order"
    scenes.append(price_scene())
    clips = [s.render() for s in scenes]
    clips.append(cta_scene(clips[-1]).render())
    cuts, t = [], 0.0
    for c in clips:
        cuts.append(round(t, 3)); t += k.dur(c)
    assert all(abs(c - f / FPS) < 0.02 for c, f in zip(cuts, F)), (cuts, F)  # every cut on its beat frame
    cuts = [f / FPS for f in F]
    audio = os.path.join(R.work, "mix.wav")
    lufs, tp = k.mix_track(sound(cuts, t), t, R.work, audio, os.path.join(MUSIC, tr["file"]), tr["start"])
    print(f"music {tr['file']} from {tr['start']:.2f} s ({tr['bpm']:.0f} BPM), mix {lufs:.1f} LUFS, {tp:.1f} dBTP")
    ins = [a for c in clips for a in ("-i", c)]
    ff([*ins, "-i", audio, "-filter_complex", "".join(f"[{i}:v]" for i in range(len(clips))) + f"concat=n={len(clips)}:v=1:a=0[v]",
        "-map", "[v]", "-map", f"{len(clips)}:a", "-c:v", "libx264", "-preset", "slow", "-profile:v", "high", "-crf", "18",
        "-pix_fmt", "yuv420p", "-r", str(FPS), "-g", "60", "-keyint_min", "60", "-sc_threshold", "0", *k.TAGS,
        "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", "-t", f"{t:.3f}", out])
    sheet = out[:-4] + "-contact.png"
    ff(["-i", out, "-vf", "fps=2,scale=216:-1,tile=10x4:padding=4", "-frames:v", "1", sheet])
    mb = os.path.getsize(out) / 1e6
    assert mb < 20, f"{out} is {mb:.1f} MB: over the Reels bot's 20 MB limit"
    names = [n for n, _ in PLAN] + ["cta"]
    print(f"{out}: {k.dur(out):.2f} s, {mb:.1f} MB; sheet {sheet}")
    print("cuts:", {n: round(c, 2) for n, c in zip(names, cuts)})


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
