#!/usr/bin/env python3
"""Jana runut bunyi video 60 saat (muzik beat + kesan bunyi) dari timeline.json ke WAV stereo. Hanya numpy.

Guna:  python3 audio.py <fail.wav>
Bunyi dijana sendiri (tiada sampel berhak cipta). Kesan bunyi disegerakkan dengan masa dalam timeline.json."""
import json
import sys
import wave
from pathlib import Path

import numpy as np

SR = 44100
TL = json.loads((Path(__file__).parent / "timeline.json").read_text())
DUR = TL["duration"]
# Garis masa dalaman (animasi video) ke masa output: dilaraskan mengikut hujung ayat suara (lihat "vo" dalam timeline.json).
_VO = TL.get("vo")
if _VO:
    ANCH = [(a / _VO["tempo"], b) for a, b in _VO["anchors"]]
else:
    ANCH = [(0.0, 0.0), (DUR, DUR)]


def to_out(ti):
    for (a0, b0), (a1, b1) in zip(ANCH, ANCH[1:]):
        if ti <= b1:
            return a0 + (a1 - a0) * (ti - b0) / (b1 - b0)
    return ANCH[-1][0]

N = int(DUR * SR)
rng = np.random.default_rng(7)

L = np.zeros(N)
R = np.zeros(N)
MUSIC_L = np.zeros(N)
MUSIC_R = np.zeros(N)
DUCK_BUS_L = np.zeros(N)  # bass dan pad: ditekan oleh kick (sidechain)
DUCK_BUS_R = np.zeros(N)


def tvec(sec):
    return np.arange(int(sec * SR)) / SR


def put(bufL, bufR, sig, t, gain=1.0, pan=0.0):
    i = int(round(t * SR))
    if i >= N or i + len(sig) <= 0:
        return
    if i < 0:
        sig = sig[-i:]
        i = 0
    seg = sig[: N - i]
    a = (pan + 1) * np.pi / 4
    bufL[i : i + len(seg)] += seg * gain * np.cos(a)
    bufR[i : i + len(seg)] += seg * gain * np.sin(a)


def bandpass(x, lo=None, hi=None):
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    m = np.ones_like(f)
    if lo:
        m *= 1 / (1 + (lo / np.maximum(f, 1e-3)) ** 6)
    if hi:
        m *= 1 / (1 + (f / hi) ** 6)
    return np.fft.irfft(X * m, len(x))


def fade(x, a=0.003, r=0.01):
    n = len(x)
    e = np.ones(n)
    na = max(1, int(a * SR))
    nr = max(1, int(r * SR))
    e[:na] = np.linspace(0, 1, na)
    e[-nr:] = np.minimum(e[-nr:], np.linspace(1, 0, nr))
    return x * e


# ------------------------------------------------------------------ instrumen
def kick():
    t = tvec(0.34)
    f = 46 + 90 * np.exp(-t * 32)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 8.5)
    s += 0.35 * np.sin(2 * np.pi * 1600 * t) * np.exp(-t * 400)
    return fade(s, 0.001, 0.02)


def clap():
    t = tvec(0.25)
    n = bandpass(rng.standard_normal(len(t)), 900, 6500)
    e = np.zeros_like(t)
    for off in (0, 0.011, 0.023):
        e += np.where(t >= off, np.exp(-(t - off) * 55), 0)
    e += 0.7 * np.where(t >= 0.03, np.exp(-(t - 0.03) * 22), 0)
    return fade(n * e * 0.9, 0.0005, 0.03)


def hat(open_=False):
    t = tvec(0.22 if open_ else 0.06)
    n = bandpass(rng.standard_normal(len(t)), 6500, 15000)
    return fade(n * np.exp(-t * (16 if open_ else 95)) * 0.5, 0.0005, 0.01)


def bass(freq, length):
    t = tvec(length)
    s = np.sin(2 * np.pi * freq * t) + 0.45 * np.sin(2 * np.pi * freq * 2 * t) + 0.18 * np.sin(2 * np.pi * freq * 3 * t)
    s *= np.exp(-t * 3.2)
    return fade(s * 0.8, 0.006, 0.04)


def pluck(freq, length=0.45):
    t = tvec(length)
    s = np.zeros_like(t)
    for k, a in enumerate((1.0, 0.5, 0.33, 0.2, 0.12), start=1):
        s += a * np.sin(2 * np.pi * freq * k * t) * np.exp(-t * (7 + 5 * k))
    return fade(s * 0.5, 0.002, 0.03)


