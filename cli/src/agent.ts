import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI, type Content, type FunctionCall, type Part } from '@google/genai';
import type { ApprovalMode } from './config.js';
import {
  TOOL_DECLARATIONS,
  executeTool,
  formatToolArgsPreview,
  needsApproval,
  type ToolContext,
} from './tools.js';

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
  private ai: GoogleGenAI;
  private history: Content[] = [];
  private sessionAlwaysAllowed = new Set<string>();
  public usage: TokenUsage = { promptTokens: 0, outputTokens: 0, totalTokens: 0 };
  public toolCallCount = 0;

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  setApiKey(apiKey: string): void {
    this.ai = new GoogleGenAI({ apiKey });
  }

  clearHistory(): void {
    this.history = [];
  }

  getTurnCount(): number {
    return this.history.filter((c) => c.role === 'user').length;
  }

  async compactHistory(model: string): Promise<string> {
    if (this.history.length < 4) {
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
      model,
      contents: [...this.history, summaryPrompt],
    });
    const summary = resp.text || 'Session compacted.';
    this.history = [
      { role: 'user', parts: [{ text: '[Compacted session context]' }] },
      { role: 'model', parts: [{ text: summary }] },
    ];
    return summary;
  }

  async sendTurn(
    userPrompt: string,
    opts: {
      model: string;
      systemInstruction: string;
      toolContext: ToolContext;
      callbacks: AgentCallbacks;
      signal?: AbortSignal;
    }
  ): Promise<string> {
    const { expanded } = expandAtMentions(userPrompt, opts.toolContext.cwd);
    this.history.push({ role: 'user', parts: [{ text: expanded }] });

    let fullAssistantText = '';
    const maxRounds = 24;

    for (let round = 0; round < maxRounds; round++) {
      if (opts.signal?.aborted) {
        throw new Error('Cancelled by user');
      }

      const stream = await this.ai.models.generateContentStream({
        model: opts.model,
        contents: this.history,
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
        this.history.push({ role: 'model', parts: modelParts });
      }

      if (collectedCalls.length === 0) {
        break;
      }

      // Execute each function call and send back functionResponse parts
      const responseParts: Part[] = [];
      for (const call of collectedCalls) {
        const name = call.name || 'unknown';
        const args = (call.args || {}) as Record<string, unknown>;
        const event: ToolEvent = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name,
          args,
          argsPreview: formatToolArgsPreview(name, args),
          status: 'pending',
        };
        this.toolCallCount += 1;
        opts.callbacks.onToolStart(event);

        const requiresPrompt =
          needsApproval(name, opts.toolContext.approvalMode) &&
          !this.sessionAlwaysAllowed.has(name);

        let approved = true;
        if (requiresPrompt) {
          const decision = await opts.callbacks.onRequestApproval(event);
          if (decision === 'always') {
            this.sessionAlwaysAllowed.add(name);
          } else if (decision === 'deny') {
            approved = false;
          }
        }

        if (!approved) {
          opts.callbacks.onToolUpdate({
            ...event,
            status: 'denied',
            preview: 'Denied by operator',
          });
          responseParts.push({
            functionResponse: {
              name,
              response: { ok: false, error: 'Tool execution denied by operator.' },
            },
          });
          continue;
        }

        opts.callbacks.onToolUpdate({ ...event, status: 'running' });
        const result = await executeTool(name, args, opts.toolContext);
        opts.callbacks.onToolUpdate({
          ...event,
          status: result.ok ? 'success' : 'error',
          preview: result.preview,
        });

        responseParts.push({
          functionResponse: {
            name,
            response: { ok: result.ok, output: result.output },
          },
        });
      }

      this.history.push({ role: 'user', parts: responseParts });
    }

    return fullAssistantText;
  }
}
