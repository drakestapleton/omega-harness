import net from 'node:net';
import type { FunctionDeclaration } from '@google/genai';

interface SimpleHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * Raw HTTP/1.1 request over TCP that accepts both CRLF (\r\n) and bare LF (\n)
 * header endings (needed for pure-Omega `inkling2-serve` which emits LF headers,
 * whereas Node's undici fetch() strictly rejects non-CRLF headers).
 */
function rawHttpRequest(
  urlStr: string,
  opts: {
    method: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  }
): Promise<SimpleHttpResponse> {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    if (u.protocol !== 'http:') {
      reject(new Error(`rawHttpRequest only supports http://, got ${u.protocol}`));
      return;
    }
    const port = u.port ? Number(u.port) : 80;
    const host = u.hostname;
    const pathAndQuery = (u.pathname || '/') + (u.search || '');
    const bodyBuf = opts.body ? Buffer.from(opts.body, 'utf8') : Buffer.alloc(0);

    const reqHeaders: Record<string, string> = {
      Host: u.host,
      Connection: 'close',
      ...(opts.headers || {}),
    };
    if (opts.method === 'POST') {
      reqHeaders['Content-Length'] = String(bodyBuf.length);
    }

    const headLines = [
      `${opts.method} ${pathAndQuery} HTTP/1.1`,
      ...Object.entries(reqHeaders).map(([k, v]) => `${k}: ${v}`),
      '',
      '',
    ].join('\r\n');

    const socket = net.createConnection({ host, port });
    const chunks: Buffer[] = [];
    let settled = false;

    const finishErr = (err: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(err);
    };

    if (opts.timeoutMs) {
      socket.setTimeout(opts.timeoutMs, () => {
        finishErr(new Error(`HTTP timeout after ${opts.timeoutMs}ms`));
      });
    }

    if (opts.signal) {
      if (opts.signal.aborted) {
        finishErr(new Error('Cancelled by user'));
        return;
      }
      opts.signal.addEventListener(
        'abort',
        () => finishErr(new Error('Cancelled by user')),
        { once: true }
      );
    }

    socket.on('connect', () => {
      socket.write(headLines);
      if (bodyBuf.length > 0) socket.write(bodyBuf);
    });
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.on('error', (err) => finishErr(err));
    socket.on('end', () => {
      if (settled) return;
      settled = true;
      const raw = Buffer.concat(chunks).toString('utf8');
      let sepIdx = raw.indexOf('\r\n\r\n');
      let sepLen = 4;
      if (sepIdx < 0) {
        sepIdx = raw.indexOf('\n\n');
        sepLen = 2;
      }
      if (sepIdx < 0) {
        reject(new Error(`Malformed HTTP response from ${urlStr}`));
        return;
      }
      const headerPart = raw.slice(0, sepIdx);
      const bodyPart = raw.slice(sepIdx + sepLen);
      const lines = headerPart.split(/\r?\n/);
      const statusMatch = lines[0]?.match(/^HTTP\/\d\.\d\s+(\d+)/);
      const status = statusMatch ? Number(statusMatch[1]) : 0;
      const headers: Record<string, string> = {};
      for (const l of lines.slice(1)) {
        const colon = l.indexOf(':');
        if (colon > 0) {
          headers[l.slice(0, colon).trim().toLowerCase()] = l.slice(colon + 1).trim();
        }
      }
      resolve({ status, headers, body: bodyPart });
    });
  });
}

async function flexibleRequest(
  urlStr: string,
  opts: {
    method: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  }
): Promise<SimpleHttpResponse> {
  try {
    const res = await fetch(urlStr, {
      method: opts.method,
      headers: opts.headers,
      body: opts.body,
      signal: opts.signal || (opts.timeoutMs ? AbortSignal.timeout(opts.timeoutMs) : undefined),
    });
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });
    const body = await res.text();
    return { status: res.status, headers, body };
  } catch (err: unknown) {
    const causeCode = (err as { cause?: { code?: string } })?.cause?.code || '';
    if (
      urlStr.startsWith('http://') &&
      (causeCode.startsWith('HPE_') || String(err).includes('fetch failed'))
    ) {
      return rawHttpRequest(urlStr, opts);
    }
    throw err;
  }
}