def pad(freqs, length):
    t = tvec(length)
    s = np.zeros_like(t)
    for f in freqs:
        for det in (-0.004, 0.004):
            s += np.sin(2 * np.pi * f * (1 + det) * t + rng.random() * 6)
    e = np.minimum(1, t / 0.6) * np.minimum(1, (length - t) / 0.5)
    return s * e * 0.12


# ------------------------------------------------------------------ kesan bunyi
def sfx(kind, **kw):
    if kind == "blip":  # notifikasi chat generik: dua nada pendek
        out = np.zeros(int(0.22 * SR))
        for off, f in ((0, 1320), (0.075, 990)):
            t = tvec(0.1)
            s = (np.sin(2 * np.pi * f * t) + 0.3 * np.sin(2 * np.pi * f * 2 * t)) * np.exp(-t * 30)
            i = int(off * SR)
            out[i : i + len(s)] += fade(s, 0.001, 0.01) * 0.6
        return out
    if kind == "tap":
        t = tvec(0.09)
        s = np.sin(2 * np.pi * 170 * t) * np.exp(-t * 60) + 0.5 * np.sin(2 * np.pi * 2100 * t) * np.exp(-t * 220)
        return fade(s * 0.9, 0.0005, 0.01)
    if kind == "pop":
        t = tvec(0.14)
        f = 480 + 520 * (1 - np.exp(-t * 40))
        return fade(np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 26) * 0.8, 0.001, 0.02)
    if kind == "chime":
        t = tvec(1.4)
        s = sum(a * np.sin(2 * np.pi * f * t) * np.exp(-t * d) for f, a, d in ((880, 1, 3.2), (1318.5, 0.6, 4), (1760, 0.35, 5), (2637, 0.15, 7)))
        return fade(s * 0.55, 0.002, 0.2)
    if kind == "whoosh":
        t = tvec(0.7)
        n = rng.standard_normal(len(t))
        out = np.zeros_like(n)
        for k, (lo, hi) in enumerate(((300, 1200), (700, 3500), (1500, 7000))):
            e = np.exp(-((t - (0.18 + 0.12 * k)) ** 2) / 0.012)
            out += bandpass(n, lo, hi) * e
        return fade(out * 0.9, 0.01, 0.08)
    if kind == "riser":
        ln = kw.get("len", 1.5)
        t = tvec(ln)
        e = (t / ln) ** 2.2
        n = bandpass(rng.standard_normal(len(t)), 1500 + 0 * t[0], 9000) * e
        f = 200 + 1400 * (t / ln) ** 2
        tone = np.sin(2 * np.pi * np.cumsum(f) / SR) * e * 0.35
        return fade((n * 0.6 + tone) * 0.8, 0.01, 0.02)
    if kind == "boom":
        t = tvec(1.2)
        f = 70 * np.exp(-t * 1.6) + 28
        s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 3.0)
        n = bandpass(rng.standard_normal(len(t)), 200, 5000) * np.exp(-t * 14) * 0.5
        return fade((s + n) * 1.0, 0.001, 0.1)
    if kind == "ding":  # notifikasi masuk: dua nada naik, bukan bunyi mana-mana aplikasi sebenar
        out = np.zeros(int(1.2 * SR))
        for off, f in ((0, 1046.5), (0.13, 1568)):
            t = tvec(1.0)
            s = (np.sin(2 * np.pi * f * t) + 0.4 * np.sin(2 * np.pi * f * 2.76 * t) * np.exp(-t * 12)) * np.exp(-t * 4.5)
            i = int(off * SR)
            out[i : i + len(s)] += fade(s, 0.001, 0.05) * 0.7
        return out
    if kind == "sent":
        t = tvec(0.25)
        f = 700 + 500 * (t / 0.25)
        return fade(np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 14) * 0.6, 0.001, 0.03)
    raise ValueError(kind)


