import React, { useEffect, useRef, useState } from 'react';
import {
  FilePlus2,
  Pin,
  Send,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  AllModelResults,
  ChatMessage,
  ChatMiniViz,
  FactSale,
  GlobalFilters,
} from '../types/sales';
import { askAiAnalyst } from '../lib/ai/tools';
import { formatCAD } from '../lib/analytics/calculations';
import { getPaletteColor } from '../lib/theme/chartTheme';

interface AiAnalystViewProps {
  filteredFacts: FactSale[];
  filters: GlobalFilters;
  models: AllModelResults;
  messages: ChatMessage[];
  aiEnabled: boolean;
  theme?: 'dark' | 'light';
  onToggleAi: (enabled: boolean) => void;
  onAddMessage: (msg: ChatMessage) => Promise<void>;
  onClearHistory: () => Promise<void>;
  onPinToDashboard: (msg: ChatMessage) => Promise<void>;
  onAddToReport: (msg: ChatMessage) => Promise<void>;
  compact?: boolean;
}

const STARTER_PROMPTS = [
  'Which store grew fastest in the second half of the dataset?',
  'Compare Q3 vs Q2 sales by category in the latest year',
  'Who are my bottom 5 salespeople by AOV?',
  'Forecast the next 3 months for Ontario',
  'What anomalies were flagged in unit prices and discounts?',
];

