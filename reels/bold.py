"""The bold look of the style-3 Reel (owner's 14 answers, 2026-11-16): no caption bubbles. Instead:
- a giant word lands in the first half-second (it drops, slams or slides in, rotating per reel), with a boom;
- the spoken words appear 2-3 at a time, in big white letters with a soft shadow, the word being said in the accent colour
  (rotating per reel), placed where the product isn't (Gemini's "pos" for each shot), inside Meta's safe zone;
- one or two emoji pop on the strongest moments;
- the price: the old one shows, a red line strikes it, then the number counts down to the real price, with a ka-ching, and
  stays to the end above the call to action;
- sounds only at the strong moments (the opening word, the drop, the price).
Captions and the price are each rendered as one image sequence (concat), so the overlay stage takes few inputs."""
import hashlib, os, subprocess

import fx
import kit as k

W, H = 1080, 1920
Y = {"upper": 470, "middle": 860, "lower": 1110}  # caption centre lines, all inside Meta's safe zone (269-1248)
PRICE_Y = 500
SHADOW = "text-shadow:0 0 3px rgba(0,0,0,.95),0 3px 14px rgba(0,0,0,.75),0 0 46px rgba(0,0,0,.45)"
BASE = ("<!doctype html><html lang='he'><head><meta charset='utf-8'><style>html,body{margin:0;width:1080px;height:1920px;"
        "background:transparent;font-family:'Heebo','Arial Hebrew',sans-serif}</style></head><body>")


def esc(s):
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def png(work, body):
    doc = BASE + body + "</body></html>"
    path = os.path.join(work, "bold", hashlib.sha1(doc.encode()).hexdigest()[:14] + ".png")
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        open(path[:-4] + ".html", "w", encoding="utf-8").write(doc)
        subprocess.run([k.CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", *k.CHROME_FLAGS,
                        "--default-background-color=00000000", "--force-device-scale-factor=1", f"--window-size={W},{H}",
                        f"--screenshot={path}", f"file://{path[:-4]}.html"], check=True, capture_output=True, timeout=90)
    return path


def blank(work):
    return png(work, "")


def sequence(work, name, frames, D):
    """frames: [(png, start, end)] in time order (gaps are blank) -> a concat list covering 0..D, as ffmpeg input args"""
    lst, t, empty = [], 0.0, blank(work)
    for p, s, e in frames:
        s, e = max(s, t), min(e, D)
        if e <= s: continue
        if s > t + 1e-3: lst.append((empty, s - t))
        lst.append((p, e - s)); t = e
    if t < D: lst.append((empty, D - t))
    path = os.path.join(work, f"{name}.ffconcat")
    with open(path, "w") as f:
        f.write("ffconcat version 1.0\n")
        for p, d in lst: f.write(f"file '{p}'\nduration {d:.4f}\n")
        f.write(f"file '{lst[-1][0]}'\n")  # the concat demuxer needs the last file again for its duration to count
    return ["-f", "concat", "-safe", "0", "-i", path]


# ---------------- captions: 2-3 words at a time, the spoken one in colour ----------------
def chunks(words, most=3, chars=16):
    out, cur = [], []
    for w in words:
        if cur and (len(cur) >= most or sum(len(x["w"]) for x in cur) + len(w["w"]) > chars):
            out.append(cur); cur = []
        cur.append(w)
    return out + ([cur] if cur else [])


def caption_body(ws, hot, y, accent):
    spans = "".join(f"<span style='color:{accent if i == hot else '#fff'}'>{esc(w['w'].rstrip('.'))}</span>" for i, w in enumerate(ws))
    return (f"<div style='position:absolute;left:80px;right:80px;top:{y}px;transform:translateY(-50%);display:flex;flex-wrap:wrap;"
            f"justify-content:center;gap:0 24px;direction:rtl;font-weight:900;font-size:96px;line-height:1.08;text-align:center;{SHADOW}'>"
            f"{spans}</div>")


def caption_frames(spec, rt, t, last, D, work, start=0.62):
    # rt: a time in the voice take -> its time in the reel
    """one PNG per (chunk, spoken word); each shows from its word's start until the next word starts"""
    accent, shots = spec["accent"], spec["shots"]
    def pos_at(x):
        i = max(j for j in range(len(t) - 1) if t[j] <= x + 1e-6) if x >= 0 else 0
        return "lower" if i >= last - 1 else shots[i].get("pos", "middle")  # the price sits above the last two shots' words
    frames, items = [], []
    for si, sent in enumerate(spec["captions"]):
        for ch in chunks(sent["words"]):
            for hot, w in enumerate(ch):
                items.append((ch, hot, max(rt(w["t0"]), start if si == 0 else 0)))
    for n, (ch, hot, s) in enumerate(items):
        e = items[n + 1][2] if n + 1 < len(items) else D
        if n + 1 < len(items) and items[n + 1][0] is not ch: e = min(e, rt(ch[-1]["t1"]) + 0.6)  # a pause: the words go soon after
        frames.append((png(work, caption_body(ch, hot, Y[pos_at(s)], accent)), s, e))
    return frames


