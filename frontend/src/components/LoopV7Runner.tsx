/**
 * # ============================================================
 * # Loop v7 端到端工作流运行组件 - LoopV7Runner
 * # ============================================================
 * # 核心作用：在 UI 端触发并展示 Loop Engineering v7 端到端工作流
 * #           用户可填写需求、选择项目类型，然后启动 15 步工作流
 * #           实时显示每步进度、Hook 事件、最终结果
 * # 运行流程：
 * #   1. 用户填写项目名 + 项目类型 + 需求文本
 * #   2. 点击"启动 Loop v7 工作流"按钮
 * #   3. 调用 POST /api/workflow/loop-v7/stream
 * #   4. 实时接收 SSE 事件，更新进度条和步骤状态
 * #   5. 工作流完成后显示最终结果（success/files/git_commits）
 * # 输入参数：
 * #   - onClose: 关闭 Runner 回调
 * #   - projectName?: 可选预设项目名
 * # 输出结果：v7 端到端工作流结果展示
 * # 修改记录：
 * #   - 2026-07-24 | v1.0.0 | 初始版本，集成 Loop v7 端到端工作流
 * # ============================================================
 */

import React, { useState, useRef } from 'react';
import { startLoopV7Stream, type LoopV7StartResponse, type LoopV7HookEvent } from '../hooks/useApi';

interface LoopV7RunnerProps {
  onClose?: () => void;
  projectName?: string;
}

const STEP_NAMES = [
  '1. 用户输入需求',
  '2. 生成总架构师',
  '3. 总架构师与用户多轮澄清（强制验收标准）',
  '4. 生成质量保障与迭代管理智能体 + 批判反思智能体',
  '5. 批判反思智能体对结构化需求做 1 次迭代',
  '6. 与质量保障智能体敲定详细任务验收标准',
  '7. 按模块生成 spec/task/checklist + 创建 git',
  '8. 在 /home/qizheng/auto_code_data/ 下创建源代码项目仓库',
  '9. 按模块分发任务到独立 CLI Worker + 实际生成代码',
  '10. 整合原子任务清单（高风险标记 + 全局接口）',
  '11. 注册 task 完成 hook',
  '12. Git 提交（按模块 + 合并到 main）',
  '13. 质量保障智能体系统评测（含打回重做）',
  '14. 实际运行整个项目验证',
  '15. 推送 main 分支',
];

const DEFAULT_USER_INPUT = `我需要完成两个项目：

【项目一：前端设计项目】智能仓库调度系统可视化平台
- 使用 React + TypeScript + Vite 技术栈
- 包含 AGV 实时位置地图、任务队列监控、设备状态面板
- 支持实时数据刷新（WebSocket，≥30Hz）
- 首屏加载≤2秒，WebSocket延迟≤100ms

【项目二：机器人全栈设计项目】AGV 集群调度系统
- ROS2 Humble + C++17/Python 3.10
- 差速驱动底盘 + SICK LiDAR + Xsens IMU + NVIDIA Jetson Orin
- 多机协同任务调度、路径规划、避障
- 包含 emergency stop 紧急停止模块（高安全风险）
- 物理碰撞检测 + 虚拟安全区双重保护
- 速度≤1.0 m/s，加速度≤0.5 m/s²，扭矩≤5 N·m
- 急停响应≤50ms，多机任务完成率≥99%`;

