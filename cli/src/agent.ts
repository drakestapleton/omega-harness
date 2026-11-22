import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI, type Content, type FunctionCall, type Part } from '@google/genai';
import { getConfigDir, type ProviderKind } from './config.js';
import {
  TOOL_DECLARATIONS,
  VALID_TOOL_NAMES,
  executeTool,
  formatToolArgsPreview,
  needsApproval,
  type ToolContext,
} from './tools.js';
import {
  callInklingChat,
  probeInkling,
  type InklingMessage,
} from './inkling.js';
import { SessionState } from './state.js';

export interface TokenUsage {
  promptTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ToolEvent {
  id: string;
  name: string;
  args: Record<string, unknown>;
  argsPreview: string;
  status: 'pending' | 'running' | 'success' | 'error' | 'denied';
  preview?: string;
}

export type ApprovalDecision = 'allow' | 'always' | 'deny';

export interface AgentCallbacks {
  onTextDelta: (chunk: string) => void;
  onToolStart: (event: ToolEvent) => void;
  onToolUpdate: (event: ToolEvent) => void;
  onRequestApproval: (event: ToolEvent) => Promise<ApprovalDecision>;
  onUsageUpdate?: (usage: TokenUsage) => void;
}

/**
 * Expands @path tokens in user prompts into attached file context blocks.
 */
export function expandAtMentions(prompt: string, cwd: string): { expanded: string; attachedFiles: string[] } {
  const attachedFiles: string[] = [];
  const attachments: string[] = [];
  const regex = /(^|\s)@([^\s@]+)/g;

  for (const match of prompt.matchAll(regex)) {
    const rawTarget = match[2].replace(/[.,;:!?)]+$/, '');
    const fullPath = path.isAbsolute(rawTarget) ? rawTarget : path.resolve(cwd, rawTarget);
    if (!fs.existsSync(fullPath)) continue;
    try {
      const stat = fs.statSync(fullPath);
      if (!stat.isFile() || stat.size > 512 * 1024) continue;
      const content = fs.readFileSync(fullPath, 'utf8');
      attachedFiles.push(rawTarget);
      attachments.push(`<attached_file path="${rawTarget}">\n${content}\n</attached_file>`);
    } catch {
      // ignore unreadable
    }
  }

  if (attachments.length === 0) {
    return { expanded: prompt, attachedFiles };
  }
  return {
    expanded: `${prompt}\n\n${attachments.join('\n\n')}`,
    attachedFiles,
  };
}

export class OmegaAgent {
  private ai: GoogleGenAI | null = null;
  private geminiHistory: Content[] = [];
  private inklingHistory: InklingMessage[] = [];
  private sessionAlwaysAllowed = new Set<string>();
  private subagentInstances = new Map<string, OmegaAgent>();
  public state: SessionState;
  public usage: TokenUsage = { promptTokens: 0, outputTokens: 0, totalTokens: 0 };
  public toolCallCount = 0;

  constructor(apiKey?: string, state?: SessionState) {
    if (apiKey) {
      this.ai = new GoogleGenAI({ apiKey });
    }
    this.state = state || new SessionState();
  }

  setApiKey(apiKey: string): void {
    this.ai = new GoogleGenAI({ apiKey });
  }

  clearHistory(): void {
    this.geminiHistory = [];
    this.inklingHistory = [];
  }

  saveSession(name = 'latest'): string {
    const dir = path.join(getConfigDir(), 'sessions');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, `${name.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
    const payload = {
      savedAt: new Date().toISOString(),
      inklingHistory: this.inklingHistory,
      geminiHistory: this.geminiHistory,
      usage: this.usage,
      todos: this.state.todos,
    };
    fs.writeFileSync(file, JSON.stringify(payload, null, 2) + '\n', { mode: 0o600 });
    return file;
  }

  loadSession(name = 'latest'): { ok: boolean; turns: number; savedAt?: string } {
    const file = path.join(getConfigDir(), 'sessions', `${name.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const data = JSON.parse(raw) as {
        savedAt?: string;
        inklingHistory?: InklingMessage[];
        geminiHistory?: Content[];
        usage?: TokenUsage;
        todos?: Array<{ id: string; title: string; status: 'pending' | 'in_progress' | 'completed' }>;
      };
      if (Array.isArray(data.inklingHistory)) this.inklingHistory = data.inklingHistory;
      if (Array.isArray(data.geminiHistory)) this.geminiHistory = data.geminiHistory;
      if (data.usage) this.usage = data.usage;
      if (Array.isArray(data.todos)) this.state.setTodos(data.todos);
      return { ok: true, turns: this.getTurnCount(), savedAt: data.savedAt };
    } catch {
      return { ok: false, turns: 0 };
    }
  }

