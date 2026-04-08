import { useCallback, useEffect, useRef, type RefObject } from "react";

const MAX_BOOST_MULTIPLIER = 3;

const isBoostSafeSource = (src: string) => {
  if (!src || typeof window === "undefined") return false;
  if (src.startsWith("blob:") || src.startsWith("data:")) return true;

  try {
    return new URL(src, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
};

export function useAudioBoost(mediaRef: RefObject<HTMLMediaElement>) {
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);

  const ensureAudioGraph = useCallback(async () => {
    const media = mediaRef.current;
    if (!media || typeof window === "undefined") return null;
    if (!isBoostSafeSource(media.currentSrc || media.src || "")) return null;

    const AudioContextCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return null;

    const context = audioContextRef.current ?? new AudioContextCtor();
    audioContextRef.current = context;

    if (!sourceNodeRef.current) {
      try {
        sourceNodeRef.current = context.createMediaElementSource(media);
      } catch {
        return null;
      }
    }

    if (!gainNodeRef.current) {
      gainNodeRef.current = context.createGain();
      sourceNodeRef.current.connect(gainNodeRef.current);
      gainNodeRef.current.connect(context.destination);
    }

    if (context.state === "suspended") {
      await context.resume().catch(() => {});
    }

    return { context, gainNode: gainNodeRef.current };
  }, [mediaRef]);

  const applyBoost = useCallback(async (percent: number, muted: boolean) => {
    const media = mediaRef.current;
    if (!media) return;

    const clampedPercent = Math.max(0, Math.min(MAX_BOOST_MULTIPLIER * 100, percent));
    const normalizedLevel = clampedPercent / 100;

    media.muted = muted;

    if (muted || clampedPercent <= 0) {
      media.volume = 0;
      if (gainNodeRef.current && audioContextRef.current) {
        gainNodeRef.current.gain.setValueAtTime(0, audioContextRef.current.currentTime);
      }
      return;
    }

    media.volume = Math.min(1, normalizedLevel);

    if (clampedPercent <= 100) {
      if (gainNodeRef.current && audioContextRef.current) {
        gainNodeRef.current.gain.setValueAtTime(1, audioContextRef.current.currentTime);
      }
      return;
    }

    const graph = await ensureAudioGraph();
    if (!graph) return;

    graph.gainNode.gain.setValueAtTime(
      Math.min(MAX_BOOST_MULTIPLIER, normalizedLevel),
      graph.context.currentTime,
    );
  }, [ensureAudioGraph, mediaRef]);

  useEffect(() => {
    return () => {
      sourceNodeRef.current?.disconnect();
      gainNodeRef.current?.disconnect();
      if (audioContextRef.current && audioContextRef.current.state !== "closed") {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, []);

  return {
    applyBoost,
    ensureAudioGraph,
    maxBoostPercent: MAX_BOOST_MULTIPLIER * 100,
  };
}