export const LoopV7Runner: React.FC<LoopV7RunnerProps> = ({ onClose, projectName: initialProjectName }) => {
  const [projectName, setProjectName] = useState(initialProjectName || 'e2e_dual_v7_ui');
  const [projectType, setProjectType] = useState<'fullstack' | 'frontend' | 'robot'>('fullstack');
  const [userInput, setUserInput] = useState(DEFAULT_USER_INPUT);
  const [running, setRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [stepStatus, setStepStatus] = useState<('pending' | 'running' | 'success' | 'failed')[]>(
    new Array(15).fill('pending'),
  );
  const [hooks, setHooks] = useState<LoopV7HookEvent[]>([]);
  const [result, setResult] = useState<LoopV7StartResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const start = async () => {
    if (!projectName.trim() || !userInput.trim()) {
      setError('请填写项目名和需求');
      return;
    }
    setRunning(true);
    setError(null);
    setResult(null);
    setHooks([]);
    setStepStatus(new Array(15).fill('pending'));
    setCurrentStep(0);
    setElapsedSeconds(0);

    timerRef.current = setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);

    abortRef.current = startLoopV7Stream(
      {
        userInput,
        projectName: projectName.trim(),
        projectType,
        userAnswers: ['方案A', '方案A', '方案A', '方案A', '方案A'],
        realRun: true,
        realPush: true,
      },
      {
        onHook: (event) => {
          setHooks((prev) => [...prev, event].slice(-50));
        },
        onCompleted: (response) => {
          setResult(response);
          setStepStatus((prev) => {
            const next = [...prev];
            response.steps.forEach((s) => {
              if (s.step >= 1 && s.step <= 15) {
                next[s.step - 1] = s.success ? 'success' : 'failed';
              }
            });
            return next;
          });
          setCurrentStep(15);
          setRunning(false);
          if (timerRef.current) clearInterval(timerRef.current);
        },
        onFailed: (err) => {
          setError(err);
          setRunning(false);
          if (timerRef.current) clearInterval(timerRef.current);
        },
      },
    );
  };

  const stop = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setRunning(false);
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-2xl w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
              🚀 Loop v7 端到端工作流
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              15 步完整流程：需求 → 架构 → 代码 → Git 推送
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-sm font-mono text-gray-600">
              ⏱️ {formatTime(elapsedSeconds)}
            </div>
            {onClose && (
              <button
                onClick={onClose}
                className="text-gray-500 hover:text-gray-700 text-2xl"
              >
                ×
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-hidden flex">
          {/* Left: Configuration + Steps */}
          <div className="w-1/2 p-6 overflow-y-auto border-r border-gray-200 dark:border-gray-700">
            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  项目名
                </label>
                <input
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  disabled={running}
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                  placeholder="e2e_dual_v7_ui"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  项目类型
                </label>
                <select
                  value={projectType}
                  onChange={(e) => setProjectType(e.target.value as 'fullstack' | 'frontend' | 'robot')}
                  disabled={running}
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                >
                  <option value="fullstack">双项目（前端 + 机器人）</option>
                  <option value="frontend">仅前端</option>
                  <option value="robot">仅机器人</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  用户需求（5 轮澄清将自动选"方案A"）
                </label>
                <textarea
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  disabled={running}
                  rows={10}
                  className="w-full px-3 py-2 border border-gray-300 rounded text-xs font-mono"
                />
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2 mb-6">
              {!running ? (
                <button
                  onClick={start}
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium"
                >
                  ▶️ 启动 Loop v7 工作流
                </button>
              ) : (
                <button
                  onClick={stop}
                  className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded font-medium"
                >
                  ⏹ 停止
                </button>
              )}
            </div>

            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded text-sm">
                ❌ {error}
              </div>
            )}

            {/* Steps list */}
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                15 步工作流进度
              </h3>
              {STEP_NAMES.map((name, idx) => {
                const status = stepStatus[idx];
                const isActive = currentStep === idx + 1 && status === 'running';
                const icon =
                  status === 'success' ? '✅' :
                    status === 'failed' ? '❌' :
                      isActive ? '⏳' : '⚪';
                return (
                  <div
                    key={idx}
                    className={`px-3 py-2 text-xs rounded ${
                      isActive ? 'bg-blue-50 border border-blue-300' :
                        status === 'success' ? 'bg-green-50' :
                          status === 'failed' ? 'bg-red-50' : 'bg-gray-50'
                    }`}
                  >
                    <span className="mr-2">{icon}</span>
                    {name}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right: Hooks + Result */}
          <div className="w-1/2 p-6 overflow-y-auto">
            {result && (
              <div className="mb-6 p-4 bg-gradient-to-br from-green-50 to-blue-50 border border-green-200 rounded-lg">
                <h3 className="text-lg font-bold text-gray-900 mb-2">
                  {result.success ? '🎉 工作流成功完成' : '⚠️ 工作流未完全成功'}
                </h3>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div><strong>workflow_id:</strong> {result.workflow_id.slice(0, 16)}...</div>
                  <div><strong>project_name:</strong> {result.project_name}</div>
                  <div><strong>project_type:</strong> {result.project_type}</div>
                  <div><strong>duration:</strong> {result.duration_s.toFixed(1)}s</div>
                  <div><strong>files_generated:</strong> {result.files_generated_count}</div>
                  <div><strong>git_commits:</strong> {result.git_commits}</div>
                  <div><strong>events:</strong> {result.event_count}</div>
                  <div><strong>final_status:</strong> {result.final_status}</div>
                </div>
                {result.project_root && (
                  <div className="mt-2 text-xs">
                    <strong>project_root:</strong>{' '}
                    <code className="bg-white px-1 py-0.5 rounded text-xs">
                      {result.project_root}
                    </code>
                  </div>
                )}
                {result.files_generated_sample.length > 0 && (
                  <details className="mt-2">
                    <summary className="text-xs font-medium cursor-pointer">
                      生成文件示例（{result.files_generated_count}）
                    </summary>
                    <ul className="mt-1 text-xs font-mono bg-white p-2 rounded max-h-40 overflow-y-auto">
                      {result.files_generated_sample.map((f, i) => (
                        <li key={i}>{f}</li>
                      ))}
                    </ul>
                  </details>
                )}
                <div className="mt-2">
                  <strong className="text-xs">步骤明细：</strong>
                  <ul className="mt-1 text-xs space-y-0.5 max-h-60 overflow-y-auto">
                    {result.steps.map((s) => (
                      <li key={s.step} className="flex items-center gap-2">
                        <span>{s.success ? '✅' : '❌'}</span>
                        <span className="font-mono">Step {s.step}</span>
                        <span className="flex-1">{s.name}</span>
                        <span className="text-gray-500">{s.duration_s.toFixed(1)}s</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              Hook 事件流（{hooks.length}）
            </h3>
            <div className="space-y-1 max-h-96 overflow-y-auto">
              {hooks.length === 0 ? (
                <div className="text-xs text-gray-400 italic">
                  {running ? '等待 hook 事件...' : '尚无 hook 事件'}
                </div>
              ) : (
                hooks.map((h, i) => (
                  <div
                    key={i}
                    className="px-2 py-1 text-xs bg-gray-50 border-l-2 border-blue-400 font-mono"
                  >
                    <span className="text-gray-500">{new Date(h.timestamp * 1000).toLocaleTimeString()}</span>{' '}
                    <span className="text-blue-600">[{h.module}]</span>{' '}
                    <span className="text-green-600">{h.status}</span>{' '}
                    {h.message} {h.files_count > 0 && `(${h.files_count} files)`}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoopV7Runner;
