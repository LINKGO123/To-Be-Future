/**
 * 资金雷达工作台 · 本地离线语音识别（STT）
 * ------------------------------------------------------------
 * 用 sherpa-onnx 的预编译离线识别器（非流式 paraformer 中文小模型）识别 16kHz/16bit/单声道 WAV。
 * 为什么走「二进制 + spawn」而不是 sherpa-onnx-node 原生插件：
 *   - 零原生编译 / N-API ABI 风险（后端是 `node -e` 直跑 .ts，便携 Node 版本会换，原生插件对齐成本高）；
 *   - sherpa-onnx 官方 Windows x64 预编译包自带 onnxruntime，解压即用，无网络无 key；
 *   - 模型 `sherpa-onnx-paraformer-zh-small-2024-03-09`（int8，约 82MB），普通话 + 常见方言，体积可控。
 *
 * 🔴 Windows 中文路径坑（务必保留此设计）：
 *   sherpa-onnx-offline.exe 用窄 `main(argc, char* argv[])` 收参，Windows 会按 ANSI 代码页(GBK 936)
 *   把中文路径转成窄字节，`std::ifstream` 再按代码页转回宽字符时可能对不上 → 模型/wav 打不开、退出码 -1。
 *   本机仓库在 `D:\AI工具\股票工作区\...`、用户名 `刘德华`，路径里全是中文，实测绝对中文路径必挂。
 *   解法：把模型 + wav 放到一个缓存目录，spawn 时 `cwd` 指向该目录（Node 用宽字符传 cwd，中文没问题），
 *   argv 只传**相对 ASCII 文件名**（tokens.txt / model.int8.onnx / audio-<rand>.wav）——exe 再也碰不到中文参数。
 *
 * 资产布局（electron/stage.cjs 打进 resources/sherpa-onnx）：
 *   <sherpaDir>/bin/sherpa-onnx-offline.exe          ← 识别器 + onnxruntime.dll（同目录，免 PATH）
 *   <sherpaDir>/models/sherpa-onnx-paraformer-zh-small-2024-03-09/{model.int8.onnx, tokens.txt}
 * 本模块不 import service.ts（避免循环依赖）：入参只收 repoRoot，错误统一抛 TranscribeError，
 * 由 service.ts 的 transcribeAudio 包装成 ServiceError。
 */
import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export class TranscribeError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "TranscribeError";
    this.code = code;
  }
}

/** 识别结果：text 为转写文本 */
export interface TranscribeResult {
  text: string;
}

const MODEL_DIR_NAME = "sherpa-onnx-paraformer-zh-small-2024-03-09";
const MODEL_FILE = "model.int8.onnx";
const TOKENS_FILE = "tokens.txt";
const BIN_NAME = process.platform === "win32" ? "sherpa-onnx-offline.exe" : "sherpa-onnx-offline";
/** 缓存目录名：放 os.tmpdir() 下（可能是中文路径，但只经 Node 读写，exe 看到的是相对名） */
const CACHE_DIR_NAME = "fr-stt-model";

const STT_TIMEOUT_MS = 60_000;
const STT_MAX_BUFFER = 4 * 1024 * 1024; // stdout/stderr 上限，超了中止（识别文本远小于此）

/** sherpa-onnx 资产根目录：VRA_SHERPA_DIR 优先（Electron 打包后由 main.cjs 指到 resources 层），
 *  否则回退 <repoRoot>/resources/sherpa-onnx（开发 / 浏览器模式）。 */
export function sherpaDir(repoRoot: string): string {
  if (process.env.VRA_SHERPA_DIR) return path.resolve(process.env.VRA_SHERPA_DIR);
  return path.join(repoRoot, "resources", "sherpa-onnx");
}

function binaryPath(dir: string): string {
  return path.join(dir, "bin", BIN_NAME);
}

function sourceModelDir(dir: string): string {
  return path.join(dir, "models", MODEL_DIR_NAME);
}

/** 模型缓存目录（可能中文；exe 只以 cwd 方式感知它，见文件头注释） */
function modelCacheDir(): string {
  return path.join(os.tmpdir(), CACHE_DIR_NAME);
}

