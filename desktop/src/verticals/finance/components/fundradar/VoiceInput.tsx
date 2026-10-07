/**
 * 资金雷达工作台 · 语音输入（刀4 本地离线 STT 改造）
 * ------------------------------------------------------------
 * 两条识别路径，自动降级：
 *  - 浏览器模式且支持 Web Speech API（SpeechRecognition / webkitSpeechRecognition）：沿用原逻辑，
 *    零安装、流式 interim、zh-CN；不联网需求下这仍是最省事的一条。
 *  - Electron 桌面版（window.__FR_DESKTOP__.isDesktop，Chromium 没有可用的 Web Speech 后端）或
 *    浏览器不支持 SpeechRecognition 时：改用 `getUserMedia` + AudioContext 录成 16kHz/16bit/单声道 WAV，
 *    交给本机后端 `POST /transcribe` 跑 sherpa-onnx 离线识别（零网络零 key）返回文字。
 *  - 两者都不可用才提示「语音不可用，请打字」。
 * 交互（interaction）：
 *  - "hold"（默认）：按住说话——pointerdown 开始 → pointerup/取消 松开即发；不再因 pointerleave 误停。
 *  - "toggle"：点击开始 / 再点停止，停止后经 onTranscript 把识别文字交给上层（填入输入框）。
 * 录音态通过 onListeningChange 通知上层（上层据此渲染红框 / 波形 / 计时 / 停止按钮）。
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { backend, transcribeStream, type StreamTranscriptController } from "@/lib/backend";

/** 两套前缀的最小结构类型：不依赖 lib.dom 里各版本不一致的 SpeechRecognition 签名 */
interface RecResultItem { transcript: string; }
interface RecResult { length: number; isFinal: boolean; [i: number]: RecResultItem; }
interface RecResults { length: number; [i: number]: RecResult; }

interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((ev: { resultIndex: number; results: RecResults }) => void) | null;
  onend: (() => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
}

type RecCtor = new () => RecognitionLike;

function recognitionCtor(): RecCtor | null {
  const w = window as unknown as Record<string, unknown>;
  const c = (w.SpeechRecognition ?? w.webkitSpeechRecognition) as RecCtor | undefined | null;
  return typeof c === "function" ? c : null;
}

/** Electron 桌面标记（preload.cjs 注入；浏览器模式为 undefined） */
function isDesktopRuntime(): boolean {
  const w = window as unknown as { __FR_DESKTOP__?: { isDesktop?: boolean } };
  return w.__FR_DESKTOP__?.isDesktop === true;
}

export interface VoiceInputHandle {
  /** 供快捷键（F2）等唤起：开始一轮语音 */
  start: () => void;
  /** 停止正在进行的识别（收尾交给 onend / 转写完成发出文本） */
  stop: () => void;
  /** 点击切换：录音中则停止，否则开始 */
  toggle: () => void;
}

interface VoiceInputProps {
  /** 转写完成后回调最终文本（松开手指 / 点停止后触发） */
  onTranscript: (text: string) => void;
  /** 边录边出的中间文本（本地流式路径专用）：实时写进输入框 */
  onInterim?: (text: string) => void;
  disabled?: boolean;
  /** "hold"（按住说话，默认）| "toggle"（点击开始/停止） */
  interaction?: "hold" | "toggle";
  /** 录音态变化通知上层（红框 / 波形 / 计时用） */
  onListeningChange?: (listening: boolean) => void;
}

const NO_SPEECH_HINT = "没听清，请再说一遍或打字";
const UNSUPPORTED_HINT = "语音不可用，请打字";
const MIC_HINT = "麦克风没权限：请在系统设置里允许后重试，或直接打字";
const NETWORK_HINT = "语音服务连不上，请打字";
const NETWORK_FALLBACK_HINT = "语音服务连不上，已切换本地识别，请再试一次";
const STT_HINT = "本地语音识别没装好，请打字";
const STT_TIMEOUT_HINT = "语音识别超时，请重试或打字";
/** localStorage 键：一旦 Web Speech 触发 network 类错误，就记住「以后一律走本地 STT」 */
const FORCE_LOCAL_KEY = "fr-voice-use-local";

