/**
 * 资金雷达工作台 · 语音朗读封装（刀4）
 * ------------------------------------------------------------
 * 浏览器 Web Speech API SpeechSynthesis：
 * - speak(segments, {onSegment})：逐段朗读，每段开始时回调下标（段落高亮）；
 * - pause / resume / stop：暂停、继续、停止（用户随时可打断）；
 * - 语速三档 0.8 / 1.0 / 1.2，选择持久化到 localStorage；
 * - 中文音色优先（遍历 voices 选 lang 含 zh 的，zh-CN 更优先）。
 * 本地 SenseVoice / 流式 TTS 为后续项（刀4 未实现，见文档标注）。
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { storageGet, storageSet } from "@/lib/storage";

export const SPEECH_RATES = [0.8, 1.0, 1.2] as const;
export type SpeechRate = (typeof SPEECH_RATES)[number];

const RATE_KEY = "fr-tts-rate";

function isSpeechRate(v: number): v is SpeechRate {
  return v === 0.8 || v === 1.0 || v === 1.2;
}

function loadRate(): SpeechRate {
  const n = Number(storageGet(RATE_KEY));
  return isSpeechRate(n) ? n : 1.0;
}

/** 中文音色优先：zh-CN 精确匹配 → 任意 zh-* → null（用系统默认音色） */
function pickZhVoice(): SpeechSynthesisVoice | null {
  const synth = window.speechSynthesis;
  if (!synth) return null;
  const voices = synth.getVoices();
  if (!voices.length) return null;
  return (
    voices.find((v) => v.lang.toLowerCase().startsWith("zh-cn"))
    ?? voices.find((v) => v.lang.toLowerCase().startsWith("zh"))
    ?? null
  );
}

export interface UseSpeech {
  /** 当前浏览器是否支持语音朗读 */
  supported: boolean;
  speaking: boolean;
  paused: boolean;
  /** 正在朗读的段落下标（-1 = 无） */
  segment: number;
  rate: SpeechRate;
  /** 朗读一组段落；每段开始时回调其下标（用于段落高亮）。新朗读会先停掉上一段。 */
  speak: (segments: string[], opts?: { onSegment?: (index: number) => void }) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  setRate: (rate: SpeechRate) => void;
}

export function useSpeech(): UseSpeech {
  const [supported] = useState(() => typeof window !== "undefined" && "speechSynthesis" in window);
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [segment, setSegment] = useState(-1);
  const [rate, setRateState] = useState<SpeechRate>(loadRate);

  /** 每次 speak/stop 递增：迟到的 onend/onerror 一律不算数（防串读） */
  const runRef = useRef(0);
  const onSegmentRef = useRef<((index: number) => void) | null>(null);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);

  // Chrome 首次 getVoices() 可能为空，音色列表异步到达后再补一次
  useEffect(() => {
    if (!supported) return;
    voiceRef.current = pickZhVoice();
    const load = () => { voiceRef.current = pickZhVoice(); };
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, [supported]);

  // 卸载兜底：停掉还在播的
  useEffect(() => () => {
    runRef.current += 1;
    window.speechSynthesis?.cancel();
  }, []);

  const stop = useCallback(() => {
    runRef.current += 1;
    onSegmentRef.current = null;
    window.speechSynthesis?.cancel();
    setSpeaking(false);
    setPaused(false);
    setSegment(-1);
  }, []);

  const speak = useCallback((segments: string[], opts?: { onSegment?: (index: number) => void }) => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const texts = segments.filter((t) => t.trim().length > 0);
    if (!texts.length) return;
    const run = runRef.current + 1;
    runRef.current = run;
    synth.cancel();
    setPaused(false);
    setSpeaking(true);
    setSegment(-1);
    onSegmentRef.current = opts?.onSegment ?? null;
    const voice = voiceRef.current ?? pickZhVoice();
    for (let i = 0; i < texts.length; i += 1) {
      const text = texts[i];
      if (text === undefined) continue;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "zh-CN";
      if (voice) u.voice = voice;
      u.rate = rate;
      u.onstart = () => {
        if (runRef.current !== run) return;
        setSegment(i);
        setSpeaking(true);
        setPaused(false);
        onSegmentRef.current?.(i);
      };
      u.onend = () => {
        if (runRef.current !== run) return;
        if (i === texts.length - 1) {
          setSpeaking(false);
          setPaused(false);
          setSegment(-1);
        }
      };
      u.onerror = () => {
        // onend 一定会跟着来，收尾交给 onend；这里只防「卡在朗读中」的兜底。
        if (runRef.current === run && i === texts.length - 1) {
          setSpeaking(false);
          setPaused(false);
          setSegment(-1);
        }
      };
      synth.speak(u);
    }
  }, [rate]);

  const pause = useCallback(() => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.pause();
    setPaused(true);
  }, []);

  const resume = useCallback(() => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.resume();
    setPaused(false);
  }, []);

  const setRate = useCallback((r: SpeechRate) => {
    setRateState(r);
    storageSet(RATE_KEY, String(r));
  }, []);

  return { supported, speaking, paused, segment, rate, speak, pause, resume, stop, setRate };
}
