/**
 * # ============================================================
 * # AppStateProvider 单元测试 (Cycle 15 P1-1)
 * # ============================================================
 * # 核心作用：覆盖 useReducer + Context 的全部 action 处理逻辑
 * #           + useAppState/useAppActions hooks 的正确性
 * # ============================================================
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { ReactNode } from 'react';
import {
  AppStateProvider,
  appReducer,
  INITIAL_STATE,
  useAppState,
  useAppActions,
  useAppStateSelector,
  useOptionalAppState,
  type AppState,
  type SessionSummary,
  type ChatMessage,
} from './AppStateProvider';

// ============================================================
// 工具函数
// ============================================================

function createWrapper() {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <AppStateProvider>{children}</AppStateProvider>;
  };
}

const mockSession: SessionSummary = {
  id: 'sess-1',
  title: 'Test Session',
  created_at: '2026-07-29T00:00:00Z',
  last_active_at: '2026-07-29T01:00:00Z',
  user_first_message: 'Hello',
  message_count: 0,
  status: 'active',
  mode: 'chat',
};

const mockMessage: ChatMessage = {
  id: 'msg-1',
  role: 'user',
  content: 'Test message',
  created_at: '2026-07-29T00:00:00Z',
  session_id: 'sess-1',
  agent_id: null,
  task_id: null,
};

// ============================================================
// Reducer 单元测试（纯函数）
// ============================================================

describe('appReducer - 会话 actions', () => {
  it('SET_CURRENT_SESSION 应更新 currentSessionId', () => {
    const result = appReducer(INITIAL_STATE, { type: 'SET_CURRENT_SESSION', sessionId: 'sess-1' });
    expect(result.currentSessionId).toBe('sess-1');
  });

  it('SET_SESSIONS 应替换会话列表', () => {
    const sessions = [mockSession];
    const result = appReducer(INITIAL_STATE, { type: 'SET_SESSIONS', sessions });
    expect(result.sessions).toEqual(sessions);
  });

  it('ADD_SESSION 应追加到会话列表', () => {
    const state1 = appReducer(INITIAL_STATE, { type: 'ADD_SESSION', session: mockSession });
    expect(state1.sessions).toHaveLength(1);
    const state2 = appReducer(state1, {
      type: 'ADD_SESSION',
      session: { ...mockSession, id: 'sess-2', title: 'Second' },
    });
    expect(state2.sessions).toHaveLength(2);
  });

  it('REMOVE_SESSION 应删除指定会话', () => {
    const state1 = appReducer(INITIAL_STATE, { type: 'ADD_SESSION', session: mockSession });
    const state2 = appReducer(state1, { type: 'REMOVE_SESSION', sessionId: 'sess-1' });
    expect(state2.sessions).toHaveLength(0);
  });

  it('REMOVE_SESSION 当前会话时应清空 currentSessionId', () => {
    const state1 = appReducer(INITIAL_STATE, { type: 'ADD_SESSION', session: mockSession });
    const state2 = appReducer(state1, { type: 'SET_CURRENT_SESSION', sessionId: 'sess-1' });
    const state3 = appReducer(state2, { type: 'REMOVE_SESSION', sessionId: 'sess-1' });
    expect(state3.currentSessionId).toBeNull();
  });

  it('REMOVE_SESSION 非当前会话时应保留 currentSessionId', () => {
    let state = INITIAL_STATE;
    state = appReducer(state, { type: 'ADD_SESSION', session: mockSession });
    state = appReducer(state, { type: 'ADD_SESSION', session: { ...mockSession, id: 'sess-2' } });
    state = appReducer(state, { type: 'SET_CURRENT_SESSION', sessionId: 'sess-2' });
    const result = appReducer(state, { type: 'REMOVE_SESSION', sessionId: 'sess-1' });
    expect(result.currentSessionId).toBe('sess-2');
  });

  it('UPDATE_SESSION 应更新指定会话字段', () => {
    let state = INITIAL_STATE;
    state = appReducer(state, { type: 'ADD_SESSION', session: mockSession });
    const result = appReducer(state, {
      type: 'UPDATE_SESSION',
      sessionId: 'sess-1',
      updates: { title: 'New Title' },
    });
    expect(result.sessions[0].title).toBe('New Title');
  });
});

describe('appReducer - 模式 & UI actions', () => {
  it('SET_APP_MODE 应更新应用模式', () => {
    const result = appReducer(INITIAL_STATE, { type: 'SET_APP_MODE', mode: 'coding' });
    expect(result.appMode).toBe('coding');
  });

  it('SET_APP_MODE 为 null 时应清空模式', () => {
    let state = INITIAL_STATE;
    state = appReducer(state, { type: 'SET_APP_MODE', mode: 'chat' });
    const result = appReducer(state, { type: 'SET_APP_MODE', mode: null });
    expect(result.appMode).toBeNull();
  });

  it('TOGGLE_SIDEBAR 应切换 sidebarExpanded', () => {
    let state = INITIAL_STATE;
    expect(state.sidebarExpanded).toBe(true);
    state = appReducer(state, { type: 'TOGGLE_SIDEBAR' });
    expect(state.sidebarExpanded).toBe(false);
    state = appReducer(state, { type: 'TOGGLE_SIDEBAR' });
    expect(state.sidebarExpanded).toBe(true);
  });

  it('SET_SIDEBAR_EXPANDED 应设置具体值', () => {
    const result = appReducer(INITIAL_STATE, { type: 'SET_SIDEBAR_EXPANDED', expanded: false });
    expect(result.sidebarExpanded).toBe(false);
  });
});

describe('appReducer - 聊天 actions', () => {
  it('SET_MESSAGES 应替换消息列表', () => {
    const messages = [mockMessage];
    const result = appReducer(INITIAL_STATE, { type: 'SET_MESSAGES', messages });
    expect(result.messages).toEqual(messages);
  });

  it('ADD_MESSAGE 应追加消息', () => {
    const state1 = appReducer(INITIAL_STATE, { type: 'ADD_MESSAGE', message: mockMessage });
    expect(state1.messages).toHaveLength(1);
    const state2 = appReducer(state1, {
      type: 'ADD_MESSAGE',
      message: { ...mockMessage, id: 'msg-2' },
    });
    expect(state2.messages).toHaveLength(2);
  });

  it('UPDATE_MESSAGE 应更新指定消息字段', () => {
    let state = INITIAL_STATE;
    state = appReducer(state, { type: 'ADD_MESSAGE', message: mockMessage });
    const result = appReducer(state, {
      type: 'UPDATE_MESSAGE',
      messageId: 'msg-1',
      updates: { content: 'Updated' },
    });
    expect(result.messages[0].content).toBe('Updated');
  });

  it('UPDATE_MESSAGE 不存在的 ID 应不修改状态', () => {
    let state = INITIAL_STATE;
    state = appReducer(state, { type: 'ADD_MESSAGE', message: mockMessage });
    const result = appReducer(state, {
      type: 'UPDATE_MESSAGE',
      messageId: 'nonexistent',
      updates: { content: 'X' },
    });
    expect(result.messages[0].content).toBe('Test message');
  });

  it('CLEAR_MESSAGES 应清空消息', () => {
    let state = INITIAL_STATE;
    state = appReducer(state, { type: 'ADD_MESSAGE', message: mockMessage });
    const result = appReducer(state, { type: 'CLEAR_MESSAGES' });
    expect(result.messages).toHaveLength(0);
  });

  it('SET_INPUT_VALUE 应更新输入框', () => {
    const result = appReducer(INITIAL_STATE, { type: 'SET_INPUT_VALUE', value: 'Hello' });
    expect(result.inputValue).toBe('Hello');
  });

  it('SET_IS_SENDING 应更新发送状态', () => {
    const result = appReducer(INITIAL_STATE, { type: 'SET_IS_SENDING', sending: true });
    expect(result.isSending).toBe(true);
  });

  it('SET_STREAMING_STATUS 应更新流式状态', () => {
    const result = appReducer(INITIAL_STATE, {
      type: 'SET_STREAMING_STATUS',
      status: 'thinking',
    });
    expect(result.streamingStatus).toBe('thinking');
  });

  it('SET_REASONING_STAGE 应更新推理阶段', () => {
    const result = appReducer(INITIAL_STATE, {
      type: 'SET_REASONING_STAGE',
      stage: 'coding',
    });
    expect(result.reasoningStage).toBe('coding');
  });

  it('RESET_CHAT_STATE 应重置所有聊天状态', () => {
    let state: AppState = {
      ...INITIAL_STATE,
      messages: [mockMessage],
      inputValue: 'test',
      isSending: true,
      streamingStatus: 'thinking',
      streamingMessageId: 'msg-1',
      thinkingContent: 'thinking...',
      reasoningStage: 'coding',
      stageProgress: 0.5,
    };
    const result = appReducer(state, { type: 'RESET_CHAT_STATE' });
    expect(result.messages).toHaveLength(0);
    expect(result.inputValue).toBe('');
    expect(result.isSending).toBe(false);
    expect(result.streamingStatus).toBeNull();
    expect(result.streamingMessageId).toBeNull();
    expect(result.thinkingContent).toBe('');
    expect(result.reasoningStage).toBe('idle');
    expect(result.stageProgress).toBe(0);
  });
});

describe('appReducer - 编程模式 & 计划 & 澄清 actions', () => {
  it('SET_SELECTED_PROJECT 应更新选中项目', () => {
    const result = appReducer(INITIAL_STATE, {
      type: 'SET_SELECTED_PROJECT',
      project: 'my-project',
    });
    expect(result.selectedProject).toBe('my-project');
  });

  it('SET_OPENED_FILE 应更新打开的文件', () => {
    const result = appReducer(INITIAL_STATE, {
      type: 'SET_OPENED_FILE',
      file: '/path/to/file.ts',
    });
    expect(result.openedFile).toBe('/path/to/file.ts');
  });

  it('SHOW_PLAN 应同时设置可见性和内容', () => {
    const result = appReducer(INITIAL_STATE, {
      type: 'SHOW_PLAN',
      content: 'Plan content',
    });
    expect(result.planVisible).toBe(true);
    expect(result.planContent).toBe('Plan content');
  });

  it('HIDE_PLAN 应只关闭可见性', () => {
    let state = INITIAL_STATE;
    state = appReducer(state, { type: 'SHOW_PLAN', content: 'test' });
    const result = appReducer(state, { type: 'HIDE_PLAN' });
    expect(result.planVisible).toBe(false);
    expect(result.planContent).toBe('test'); // 内容保留
  });

  it('SHOW_CLARIFY_MODAL 应设置 showClarifyModal', () => {
    const result = appReducer(INITIAL_STATE, { type: 'SHOW_CLARIFY_MODAL' });
    expect(result.showClarifyModal).toBe(true);
  });

  it('HIDE_CLARIFY_MODAL 应清空 showClarifyModal', () => {
    let state = INITIAL_STATE;
    state = appReducer(state, { type: 'SHOW_CLARIFY_MODAL' });
    const result = appReducer(state, { type: 'HIDE_CLARIFY_MODAL' });
    expect(result.showClarifyModal).toBe(false);
  });
});

describe('appReducer - 批量 actions', () => {
  it('RESET_ALL 应重置为初始状态', () => {
    let state: AppState = {
      ...INITIAL_STATE,
      currentSessionId: 'sess-1',
      messages: [mockMessage],
      appMode: 'coding',
    };
    const result = appReducer(state, { type: 'RESET_ALL' });
    expect(result).toEqual(INITIAL_STATE);
  });

  it('HYDRATE 应合并部分状态', () => {
    const partial = { currentSessionId: 'sess-x', sidebarExpanded: false };
    const result = appReducer(INITIAL_STATE, { type: 'HYDRATE', partial });
    expect(result.currentSessionId).toBe('sess-x');
    expect(result.sidebarExpanded).toBe(false);
    // 未修改字段应保留
    expect(result.appMode).toBe(INITIAL_STATE.appMode);
  });
});

describe('appReducer - 不可变性', () => {
  it('任何 action 不应修改原 state', () => {
    const original = { ...INITIAL_STATE };
    appReducer(INITIAL_STATE, { type: 'TOGGLE_SIDEBAR' });
    expect(INITIAL_STATE).toEqual(original);
  });

  it('未知 action 应返回原 state（不抛错）', () => {
    const unknown = { type: 'UNKNOWN' } as any;
    const result = appReducer(INITIAL_STATE, unknown);
    expect(result).toBe(INITIAL_STATE);
  });
});

// ============================================================
// useAppState / useAppActions Hook 测试
// ============================================================

describe('useAppState - Provider 集成', () => {
  it('在 Provider 内部应返回 state 和 dispatch', () => {
    const { result } = renderHook(() => useAppState(), { wrapper: createWrapper() });
    expect(result.current.state).toBeDefined();
    expect(typeof result.current.dispatch).toBe('function');
  });

  it('dispatch SET_CURRENT_SESSION 应更新 state', () => {
    const { result } = renderHook(() => useAppState(), { wrapper: createWrapper() });
    act(() => {
      result.current.dispatch({ type: 'SET_CURRENT_SESSION', sessionId: 'sess-1' });
    });
    expect(result.current.state.currentSessionId).toBe('sess-1');
  });

  it('在 Provider 外部使用应抛出错误', () => {
    // 抑制错误日志
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useAppState())).toThrow(
      /必须在 <AppStateProvider> 内部使用/
    );
    consoleError.mockRestore();
  });
});

describe('useAppActions - Action Creators', () => {
  it('setCurrentSession 应正确分发', () => {
    const { result } = renderHook(
      () => ({ actions: useAppActions(), state: useAppState().state }),
      { wrapper: createWrapper() }
    );
    act(() => result.current.actions.setCurrentSession('sess-1'));
    expect(result.current.state.currentSessionId).toBe('sess-1');
  });

  it('addMessage 应追加消息', () => {
    const { result } = renderHook(
      () => ({ actions: useAppActions(), state: useAppState().state }),
      { wrapper: createWrapper() }
    );
    act(() => result.current.actions.addMessage(mockMessage));
    expect(result.current.state.messages).toHaveLength(1);
  });

  it('showPlan + hidePlan 应正确切换', () => {
    const { result } = renderHook(
      () => ({ actions: useAppActions(), state: useAppState().state }),
      { wrapper: createWrapper() }
    );
    act(() => result.current.actions.showPlan('test'));
    expect(result.current.state.planVisible).toBe(true);
    act(() => result.current.actions.hidePlan());
    expect(result.current.state.planVisible).toBe(false);
  });

  it('resetChatState 应清空聊天状态', () => {
    const { result } = renderHook(
      () => ({ actions: useAppActions(), state: useAppState().state }),
      { wrapper: createWrapper() }
    );
    act(() => result.current.actions.addMessage(mockMessage));
    act(() => result.current.actions.setInputValue('hello'));
    act(() => result.current.actions.setIsSending(true));
    act(() => result.current.actions.resetChatState());
    expect(result.current.state.messages).toHaveLength(0);
    expect(result.current.state.inputValue).toBe('');
    expect(result.current.state.isSending).toBe(false);
  });

  it('actions 引用应保持稳定（useMemo 优化）', () => {
    const { result, rerender } = renderHook(() => useAppActions(), {
      wrapper: createWrapper(),
    });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});

describe('useAppStateSelector - 选择器订阅', () => {
  it('应返回选择器指定的状态切片', () => {
    const { result } = renderHook(() => useAppStateSelector((s) => s.appMode), {
      wrapper: createWrapper(),
    });
    expect(result.current).toBeNull();
  });

  it('state 变化时应返回新值', () => {
    const { result } = renderHook(
      () => ({
        mode: useAppStateSelector((s) => s.appMode),
        setMode: useAppActions().setAppMode,
      }),
      { wrapper: createWrapper() }
    );
    expect(result.current.mode).toBeNull();
    act(() => result.current.setMode('coding'));
    expect(result.current.mode).toBe('coding');
  });
});

describe('useOptionalAppState - 可选访问', () => {
  it('在 Provider 外部应返回 null', () => {
    const { result } = renderHook(() => useOptionalAppState());
    expect(result.current).toBeNull();
  });

  it('在 Provider 内部应返回完整 state', () => {
    const { result } = renderHook(() => useOptionalAppState(), {
      wrapper: createWrapper(),
    });
    expect(result.current).not.toBeNull();
    expect(result.current?.state).toBeDefined();
  });
});

describe('AppStateProvider - 初始状态', () => {
  it('应使用默认初始状态（无 initialState）', () => {
    const { result } = renderHook(() => useAppState(), { wrapper: createWrapper() });
    expect(result.current.state.currentSessionId).toBeNull();
    expect(result.current.state.appMode).toBeNull();
    expect(result.current.state.sidebarExpanded).toBe(true);
    expect(result.current.state.messages).toEqual([]);
  });

  it('应支持 initialState 覆盖', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AppStateProvider initialState={{ currentSessionId: 'preset-1', appMode: 'coding' }}>
        {children}
      </AppStateProvider>
    );
    const { result } = renderHook(() => useAppState(), { wrapper });
    expect(result.current.state.currentSessionId).toBe('preset-1');
    expect(result.current.state.appMode).toBe('coding');
  });

  it('initialState 未覆盖字段应使用默认值', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AppStateProvider initialState={{ currentSessionId: 'preset-1' }}>
        {children}
      </AppStateProvider>
    );
    const { result } = renderHook(() => useAppState(), { wrapper });
    expect(result.current.state.appMode).toBeNull();
    expect(result.current.state.sidebarExpanded).toBe(true);
  });
});

describe('Context value 稳定性', () => {
  it('state 变化时 context value 应变化', () => {
    const { result, rerender } = renderHook(() => useAppState(), {
      wrapper: createWrapper(),
    });
    const first = result.current;
    act(() => {
      first.dispatch({ type: 'SET_APP_MODE', mode: 'coding' });
    });
    rerender();
    expect(result.current).not.toBe(first);
    expect(result.current.state.appMode).toBe('coding');
  });
});