# ---------------- the opening word ----------------
def hero_layers(spec, work, y=860):
    """[(png, start, end, (x, y) motion)] and the landing time; the entrance rotates per reel"""
    word, accent, how = spec["hero"], spec["accent"], spec.get("entrance", "drop")
    def body(size):
        return (f"<div style='position:absolute;left:40px;right:40px;top:{y}px;transform:translateY(-50%);text-align:center;"
                f"direction:rtl;font-weight:900;font-size:{size}px;line-height:1;color:{accent};{SHADOW}'>{esc(word)}</div>")
    end = 0.62
    if how == "slam":  # it hits the screen big and settles in three steps
        sizes = [(330, 0.0, 0.05), (260, 0.05, 0.1), (210, 0.1, end)]
        return [(png(work, body(s)), a, b, None) for s, a, b in sizes], 0.05
    p = png(work, body(210))
    if how == "side": return [(p, 0.0, end, fx.from_side(0.0, 0.22))], 0.2
    return [(p, 0.0, end, ("0", f"-1000*(1-{fx.back_out(0.0, 0.28)})"))], 0.25  # drop: falls from above, a small bounce


# ---------------- emoji ----------------
def emoji_layers(spec, t, work):
    out = []
    for e in spec.get("emoji", [])[:2]:
        i = e["shot"]
        if not (0 < i < len(t) - 1): continue
        y = Y[spec["shots"][i].get("pos", "middle")] - 190
        def body(size):
            return f"<div style='position:absolute;left:120px;top:{y}px;transform:translateY(-50%);font-size:{size}px;line-height:1'>{esc(e['char'])}</div>"
        s = t[i] + 0.15
        out += [(png(work, body(230)), s, s + 0.08, None), (png(work, body(170)), s + 0.08, s + 1.4, None)]
    return out


# ---------------- the price ----------------
def price_body(old, new_text, strike, accent):
    old_html = ""
    if old:
        old_html = (f"<div style='position:relative;display:inline-block;direction:ltr;font-size:92px;color:#fff;opacity:.92'>₪{esc(old)}"
                    f"<div style='position:absolute;left:-6px;top:52%;height:10px;width:{strike * 104:.0f}%;background:#ff3b30;"
                    f"border-radius:5px;transform:rotate(-8deg);transform-origin:left'></div></div>")
    new_html = f"<div style='direction:ltr;font-size:170px;line-height:1.05;color:{accent}'>{esc(new_text)}</div>" if new_text else ""
    return (f"<div style='position:absolute;left:0;right:0;top:{PRICE_Y}px;transform:translateY(-50%);text-align:center;"
            f"font-weight:900;{SHADOW}'>{old_html}{new_html}</div>")


def price_frames(spec, t, last, D, work):
    """the old price, struck by a red line, then the number counting down to the real price; returns (frames, landing time)"""
    accent = spec["accent"]
    new = float(spec["proof"]["price"])
    old = float(spec["proof"].get("old_price") or 0)
    old = old if old > new * 1.05 else 0
    s = t[last - 1]
    if not old:
        land = s + 0.35
        return [(png(work, price_body(None, f"₪{new:.2f}", 0, accent)), land, D)], land
    old_txt = f"{old:.2f}"
    frames = [(png(work, price_body(old_txt, "", 0, accent)), s, s + 0.35)]
    for j, p in enumerate([0.25, 0.5, 0.75, 1.0]):  # the strike is drawn across
        frames.append((png(work, price_body(old_txt, "", p, accent)), s + 0.35 + 0.06 * j, s + 0.41 + 0.06 * j))
    steps = fx.price_steps(old, new, 12)
    c0 = s + 0.6
    for j, val in enumerate(steps[:-1]):
        frames.append((png(work, price_body(old_txt, f"₪{val}", 1.0, accent)), c0 + 0.075 * j, c0 + 0.075 * (j + 1)))
    land = c0 + 0.075 * (len(steps) - 1)
    frames.append((png(work, price_body(old_txt, f"₪{new:.2f}", 1.0, accent)), land, D))
    return frames, land