export interface InklingHealth {
  online: boolean;
  endpoint: string;
  model?: string;
  slotsActive?: number;
  slotsMax?: number;
  engine: 'inkling2-serve' | 'openai-compat' | 'offline';
  error?: string;
}

export interface InklingMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
}

export interface ParsedInklingOutput {
  text: string;
  thinking?: string;
  toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>;
}

/**
 * Probe an Inkling HTTP endpoint (GET /health, falling back to GET /v1/models).
 * Detects Omega's pure seeded-Omega `inkling2-serve` (which reports slots_max / slots_active)
 * versus a general OpenAI-compatible Inkling server.
 */
export async function probeInkling(endpoint: string, apiKey?: string): Promise<InklingHealth> {
  const base = endpoint.replace(/\/+$/, '');
  const headers: Record<string, string> = {};
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  try {
    const res = await flexibleRequest(`${base}/health`, {
      method: 'GET',
      headers,
      timeoutMs: 2500,
    });
    if (res.status >= 200 && res.status < 300) {
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(res.body) as Record<string, unknown>;
      } catch {
        data = {};
      }
      const slotsMax =
        typeof data.slots_max === 'number'
          ? data.slots_max
          : typeof data.max_slots === 'number'
            ? data.max_slots
            : undefined;
      const slotsActive =
        typeof data.slots_active === 'number'
          ? data.slots_active
          : typeof data.active_slots === 'number'
            ? data.active_slots
            : undefined;
      const model = typeof data.model === 'string' ? data.model : 'inkling-2-mini';
      const isNativeServe = slotsMax !== undefined;
      return {
        online: true,
        endpoint: base,
        model,
        slotsActive,
        slotsMax,
        engine: isNativeServe ? 'inkling2-serve' : 'openai-compat',
      };
    }
  } catch {
    // Fall through to /v1/models check
  }

  try {
    const res = await flexibleRequest(`${base}/v1/models`, {
      method: 'GET',
      headers,
      timeoutMs: 2500,
    });
    if (res.status >= 200 && res.status < 300) {
      let data: { data?: Array<{ id?: string; slots_max?: number }> } = {};
      try {
        data = JSON.parse(res.body) as { data?: Array<{ id?: string; slots_max?: number }> };
      } catch {
        data = {};
      }
      const first = data.data?.[0];
      return {
        online: true,
        endpoint: base,
        model: first?.id || 'inkling-2-mini',
        slotsMax: first?.slots_max,
        engine: first?.slots_max !== undefined ? 'inkling2-serve' : 'openai-compat',
      };
    }
    return {
      online: false,
      endpoint: base,
      engine: 'offline',
      error: `HTTP ${res.status}`,
    };
  } catch (err: unknown) {
    return {
      online: false,
      endpoint: base,
      engine: 'offline',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Parse Inkling-2-Mini native control tokens if emitted inline in text:
 *  - <|content_thinking|>...<|end_message|>
 *  - <|message_model|>NAME<|content_invoke_tool_json|>{"name":...,"args":...}<|end_message|>
 *  - <|content_text|>, <|end_message|>, <|content_model_end_sampling|>
 */
export function parseInklingTokens(raw: string): ParsedInklingOutput {
  const toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> = [];
  let thinking = '';
  let text = raw;

  // Extract thinking blocks
  text = text.replace(/<\|content_thinking\|>([\s\S]*?)(?:<\|end_message\|>|$)/g, (_, inner: string) => {
    thinking += (thinking ? '\n' : '') + inner.trim();
    return '';
  });

  // Extract inline Inkling tool invocations
  text = text.replace(
    /(?:<\|message_model\|>[^<]*)?<\|content_invoke_tool_json\|>([\s\S]*?)(?:<\|end_message\|>|$)/g,
    (_, jsonStr: string) => {
      try {
        const parsed = JSON.parse(jsonStr.trim()) as {
          name?: string;
          args?: Record<string, unknown>;
          arguments?: Record<string, unknown>;
        };
        if (parsed.name) {
          toolCalls.push({
            id: `ik-tc-${Date.now()}-${toolCalls.length}`,
            name: parsed.name,
            args: parsed.args || parsed.arguments || {},
          });
        }
      } catch {
        // leave unparseable block ignored
      }
      return '';
    }
  );

  // Strip remaining Inkling framing tokens
  text = text
    .replace(/<\|content_text\|>/g, '')
    .replace(/<\|end_message\|>/g, '')
    .replace(/<\|content_model_end_sampling\|>/g, '')
    .replace(/<\|message_model\|>/g, '')
    .trim();

  return {
    text,
    thinking: thinking || undefined,
    toolCalls,
  };
}

function toOpenAITools(decls: FunctionDeclaration[]) {
  return decls.map((d) => ({
    type: 'function' as const,
    function: {
      name: d.name,
      description: d.description || '',
      parameters: d.parameters || { type: 'object', properties: {} },
    },
  }));
}

/**
 * Formats a prompt specifically for Omega's native `inkling2-serve` (serve_live.om),
 * whose slFindContent scans for the first `"content"` field up to the next `"` (max 1024 bytes).
 */
export function buildNativeServePayload(model: string, userPrompt: string): string {
  // Replace double quotes with single quotes so slFindContent doesn't truncate early,
  // and collapse newlines to spaces within the 1000-byte pBuf budget.
  const sanitized = userPrompt
    .replace(/"/g, "'")
    .replace(/\r?\n+/g, ' ')
    .trim()
    .slice(0, 980);
  return JSON.stringify({
    model,
    messages: [{ role: 'user', content: sanitized }],
  });
}

export async function callInklingChat(opts: {
  endpoint: string;
  model: string;
  messages: InklingMessage[];
  tools: FunctionDeclaration[];
  apiKey?: string;
  engine: 'inkling2-serve' | 'openai-compat';
  signal?: AbortSignal;
  onTextDelta: (chunk: string) => void;
}): Promise<{
  parsed: ParsedInklingOutput;
  usage?: { promptTokens: number; outputTokens: number; totalTokens: number };
}> {
  const base = opts.endpoint.replace(/\/+$/, '');
  const url = `${base}/v1/chat/completions`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (opts.apiKey) {
    headers['Authorization'] = `Bearer ${opts.apiKey}`;
  }

  // Native pure-Omega `inkling2-serve` path (with automatic 503 server_busy retry)
  if (opts.engine === 'inkling2-serve') {
    const lastUser = [...opts.messages].reverse().find((m) => m.role === 'user');
    const body = buildNativeServePayload(opts.model, lastUser?.content || '');

    let lastStatus = 0;
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await flexibleRequest(url, {
        method: 'POST',
        headers,
        body,
        timeoutMs: 120_000,
        signal: opts.signal,
      });
      lastStatus = res.status;

      if (res.status === 503 && attempt < 4) {
        const retryAfter = Number(res.headers['retry-after'] || '1');
        const delayMs = Math.min(5000, Math.max(250, retryAfter * 1000));
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }

      if (res.status < 200 || res.status >= 300) {
        throw new Error(`Inkling server HTTP ${res.status}: ${res.body.slice(0, 200)}`);
      }

      const data = JSON.parse(res.body) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
      const rawContent = data.choices?.[0]?.message?.content || '';
      const parsed = parseInklingTokens(rawContent);
      if (parsed.text) {
        opts.onTextDelta(parsed.text);
      }
      const usage = data.usage
        ? {
            promptTokens: data.usage.prompt_tokens || 0,
            outputTokens: data.usage.completion_tokens || 0,
            totalTokens: data.usage.total_tokens || 0,
          }
        : undefined;
      return { parsed, usage };
    }
    throw new Error(`Inkling server busy (HTTP ${lastStatus}) after 5 retries — all 8 KV slots occupied.`);
  }

  // Full OpenAI-compatible Inkling server path (SSE streaming + native tool_calls)
  const payload = {
    model: opts.model,
    messages: opts.messages,
    tools: toOpenAITools(opts.tools),
    stream: true,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: opts.signal,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Inkling server HTTP ${res.status}: ${errText.slice(0, 240)}`);
  }

  const contentType = res.headers.get('content-type') || '';

  // Non-streaming JSON fallback if server ignored stream: true
  if (!contentType.includes('text/event-stream') || !res.body) {
    const data = (await res.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
          reasoning_content?: string;
          tool_calls?: Array<{
            id?: string;
            function?: { name?: string; arguments?: string };
          }>;
        };
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const msg = data.choices?.[0]?.message;
    const parsed = parseInklingTokens(msg?.content || '');
    if (msg?.reasoning_content) {
      parsed.thinking = msg.reasoning_content;
    }
    if (msg?.tool_calls) {
      for (const tc of msg.tool_calls) {
        const fn = tc.function;
        if (!fn?.name) continue;
        let args: Record<string, unknown> = {};
        try {
          args = fn.arguments ? JSON.parse(fn.arguments) : {};
        } catch {
          args = {};
        }
        parsed.toolCalls.push({
          id: tc.id || `ik-tc-${Date.now()}-${parsed.toolCalls.length}`,
          name: fn.name,
          args,
        });
      }
    }
    if (parsed.text) opts.onTextDelta(parsed.text);
    const usage = data.usage
      ? {
          promptTokens: data.usage.prompt_tokens || 0,
          outputTokens: data.usage.completion_tokens || 0,
          totalTokens: data.usage.total_tokens || 0,
        }
      : undefined;
    return { parsed, usage };
  }

  // SSE streaming parser
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let rawText = '';
  let reasoningText = '';
  const tcAccum = new Map<number, { id: string; name: string; argsJson: string }>();
  let usage: { promptTokens: number; outputTokens: number; totalTokens: number } | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const payloadStr = line.slice(5).trim();
      if (!payloadStr || payloadStr === '[DONE]') continue;

      try {
        const chunk = JSON.parse(payloadStr) as {
          choices?: Array<{
            delta?: {
              content?: string;
              reasoning_content?: string;
              tool_calls?: Array<{
                index?: number;
                id?: string;
                function?: { name?: string; arguments?: string };
              }>;
            };
          }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
        };

        if (chunk.usage) {
          usage = {
            promptTokens: chunk.usage.prompt_tokens || 0,
            outputTokens: chunk.usage.completion_tokens || 0,
            totalTokens: chunk.usage.total_tokens || 0,
          };
        }

        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        if (delta.reasoning_content) {
          reasoningText += delta.reasoning_content;
        }
        if (delta.content) {
          rawText += delta.content;
          // Stream clean text when not inside a raw control tag
          if (!delta.content.includes('<|')) {
            opts.onTextDelta(delta.content);
          }
        }
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            const entry = tcAccum.get(idx) || {
              id: tc.id || `ik-tc-${Date.now()}-${idx}`,
              name: '',
              argsJson: '',
            };
            if (tc.id) entry.id = tc.id;
            if (tc.function?.name) entry.name += tc.function.name;
            if (tc.function?.arguments) entry.argsJson += tc.function.arguments;
            tcAccum.set(idx, entry);
          }
        }
      } catch {
        // ignore malformed SSE frame
      }
    }
  }

  const parsed = parseInklingTokens(rawText);
  if (reasoningText && !parsed.thinking) {
    parsed.thinking = reasoningText;
  }
  for (const entry of tcAccum.values()) {
    if (!entry.name) continue;
    let args: Record<string, unknown> = {};
    try {
      args = entry.argsJson ? JSON.parse(entry.argsJson) : {};
    } catch {
      args = {};
    }
    parsed.toolCalls.push({ id: entry.id, name: entry.name, args });
  }

  return { parsed, usage };
}
