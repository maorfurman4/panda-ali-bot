"""Effects packs for the style-3 Reel (owner 2026-11-16: "effects that change the face of the videos, not another generic
one"). Everything is made here: synthesized sounds (no samples to license), motion as ffmpeg expressions, price cards as
HTML. A pack is picked per reel (spec["fx"]): "punchy" (things rise from below, a hard drop) or "slick" (things slide in
from the side, the price rolls down like a counter)."""
import math, random, struct, wave

SR = 48000
PACKS = ("punchy", "slick")


# ---------------- sounds (ported from the owner-approved style-1 kit, build/reelkit.py) ----------------
def _whoosh():
    n = int(0.30 * SR); y, out, ph = 0.0, [], 0.0
    for i in range(n):
        p = i / n; y += (0.02 + 0.25 * p * p) * (random.uniform(-1, 1) - y); ph += 2 * math.pi * (500 + 700 * p) / SR
        out.append((y * 1.6 + 0.25 * math.sin(ph)) * math.sin(math.pi * p) ** 2)
    return out


def _pop():
    n = int(0.12 * SR); ph, out = 0.0, []
    for i in range(n):
        t = i / SR; ph += 2 * math.pi * (520 + 260 * min(t / 0.05, 1)) / SR
        out.append(math.sin(ph) * min(t / 0.004, 1) * math.exp(-t / 0.04))
    return out


def _kaching():  # a bright two-note register chime
    n = int(0.9 * SR); out = []
    for i in range(n):
        t = i / SR; t2 = max(t - 0.07, 0)
        out.append(0.6 * math.sin(2 * math.pi * 2637 * t) * math.exp(-t / 0.22) + (0.5 * math.sin(2 * math.pi * 3520 * t2) * math.exp(-t2 / 0.3) if t > 0.07 else 0))
    return out


def _boom():  # a low thump under the drop
    n = int(0.5 * SR)
    return [math.sin(2 * math.pi * (110 * math.exp(-i / SR / 0.12) + 40) * i / SR) * math.exp(-i / SR / 0.16) for i in range(n)]


SOUND = {"whoosh": (_whoosh, 0.35), "pop": (_pop, 0.30), "kaching": (_kaching, 0.30), "boom": (_boom, 0.9)}


def write_sfx(path, D, events):
    """events: [(t, kind)] -> a 48 kHz stereo wav of D seconds"""
    random.seed(7)
    buf = [0.0] * int(SR * D)
    for t, kind in sorted(events):
        make, vol = SOUND[kind]
        i0 = int(t * SR)
        for i, v in enumerate(make()):
            if 0 <= i0 + i < len(buf): buf[i0 + i] += v * vol
    with wave.open(path, "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(b"".join(struct.pack("<hh", s, s) for s in (int(max(-1, min(1, v)) * 32767) for v in buf)))


# ---------------- motion (ffmpeg overlay expressions in the output time t) ----------------
def _p(s, d):
    return f"min(max((t-{s:.3f})/{d:.3f},0),1)"


def back_out(s, d):
    """0 -> 1 with a small overshoot, starting at s, over d seconds"""
    p = _p(s, d)
    return f"(1+2.70158*pow({p}-1,3)+1.70158*pow({p}-1,2))"


def ease_out(s, d):
    p = _p(s, d)
    return f"(1-pow(1-{p},3))"


def enter(kind, s, d=0.22, dist=60):
    """overlay x and y offsets for a caption coming in at s: "rise" (from below) or "side" (from the right)"""
    if kind == "rise": return "0", f"{dist}*(1-{back_out(s, d)})"
    return f"{dist * 2}*(1-{ease_out(s, d)})", "0"


def from_bottom(s, d=0.4):
    """a card that flies up from below the screen and lands softly (an overshoot of 10% of 1100 px threw it 110 px too high)"""
    return "0", f"1100*(1-{ease_out(s, d)})"


def from_side(s, d=0.3):
    return f"1100*(1-{ease_out(s, d)})", "0"


def shake(s, d=0.28, amp=14):
    """crop offsets for a short camera shake at s (the frame is cropped 2*amp and scaled back)"""
    on = f"between(t,{s:.3f},{s + d:.3f})"
    return f"{amp}+{amp}*sin(t*97)*{on}", f"{amp}+{amp}*cos(t*83)*{on}"


def price_steps(old, new, n=9):
    """a rolling price from the old one down to the sale price, easing out: n numbers, the last one the sale price"""
    return [f"{old + (new - old) * (1 - (1 - k / (n - 1)) ** 3):.2f}" for k in range(n)]