  getTurnCount(): number {
    return Math.max(
      this.geminiHistory.filter((c) => c.role === 'user').length,
      this.inklingHistory.filter((m) => m.role === 'user').length
    );
  }

  async compactHistory(opts: {
    provider: ProviderKind;
    model: string;
    endpoint: string;
    apiKey?: string;
  }): Promise<string> {
    if (opts.provider === 'inkling') {
      if (this.inklingHistory.length < 4) {
        return 'Conversation is already short; nothing to compact.';
      }
      const recent = this.inklingHistory.slice(-4);
      this.inklingHistory = recent;
      return `Kept last ${recent.length} messages in Inkling session context.`;
    }

    if (!this.ai || this.geminiHistory.length < 4) {
      return 'Conversation is already short; nothing to compact.';
    }
    const summaryPrompt: Content = {
      role: 'user',
      parts: [
        {
          text: 'Summarize our session so far in concise bullet points: goals, files inspected or modified, compiler/test results, and next steps.',
        },
      ],
    };
    const resp = await this.ai.models.generateContent({
      model: opts.model,
      contents: [...this.geminiHistory, summaryPrompt],
    });
    const summary = resp.text || 'Session compacted.';
    this.geminiHistory = [
      { role: 'user', parts: [{ text: '[Compacted session context]' }] },
      { role: 'model', parts: [{ text: summary }] },
    ];
    return summary;
  }

  async sendTurn(
    userPrompt: string,
    opts: {
      provider: ProviderKind;
      endpoint: string;
      apiKey?: string;
      model: string;
      systemInstruction: string;
      toolContext: ToolContext;
      callbacks: AgentCallbacks;
      signal?: AbortSignal;
      depth?: number;
    }
  ): Promise<string> {
    const depth = opts.depth ?? 0;

    // Bind autonomous subagent runner onto this session's state
    const boundState = opts.toolContext.state || this.state;
    if (depth < 2) {
      boundState.runSubagent = async (req) => {
        let sub = req.existingId ? this.subagentInstances.get(req.existingId) : undefined;
        if (!sub) {
          sub = new OmegaAgent(opts.apiKey, new SessionState());
          this.subagentInstances.set(req.id, sub);
        }
        const subSystem =
          `You are subagent "${req.role}" (${req.id}) spawned by Ω Omega Harness.\n` +
          `Mode: ${req.mode}. Focus strictly on the assigned task and return a concise, factual report with evidence.\n` +
          opts.systemInstruction;

        const subStartCalls = sub.toolCallCount;
        const text = await sub.sendTurn(req.task, {
          provider: opts.provider,
          endpoint: opts.endpoint,
          apiKey: opts.apiKey,
          model: opts.model,
          systemInstruction: subSystem,
          toolContext: {
            ...opts.toolContext,
            state: sub.state,
            readOnlyOnly: req.mode === 'read-only',
          },
          signal: opts.signal,
          depth: depth + 1,
          callbacks: {
            onTextDelta: () => {},
            onToolStart: (ev) =>
              opts.callbacks.onToolStart({
                ...ev,
                name: `${req.id}:${ev.name}`,
              }),
            onToolUpdate: (ev) =>
              opts.callbacks.onToolUpdate({
                ...ev,
                name: `${req.id}:${ev.name}`,
              }),
            onRequestApproval: opts.callbacks.onRequestApproval,
            onUsageUpdate: opts.callbacks.onUsageUpdate,
          },
        });
        return { text, toolCalls: sub.toolCallCount - subStartCalls };
      };
    }

    const toolContext: ToolContext = {
      ...opts.toolContext,
      state: boundState,
    };

    if (opts.provider === 'inkling') {
      return this.sendInklingTurn(userPrompt, { ...opts, toolContext });
    }
    return this.sendGeminiTurn(userPrompt, { ...opts, toolContext });
  }

