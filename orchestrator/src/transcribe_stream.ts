/**
 * 资金雷达工作台 · 本地**流式**离线语音识别（sherpa-onnx OnlineRecognizer）
 * --------------------------------------------------------------------------
 * 与 transcribe.ts（非流式 paraformer，录完一次性识别）并存的**真流式**路径：
 * 前端边录边把 PCM 经 WebSocket 发过来，这里 spawn 一个 Python 流式识别器
 * （sherpa_onnx.OnlineRecognizer），边喂音频边把 interim/final 文本按 JSON 行推回去。
 *
 * 为什么选 Python 而不是预编译流式 exe：
 *   - sherpa-onnx 官方预编译的流式 demo（sherpa-onnx.exe）只接受 wav 文件路径 / 麦克风，
 *     没有「stdin 喂 PCM → stdout 出 interim」的可脚本化协议，无法做边录边出；
 *   - sherpa-onnx Python 包（sherpa_onnx 1.13.8）的 OnlineRecognizer 提供
 *     accept_waveform / is_ready / decode_stream / get_result，正好匹配流式协议，
 *     且 Windows 下有 cp314 预编译 wheel，装进 resources/python 即用，零 key 零网络；
 *   - sherpa-onnx-node 有原生 ABI 风险，便携 Node 版本会换，对齐成本高。
 *
 * 资产布局（electron/stage.cjs 已把 resources/sherpa-onnx 与 resources/python 整体打包）：
 *   <sherpaDir>/streaming_stt.py                          ← 本模块 spawn 的识别器脚本
 *   <sherpaDir>/models/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20/{...}  ← 流式模型
 * Python 解释器用 ctx.python（= product config / VRA_PYTHON 指向的便携 python），
 * sherpa_onnx + numpy 已装进该解释器的 site-packages。
 *
 * 与 transcribe.ts 一样，本模块不 import service.ts（避免循环依赖）：入参只收最小 ctx。
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { sherpaDir, TranscribeError } from "./transcribe.ts";

export interface StreamRecognizerCtx {
  repoRoot: string;
  python?: string;
}

export interface StreamRecognitionHandlers {
  /** 识别器模型加载完成，可以开始喂音频（前端据此 flush 已录的缓冲 PCM） */
  onReady: () => void;
  /** 边录边出的中间结果（累计文本） */
  onPartial: (text: string) => void;
  /** 收尾后的最终文本 */
  onFinal: (text: string) => void;
  /** 识别器退出（正常或异常收尾，用于释放连接侧状态） */
  onClose: () => void;
}

export interface StreamRecognizerHandle {
  /** 喂一段 raw PCM（int16 小端、16kHz、单声道） */
  feed: (pcm: Buffer) => void;
  /** 结束：补尾部静音 + input_finished，随后触发 onFinal */
  finish: () => void;
  /** 取消：立即杀进程（前端断开 / 出错时用） */
  abort: () => void;
}

const STREAM_MODEL_DIR_NAME = "sherpa-onnx-streaming-zipformer-small-bilingual-zh-en-2023-02-16";
const ENCODER_FILE = "encoder-epoch-99-avg-1.int8.onnx";
const DECODER_FILE = "decoder-epoch-99-avg-1.onnx";
const JOINER_FILE = "joiner-epoch-99-avg-1.int8.onnx";
const TOKENS_FILE = "tokens.txt";
const SCRIPT_FILE = "streaming_stt.py";

/** 流式模型是否已安装（用于前端「流式不可用则回退非流式」的判定） */
export function streamingModelAvailable(ctx: StreamRecognizerCtx): boolean {
  const dir = sherpaDir(ctx.repoRoot);
  const modelDir = path.join(dir, "models", STREAM_MODEL_DIR_NAME);
  return (
    fs.existsSync(path.join(dir, SCRIPT_FILE)) &&
    fs.existsSync(path.join(modelDir, ENCODER_FILE)) &&
    fs.existsSync(path.join(modelDir, DECODER_FILE)) &&
    fs.existsSync(path.join(modelDir, JOINER_FILE)) &&
    fs.existsSync(path.join(modelDir, TOKENS_FILE))
  );
}

