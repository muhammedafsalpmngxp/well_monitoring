import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

export interface JennyMessage {
  role: 'user' | 'ai';
  text: string;
  time: string;
}

interface MasOutputItem {
  type: string;
  role?: string;
  content?: Array<{ type: string; text: string }>;
  name?: string;
  arguments?: string;
}

interface MasResponse {
  status: string;
  output: MasOutputItem[];
}

@Injectable({ providedIn: 'root' })
export class JennyAiService {

  private readonly apiUrl = environment.databricks.masAgentUrl;
  private readonly token = environment.databricks.token;
  private conversationHistory: Array<{ role: string; content: string }> = [];

  constructor(private readonly http: HttpClient) {}

  /**
   * Send a user message to the MAS agent and return the final assistant reply.
   * Maintains conversation history for multi-turn context.
   */
  async sendMessage(userMessage: string): Promise<string> {
    this.conversationHistory.push({ role: 'user', content: userMessage });

    const headers = new HttpHeaders(
      this.token
        ? { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` }
        : { 'Content-Type': 'application/json' }
    );

    const body = {
      input: this.conversationHistory
    };

    try {
      const response = await firstValueFrom(
        this.http.post<MasResponse>(this.apiUrl, body, { headers })
      );

      const reply = this.extractFinalReply(response);

      this.conversationHistory.push({ role: 'assistant', content: reply });

      // Keep conversation history manageable (last 20 turns)
      if (this.conversationHistory.length > 40) {
        this.conversationHistory = this.conversationHistory.slice(-40);
      }

      return reply;
    } catch (err: any) {
      console.error('[JennyAiService] API call failed', err);
      const status = err?.status;
      if (status === 401 || status === 403) {
        return 'I\'m having trouble authenticating right now. Please contact your administrator.';
      }
      if (status === 429) {
        return 'I\'m receiving too many requests at the moment. Please try again in a few seconds.';
      }
      return 'Sorry, I\'m having trouble connecting right now. Please try again in a moment.';
    }
  }

  /**
   * Extract the final assistant message from the MAS multi-step response.
   * The API returns multiple output items (intermediate tool calls, agent handoffs, etc.).
   * We want the last message from the Master_Supervisor or the last assistant message.
   */
  private extractFinalReply(response: MasResponse | undefined): string {
    if (!response?.output?.length) {
      return 'I wasn\'t able to process that. Could you try rephrasing?';
    }

    // Walk output in reverse to find the last substantive assistant message
    const messages = response.output.filter(
      (item) => item.type === 'message' && item.role === 'assistant' && item.content?.length
    );

    // Skip agent-name-only messages (e.g. "<name>Master_Supervisor</name>")
    for (let i = messages.length - 1; i >= 0; i--) {
      const text = messages[i].content?.[0]?.text || '';
      if (text && !/^<name>.+<\/name>$/.exec(text)) {
        return this.formatMarkdown(text);
      }
    }

    return 'I processed your request but didn\'t get a clear answer. Could you try again?';
  }

  /**
   * Light markdown → HTML conversion for chat display.
   * Handles: headers, bold, tables, lists, code blocks, line breaks.
   */
  private formatMarkdown(md: string): string {
    let html = md;

    // Code blocks (```...```)
    html = html.replaceAll(/```[\s\S]*?```/g, (match) => {
      const code = match.replaceAll(/```\w*\n?/g, '').replaceAll(/```$/g, '');
      return '<pre class="marina-code">' + this.escapeHtml(code) + '</pre>';
    });

    // Tables: detect lines starting with |
    html = html.replaceAll(/((?:\|.+\|\n?)+)/g, (tableBlock) => {
      const rows = tableBlock.trim().split('\n').filter((r) => r.trim());
      if (rows.length < 2) return tableBlock;

      let tableHtml = '<table class="marina-table">';
      rows.forEach((row, idx) => {
        // Skip separator rows (|---|---|)
        if (/^\|[\s\-:|]+\|$/.test(row.trim())) return;

        const cells = row.split('|').filter((c, i, arr) => i > 0 && i < arr.length);
        const tag = idx === 0 ? 'th' : 'td';
        tableHtml += '<tr>' + cells.map((c) => `<${tag}>${c.trim()}</${tag}>`).join('') + '</tr>';
      });
      tableHtml += '</table>';
      return tableHtml;
    });

    // Headers (## ... )
    html = html.replaceAll(/^### (.+)$/gm, '<strong class="marina-h3">$1</strong>');
    html = html.replaceAll(/^## (.+)$/gm, '<strong class="marina-h2">$1</strong>');
    html = html.replaceAll(/^# (.+)$/gm, '<strong class="marina-h1">$1</strong>');

    // Bold (**...**)
    html = html.replaceAll(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // Italic (*...*)
    html = html.replaceAll(/\*(.+?)\*/g, '<em>$1</em>');

    // Numbered lists
    html = html.replaceAll(/^\d+\.\s+(.+)$/gm, '<div class="marina-li">$&</div>');

    // Line breaks
    html = html.replaceAll(/\n/g, '<br>');

    return html;
  }

  private escapeHtml(text: string): string {
    return text
      .replaceAll(/&/g, '&amp;')
      .replaceAll(/</g, '&lt;')
      .replaceAll(/>/g, '&gt;');
  }

  /** Clear conversation history (e.g. on new session) */
  clearHistory(): void {
    this.conversationHistory = [];
  }
}
