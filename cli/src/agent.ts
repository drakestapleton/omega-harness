import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI, type Content, type FunctionCall, type Part } from '@google/genai';
import type { ProviderKind } from './config.js';
import {
  TOOL_DECLARATIONS,
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
 * Expands @path tokens in user prompts into attached file context blocks,
 * matching Gemini CLI's @file ergonomic workflow.
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
  public usage: TokenUsage = { promptTokens: 0, outputTokens: 0, totalTokens: 0 };
  public toolCallCount = 0;

  constructor(apiKey?: string) {
    if (apiKey) {
      this.ai = new GoogleGenAI({ apiKey });
    }
  }

  setApiKey(apiKey: string): void {
    this.ai = new GoogleGenAI({ apiKey });
  }

  clearHistory(): void {
    this.geminiHistory = [];
    this.inklingHistory = [];
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
    }
  ): Promise<string> {
    if (opts.provider === 'inkling') {
      return this.sendInklingTurn(userPrompt, opts);
    }
    return this.sendGeminiTurn(userPrompt, opts);
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
          `Start inkling2-serve on Spark and tunnel: ssh -N -L 8080:127.0.0.1:8080 spark`
      );
    }

    const { expanded } = expandAtMentions(userPrompt, opts.toolContext.cwd);
    this.inklingHistory.push({ role: 'user', content: expanded });

    const engine = health.engine === 'inkling2-serve' ? 'inkling2-serve' : 'openai-compat';
    let fullAssistantText = '';
    const maxRounds = engine === 'inkling2-serve' ? 1 : 24;

    for (let round = 0; round < maxRounds; round++) {
      if (opts.signal?.aborted) throw new Error('Cancelled by user');

      const messages: InklingMessage[] = [
        { role: 'system', content: opts.systemInstruction },
        ...this.inklingHistory,
      ];

      const { parsed, usage } = await callInklingChat({
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

      if (parsed.text) {
        fullAssistantText += (fullAssistantText ? '\n' : '') + parsed.text;
      }

      this.inklingHistory.push({
        role: 'assistant',
        content: parsed.text,
        ...(parsed.toolCalls.length > 0
          ? {
              tool_calls: parsed.toolCalls.map((tc) => ({
                id: tc.id,
                type: 'function' as const,
                function: { name: tc.name, arguments: JSON.stringify(tc.args) },
              })),
            }
          : {}),
      });

      if (parsed.toolCalls.length === 0) {
        break;
      }

      for (const tc of parsed.toolCalls) {
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