# ------------------------------------------------------------------ muzik
BPM = TL["music"]["bpm"]
BEAT = 60 / BPM
START = to_out(TL["music"]["start"])
END = TL["music"]["end"] - 1.3
T_ARP = to_out(10.0)
T_PAD = to_out(28.0)
BARS = [  # (akar bass, kord arp)
    (110.0, (220.0, 261.63, 329.63)),   # Am
    (87.31, (174.61, 220.0, 261.63)),   # F
    (130.81, (261.63, 329.63, 392.0)),  # C
    (98.0, (196.0, 246.94, 293.66)),    # G
]
KICKS = []
b = 0
while START + b * BEAT < END:
    t = START + b * BEAT
    bar = int((t - START) / (BEAT * 4)) % 4
    root, chord = BARS[bar]
    beat_in_bar = b % 4
    # kick: setiap detik; hi-hat: sela detik; clap: detik 2 dan 4
    put(MUSIC_L, MUSIC_R, kick(), t, 0.95)
    KICKS.append(t)
    if beat_in_bar in (1, 3) and t >= T_ARP:
        put(MUSIC_L, MUSIC_R, clap(), t, 0.55, pan=0.1)
    put(MUSIC_L, MUSIC_R, hat(), t + BEAT / 2, 0.55, pan=-0.2)
    if t >= T_PAD:
        put(MUSIC_L, MUSIC_R, hat(True), t + BEAT * 0.75, 0.3, pan=0.25)
        put(MUSIC_L, MUSIC_R, hat(), t, 0.3, pan=0.2)
    # bass: nota akar pada setiap setengah detik
    for h in (0, 1):
        put(DUCK_BUS_L, DUCK_BUS_R, bass(root if h == 0 or beat_in_bar % 2 == 0 else root * 1.5, BEAT * 0.9), t + h * BEAT / 2, 0.55)
    # arp pluck
    if t >= T_ARP:
        for h in range(2):
            idx = (b * 2 + h) % 4
            f = chord[[0, 1, 2, 1][idx]] * (2 if t >= T_PAD else 1)
            put(MUSIC_L, MUSIC_R, pluck(f), t + h * BEAT / 2, 0.42 if t < T_PAD else 0.5, pan=-0.35 if h == 0 else 0.35)
    if beat_in_bar == 0 and t >= T_PAD:
        put(DUCK_BUS_L, DUCK_BUS_R, pad(chord, BEAT * 4), t, 1.0)
    b += 1

# sidechain: bass dan pad ditekan seketika selepas setiap kick
duck = np.ones(N)
for tk in KICKS:
    i = int(tk * SR)
    seg = min(N - i, int(0.35 * SR))
    tt = np.arange(seg) / SR
    duck[i : i + seg] = np.minimum(duck[i : i + seg], 1 - 0.65 * np.exp(-tt * 9))
MUSIC_L += DUCK_BUS_L * duck
MUSIC_R += DUCK_BUS_R * duck

# pembukaan (0 hingga 5 saat): dron rendah yang makin kuat
D0 = START
t = tvec(D0)
drone = (np.sin(2 * np.pi * 55 * t) + 0.6 * np.sin(2 * np.pi * 82.5 * t * (1 + 0.02 * t / D0))) * (0.25 * (t / D0) ** 1.6) * (0.75 + 0.25 * np.sin(2 * np.pi * (1.5 + 3 * t / D0) * t))
MUSIC_L[: len(t)] += drone
MUSIC_R[: len(t)] += drone

# kesan bunyi
for ev in TL["sfx"]:
    kind = ev["type"]
    sig = sfx(kind, **({"len": ev["len"]} if "len" in ev else {}))
    t0 = to_out(ev["t"]) - (ev["len"] if kind == "riser" else 0)
    gain = {"blip": 0.5, "tap": 0.7, "pop": 0.55, "chime": 0.55, "whoosh": 0.6, "riser": 0.5, "boom": 0.9, "ding": 0.8, "sent": 0.6}[kind]
    pan = float(np.sin(ev["t"] * 7)) * 0.3 if kind in ("blip", "pop") else 0.0
    put(L, R, sig, t0, gain, pan)

MIX_L = L + MUSIC_L * 0.55
MIX_R = R + MUSIC_R * 0.55

# akhir: muzik ditutup perlahan selepas 58.5
fadeout = np.ones(N)
f0 = int(58.6 * SR)
fadeout[f0:] = np.linspace(1, 0, N - f0) ** 1.5
MIX_L *= fadeout
MIX_R *= fadeout

peak = max(np.abs(MIX_L).max(), np.abs(MIX_R).max())
scale = 0.89 / peak
pcm = (np.stack([MIX_L, MIX_R], axis=1) * scale * 32767).astype("<i2")
with wave.open(sys.argv[1], "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print(f"{sys.argv[1]}: {DUR}s, puncak asal {peak:.2f}")