/** 录音最长 30 秒（16kHz/16bit/单声道 WAV ≈ 32KB/s，30s 约 1MB，body 上限内） */
const MAX_RECORD_SEC = 30;

/* ---------------- 本地录音：WAV（16kHz/16bit/单声道）编码 ---------------- */

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buf);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i += 1) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // 单声道
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byteRate
  view.setUint16(32, 2, true); // blockAlign
  view.setUint16(34, 16, true); // bitsPerSample
  writeStr(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i += 1, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

interface LocalRecorder {
  /** 结束录音并返回 WAV 字节 */
  stop: () => Promise<ArrayBuffer>;
  /** 取消录音（不产音频），释放麦克风 */
  cancel: () => void;
}

/** Float32 采样（[-1,1]）→ int16 小端 PCM 字节 */
function floatToPcm16(samples: Float32Array): ArrayBuffer {
  const buf = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

/**
 * 用 getUserMedia + AudioContext（ScriptProcessorNode）录 16kHz 单声道 PCM。
 * 用 ScriptProcessor 而非 AudioWorklet：前者在 Chromium/Electron/Firefox 都开箱即用，deprecated 但功能稳定。
 * `onPcm` 可选：给流式路径边录边出 PCM；不传则只攒 WAV（回退非流式）。
 */
async function startLocalRecorder(onPcm?: (pcm: ArrayBuffer) => void): Promise<LocalRecorder> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const AC = w.AudioContext ?? w.webkitAudioContext;
  if (!AC) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error("no-audio-context");
  }
  const ctx = new AC({ sampleRate: 16000 });
  const source = ctx.createMediaStreamSource(stream);
  // 2048 帧 @16k ≈ 128ms 一包：够跟手，又不会太频繁地推 WebSocket
  const processor = ctx.createScriptProcessor(2048, 1, 1);
  const chunks: Float32Array[] = [];
  processor.onaudioprocess = (e) => {
    const samples = new Float32Array(e.inputBuffer.getChannelData(0));
    chunks.push(samples);
    onPcm?.(floatToPcm16(samples));
  };
  source.connect(processor);
  // 必须连到 destination 才会持续触发 onaudioprocess
  processor.connect(ctx.destination);

  let stopped = false;
  const release = () => {
    if (stopped) return;
    stopped = true;
    try { processor.disconnect(); } catch { /* ignore */ }
    try { source.disconnect(); } catch { /* ignore */ }
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close().catch(() => undefined);
  };
  const concat = (): Float32Array => {
    let total = 0;
    for (const c of chunks) total += c.length;
    const out = new Float32Array(total);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return out;
  };
  return {
    stop: async () => {
      const samples = concat();
      release();
      return encodeWav(samples, 16000);
    },
    cancel: release,
  };
}

