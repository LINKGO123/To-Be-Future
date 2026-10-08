#!/usr/bin/env python3
"""
资金雷达工作台 · 本地流式离线语音识别（sherpa-onnx OnlineRecognizer）

契约（与 orchestrator/src/transcribe_stream.ts 严格对齐）：
  stdin  : 连续喂 raw PCM（int16 小端、16kHz、单声道，无 WAV 头）
  stdout : 每行一个 JSON 事件，即时 flush：
             {"type": "ready"}                 模型加载完成，可以开始喂音频
             {"type": "partial", "text": "…"}  边录边出的累计中间文本
             {"type": "final", "text": "…"}    收尾后的最终文本
  stderr : 错误 / 日志（Node 侧仅做日志，识别失败走非流式降级）
退出约定：stdin 关闭（EOF）→ input_finished → 输出 final → 正常退出。
"""
import argparse
import json
import sys


def main() -> None:
    ap = argparse.ArgumentParser(description="sherpa-onnx streaming STT (stdin PCM -> stdout JSON)")
    ap.add_argument("--encoder", required=True)
    ap.add_argument("--decoder", required=True)
    ap.add_argument("--joiner", required=True)
    ap.add_argument("--tokens", required=True)
    ap.add_argument("--num-threads", type=int, default=2)
    args = ap.parse_args()

    try:
        import numpy as np
        import sherpa_onnx
    except Exception as e:  # noqa: BLE001
        sys.stderr.write(f"import failed: {e}\n")
        sys.stderr.flush()
        sys.exit(2)

    try:
        recognizer = sherpa_onnx.OnlineRecognizer.from_transducer(
            tokens=args.tokens,
            encoder=args.encoder,
            decoder=args.decoder,
            joiner=args.joiner,
            num_threads=args.num_threads,
            sample_rate=16000,
            feature_dim=80,
        )
    except Exception as e:  # noqa: BLE001
        sys.stderr.write(f"recognizer init failed: {e}\n")
        sys.stderr.flush()
        sys.exit(3)

    # 模型加载完成，通知前端可以开始 flush 缓冲 PCM
    sys.stdout.write(json.dumps({"type": "ready"}) + "\n")
    sys.stdout.flush()

    sample_rate = 16000
    # 每块读 0.1 秒：1600 样本 × 2 字节(int16) = 3200 字节
    chunk_bytes = int(0.1 * sample_rate) * 2
    stream = recognizer.create_stream()
    last_text = ""

    while True:
        chunk = sys.stdin.buffer.read(chunk_bytes)
        if not chunk:
            break
        samples = np.frombuffer(chunk, dtype=np.int16).astype(np.float32) / 32768.0
        stream.accept_waveform(sample_rate, samples)
        while recognizer.is_ready(stream):
            recognizer.decode_stream(stream)
        text = recognizer.get_result(stream)
        if text != last_text:
            last_text = text
            sys.stdout.write(json.dumps({"type": "partial", "text": text}, ensure_ascii=False) + "\n")
            sys.stdout.flush()

    # stdin EOF：收尾，出最终文本
    try:
        stream.input_finished()
        while recognizer.is_ready(stream):
            recognizer.decode_stream(stream)
    except Exception as e:  # noqa: BLE001
        sys.stderr.write(f"finish failed: {e}\n")
        sys.stderr.flush()
    final_text = recognizer.get_result(stream)
    sys.stdout.write(json.dumps({"type": "final", "text": final_text}, ensure_ascii=False) + "\n")
    sys.stdout.flush()


if __name__ == "__main__":
    main()