function pythonExe(ctx: StreamRecognizerCtx): string {
  // 流式识别依赖 sherpa_onnx（装在 resources/python 便携解释器里），优先用它；
  // 否则回退 ctx.python（.venv，只有数据层依赖没有 sherpa_onnx）→ VRA_PYTHON → 系统 python。
  const portable = path.join(
    ctx.repoRoot,
    "resources",
    "python",
    process.platform === "win32" ? "python.exe" : "bin/python3",
  );
  if (fs.existsSync(portable)) return portable;
  if (ctx.python && ctx.python !== "python3") return ctx.python;
  return process.env.VRA_PYTHON ?? (process.platform === "win32" ? "python" : "python3");
}

/**
 * 启动流式识别器进程。stdin 喂 PCM、stdout 按行收 JSON 事件。
 * 失败（模型缺失 / 解释器缺失 / 加载失败）抛 TranscribeError(stt_unavailable)。
 */
export function startStreamRecognizer(
  ctx: StreamRecognizerCtx,
  handlers: StreamRecognitionHandlers,
): StreamRecognizerHandle {
  const dir = sherpaDir(ctx.repoRoot);
  const modelDir = path.join(dir, "models", STREAM_MODEL_DIR_NAME);
  const script = path.join(dir, SCRIPT_FILE);
  const encoder = path.join(modelDir, ENCODER_FILE);
  const decoder = path.join(modelDir, DECODER_FILE);
  const joiner = path.join(modelDir, JOINER_FILE);
  const tokens = path.join(modelDir, TOKENS_FILE);

  if (!streamingModelAvailable(ctx)) {
    throw new TranscribeError("stt_unavailable", `本地流式语音识别模型未安装（缺 ${modelDir}）`);
  }
  const python = pythonExe(ctx);

  let child: ChildProcess;
  try {
    child = spawn(python, [
      script,
      `--encoder=${encoder}`,
      `--decoder=${decoder}`,
      `--joiner=${joiner}`,
      `--tokens=${tokens}`,
      "--num-threads=2",
    ], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch (e) {
    throw new TranscribeError("stt_unavailable", `流式识别器启动失败：${e instanceof Error ? e.message : String(e)}`);
  }

  let ended = false;
  let stdoutBuf = "";

  const finalize = () => {
    if (ended) return;
    ended = true;
    handlers.onClose();
  };

  // stdout 按行解析 JSON 事件（脚本每个事件一行 + flush）
  child.stdout?.on("data", (chunk: Buffer) => {
    stdoutBuf += chunk.toString("utf8");
    let idx: number;
    while ((idx = stdoutBuf.indexOf("\n")) >= 0) {
      const line = stdoutBuf.slice(0, idx).trim();
      stdoutBuf = stdoutBuf.slice(idx + 1);
      if (!line) continue;
      let ev: { type?: string; text?: string; message?: string };
      try {
        ev = JSON.parse(line);
      } catch {
        continue;
      }
      if (ev.type === "ready") handlers.onReady();
      else if (ev.type === "partial" && typeof ev.text === "string") handlers.onPartial(ev.text);
      else if (ev.type === "final" && typeof ev.text === "string") handlers.onFinal(ev.text);
      // error 事件：交给 stderr 日志 + onClose 收尾；前端已通过 stt_unavailable 走降级，这里不再回传文本
    }
  });

  child.stderr?.on("data", (chunk: Buffer) => {
    const s = chunk.toString("utf8").trim();
    if (s) console.error(`[stt-stream] ${s.slice(0, 400)}`);
  });

  child.on("error", (e) => {
    console.error(`[stt-stream] spawn error: ${e.message}`);
    finalize();
  });
  child.on("close", () => finalize());

  return {
    feed: (pcm: Buffer) => {
      if (ended || !child.stdin || child.stdin.destroyed) return;
      child.stdin.write(pcm);
    },
    finish: () => {
      if (ended || !child.stdin || child.stdin.destroyed) return;
      child.stdin.end();
    },
    abort: () => {
      if (ended) return;
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
      finalize();
    },
  };
}