  private async runToolWithApproval(
    name: string,
    args: Record<string, unknown>,
    toolContext: ToolContext,
    callbacks: AgentCallbacks
  ): Promise<{ approved: boolean; ok: boolean; output: string }> {
    const event: ToolEvent = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      args,
      argsPreview: formatToolArgsPreview(name, args),
      status: 'pending',
    };
    this.toolCallCount += 1;
    callbacks.onToolStart(event);

    const requiresPrompt =
      needsApproval(name, toolContext.approvalMode) &&
      !this.sessionAlwaysAllowed.has(name);

    let approved = true;
    if (requiresPrompt) {
      const decision = await callbacks.onRequestApproval(event);
      if (decision === 'always') {
        this.sessionAlwaysAllowed.add(name);
      } else if (decision === 'deny') {
        approved = false;
      }
    }

    if (!approved) {
      callbacks.onToolUpdate({
        ...event,
        status: 'denied',
        preview: 'Denied by operator',
      });
      return { approved: false, ok: false, output: 'Tool execution denied by operator.' };
    }

    callbacks.onToolUpdate({ ...event, status: 'running' });
    const result = await executeTool(name, args, toolContext);
    callbacks.onToolUpdate({
      ...event,
      status: result.ok ? 'success' : 'error',
      preview: result.preview,
    });
    return { approved: true, ok: result.ok, output: result.output };
  }

  private async sendInklingTurn(
    userPrompt: string,
    opts: {
      endpoint: string;
      apiKey?: string;
      model: string;
      systemInstruction: string;
      toolContext: ToolContext;
      callbacks: AgentCallbacks;
      signal?: AbortSignal;
    }
  ): Promise<string> {
    const health = await probeInkling(opts.endpoint, opts.apiKey);
    if (!health.online) {
      throw new Error(
        `Cannot reach Inkling server at ${opts.endpoint} (${health.error || 'offline'}). ` +
          `Run \`omega up\` to boot Inkling-2-Mini + Arboris on Spark.`
      );
    }

    const { expanded } = expandAtMentions(userPrompt, opts.toolContext.cwd);
    this.inklingHistory.push({ role: 'user', content: expanded });

    const engine = health.engine === 'inkling2-serve' ? 'inkling2-serve' : 'openai-compat';
    let fullAssistantText = '';
    const maxRounds = engine === 'inkling2-serve' ? 10 : 24;
    const seenSignatures = new Set<string>();

    for (let round = 0; round < maxRounds; round++) {
      if (opts.signal?.aborted) throw new Error('Cancelled by user');

      const messages: InklingMessage[] = [
        { role: 'system', content: opts.systemInstruction },
        ...this.inklingHistory,
      ];

      const { parsed, rawContent, usage } = await callInklingChat({
        endpoint: opts.endpoint,
        model: opts.model,
        messages,
        tools: TOOL_DECLARATIONS,
        apiKey: opts.apiKey,
        engine,
        signal: opts.signal,
        onTextDelta: opts.callbacks.onTextDelta,
      });

      if (usage) {
        this.usage = {
          promptTokens: this.usage.promptTokens + usage.promptTokens,
          outputTokens: this.usage.outputTokens + usage.outputTokens,
          totalTokens: this.usage.totalTokens + usage.totalTokens,
        };
        opts.callbacks.onUsageUpdate?.(this.usage);
      }

      // Filter to valid registered tool names
      const validCalls = parsed.toolCalls.filter((tc) => VALID_TOOL_NAMES.has(tc.name));

      if (parsed.text) {
        fullAssistantText += (fullAssistantText ? '\n' : '') + parsed.text;
      }

      this.inklingHistory.push({
        role: 'assistant',
        content: parsed.text,
        ...(engine === 'inkling2-serve' ? { rawAssistantOutput: rawContent } : {}),
        ...(validCalls.length > 0
          ? {
              tool_calls: validCalls.map((tc) => ({
                id: tc.id,
                type: 'function' as const,
                function: { name: tc.name, arguments: JSON.stringify(tc.args) },
              })),
            }
          : {}),
      });

      if (validCalls.length === 0) {
        break;
      }

      let executedAnyNew = false;
      for (const tc of validCalls) {
        const sig = `${tc.name}:${JSON.stringify(tc.args)}`;
        if (seenSignatures.has(sig)) {
          // Loop breaker: do not execute identical tool call twice in the same turn
          this.inklingHistory.push({
            role: 'tool',
            name: tc.name,
            tool_call_id: tc.id,
            content: `Already executed ${tc.name} with those exact args above. Do NOT call it again; answer the user now.`,
          });
          continue;
        }
        seenSignatures.add(sig);
        executedAnyNew = true;
        const res = await this.runToolWithApproval(
          tc.name,
          tc.args,
          opts.toolContext,
          opts.callbacks
        );
        this.inklingHistory.push({
          role: 'tool',
          name: tc.name,
          tool_call_id: tc.id,
          content: res.output,
        });
      }

      if (!executedAnyNew) {
        // Model attempted only duplicate calls — break cleanly after reporting last tool result
        const lastObs = [...this.inklingHistory].reverse().find((m) => m.role === 'tool' && !m.content.startsWith('Already executed'));
        if (!fullAssistantText.trim() && lastObs) {
          fullAssistantText = lastObs.content;
          opts.callbacks.onTextDelta(lastObs.content);
        }
        break;
      }
    }

    return fullAssistantText;
  }

  private async sendGeminiTurn(
    userPrompt: string,
    opts: {
      apiKey?: string;
      model: string;
      systemInstruction: string;
      toolContext: ToolContext;
      callbacks: AgentCallbacks;
      signal?: AbortSignal;
    }
  ): Promise<string> {
    if (!this.ai) {
      if (opts.apiKey) {
        this.ai = new GoogleGenAI({ apiKey: opts.apiKey });
      } else {
        throw new Error('No Gemini API key configured. Run `/auth <API_KEY>` or switch to `/provider inkling`.');
      }
    }

    const { expanded } = expandAtMentions(userPrompt, opts.toolContext.cwd);
    this.geminiHistory.push({ role: 'user', parts: [{ text: expanded }] });

    let fullAssistantText = '';
    const maxRounds = 24;

    for (let round = 0; round < maxRounds; round++) {
      if (opts.signal?.aborted) {
        throw new Error('Cancelled by user');
      }

      const stream = await this.ai.models.generateContentStream({
        model: opts.model,
        contents: this.geminiHistory,
        config: {
          systemInstruction: opts.systemInstruction,
          tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
        },
      });

      let roundText = '';
      const collectedCalls: FunctionCall[] = [];
      const modelParts: Part[] = [];

      for await (const chunk of stream) {
        if (opts.signal?.aborted) {
          throw new Error('Cancelled by user');
        }

        if (chunk.usageMetadata) {
          const p = chunk.usageMetadata.promptTokenCount ?? 0;
          const o = chunk.usageMetadata.candidatesTokenCount ?? 0;
          const t = chunk.usageMetadata.totalTokenCount ?? p + o;
          if (t > 0) {
            this.usage = {
              promptTokens: this.usage.promptTokens + p,
              outputTokens: this.usage.outputTokens + o,
              totalTokens: this.usage.totalTokens + t,
            };
            opts.callbacks.onUsageUpdate?.(this.usage);
          }
        }

        const candidate = chunk.candidates?.[0];
        const parts = candidate?.content?.parts || [];
        for (const part of parts) {
          if (part.text) {
            roundText += part.text;
            fullAssistantText += part.text;
            opts.callbacks.onTextDelta(part.text);
          }
          if (part.functionCall) {
            collectedCalls.push(part.functionCall);
            modelParts.push(part);
          }
        }
      }

      if (roundText) {
        modelParts.unshift({ text: roundText });
      }
      if (modelParts.length > 0) {
        this.geminiHistory.push({ role: 'model', parts: modelParts });
      }

      if (collectedCalls.length === 0) {
        break;
      }

      const responseParts: Part[] = [];
      for (const call of collectedCalls) {
        const name = call.name || 'unknown';
        const args = (call.args || {}) as Record<string, unknown>;
        const res = await this.runToolWithApproval(name, args, opts.toolContext, opts.callbacks);
        responseParts.push({
          functionResponse: {
            name,
            response: res.approved ? { ok: res.ok, output: res.output } : { ok: false, error: res.output },
          },
        });
      }

      this.geminiHistory.push({ role: 'user', parts: responseParts });
    }

    return fullAssistantText;
  }
}
