/**
 * # ============================================================
 * # Slash Command Panel - 斜杠命令 UI (v1.0.0 Cycle 28 G28-05)
 * # ============================================================
 */

import React, { useState, useEffect, useMemo } from 'react';
import { getDefaultSlashCommandEngine } from '../utils/slashCommandEngine';
import { SlashCommand, CommandResult } from '../utils/slashCommandEngine';

interface SlashCommandPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SlashCommandPanel: React.FC<SlashCommandPanelProps> = ({ isOpen, onClose }) => {
  const engine = useMemo(() => getDefaultSlashCommandEngine(), []);
  const [refreshKey, setRefreshKey] = useState(0);
  const [commands, setCommands] = useState<SlashCommand[]>([]);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<Array<{ input: string; result: CommandResult }>>([]);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setCommands(engine.listCommands());
  }, [isOpen, refreshKey, engine]);

  const refresh = () => setRefreshKey((k) => k + 1);

  const handleExecute = async (cmd: string) => {
    const result = await engine.execute(cmd, {
      cwd: '/',
      sessionId: 'panel',
      rawInput: cmd,
      metadata: {},
    });
    setHistory((h) => [{ input: cmd, result }, ...h].slice(0, 20));
    refresh();
  };

  const filteredCommands = useMemo(() => {
    if (!filter) return commands;
    const f = filter.toLowerCase();
    return commands.filter(
      (c) => c.name.toLowerCase().includes(f) || c.description.toLowerCase().includes(f)
    );
  }, [commands, filter]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" data-testid="slash-command-panel">
      <div className="bg-white rounded-lg shadow-xl w-[900px] max-w-[95vw] h-[640px] max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <div className="flex items-center gap-2">
            <span className="text-2xl">⌨️</span>
            <h2 className="text-lg font-semibold">斜杠命令 (Slash Commands)</h2>
            <span className="text-xs text-gray-500">/init /status /review /plan /goal</span>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700" data-testid="slash-command-close">✕</button>
        </div>

        <div className="flex-1 grid grid-cols-2 gap-0">
          {/* Left: Commands list */}
          <div className="border-r p-4 flex flex-col">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="搜索命令..."
              className="border rounded px-3 py-2 text-sm mb-3"
              data-testid="slash-command-filter"
            />
            <div className="flex-1 overflow-auto space-y-1" data-testid="slash-command-list">
              {filteredCommands.map((c) => (
                <div
                  key={c.name}
                  className="border rounded p-2 hover:bg-gray-50 cursor-pointer"
                  onClick={() => setInput('/' + c.name)}
                  data-testid={`slash-command-item-${c.name}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-semibold">/{c.name}</span>
                    {c.builtin && <span className="text-xs bg-indigo-100 text-indigo-700 px-1.5 rounded">内置</span>}
                  </div>
                  <div className="text-xs text-gray-600 mt-0.5">{c.description}</div>
                  {c.usage && <div className="text-xs text-gray-400 mt-0.5 font-mono">{c.usage}</div>}
                </div>
              ))}
            </div>
          </div>

          {/* Right: Execute + History */}
          <div className="p-4 flex flex-col">
            <div className="flex gap-2 mb-3">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleExecute(input)}
                placeholder="输入命令 (如 /init /status /review)"
                className="flex-1 border rounded px-3 py-2 text-sm font-mono"
                data-testid="slash-command-input"
              />
              <button
                onClick={() => handleExecute(input)}
                disabled={!input}
                className="px-4 py-2 bg-indigo-500 text-white rounded hover:bg-indigo-600 text-sm disabled:opacity-50"
                data-testid="slash-command-execute"
              >
                执行
              </button>
            </div>
            <div className="flex-1 overflow-auto space-y-2" data-testid="slash-command-history">
              {history.map((h, i) => (
                <div key={i} className={`border rounded p-2 ${h.result.success ? 'bg-green-50' : 'bg-red-50'}`}>
                  <div className="font-mono text-sm font-semibold">{h.input}</div>
                  <pre className="text-xs mt-1 whitespace-pre-wrap">{h.result.output || h.result.error}</pre>
                </div>
              ))}
              {history.length === 0 && (
                <div className="text-center text-sm text-gray-500 py-8">执行历史为空</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SlashCommandPanel;