const MiniVizRenderer: React.FC<{ viz: ChatMiniViz; theme: 'dark' | 'light' }> = ({ viz, theme }) => {
  const seriesColor = getPaletteColor(0, theme);
  if (viz.type === 'table' || !viz.xKey || !viz.yKey) {
    return (
      <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200/80 dark:border-white/10">
        <div className="border-b border-slate-100 px-3 py-1.5 text-[11px] font-semibold text-slate-600 dark:border-white/10 dark:text-slate-300">
          {viz.title}
        </div>
        <table className="w-full text-left text-[11px]">
          <thead>
            <tr className="border-b border-slate-100 text-slate-500 dark:border-white/10 dark:text-slate-400">
              {viz.columns.map((c) => (
                <th key={c} className="px-2.5 py-1.5 font-medium capitalize">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-white/5">
            {viz.rows.slice(0, 8).map((r, i) => (
              <tr key={i}>
                {viz.columns.map((c) => {
                  const val = r[c];
                  return (
                    <td
                      key={c}
                      className={`px-2.5 py-1.5 ${
                        typeof val === 'number' ? 'font-mono tabular-nums' : ''
                      } text-[#0F2238] dark:text-slate-100`}
                    >
                      {typeof val === 'number'
                        ? val.toLocaleString('en-CA', { maximumFractionDigits: 2 })
                        : String(val ?? '')}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-slate-200/80 p-3 dark:border-white/10">
      <div className="mb-2 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
        {viz.title}
      </div>
      <div className="h-44 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {viz.type === 'line' ? (
            <LineChart data={viz.rows}>
              <XAxis
                dataKey={viz.xKey}
                tick={{ fontSize: 10, fill: '#94A3B8' }}
                axisLine={{ stroke: 'rgba(148,163,184,0.25)' }}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: '#94A3B8' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => (Math.abs(Number(v)) >= 1000 ? formatCAD(Number(v), true) : String(v))}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#0F2238',
                  borderColor: 'rgba(255,255,255,0.14)',
                  borderRadius: 10,
                  fontSize: 11,
                  color: '#F1F5F9',
                }}
              />
              <Line type="monotone" dataKey={viz.yKey} stroke={seriesColor} strokeWidth={2} dot={{ r: 2.5 }} />
            </LineChart>
          ) : (
            <BarChart data={viz.rows}>
              <XAxis
                dataKey={viz.xKey}
                tick={{ fontSize: 10, fill: '#94A3B8' }}
                axisLine={{ stroke: 'rgba(148,163,184,0.25)' }}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: '#94A3B8' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => (Math.abs(Number(v)) >= 1000 ? formatCAD(Number(v), true) : String(v))}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#0F2238',
                  borderColor: 'rgba(255,255,255,0.14)',
                  borderRadius: 10,
                  fontSize: 11,
                  color: '#F1F5F9',
                }}
              />
              <Bar dataKey={viz.yKey} fill={seriesColor} radius={[4, 4, 0, 0]} />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export const AiAnalystView: React.FC<AiAnalystViewProps> = ({
  filteredFacts,
  filters,
  models,
  messages,
  aiEnabled,
  theme = 'dark',
  onToggleAi,
  onAddMessage,
  onClearHistory,
  onPinToDashboard,
  onAddToReport,
  compact = false,
}) => {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const sendQuestion = async (rawQuestion: string) => {
    const q = rawQuestion.trim();
    if (!q || loading) return;
    if (!aiEnabled) return;

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}-u`,
      role: 'user',
      text: q,
      timestamp: new Date().toISOString(),
    };
    setInput('');
    await onAddMessage(userMsg);
    setLoading(true);

    try {
      const result = await askAiAnalyst({
        question: q,
        history: messages.map((m) => ({ role: m.role, text: m.text })),
        facts: filteredFacts,
        filters,
        trainedModels: models,
      });

      const assistantMsg: ChatMessage = {
        id: `msg-${Date.now()}-a`,
        role: 'assistant',
        text: result.text,
        timestamp: new Date().toISOString(),
        filtersUsed: result.filtersUsed,
        toolsCalled: result.toolsCalled,
        viz: result.viz,
        followUps: result.followUps,
      };
      await onAddMessage(assistantMsg);
    } catch (err) {
      const errMsg: ChatMessage = {
        id: `msg-${Date.now()}-e`,
        role: 'assistant',
        text: err instanceof Error ? err.message : 'Unable to reach Gemini AI Analyst.',
        timestamp: new Date().toISOString(),
        error: true,
      };
      await onAddMessage(errMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className={`flex flex-col rounded-[16px] border border-slate-200/90 bg-white dark:border-white/10 dark:bg-[#16314D] ${
        compact ? 'h-full' : 'h-[calc(100vh-14rem)] min-h-[540px]'
      }`}
    >
      {/* Privacy Notice & AI Opt-Out Toggle Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 px-4 py-3 dark:border-white/10">
        <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
          <ShieldCheck className="h-4 w-4 shrink-0 text-[#26E6D0]" aria-hidden="true" />
          <span>
            Tool-grounded Gemini Analyst · Raw rows stay in your browser; only minimal aggregated tool outputs are sent.
          </span>
        </div>
        <div className="flex items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={aiEnabled}
              onChange={(e) => onToggleAi(e.target.checked)}
              className="rounded accent-[#26E6D0]"
            />
            <span>AI Enabled</span>
          </label>
          {messages.length > 0 && (
            <button
              type="button"
              onClick={onClearHistory}
              title="Clear chat history"
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-rose-500 dark:text-slate-400 dark:hover:bg-white/10"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Messages Stream */}
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {!aiEnabled && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-800 dark:text-amber-200">
            AI features are opted out. All dashboards, star-schema ETL, IndexedDB persistence, ML models, and exports continue working 100% offline in your browser. Re-enable <strong>AI Enabled</strong> above whenever you want natural-language analysis.
          </div>
        )}

        {messages.length === 0 && aiEnabled && (
          <div className="mx-auto max-w-2xl py-6 text-center">
            <h3 className="font-display text-base font-semibold text-[#0F2238] dark:text-white">
              Ask grounded questions about your Canadian sales data
            </h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Every figure is computed locally via structured tools (query_sales, compare_periods, top_n, get_forecast, get_anomalies, get_segment_profile, explain_trend) before Gemini explains it.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {STARTER_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => sendQuestion(prompt)}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs text-[#0F2238] transition-colors hover:border-[#26E6D0] dark:border-white/10 dark:bg-[#0F2238]/60 dark:text-slate-200 dark:hover:border-[#26E6D0]"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[92%] rounded-2xl px-4 py-3 text-xs leading-relaxed sm:max-w-[82%] ${
                m.role === 'user'
                  ? 'brand-gradient font-medium text-[#0F2238]'
                  : m.error
                  ? 'border border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-200'
                  : 'border border-slate-200/80 bg-slate-50/90 text-[#0F2238] dark:border-white/10 dark:bg-[#0F2238]/80 dark:text-slate-100'
              }`}
            >
              <div className="whitespace-pre-line">{m.text}</div>

              {m.viz && <MiniVizRenderer viz={m.viz} theme={theme} />}

              {m.role === 'assistant' && !m.error && (
                <div className="mt-3 space-y-2 border-t border-slate-200/70 pt-2.5 dark:border-white/10">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                    <span>
                      Scope: {m.filtersUsed || 'Active filters'}
                      {m.toolsCalled && m.toolsCalled.length > 0
                        ? ` · Tools: ${Array.from(new Set(m.toolsCalled)).join(', ')}`
                        : ''}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onPinToDashboard(m)}
                        className="inline-flex items-center gap-1 font-medium text-[#0FA696] hover:underline dark:text-[#26E6D0]"
                      >
                        <Pin className="h-3 w-3" aria-hidden="true" />
                        Pin to dashboard
                      </button>
                      <button
                        type="button"
                        onClick={() => onAddToReport(m)}
                        className="inline-flex items-center gap-1 font-medium text-[#B740DE] hover:underline"
                      >
                        <FilePlus2 className="h-3 w-3" aria-hidden="true" />
                        Add to report
                      </button>
                    </div>
                  </div>

                  {m.followUps && m.followUps.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {m.followUps.map((fu) => (
                        <button
                          key={fu}
                          type="button"
                          onClick={() => sendQuestion(fu)}
                          className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-700 hover:border-[#26E6D0] dark:border-white/10 dark:bg-[#16314D] dark:text-slate-200"
                        >
                          {fu}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="rounded-2xl border border-slate-200/80 bg-slate-50 px-4 py-3 text-xs text-slate-500 dark:border-white/10 dark:bg-[#0F2238] dark:text-slate-300">
              Running local analytics queries and synthesizing response…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Prompt Input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          sendQuestion(input);
        }}
        className="flex items-center gap-2 border-t border-slate-200/80 p-3 dark:border-white/10"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={!aiEnabled || loading || filteredFacts.length === 0}
          placeholder={
            aiEnabled
              ? 'Ask a question (e.g. "Compare Q3 vs Q2 by category" or "What drove the October dip?")'
              : 'Enable AI above to chat with the Analyst'
          }
          className="flex-1 rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs text-[#0F2238] placeholder:text-slate-400 disabled:opacity-50 dark:border-white/15 dark:bg-[#0F2238] dark:text-white"
        />
        <button
          type="submit"
          disabled={!aiEnabled || loading || !input.trim() || filteredFacts.length === 0}
          aria-label="Send question"
          className="inline-flex items-center gap-1.5 rounded-xl brand-gradient px-4 py-2.5 text-xs font-semibold text-[#0F2238] transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <Send className="h-3.5 w-3.5" aria-hidden="true" />
          Ask
        </button>
      </form>
    </div>
  );
};
