/**
 * # ============================================================
 * MCP 面板组件
 * # ============================================================
 * 核心作用：展示 MCP servers 和可用工具，支持调用
 * 创建日期：2026-07-27
 * 模块版本：v1.0.0
 * ============================================================
 */

import React, { useState } from 'react';
import { useMCPServers, useMCPTools, callMCPTool, MCPTool } from '../hooks/useCycle2Api';

export const McpPanel: React.FC = () => {
  const { servers, loading: serversLoading } = useMCPServers();
  const { tools, loading: toolsLoading, refetch: refetchTools } = useMCPTools();
  const [selectedTool, setSelectedTool] = useState<MCPTool | null>(null);
  const [args, setArgs] = useState('{}');
  const [result, setResult] = useState<any>(null);
  const [calling, setCalling] = useState(false);

  const handleCall = async () => {
    if (!selectedTool) return;
    setCalling(true);
    setResult(null);
    try {
      const parsed = JSON.parse(args);
      const res = await callMCPTool(selectedTool.name, parsed);
      setResult(res);
    } catch (e: any) {
      setResult({ success: false, error: e.message || '调用失败' });
    } finally {
      setCalling(false);
    }
  };

  return (
    <div className="mcp-panel p-4 bg-white rounded-lg shadow">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <span>🔌</span>
          <span>MCP (Model Context Protocol)</span>
        </h2>
        <button
          onClick={refetchTools}
          className="text-sm text-blue-600 hover:text-blue-800"
        >
          刷新
        </button>
      </div>

      {/* Servers */}
      <div className="mb-4">
        <h3 className="text-sm font-medium text-gray-700 mb-2">已注册 Servers</h3>
        {serversLoading ? (
          <div className="text-sm text-gray-500">加载中...</div>
        ) : (
          <div className="space-y-1">
            {servers.map(s => (
              <div
                key={s.id}
                className="flex items-center justify-between text-sm bg-gray-50 px-3 py-2 rounded"
              >
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-500"></span>
                  <span className="font-mono">{s.name}</span>
                  <span className="text-xs text-gray-500">({s.transport})</span>
                </div>
                <span className="text-xs text-gray-500">{s.tool_count} tools</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tools */}
      <div className="mb-4">
        <h3 className="text-sm font-medium text-gray-700 mb-2">可用工具</h3>
        {toolsLoading ? (
          <div className="text-sm text-gray-500">加载中...</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {tools.map(t => (
              <button
                key={t.name}
                onClick={() => setSelectedTool(t)}
                className={`text-left text-sm p-2 border rounded transition-colors ${
                  selectedTool?.name === t.name
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="font-mono font-medium">{t.name}</div>
                <div className="text-xs text-gray-500 line-clamp-2">{t.description}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Call Tool */}
      {selectedTool && (
        <div className="border-t pt-4 mt-4">
          <h3 className="text-sm font-medium text-gray-700 mb-2">
            调用: {selectedTool.name}
          </h3>
          <div className="text-xs text-gray-600 mb-2">
            <pre className="bg-gray-50 p-2 rounded overflow-x-auto">
              {JSON.stringify(selectedTool.inputSchema, null, 2)}
            </pre>
          </div>
          <textarea
            value={args}
            onChange={e => setArgs(e.target.value)}
            className="w-full p-2 border rounded text-sm font-mono"
            rows={4}
            placeholder='{"path": "/path/to/file"}'
          />
          <button
            onClick={handleCall}
            disabled={calling}
            className="mt-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {calling ? '调用中...' : '调用'}
          </button>

          {result && (
            <div className="mt-3 p-3 bg-gray-50 rounded text-sm">
              <div className="font-medium mb-1">结果:</div>
              <pre className="text-xs overflow-x-auto whitespace-pre-wrap">
                {JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default McpPanel;