export const VoiceInput = forwardRef<VoiceInputHandle, VoiceInputProps>(function VoiceInput(
  { onTranscript, onInterim, disabled = false, interaction = "hold", onListeningChange },
  ref,
) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  // network 错误降级标记：一旦遇到就记忆式切到本地 STT（localStorage 持久化）
  const [forceLocal, setForceLocal] = useState<boolean>(() => {
    try {
      return typeof window !== "undefined" && window.localStorage.getItem(FORCE_LOCAL_KEY) === "1";
    } catch {
      return false;
    }
  });
  // Web Speech 路径
  const recRef = useRef<RecognitionLike | null>(null);
  const finalRef = useRef("");
  const startedRef = useRef(false);
  const endedRef = useRef(false); // onend / onerror(aborted) 只收尾一次，防双发转写
  // 本地录音路径
  const recorderRef = useRef<LocalRecorder | null>(null);
  const localBusyRef = useRef(false); // 转写请求在飞：期间禁止再开始
  const startingLocalRef = useRef(false); // getUserMedia 尚未 resolve
  const wantStopRef = useRef(false); // 开始中已被要求停止（hold 松手早于麦克风就绪）
  // 流式识别路径（WebSocket /transcribe-stream）：边录边出，失败回退非流式 WAV
  const streamCtrlRef = useRef<StreamTranscriptController | null>(null);
  const streamStateRef = useRef<"none" | "connecting" | "ready" | "failed" | "final">("none");
  const pcmQueueRef = useRef<ArrayBuffer[]>([]); // ready 前缓存的 PCM
  const streamPendedWavRef = useRef<ArrayBuffer | null>(null); // finish 时暂存的 WAV（供 final/回退用）
  const streamFinalTimerRef = useRef<number | null>(null); // end 后等 final 的看门狗
  const endRequestedRef = useRef(false); // 录音已结束但识别器还没 ready：等 flush 缓存 PCM 后再发 end
  const committedRef = useRef(false); // 本轮是否已提交文本（final 与 WAV 回退只提交一次）
  // 通用
  const downRef = useRef(false);
  const hintTimer = useRef<number | null>(null);
  const maxTimerRef = useRef<number | null>(null);
  const transcriptRef = useRef(onTranscript);
  transcriptRef.current = onTranscript;
  const interimRef = useRef(onInterim);
  interimRef.current = onInterim;
  const listeningChangeRef = useRef(onListeningChange);
  listeningChangeRef.current = onListeningChange;

  const webSpeechSupported = recognitionCtor() !== null;
  const canRecord = typeof navigator !== "undefined"
    && typeof navigator.mediaDevices?.getUserMedia === "function"
    && typeof window !== "undefined"
    && (typeof window.AudioContext !== "undefined" || typeof (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext !== "undefined");
  // Electron 没有可用 Web Speech 后端；浏览器不支持 SpeechRecognition，或曾触发 network 错误降级时也走本地。
  const useLocal = isDesktopRuntime() || !webSpeechSupported || forceLocal;
  const supported = useLocal ? canRecord : webSpeechSupported;

  // 录音态变化通知上层
  useEffect(() => {
    listeningChangeRef.current?.(listening);
  }, [listening]);

  // 卸载兜底：停掉识别 / 录音与提示定时器，避免切页后残留 setState
  useEffect(() => () => {
    if (hintTimer.current !== null) window.clearTimeout(hintTimer.current);
    if (maxTimerRef.current !== null) window.clearTimeout(maxTimerRef.current);
    if (streamFinalTimerRef.current !== null) window.clearTimeout(streamFinalTimerRef.current);
    streamCtrlRef.current?.close();
    streamCtrlRef.current = null;
    streamStateRef.current = "none";
    recorderRef.current?.cancel();
    recorderRef.current = null;
    recRef.current?.abort();
  }, []);

  const showHint = (text: string) => {
    setHint(text);
    if (hintTimer.current !== null) window.clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => setHint(null), 4000);
  };

  /* ---------------- Web Speech 路径 ---------------- */

  const resetWebSpeechState = () => {
    startedRef.current = false;
    endedRef.current = true;
    setListening(false);
    setInterim("");
    recRef.current = null;
  };

  /** onerror 统一收尾：退出录音态、清掉识别实例，保证停止按钮/红框/波形都能复位 */
  const resetAfterError = () => {
    resetWebSpeechState();
    downRef.current = false;
  };

  const startWebSpeech = () => {
    if (disabled || listening) return;
    const Ctor = recognitionCtor();
    if (!Ctor) { showHint(UNSUPPORTED_HINT); return; }
    const rec = new Ctor();
    rec.lang = "zh-CN";
    rec.continuous = false;
    rec.interimResults = true;
    finalRef.current = "";
    endedRef.current = false;
    setInterim("");
    rec.onresult = (ev) => {
      const results = ev.results;
      for (let i = ev.resultIndex; i < results.length; i += 1) {
        const r = results[i];
        if (!r) continue;
        const text = r[0]?.transcript ?? "";
        if (r.isFinal) finalRef.current += text;
        else setInterim(text);
      }
    };
    rec.onend = () => {
      if (endedRef.current) return;
      endedRef.current = true;
      startedRef.current = false;
      setListening(false);
      setInterim("");
      recRef.current = null;
      const final = finalRef.current.trim();
      if (final) transcriptRef.current(final);
      else showHint(NO_SPEECH_HINT);
    };
    rec.onerror = (ev) => {
      const err = ev.error ?? "";
      if (err === "aborted") {
        // 主动停止：也要重置状态，不能卡在「录音中」。onend 可能还会来，用 endedRef 防重复收尾。
        if (endedRef.current) return;
        resetAfterError();
        return;
      }
      // 所有错误分支都重置状态，确保录音态退出、停止按钮恢复
      resetAfterError();
      if (err === "network" || err === "service-not-allowed") {
        // Web Speech 依赖 Google 语音服务，国内连不上 → 记忆式降级到本地 STT
        try {
          setForceLocal(true);
          window.localStorage.setItem(FORCE_LOCAL_KEY, "1");
        } catch { /* ignore */ }
        showHint(NETWORK_FALLBACK_HINT);
      } else if (err === "not-allowed") {
        showHint(MIC_HINT);
      } else {
        showHint(NO_SPEECH_HINT);
      }
    };
    recRef.current = rec;
    setListening(true);
    startedRef.current = false;
    try {
      rec.start();
      startedRef.current = true;
    } catch {
      // 某些浏览器对同一时刻多次 start 抛错：提示后回到可重试状态
      showHint(NO_SPEECH_HINT);
      resetWebSpeechState();
    }
  };

  const finishWebSpeech = () => {
    if (interaction === "toggle") {
      // 不再依赖 startedRef 判断窗口：只要还在录音就尝试停；stop 在「未真正 start」时也安全，异常用 abort 兜底
      const rec = recRef.current;
      if (!rec) return;
      startedRef.current = false;
      try {
        rec.stop();
      } catch {
        try { rec.abort(); } catch { /* ignore */ }
      }
      return;
    }
    if (!downRef.current) return;
    downRef.current = false;
    // 授权弹窗等场景下 start 还没生效就 blur 了：不打断，等它自己出结果
    if (!startedRef.current) return;
    recRef.current?.stop();
  };

  /* ---------------- 本地离线 STT 路径（流式优先，非流式回退） ---------------- */

  const cleanupStream = () => {
    const c = streamCtrlRef.current;
    streamCtrlRef.current = null;
    if (c) { try { c.close(); } catch { /* ignore */ } }
    pcmQueueRef.current = [];
    if (streamFinalTimerRef.current !== null) { window.clearTimeout(streamFinalTimerRef.current); streamFinalTimerRef.current = null; }
  };

  /** 提交最终文本（final 与 WAV 回退只走一次，防双发） */
  const commitText = (text: string) => {
    if (committedRef.current) return;
    committedRef.current = true;
    const t = text.trim();
    if (t) transcriptRef.current(t);
    else showHint(NO_SPEECH_HINT);
    setInterim("");
    localBusyRef.current = false;
  };

  /** 流式不可用时的非流式回退：WAV → POST /transcribe（保留旧 paraformer 路径） */
  const fallbackToWav = async (wav: ArrayBuffer | null) => {
    if (committedRef.current) { localBusyRef.current = false; return; }
    if (!wav || wav.byteLength < 44) {
      committedRef.current = true;
      localBusyRef.current = false;
      setInterim("");
      showHint(NO_SPEECH_HINT);
      return;
    }
    try {
      const r = await backend.transcribe(arrayBufferToBase64(wav));
      commitText(r?.text ?? "");
    } catch (e) {
      committedRef.current = true;
      localBusyRef.current = false;
      setInterim("");
      const code = (e as { code?: string })?.code;
      const msg = (e as { message?: string })?.message;
      if (code === "stt_unavailable") showHint(STT_HINT);
      else if (code === "stt_timeout") showHint(STT_TIMEOUT_HINT);
      else if (code === "bad_audio") showHint(NO_SPEECH_HINT);
      else showHint(msg || NETWORK_HINT);
    }
  };

  /** 流式失败（onerror / onclose）时，若 finish 已攒好 WAV 就立刻回退 */
  const maybeFallbackStream = () => {
    const wav = streamPendedWavRef.current;
    if (wav === null) return; // finish 还没发生：finish 里看到 failed 会自己回退
    streamPendedWavRef.current = null;
    void fallbackToWav(wav);
  };

  /** 发 end 后启动看门狗：超时没拿到 final 就回退非流式（覆盖「永远不 ready / 识别器卡死」） */
  const startFinalWatchdog = () => {
    if (streamFinalTimerRef.current !== null) return;
    streamFinalTimerRef.current = window.setTimeout(() => {
      streamFinalTimerRef.current = null;
      if (streamStateRef.current !== "final") {
        streamStateRef.current = "failed";
        cleanupStream();
        maybeFallbackStream();
      }
    }, 6000);
  };

  const doEnd = () => {
    endRequestedRef.current = false;
    streamCtrlRef.current?.end();
    startFinalWatchdog();
  };

  const finishLocal = async () => {
    // 还在等麦克风就绪：记下「要停」，等 startLocal 拿到录音器后立即收尾
    if (startingLocalRef.current) {
      wantStopRef.current = true;
      downRef.current = false;
      return;
    }
    if (localBusyRef.current) return;
    if (!listening && !recorderRef.current) return;
    localBusyRef.current = true;
    downRef.current = false;
    if (maxTimerRef.current !== null) { window.clearTimeout(maxTimerRef.current); maxTimerRef.current = null; }
    const rec = recorderRef.current;
    recorderRef.current = null;
    setListening(false);

    let wav: ArrayBuffer | null = null;
    if (rec) {
      try { wav = await rec.stop(); } catch { wav = null; }
    }

    const state = streamStateRef.current;
    if (state === "ready") {
      streamPendedWavRef.current = wav;
      doEnd();
    } else if (state === "connecting") {
      // 识别器还没 ready：先暂存 WAV，等 ready 后 flush 缓存 PCM 再发 end
      streamPendedWavRef.current = wav;
      endRequestedRef.current = true;
      startFinalWatchdog();
    } else {
      // 流式已失败 / 从未成功：直接走非流式 WAV 回退
      streamPendedWavRef.current = null;
      await fallbackToWav(wav);
    }
  };

  const startLocal = async () => {
    if (disabled || listening || localBusyRef.current) return;
    if (!canRecord) { showHint(UNSUPPORTED_HINT); return; }
    finalRef.current = "";
    setInterim("");
    downRef.current = true;
    startingLocalRef.current = true;
    wantStopRef.current = false;
    committedRef.current = false;
    endRequestedRef.current = false;
    setListening(true);

    // 先建流式通道（后台连 WS，Bearer 由代理注入），再起录音；ready 前 PCM 先缓存
    streamStateRef.current = "connecting";
    pcmQueueRef.current = [];
    streamPendedWavRef.current = null;
    let ctrl: StreamTranscriptController | null = null;
    try {
      ctrl = transcribeStream(
        (e) => {
          if (e.type === "ready") {
            if (streamStateRef.current !== "connecting") return;
            streamStateRef.current = "ready";
            const q = pcmQueueRef.current;
            pcmQueueRef.current = [];
            for (const p of q) ctrl?.sendPcm(p);
            if (endRequestedRef.current) doEnd();
          } else if (e.type === "partial") {
            setInterim(e.text);
            interimRef.current?.(e.text);
          } else if (e.type === "final") {
            streamStateRef.current = "final";
            cleanupStream();
            commitText(e.text);
          } else if (e.type === "error") {
            if (streamStateRef.current !== "final") {
              streamStateRef.current = "failed";
              cleanupStream();
              maybeFallbackStream();
            }
          }
        },
        () => {
          // WS 关闭：没拿到 final 就判流式失败 → 回退
          if (streamStateRef.current !== "final") {
            streamStateRef.current = "failed";
            cleanupStream();
            maybeFallbackStream();
          }
        },
      );
      streamCtrlRef.current = ctrl;
      ctrl.start();
    } catch {
      streamStateRef.current = "failed";
      streamCtrlRef.current = null;
    }

    let rec: LocalRecorder | null = null;
    try {
      rec = await startLocalRecorder((pcm) => {
        if (streamStateRef.current === "ready") streamCtrlRef.current?.sendPcm(pcm);
        else if (streamStateRef.current === "connecting") pcmQueueRef.current.push(pcm);
      });
    } catch (e) {
      startingLocalRef.current = false;
      downRef.current = false;
      setListening(false);
      cleanupStream();
      streamStateRef.current = "none";
      const name = (e as { name?: string })?.name;
      if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") showHint(MIC_HINT);
      else showHint(UNSUPPORTED_HINT);
      return;
    }
    startingLocalRef.current = false;
    if (wantStopRef.current) {
      // 麦克风就绪前用户已松手（hold）：立即取消，不产音频
      rec.cancel();
      setListening(false);
      downRef.current = false;
      cleanupStream();
      streamStateRef.current = "none";
      showHint(NO_SPEECH_HINT);
      return;
    }
    recorderRef.current = rec;
    // 录音自动停（防无限录制 + 控制 body 体积）
    maxTimerRef.current = window.setTimeout(() => { void finishLocal(); }, MAX_RECORD_SEC * 1000);
  };

  /* ---------------- 统一入口 ---------------- */

  const start = () => {
    if (disabled || listening || localBusyRef.current) return;
    if (useLocal) { void startLocal(); return; }
    startWebSpeech();
  };

  const finish = () => {
    if (useLocal) { void finishLocal(); return; }
    finishWebSpeech();
  };

  const toggle = () => {
    if (disabled) return;
    if (listening) finish();
    else start();
  };

  useImperativeHandle(ref, () => ({ start, stop: finish, toggle }));

  const holdHandlers = interaction === "hold"
    ? {
        onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => {
          e.preventDefault();
          // 捕获指针：松手事件始终回到按钮，即使手指滑出也可靠结束
          try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
          downRef.current = true;
          start();
        },
        onPointerUp: finish,
        onPointerCancel: finish,
        onBlur: finish,
      }
    : {};

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        aria-label={listening ? (interaction === "toggle" ? "正在录音，点击停止" : "正在听，松开手指即发送") : "开始说话"}
        title={
          interaction === "toggle"
            ? (supported ? "点击开始说话，再点停止" : "当前设备不支持语音输入")
            : (supported ? "按住说话，松开即发送" : "当前设备不支持语音输入")
        }
        disabled={disabled}
        {...holdHandlers}
        onClick={() => {
          if (interaction === "toggle") { toggle(); return; }
          if (!supported) showHint(UNSUPPORTED_HINT);
        }}
        className={`fr-composer-ibtn ${listening ? "fr-composer-rec" : ""} ${disabled ? "opacity-50" : ""}`}
      >
        {listening
          ? <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect width="11" height="11" x="6.5" y="6.5" rx="2" /></svg>
          : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3" /></svg>}
      </button>
      {interaction === "hold" && listening && (
        <span className="fr-sub text-primary" role="status" aria-live="polite">
          正在听…松开手指即发送{interim ? `：${interim}` : ""}
        </span>
      )}
      {interaction === "hold" && !listening && interim && <span className="fr-sub text-primary">听：{interim}</span>}
      {interaction === "hold" && !listening && !interim && hint && (
        <span className="fr-sub text-muted-foreground" role="status">{hint}</span>
      )}
      {interaction === "toggle" && hint && !listening && (
        <span className="fr-sub text-muted-foreground" role="status">{hint}</span>
      )}
    </span>
  );
});
