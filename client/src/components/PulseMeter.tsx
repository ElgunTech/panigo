import { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { HeartPulse, Loader2, RotateCcw, Send, X } from 'lucide-react';
import { useI18n } from '../i18n';
import { api } from '../lib/api';
import { estimatePulse, fingerDetected, MIN_QUALITY, pulseAbnormal, type PulseEstimate, type Sample } from '../lib/ppg';

const MEASURE_MS = 20_000;
const LIVE_AFTER_MS = 8_000;

type Phase = 'intro' | 'starting' | 'measuring' | 'result' | 'weak' | 'error';

/**
 * Phone-camera pulse (PPG). Fingertip on rear camera + torch → mean red per frame
 * → estimatePulse(). Everything runs on the device; only {bpm, quality} is sent.
 */
export function PulseMeter({ token, onClose, onSent }: { token: string | null; onClose: () => void; onSent: (bpm: number) => void }) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>('intro');
  const [finger, setFinger] = useState(false);
  const [progress, setProgress] = useState(0);
  const [live, setLive] = useState<number | null>(null);
  const [result, setResult] = useState<PulseEstimate | null>(null);
  const [torch, setTorch] = useState(true);
  const [sending, setSending] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const waveRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const samples = useRef<Sample[]>([]);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
  }, []);
  useEffect(() => stop, [stop]);

  const drawWave = () => {
    const c = waveRef.current;
    const s = samples.current;
    if (!c || s.length < 10) return;
    const ctx = c.getContext('2d')!;
    const last = s.slice(-180); // ~6 s
    const vals = last.map((x, i) => x.r - last.slice(Math.max(0, i - 15), i + 1).reduce((a, y) => a + y.r, 0) / Math.min(i + 1, 16));
    const max = Math.max(1, ...vals.map(Math.abs));
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.beginPath();
    vals.forEach((v, i) => {
      const x = (i / (vals.length - 1)) * c.width;
      const y = c.height / 2 + (v / max) * (c.height / 2 - 4);
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
    ctx.stroke();
  };

  const start = async () => {
    setPhase('starting');
    setResult(null);
    setLive(null);
    setProgress(0);
    samples.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 30 } },
        audio: false,
      });
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      // Torch (Android Chrome); iOS Safari has no torch API → hint to use daylight
      try {
        const caps = (track.getCapabilities?.() ?? {}) as { torch?: boolean };
        if (caps.torch) await track.applyConstraints({ advanced: [{ torch: true } as MediaTrackConstraintSet] });
        else setTorch(false);
      } catch {
        setTorch(false);
      }
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      setPhase('measuring');

      const canvas = document.createElement('canvas');
      canvas.width = 32;
      canvas.height = 24;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      let measuringSince = 0;
      let lastLive = 0;

      const loop = () => {
        ctx.drawImage(video, 0, 0, 32, 24);
        const { data } = ctx.getImageData(8, 6, 16, 12); // centre of the frame
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
        setFinger(ok);
        if (!ok) {
          // finger lifted → restart the window
          samples.current = [];
          measuringSince = 0;
          setProgress(0);
          setLive(null);
        } else {
          if (!measuringSince) measuringSince = s.t;
          samples.current.push(s);
          const elapsed = s.t - measuringSince;
          setProgress(Math.min(1, elapsed / MEASURE_MS));
          drawWave();
          if (elapsed > LIVE_AFTER_MS && s.t - lastLive > 1000) {
            lastLive = s.t;
            const e = estimatePulse(samples.current);
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
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
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

  return (
    <div className="fixed inset-0 z-[1200] flex items-end justify-center bg-slate-900/50 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={t.pulse.title}>
      <div className="w-full max-w-sm rounded-t-3xl bg-white p-5 pb-[calc(env(safe-area-inset-bottom)+20px)] shadow-2xl sm:rounded-3xl sm:pb-5">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
            <HeartPulse className="h-5 w-5 text-red-500" /> {t.pulse.title}
          </h2>
          <button onClick={close} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" aria-label={t.common.close}>
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-800">{t.pulse.disclaimer}</p>

        {/* hidden video feed — frames are analysed on-device */}
        <video ref={videoRef} playsInline muted className="hidden" />

        {phase === 'intro' && (
          <>
            <p className="mt-4 text-sm text-slate-600">{t.pulse.instruction}</p>
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
            <div className="flex items-end justify-between">
              <div className={clsx('text-sm font-semibold', finger ? 'text-slate-700' : 'text-red-600')}>{finger ? t.pulse.measuring : t.pulse.noFinger}</div>
              <div className="font-mono text-3xl font-bold text-slate-900">
                {live ?? '--'}
                <span className="ml-1 text-xs font-medium text-slate-400">{t.pulse.bpm}</span>
              </div>
            </div>
            <canvas ref={waveRef} width={320} height={70} className="mt-2 h-[70px] w-full rounded-lg bg-slate-50" />
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
              <div className="h-full rounded-full bg-red-500 transition-[width] duration-300" style={{ width: `${progress * 100}%` }} />
            </div>
            {!torch && <p className="mt-2 text-[11px] text-slate-500">{t.pulse.torchHint}</p>}
          </div>
        )}

        {phase === 'result' && result && (
          <div className="mt-4 text-center">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t.pulse.result}</div>
            <div className={clsx('mt-1 font-mono text-5xl font-bold', pulseAbnormal(result.bpm) ? 'text-red-600' : 'text-slate-900')}>
              ~{result.bpm}
              <span className="ml-1 text-base font-medium text-slate-400">{t.pulse.bpm}</span>
            </div>
            <div className="mt-1 text-xs text-slate-500">{result.quality >= 0.7 ? t.pulse.qualityGood : t.pulse.qualityFair}</div>
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
            <button onClick={start} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              <RotateCcw className="h-4 w-4" /> {t.pulse.retry}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
