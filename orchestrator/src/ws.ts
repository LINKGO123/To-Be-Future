/**
 * 极简 WebSocket 服务端（零依赖，仅用于内部流式语音通道）。
 * --------------------------------------------------------------------------
 * 为什么不引 `ws`：orchestrator 走 `node -e` 直跑 .ts，且打包走 orchestrator-flat
 * 的 hoisted node_modules；新增 npm 依赖要同时改两处安装并重装，还会扰动正在跑的服务。
 * 内部通道协议固定（客户端发文本/二进制帧、服务端发文本 JSON 帧），实现 RFC6455 的最小
 * 子集即可：握手、掩码解析、文本/二进制/close/ping/pong、分片合并，服务端帧不掩码。
 */
import crypto from "node:crypto";
import type http from "node:http";
import type { Duplex } from "node:stream";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export interface WsHandlers {
  onOpen: (conn: WsConnection) => void;
  onText: (text: string) => void;
  onBinary: (buf: Buffer) => void;
  onClose: () => void;
}

export class WsConnection {
  private socket: Duplex;
  private closed = false;

  constructor(socket: Duplex) {
    this.socket = socket;
  }

  sendText(text: string): void {
    this.send(Buffer.from(text, "utf8"), 0x1);
  }

  /** 回 pong（响应客户端 ping 保活） */
  sendPong(payload: Buffer): void {
    this.send(payload, 0xa);
  }

  sendJson(obj: unknown): void {
    this.sendText(JSON.stringify(obj));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try { this.sendFrame(Buffer.alloc(0), 0x8); } catch { /* ignore */ }
    try { this.socket.end(); } catch { /* ignore */ }
  }

  get isOpen(): boolean {
    return !this.closed && !this.socket.destroyed;
  }

  private send(payload: Buffer, opcode: number): void {
    if (this.closed || this.socket.destroyed) return;
    try { this.sendFrame(payload, opcode); } catch { /* ignore */ }
  }

  private sendFrame(payload: Buffer, opcode: number): void {
    const header: number[] = [0x80 | opcode];
    const len = payload.length;
    if (len < 126) {
      header.push(len);
    } else if (len < 65536) {
      header.push(126, (len >> 8) & 0xff, len & 0xff);
    } else {
      header.push(127);
      for (let i = 7; i >= 0; i -= 1) header.push((len >> (i * 8)) & 0xff);
    }
    const head = Buffer.from(header);
    this.socket.write(len === 0 ? head : Buffer.concat([head, payload]));
  }
}

/**
 * 处理一次 WebSocket upgrade 握手；成功后返回连接对象并开始解析帧。
 * 调用方需自行在调用前完成鉴权（Authorization 头校验），未授权时不要调用本函数。
 */
export function acceptWebSocket(
  req: http.IncomingMessage,
  socket: Duplex,
  head: Buffer,
  handlers: WsHandlers,
): WsConnection {
  const key = req.headers["sec-websocket-key"];
  if (typeof key !== "string") {
    socket.destroy();
    throw new Error("missing sec-websocket-key");
  }
  const accept = crypto.createHash("sha1").update(key + WS_GUID).digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\n" +
    "Connection: Upgrade\r\n" +
    `Sec-WebSocket-Accept: ${accept}\r\n` +
    "\r\n",
  );

  const conn = new WsConnection(socket);
  handlers.onOpen(conn);

  let buffer: Buffer = head;
  let fragments: Buffer[] = [];
  let fragOpcode = 0;

  const processFrames = () => {
    for (;;) {
      if (buffer.length < 2) return;
      const b0 = buffer[0]!;
      const b1 = buffer[1]!;
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (buffer.length < 4) return;
        len = buffer.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (buffer.length < 10) return;
        const big = buffer.readBigUInt64BE(2);
        if (big > BigInt(Number.MAX_SAFE_INTEGER)) { socket.destroy(); return; }
        len = Number(big);
        offset = 10;
      }
      let mask: Buffer | null = null;
      if (masked) {
        if (buffer.length < offset + 4) return;
        mask = buffer.subarray(offset, offset + 4);
        offset += 4;
      }
      if (buffer.length < offset + len) return;
      let payload = buffer.subarray(offset, offset + len);
      buffer = buffer.subarray(offset + len);

      if (mask) {
        const unmasked = Buffer.allocUnsafe(payload.length);
        for (let i = 0; i < payload.length; i += 1) unmasked[i] = payload[i]! ^ mask[i % 4]!;
        payload = unmasked;
      }

      // 控制帧（FIN 必须为 1，长度 ≤ 125）
      if (opcode >= 0x8) {
        if (opcode === 0x8) {
          conn.close();
          handlers.onClose();
          return;
        }
        if (opcode === 0x9) {
          // ping → pong
          try { conn.sendPong(payload); } catch { /* ignore */ }
        }
        // 0xa pong 忽略
        continue;
      }

      if (opcode === 0x1 || opcode === 0x2) {
        fragments = [payload];
        fragOpcode = opcode;
      } else if (opcode === 0x0) {
        fragments.push(payload);
      } else {
        continue; // 未知 opcode 忽略
      }

      if (!fin) continue; // 分片未结束，继续攒

      const full = Buffer.concat(fragments);
      fragments = [];
      if (fragOpcode === 0x1) handlers.onText(full.toString("utf8"));
      else if (fragOpcode === 0x2) handlers.onBinary(full);
      fragOpcode = 0;
    }
  };

  socket.on("data", (chunk: Buffer) => {
    buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);
    try { processFrames(); } catch { /* 解析异常：直接断开 */ socket.destroy(); }
  });
  socket.on("error", () => { conn.close(); handlers.onClose(); });
  socket.on("close", () => handlers.onClose());

  return conn;
}
