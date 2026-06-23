"use client";

import { useEffect, useRef, useCallback } from "react";

interface AudioWaveformProps {
  mediaStream: MediaStream | null;
  barCount?: number;
  className?: string;
}

export const AudioWaveform: React.FC<AudioWaveformProps> = ({
  mediaStream,
  barCount = 40,
  className,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    // Use CSS dimensions (not canvas pixel dimensions) since ctx is pre-scaled
    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;
    ctx.clearRect(0, 0, w, h);

    const barW = 2.5;
    const totalBarSpace = barW * barCount;
    const gap = Math.max(1, (w - totalBarSpace) / (barCount - 1));
    const minH = 2;
    const maxH = h * 0.85;

    const step = Math.floor(bufferLength / barCount);

    for (let i = 0; i < barCount; i++) {
      const value = dataArray[i * step] ?? 0;
      const barH = minH + (value / 255) * (maxH - minH);
      const x = i * (barW + gap);
      const y = (h - barH) / 2;

      ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
      ctx.beginPath();
      ctx.roundRect(x, y, barW, barH, barW / 2);
      ctx.fill();
    }

    animFrameRef.current = requestAnimationFrame(draw);
  }, [barCount]);

  // Set up AudioContext + AnalyserNode when stream is available
  useEffect(() => {
    if (!mediaStream) return;

    const audioCtx = new AudioContext();
    audioCtxRef.current = audioCtx;

    const source = audioCtx.createMediaStreamSource(mediaStream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.7;
    source.connect(analyser);
    analyserRef.current = analyser;

    animFrameRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      analyserRef.current = null;
      source.disconnect();
      void audioCtx.close();
      audioCtxRef.current = null;
    };
  }, [mediaStream, draw]);

  // Sync canvas resolution with CSS size (for retina)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const syncSize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      const ctx = canvas.getContext("2d");
      ctx?.scale(dpr, dpr);
    };

    const observer = new ResizeObserver(syncSize);
    observer.observe(canvas);
    syncSize();

    return () => observer.disconnect();
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: "100%", height: "100%", display: "block" }}
    />
  );
};
