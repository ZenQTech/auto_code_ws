# Cycle 24 SPEC: Voice Input 语音输入

## 概述

集成浏览器 Web Speech API + 可选外部 STT 服务，为 ChatMainArea / ComposerPanel / RequirementInput 提供语音输入能力。支持中/英/日多语言识别、实时转写、命令快捷词。

## 设计目标

1. **零依赖优先**：使用浏览器原生 Web Speech API（Chrome / Edge / Safari 支持）
2. **可降级**：不支持 Web Speech 的浏览器自动降级为文本输入
3. **多语言**：自动检测语言或手动指定（中/英/日）
4. **可定制**：支持自定义命令快捷词（"停止"、"发送"、"删除"等）

## 核心功能

### 1. 适配器 (VoiceInputAdapter)

```typescript
interface VoiceInputConfig {
  lang: string;            // 'zh-CN' | 'en-US' | 'ja-JP' | 'auto'
  continuous: boolean;     // 持续识别
  interimResults: boolean; // 实时显示中间结果
  maxAlternatives: number; // 候选数
  silenceTimeoutMs: number; // 静音自动停止时间
  commandShortcuts: Record<string, VoiceCommand>; // 语音命令
}

interface VoiceCommand {
  pattern: string | RegExp;  // 匹配模式
  action: 'send' | 'clear' | 'stop' | 'undo' | 'newline';
  description: string;
}

interface VoiceRecognitionState {
  isListening: boolean;
  isSupported: boolean;
  transcript: string;        // 完整转写
  interimTranscript: string; // 中间结果
  confidence: number;        // 置信度 0-1
  language: string;
  error: string | null;
  startedAt: number | null;
  durationMs: number;
}

class VoiceInputAdapter {
  isSupported(): boolean;
  getState(): VoiceRecognitionState;
  start(): Promise<void>;
  stop(): void;
  abort(): void;
  reset(): void;
  updateConfig(patch: Partial<VoiceInputConfig>): void;
  on(type: VoiceEventType, handler: Function): () => void;
  setLanguage(lang: string): void;
  addCommand(name: string, command: VoiceCommand): void;
  removeCommand(name: string): void;
}
```

### 2. UI 组件 (VoiceButton)

- 麦克风图标按钮，集成到 ChatMainArea 输入框右侧
- 三态：默认 / 监听中（红色脉冲）/ 处理中（加载图标）
- 点击开始，再次点击停止
- 实时显示转写气泡（可关闭）
- 长按打开语音命令帮助

## 验收标准

- [ ] 支持 zh-CN / en-US / ja-JP 三种语言
- [ ] 浏览器不支持时自动隐藏按钮
- [ ] 实时转写显示中间结果
- [ ] 5 个内置语音命令（发送/停止/清空/换行/撤销）
- [ ] 静音 2 秒自动停止
- [ ] 识别错误显示友好提示
- [ ] 25+ 单元/组件测试

---

**创建日期**: 2026-07-29
**目标 Cycle**: Cycle 24 P1-1