/** 原子拷贝：先写 .tmp 再 rename，避免并发下读到半截文件 */
function copyFileAtomic(src: string, dst: string): void {
  const tmp = `${dst}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  try {
    fs.copyFileSync(src, tmp);
    fs.renameSync(tmp, dst);
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
    throw e;
  }
}

function needsCopy(src: string, dst: string): boolean {
  if (!fs.existsSync(dst)) return true;
  try {
    return fs.statSync(dst).size !== fs.statSync(src).size;
  } catch {
    return true;
  }
}

/** 把模型 + 词表缓存到 ASCII-相对可用的目录，返回该目录（用作 spawn 的 cwd）。 */
function ensureModelCached(srcDir: string): string {
  const srcModel = path.join(srcDir, MODEL_FILE);
  const srcTokens = path.join(srcDir, TOKENS_FILE);
  if (!fs.existsSync(srcModel) || !fs.existsSync(srcTokens)) {
    throw new TranscribeError("stt_unavailable", `本地语音识别模型未安装（缺 ${srcDir}）`);
  }
  const cwd = modelCacheDir();
  fs.mkdirSync(cwd, { recursive: true });
  const dstModel = path.join(cwd, MODEL_FILE);
  const dstTokens = path.join(cwd, TOKENS_FILE);
  if (needsCopy(srcModel, dstModel)) copyFileAtomic(srcModel, dstModel);
  if (needsCopy(srcTokens, dstTokens)) copyFileAtomic(srcTokens, dstTokens);
  return cwd;
}

/** 从识别器 stdout 里抽出转写文本。sherpa-onnx-offline v1.13 的 stdout 是单行 JSON：
 *  {"lang":"","emotion":"","event":"","text":"…","timestamps":[...],"tokens":[...],...}
 *  兼容：优先收集 JSON 行的 `text` 字段；没有 JSON 行则回退为过滤表头后的纯文本行。 */
function parseOfflineStdout(stdout: string): string {
  const jsonTexts: string[] = [];
  const plainLines: string[] = [];
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("<sherpa-onnx")) continue;
    if (line === "Started" || line === "Done!") continue;
    if (/\.wav"?$/i.test(line) && line.indexOf("{") < 0) continue; // 文件名行
    if (line.startsWith("{")) {
      try {
        const obj = JSON.parse(line) as { text?: unknown };
        if (typeof obj.text === "string" && obj.text.trim()) jsonTexts.push(obj.text.trim());
        continue;
      } catch {
        /* 不是合法 JSON，按纯文本行处理 */
      }
    }
    plainLines.push(line);
  }
  const fromJson = jsonTexts.join("").trim();
  if (fromJson) return fromJson;
  return plainLines.join("").trim();
}

interface SpawnResult {
  status: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** 异步 spawn 识别器：不阻塞事件循环（service 层的取数同款约束）。 */
function runRecognizer(
  cmd: string,
  argv: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number; signal?: AbortSignal },
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(cmd, argv, { cwd: opts.cwd, env: opts.env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    } catch (e) {
      reject(new TranscribeError("stt_unavailable", `识别器启动失败：${e instanceof Error ? e.message : String(e)}`));
      return;
    }
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let outLen = 0;
    let errLen = 0;
    let timedOut = false;
    let done = false;
    let hardKill: NodeJS.Timeout | null = null;

    const take = (buf: Buffer[], chunk: Buffer, len: number): number => {
      const next = len + chunk.length;
      if (next > STT_MAX_BUFFER) return STT_MAX_BUFFER + 1; // 超上限：丢后续
      buf.push(chunk);
      return next;
    };
    child.stdout?.on("data", (c: Buffer) => { if (outLen <= STT_MAX_BUFFER) outLen = take(out, c, outLen); });
    child.stderr?.on("data", (c: Buffer) => { if (errLen <= STT_MAX_BUFFER) errLen = take(err, c, errLen); });

    const finish = (status: number | null) => {
      if (done) return;
      done = true;
      if (hardKill) { clearTimeout(hardKill); hardKill = null; }
      resolve({
        status,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
        timedOut,
      });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      hardKill = setTimeout(() => child.kill("SIGKILL"), 2000);
      hardKill.unref();
    }, opts.timeoutMs);
    timer.unref();

    const onAbort = () => {
      child.kill("SIGTERM");
      hardKill = setTimeout(() => child.kill("SIGKILL"), 2000);
      hardKill.unref();
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    if (opts.signal?.aborted) onAbort();

    child.on("error", (e) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (hardKill) { clearTimeout(hardKill); hardKill = null; }
      reject(new TranscribeError("stt_unavailable", `识别器启动失败：${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish(code);
    });
  });
}

/** 识别一段 WAV（16kHz/16bit/单声道）→ 文本。失败抛 TranscribeError（code: stt_unavailable / stt_failed / stt_timeout / bad_audio）。 */
export async function transcribeWav(
  ctx: { repoRoot: string },
  wav: Buffer,
  signal?: AbortSignal,
): Promise<TranscribeResult> {
  if (!wav || wav.length < 44) throw new TranscribeError("bad_audio", "音频数据为空或过短");

  const dir = sherpaDir(ctx.repoRoot);
  const bin = binaryPath(dir);
  if (!fs.existsSync(bin)) {
    throw new TranscribeError("stt_unavailable", `本地语音识别未安装（缺 ${bin}）`);
  }
  const cwd = ensureModelCached(sourceModelDir(dir));

  // wav 写进缓存目录、用相对文件名（见文件头「中文路径坑」）
  const wavName = `audio-${process.pid}-${crypto.randomBytes(6).toString("hex")}.wav`;
  const wavPath = path.join(cwd, wavName);
  try {
    fs.writeFileSync(wavPath, wav);
    const argv = [
      `--tokens=${TOKENS_FILE}`,
      `--paraformer=${MODEL_FILE}`,
      "--num-threads=2",
      wavName,
    ];
    // 识别器依赖的 onnxruntime.dll 与 exe 同目录；再把它目录塞进 PATH 兜底（防御性）
    const binDir = path.dirname(bin);
    const env: NodeJS.ProcessEnv = { ...process.env };
    env.PATH = `${binDir}${path.delimiter}${env.PATH ?? ""}`;

    const r = await runRecognizer(bin, argv, { cwd, env, timeoutMs: STT_TIMEOUT_MS, signal });
    if (r.timedOut) throw new TranscribeError("stt_timeout", "本地语音识别超时，请重试");
    const text = parseOfflineStdout(r.stdout);
    if (r.status !== 0) {
      throw new TranscribeError("stt_failed", `本地语音识别失败：${(r.stderr || r.stdout || `退出码 ${r.status}`).slice(0, 200)}`);
    }
    return { text };
  } finally {
    try { fs.rmSync(wavPath, { force: true }); } catch { /* 清理失败不影响识别结果 */ }
  }
}
