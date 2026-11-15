"""Measure a music track's beat grid without listening: tempo, kick phase, and how strong each beat is.

    python3 beatgrid.py track.mp3 [bpm_lo bpm_hi]

Why not the ffmpeg skill's `scenes.py --beats`: on 3-house-berlin.mp3 it reported 139.5 BPM at confidence 0.26
("usable: false"), because its full-band envelope also sees the off-beat bass and hats. This listens to the kick band
only (lowpass 100 Hz), finds the tempo by autocorrelation, then folds the onsets over one beat to find the phase.
Output: BPM, phase (beat k is at phase + k*60/BPM), and one line per beat (index, time, kick strength, RMS dB),
so you can pick a lively section: a run of strong kicks at a steady RMS. Python standard library only."""
import math, struct, subprocess, sys

SR, DT = 4000, 0.005


def pcm(src, af):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", src, "-af", af, "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"],
                         capture_output=True, check=True).stdout
    return [v / 32768 for v in struct.unpack(f"<{len(raw) // 2}h", raw)]


def main(src, lo=100.0, hi=160.0):
    kick, full, step = pcm(src, "lowpass=f=100,lowpass=f=100"), pcm(src, "anull"), int(DT * SR)
    env = [math.sqrt(sum(v * v for v in kick[i:i + step]) / step) for i in range(0, len(kick) - step, step)]
    flux = [0.0] + [max(env[i] - env[i - 1], 0) for i in range(1, len(env))]

    def ac(bpm):
        lag = 60 / bpm / DT; l0 = int(lag); fr = lag - l0
        return sum(flux[i] * (flux[i + l0] * (1 - fr) + flux[i + l0 + 1] * fr) for i in range(len(flux) - l0 - 1))
    coarse = max((b / 10 for b in range(int(lo * 10), int(hi * 10))), key=ac)

    def fold(bpm, nb=96):  # onsets folded over one beat: a sharp peak means the grid holds over the whole track
        P, bins = 60 / bpm, [0.0] * nb
        for i, f in enumerate(flux):
            if f: bins[int(i * DT / P * nb) % nb] += f
        return bins
    # 0.1 BPM is too coarse: 0.05 BPM off drifts ~35 ms over 3 minutes, so kicks late in a track fall off the grid.
    bpm = max((coarse + d / 100 for d in range(-15, 16)), key=lambda b: max(fold(b)) / (sum(fold(b)) or 1))
    P, bins = 60 / bpm, fold(bpm)
    phase = (max(range(len(bins)), key=bins.__getitem__) + 0.5) * P / len(bins)
    print(f"tempo {bpm:.2f} BPM, beat {P:.4f} s, phase {phase:.3f} s")
    t, k = phase, 0
    while t < len(full) / SR - P:
        i = int(round(t / DT)); seg = full[int(t * SR):int((t + P) * SR)]
        rms = 20 * math.log10(math.sqrt(sum(v * v for v in seg) / len(seg)) + 1e-9)
        print(f"{k:4d} {t:7.3f}  kick {max(flux[max(i - 2, 0):i + 3]) * 1000:6.1f}  rms {rms:6.1f}")
        t += P; k += 1


if __name__ == "__main__":
    main(sys.argv[1], *map(float, sys.argv[2:4]))
