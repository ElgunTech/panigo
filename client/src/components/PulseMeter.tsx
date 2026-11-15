import { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Camera, HeartPulse, Loader2, RotateCcw, Send, Smartphone, X } from 'lucide-react';
import { useI18n } from '../i18n';
import { api } from '../lib/api';
import { estimatePulse, fingerDetected, MIN_QUALITY, pulseAbnormal, signalStats, type PulseEstimate, type Sample } from '../lib/ppg';

const MEASURE_MS = 20_000;
const LIVE_AFTER_MS = 7_000;
/** consecutive "no finger" frames (~0.7 s) before the window restarts — tolerates small moves */
const LOST_FRAMES = 20;

type Phase = 'intro' | 'starting' | 'measuring' | 'result' | 'weak' | 'error';
type Facing = 'environment' | 'user';

type VideoWithRvfc = HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number; cancelVideoFrameCallback?: (h: number) => void };

/**
 * Phone-camera pulse (PPG).
 *  - rear camera: lit by the torch (Android Chrome); iOS has no torch API → bright place
 *  - front camera: has no LED at all → the SCREEN becomes the light (full-white overlay)
 * Frames are analysed on the device; only {bpm, quality} is sent to the server.
 */
export function PulseMeter({ token, onClose, onSent }: { token: string | null; onClose: () => void; onSent: (bpm: number) => void }) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>('intro');
  const [facing, setFacing] = useState<Facing>('environment');
  const [finger, setFinger] = useState(false);
  const [progress, setProgress] = useState(0);
  const [live, setLive] = useState<number | null>(null);
  const [result, setResult] = useState<PulseEstimate | null>(null);
  const [torch, setTorch] = useState(true);
  const [sending, setSending] = useState(false);
  const [diag, setDiag] = useState<{ r: number; g: number; fps: number; q?: number; ch?: string } | null>(null);

  const videoRef = useRef<VideoWithRvfc>(null);
  const waveRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<{ raf?: number; rvfc?: number }>({});
  const samples = useRef<Sample[]>([]);

  const stop = useCallback(() => {
    const v = videoRef.current;
    if (frameRef.current.raf) cancelAnimationFrame(frameRef.current.raf);
    if (frameRef.current.rvfc && v?.cancelVideoFrameCallback) v.cancelVideoFrameCallback(frameRef.current.rvfc);
    frameRef.current = {};
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
  }, []);
  useEffect(() => stop, [stop]);

  const drawWave = () => {
    const c = waveRef.current;
    const s = samples.current;
    if (!c || s.length < 10) return;
    const ctx = c.getContext('2d')!;
    const last = s.slice(-180);
    // show the channel with more variation (green when red is saturated)
    const ch: 'r' | 'g' = last.every((x) => x.r > 250) ? 'g' : 'r';
    const vals = last.map((x, i) => x[ch] - last.slice(Math.max(0, i - 15), i + 1).reduce((a, y) => a + y[ch], 0) / Math.min(i + 1, 16));
    const max = Math.max(0.5, ...vals.map(Math.abs));
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.beginPath();
    vals.forEach((v, i) => {
      const x = (i / (vals.length - 1)) * c.width;
      const y = c.height / 2 - (v / max) * (c.height / 2 - 4);
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
    ctx.stroke();
  };

  /** Lock exposure / white balance once the finger is on the lens (stops auto-adjust drift). */
  const lockCamera = async (track: MediaStreamTrack) => {
    try {
      const caps = (track.getCapabilities?.() ?? {}) as { exposureMode?: string[]; whiteBalanceMode?: string[] };
      const adv: Record<string, string>[] = [];
      if (caps.exposureMode?.includes('manual')) adv.push({ exposureMode: 'manual' });
      if (caps.whiteBalanceMode?.includes('manual')) adv.push({ whiteBalanceMode: 'manual' });
      if (adv.length) await track.applyConstraints({ advanced: adv as MediaTrackConstraintSet[] });
    } catch {
      /* not supported — the band-pass filter handles drift */
    }
  };

  const start = async () => {
    stop();
    setPhase('starting');
    setResult(null);
    setLive(null);
    setProgress(0);
    setDiag(null);
    samples.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facing }, width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 30 } },
        audio: false,
      });
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      if (facing === 'environment') {
        try {
          const caps = (track.getCapabilities?.() ?? {}) as { torch?: boolean };
          if (caps.torch) await track.applyConstraints({ advanced: [{ torch: true } as MediaTrackConstraintSet] });
          else setTorch(false);
        } catch {
          setTorch(false);
        }
      }
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      setPhase('measuring');

      const canvas = document.createElement('canvas');
      canvas.width = 32;
      canvas.height = 24;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      let since = 0;
      let lastLive = 0;
      let lost = 0;
      let locked = false;

      const onFrame = () => {
        ctx.drawImage(video, 0, 0, 32, 24);
        const { data } = ctx.getImageData(6, 4, 20, 16); // central area
        let r = 0;
        let g = 0;
        let b = 0;
        for (let i = 0; i < data.length; i += 4) {
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
        }
        const n = data.length / 4;
        const s: Sample = { t: performance.now(), r: r / n, g: g / n, b: b / n };
        const ok = fingerDetected(s);
        lost = ok ? 0 : lost + 1;
        setFinger(ok || lost < LOST_FRAMES);

        if (lost >= LOST_FRAMES) {
          // finger really lifted → restart the window
          samples.current = [];
          since = 0;
          setProgress(0);
          setLive(null);
        } else if (ok || since) {
          if (!since) since = s.t;
          samples.current.push(s);
          const elapsed = s.t - since;
          if (!locked && elapsed > 1500) {
            locked = true;
            void lockCamera(track);
          }
          setProgress(Math.min(1, elapsed / MEASURE_MS));
          drawWave();
          if (s.t - lastLive > 1000) {
            lastLive = s.t;
            const st = signalStats(samples.current);
            const e = elapsed > LIVE_AFTER_MS ? estimatePulse(samples.current) : null;
            if (st) setDiag({ ...st, q: e?.quality, ch: e?.channel });
            if (e && e.quality >= MIN_QUALITY) setLive(e.bpm);
          }
          if (elapsed >= MEASURE_MS) {
            stop();
            const e = estimatePulse(samples.current);
            if (e && e.quality >= MIN_QUALITY) {
              setResult(e);
              setPhase('result');
            } else setPhase('weak');
            return;
          }
        }
        schedule();
      };
      // Sample real camera frames when the browser supports it, else every animation frame
      const schedule = () => {
        if (video.requestVideoFrameCallback) frameRef.current.rvfc = video.requestVideoFrameCallback(onFrame);
        else frameRef.current.raf = requestAnimationFrame(onFrame);
      };
      schedule();
    } catch {
      stop();
      setPhase('error');
    }
  };

  const send = async () => {
    if (!result) return;
    setSending(true);
    try {
      await api('/citizen/vitals', { body: { bpm: result.bpm, quality: Math.round(result.quality * 100) / 100, method: 'camera_ppg' }, token });
      onSent(result.bpm);
      onClose();
    } catch {
      setSending(false);
    }
  };

  const close = () => {
    stop();
    onClose();
  };

  const screenLight = facing === 'user' && phase === 'measuring';

  return (
    <div className="fixed inset-0 z-[1200] flex items-end justify-center bg-slate-900/50 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={t.pulse.title}>
      {/* Front camera has no LED: the whole screen becomes a white light source */}
      {screenLight && <div className="fixed inset-0 bg-white" aria-hidden />}

      <div className={clsx('relative w-full max-w-sm rounded-t-3xl bg-white p-5 pb-[calc(env(safe-area-inset-bottom)+20px)] sm:rounded-3xl sm:pb-5', screenLight ? 'shadow-none' : 'shadow-2xl')}>
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
            <HeartPulse className="h-5 w-5 text-red-500" /> {t.pulse.title}
          </h2>
          <button onClick={close} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" aria-label={t.common.close}>
            <X className="h-5 w-5" />
          </button>
        </div>
        {!screenLight && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-800">{t.pulse.disclaimer}</p>}

        {/* Visible (small) preview: browsers throttle hidden videos to a few fps, which kills the PPG signal */}
        <video
          ref={videoRef}
          playsInline
          muted
          className={clsx(
            'pointer-events-none rounded-xl object-cover ring-2 ring-red-200',
            phase === 'measuring' || phase === 'starting' ? 'float-right ml-3 mt-4 h-14 w-14' : 'fixed -left-[9999px] h-14 w-14',
          )}
        />

        {phase === 'intro' && (
          <>
            <div className="mt-4 grid grid-cols-2 gap-2" role="radiogroup" aria-label={t.pulse.camera}>
              {(
                [
                  ['environment', t.pulse.rear, Camera],
                  ['user', t.pulse.front, Smartphone],
                ] as const
              ).map(([id, label, Icon]) => (
                <button
                  key={id}
                  role="radio"
                  aria-checked={facing === id}
                  onClick={() => setFacing(id)}
                  className={clsx('flex flex-col items-center gap-1 rounded-xl border px-2 py-2.5 text-[11px] font-semibold transition', facing === id ? 'border-red-400 bg-red-50 text-red-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50')}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-3 text-sm text-slate-600">{facing === 'user' ? t.pulse.frontInstruction : t.pulse.instruction}</p>
            <p className="mt-1 text-[11px] text-slate-500">{t.pulse.pressHint}</p>
            <button onClick={start} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-red-500 py-3 text-sm font-bold text-white shadow-lg shadow-red-500/25 hover:bg-red-600">
              <HeartPulse className="h-4 w-4" /> {t.pulse.start}
            </button>
          </>
        )}

        {phase === 'starting' && (
          <div className="mt-6 flex items-center justify-center gap-2 py-6 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> {t.pulse.starting}
          </div>
        )}

        {phase === 'measuring' && (
          <div className="mt-4">
            <div className="flex items-end justify-between gap-2">
              <div className={clsx('text-sm font-semibold', finger ? 'text-slate-700' : 'text-red-600')}>{finger ? (facing === 'user' ? t.pulse.frontLight : t.pulse.measuring) : t.pulse.noFinger}</div>
              <div className="shrink-0 font-mono text-3xl font-bold text-slate-900">
                {live ?? '--'}
                <span className="ml-1 text-xs font-medium text-slate-400">{t.pulse.bpm}</span>
              </div>
            </div>
            <canvas ref={waveRef} width={320} height={70} className="mt-2 h-[70px] w-full rounded-lg bg-slate-50" />
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
              <div className="h-full rounded-full bg-red-500 transition-[width] duration-300" style={{ width: `${progress * 100}%` }} />
            </div>
            {facing === 'environment' && !torch && <p className="mt-2 text-[11px] text-slate-500">{t.pulse.torchHint}</p>}
            {diag && (
              <p className="mt-2 font-mono text-[10px] text-slate-400">
                {t.pulse.diag}: R {diag.r} · G {diag.g} · {diag.fps} fps{diag.q !== undefined ? ` · q ${diag.q.toFixed(2)} (${diag.ch})` : ''}
              </p>
            )}
          </div>
        )}

        {phase === 'result' && result && (
          <div className="mt-4 text-center">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t.pulse.result}</div>
            <div className={clsx('mt-1 font-mono text-5xl font-bold', pulseAbnormal(result.bpm) ? 'text-red-600' : 'text-slate-900')}>
              ~{result.bpm}
              <span className="ml-1 text-base font-medium text-slate-400">{t.pulse.bpm}</span>
            </div>
            <div className="mt-1 text-xs text-slate-500">{result.quality >= 0.6 ? t.pulse.qualityGood : t.pulse.qualityFair}</div>
            {pulseAbnormal(result.bpm) && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{t.pulse.abnormal}</p>}
            <div className="mt-4 flex gap-2">
              <button onClick={start} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                <RotateCcw className="h-4 w-4" /> {t.pulse.retry}
              </button>
              <button onClick={send} disabled={sending} className="flex flex-[1.4] items-center justify-center gap-1.5 rounded-xl bg-red-500 py-2.5 text-sm font-bold text-white hover:bg-red-600 disabled:opacity-60">
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {t.pulse.send}
              </button>
            </div>
          </div>
        )}

        {(phase === 'weak' || phase === 'error') && (
          <div className="mt-4">
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{phase === 'weak' ? t.pulse.weak : t.pulse.noCamera}</p>
            {diag && phase === 'weak' && (
              <p className="mt-2 font-mono text-[10px] text-slate-400">
                {t.pulse.diag}: R {diag.r} · G {diag.g} · {diag.fps} fps{diag.q !== undefined ? ` · q ${diag.q.toFixed(2)}` : ''}
              </p>
            )}
            <div className="mt-3 flex gap-2">
              <button onClick={() => setPhase('intro')} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                {t.pulse.camera}…
              </button>
              <button onClick={start} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-red-500 py-2.5 text-sm font-semibold text-white hover:bg-red-600">
                <RotateCcw className="h-4 w-4" /> {t.pulse.retry}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
