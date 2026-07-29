# CYCLE 15 - UI/UX 优化 Spec #4: 验收标准

> **文档版本**: v1.0.0
> **创建日期**: 2026-07-29
> **适用范围**: Hermes 智能体调度平台全部 3 个 frontend 项目
> **依赖**: [CYCLE15_SPEC_VISUAL.md](./CYCLE15_SPEC_VISUAL.md), [CYCLE15_SPEC_INTERACTION.md](./CYCLE15_SPEC_INTERACTION.md), [CYCLE15_SPEC_TECHNICAL.md](./CYCLE15_SPEC_TECHNICAL.md)
> **状态**: ✅ Phase 4 测试验证基线

---

## 1. 验收框架

### 1.1 五维验收

| 维度 | 目标 | 测试方法 | 权重 |
|------|------|---------|------|
| 视觉品质 | 像素级合规 | 视觉对比 + Chromatic | 20% |
| 交互体验 | 100% 闭环 | 手动 + 自动化 E2E | 25% |
| 性能指标 | Lighthouse ≥ 90 | Lighthouse + Web Vitals | 20% |
| 兼容性 | 全平台覆盖 | BrowserStack + 真机 | 15% |
| 代码质量 | 覆盖率 ≥ 80% | Vitest + ESLint + tsc | 20% |

### 1.2 验收等级

| 等级 | 描述 | 通过条件 |
|------|------|---------|
| **A (优秀)** | 超过预期 | 所有维度 ≥ 95% 通过率 |
| **B (合格)** | 达到预期 | 所有维度 ≥ 90% 通过率 |
| **C (基本)** | 勉强可用 | 所有维度 ≥ 80% 通过率 |
| **D (不达标)** | 未达预期 | 任何维度 < 80% |

**本项目目标**: 至少达到 **B (合格)**

---

## 2. 视觉验收标准

### 2.1 像素级合规

#### 验收项
- ✅ 3 项目视觉风格 100% 一致（同色、同圆角、同间距）
- ✅ Design Token 100% 统一（无硬编码颜色/间距）
- ✅ 圆角、间距、字号严格遵循规范
- ✅ 像素级偏差容忍度 ≤ 2px

#### 验收方法

##### 自动化（Chromatic 视觉回归）
```typescript
// chromatic.config.ts
export default {
  projectToken: 'xxx',
  exitZeroOnChanges: false,
  // 视觉对比阈值
  diffThreshold: 0.1,  // 10% 像素差异
};
```

##### 手动（设计稿对比）
- 使用 Figma / Sketch 设计稿
- 关键页面 100% 覆盖
- 4 个分辨率截图对比

#### 验收清单
- [ ] 主 frontend - ChatView 视觉对比
- [ ] 主 frontend - DiffView 视觉对比
- [ ] 主 frontend - CodeViewer 视觉对比
- [ ] 主 frontend - ThinkingBlock 视觉对比
- [ ] 主 frontend - Modal/Drawer 视觉对比
- [ ] loop-verify - HealthCheck 视觉对比
- [ ] test_loop_v7 - Dashboard 视觉对比
- [ ] 3 主题（浅色/深色/高对比度）对比

### 2.2 主题切换

#### 验收项
- ✅ 3 主题（浅色/深色/高对比度）可正常切换
- ✅ 切换无闪烁
- ✅ 用户偏好持久化
- ✅ 系统主题自动适配

#### 验收用例
```typescript
describe('主题切换', () => {
  it('切换到深色主题', async () => {
    await page.click('[data-testid="theme-toggle"]');
    await page.click('[data-testid="theme-dark"]');
    expect(page.locator('html')).toHaveClass('dark');
  });

  it('刷新后保持主题', async () => {
    await page.click('[data-testid="theme-toggle"]');
    await page.click('[data-testid="theme-dark"]');
    await page.reload();
    expect(page.locator('html')).toHaveClass('dark');
  });

  it('跟随系统主题', async () => {
    await page.emulateMedia({ colorScheme: 'dark' });
    expect(page.locator('html')).toHaveClass('dark');
  });
});
```

### 2.3 色盲模式

#### 验收项
- ✅ 色盲模式开关可见
- ✅ 开启后所有状态可识别（图标 + 形状双编码）
- ✅ 7 种状态颜色 + 图标组合不冲突

#### 验收用例
```typescript
describe('色盲模式', () => {
  it('开启色盲模式后状态图标可见', async () => {
    await page.click('[data-testid="settings"]');
    await page.click('[data-testid="color-blind-toggle"]');
    // 验证 7 状态都显示图标
    const statuses = ['idle', 'running', 'paused', 'tool-calling', 'failed', 'cancelled', 'completed'];
    for (const status of statuses) {
      await expect(page.locator(`[data-testid="status-${status}"] svg`)).toBeVisible();
    }
  });
});
```

### 2.4 无障碍合规（WCAG 2.1 AA）

#### 验收项
- ✅ 文字对比度 ≥ 4.5:1（正文）
- ✅ 图形对比度 ≥ 3:1（大字体、图标）
- ✅ 所有交互元素键盘可达
- ✅ 焦点环可见
- ✅ ARIA 标签完整

#### 验收方法
- **axe DevTools** 自动扫描
- **Lighthouse Accessibility** ≥ 95
- **键盘导航** 100% 覆盖

---

## 3. 交互验收标准

### 3.1 操作反馈完整性

#### 验收项
- ✅ 所有用户操作 100ms 内有视觉反馈
- ✅ 所有 API 调用有 loading 状态
- ✅ 所有结果有 success/error Toast

#### 验收用例清单

| # | 操作 | 反馈形式 | 验收 |
|---|------|---------|------|
| 1 | 点击主按钮 | loading spinner | ☐ |
| 2 | 提交表单 | 按钮 disabled + spinner | ☐ |
| 3 | API 成功 | success Toast | ☐ |
| 4 | API 失败 | error Toast + [重试] | ☐ |
| 5 | 删除项目 | confirm 模态 | ☐ |
| 6 | 切换 Tab | 立即切换 + 加载状态 | ☐ |
| 7 | 打开 Modal | 遮罩 + 缩放动画 | ☐ |
| 8 | 关闭 Modal | Esc 键 | ☐ |
| 9 | 拖拽文件 | 蓝色虚线提示 | ☐ |
| 10 | 网络断开 | 顶部 banner | ☐ |

### 3.2 核心用户路径 E2E

#### 路径 1: 创建新项目
```typescript
test('用户创建新项目', async ({ page }) => {
  // 步骤 1: 打开主页
  await page.goto('http://localhost:5173');
  await expect(page).toHaveTitle(/Hermes/);

  // 步骤 2: 点击新项目（或 Cmd+N）
  await page.keyboard.press('Meta+N');
  await expect(page.locator('[data-testid="new-project-modal"]')).toBeVisible();

  // 步骤 3: 填写表单
  await page.fill('[data-testid="project-name"]', 'E2E Test Project');
  await page.fill('[data-testid="project-path"]', '/tmp/test');

  // 步骤 4: 提交
  await page.click('[data-testid="submit"]');

  // 步骤 5: 验证创建成功
  await expect(page.locator('.toast-success')).toContainText('项目创建成功');
  await expect(page).toHaveURL(/.*\/project\/.+/);

  // 步骤 6: 验证项目出现在列表
  await page.click('[data-testid="back-home"]');
  await expect(page.locator('[data-testid="project-list"]')).toContainText('E2E Test Project');
});
```

#### 路径 2: 与 AI 对话
```typescript
test('用户与 AI 对话', async ({ page }) => {
  // 准备：进入项目
  await page.goto('http://localhost:5173/project/test-id');

  // 步骤 1: Cmd+I 唤起输入
  await page.keyboard.press('Meta+I');
  await expect(page.locator('[data-testid="chat-input"]')).toBeFocused();

  // 步骤 2: 输入消息
  await page.fill('[data-testid="chat-input"]', 'Hello AI');

  // 步骤 3: 发送
  await page.keyboard.press('Enter');

  // 步骤 4: 验证消息出现
  await expect(page.locator('[data-testid="user-message"]')).toContainText('Hello AI');

  // 步骤 5: 验证 thinking block
  await expect(page.locator('[data-testid="thinking-block"]')).toBeVisible();

  // 步骤 6: 等待 AI 响应
  await expect(page.locator('[data-testid="ai-message"]')).toBeVisible({ timeout: 30000 });

  // 步骤 7: 验证状态变为 completed
  await expect(page.locator('[data-testid="workflow-status"]')).toContainText('已完成');
});
```

#### 路径 3: 查看代码变更
```typescript
test('用户查看代码变更', async ({ page }) => {
  // 准备：AI 已完成生成
  await page.goto('http://localhost:5173/project/test-id/session/with-diff');

  // 步骤 1: 验证 DiffView 浮层出现
  await expect(page.locator('[data-testid="diff-view"]')).toBeVisible();

  // 步骤 2: 切换行/词/字符模式
  await page.click('[data-testid="diff-mode-word"]');
  await expect(page.locator('[data-testid="word-diff"]')).toBeVisible();

  // 步骤 3: 切换统一/分屏视图
  await page.click('[data-testid="diff-view-split"]');
  await expect(page.locator('[data-testid="split-view"]')).toBeVisible();

  // 步骤 4: 接受变更
  await page.click('[data-testid="accept-diff"]');
  await expect(page.locator('.toast-success')).toContainText('变更已接受');
});
```

#### 路径 4: 回退代码
```typescript
test('用户回退代码', async ({ page }) => {
  // 准备：存在历史版本
  await page.goto('http://localhost:5173/project/test-id/timeline');

  // 步骤 1: 打开时间线
  await expect(page.locator('[data-testid="timeline"]')).toBeVisible();

  // 步骤 2: 选择历史版本
  await page.click('[data-testid="timeline-entry-2"]');

  // 步骤 3: 打开 Diff Preview
  await expect(page.locator('[data-testid="diff-preview-modal"]')).toBeVisible();

  // 步骤 4: 选择"直接回退"
  await page.click('[data-testid="rollback-direct"]');

  // 步骤 5: 验证 5s 倒计时
  await expect(page.locator('[data-testid="countdown"]')).toContainText('5s');

  // 步骤 6: 等待执行
  await page.waitForTimeout(5500);

  // 步骤 7: 验证 Toast 撤销按钮
  await expect(page.locator('[data-testid="undo-toast"]')).toBeVisible();

  // 步骤 8: 点击撤销
  await page.click('[data-testid="undo-button"]');
  await expect(page.locator('.toast-success')).toContainText('已撤销');
});
```

### 3.3 错误处理覆盖

| # | 错误类型 | 验收点 |
|---|---------|--------|
| 1 | 表单空字段 | inline error + 提交禁用 |
| 2 | 表单字段过长 | inline error + 字符计数 |
| 3 | 重复名称 | inline error 明确建议 |
| 4 | 网络断开 | 顶部 banner + 操作降级 |
| 5 | API 500 | error Toast + [重试] |
| 6 | API 超时（30s） | timeout Toast + [重试] |
| 7 | 权限不足 | 模态 + 申请权限引导 |
| 8 | 文件过大 | inline error + 建议 |
| 9 | 列表为空 | 引导插画 + 建议 |
| 10 | 加载失败 | 占位 + [重试] |

### 3.4 快捷键覆盖

| # | 快捷键 | 操作 | 验收 |
|---|--------|------|------|
| 1 | Cmd+I | 唤起 AI 输入 | ☐ |
| 2 | Cmd+K | 命令面板 | ☐ |
| 3 | Cmd+N | 新建项目 | ☐ |
| 4 | Cmd+S | 保存 | ☐ |
| 5 | Cmd+Z | 撤销 | ☐ |
| 6 | Cmd+Shift+Z | 重做 | ☐ |
| 7 | Cmd+, | 设置 | ☐ |
| 8 | Esc | 关闭弹窗 | ☐ |
| 9 | ? | 快捷键帮助 | ☐ |
| 10 | Space | 暂停/恢复工作流 | ☐ |

---

## 4. 性能验收标准

### 4.1 Lighthouse 评分

| 指标 | 目标 | 不可接受 |
|------|------|---------|
| Performance | ≥ 90 | < 80 |
| Accessibility | ≥ 95 | < 90 |
| Best Practices | ≥ 95 | < 90 |
| SEO | ≥ 90 | < 80 |

### 4.2 Core Web Vitals

| 指标 | 目标 | 不可接受 |
|------|------|---------|
| LCP (Largest Contentful Paint) | < 2.5s | > 4s |
| FID (First Input Delay) | < 100ms | > 300ms |
| CLS (Cumulative Layout Shift) | < 0.1 | > 0.25 |
| FCP (First Contentful Paint) | < 1.8s | > 3s |
| TTI (Time to Interactive) | < 3.8s | > 7.3s |

### 4.3 Bundle 大小

| 资源 | 预算 | 不可接受 |
|------|------|---------|
| Initial JS (gzip) | < 500KB | > 1MB |
| Total CSS (gzip) | < 50KB | > 100KB |
| Total Initial (gzip) | < 1MB | > 2MB |
| Monaco 主包 (gzip) | < 200KB | > 300KB |
| Shiki (async, gzip) | < 500KB | > 1MB |

#### 验收方法
```bash
# Bundle 分析
npm run build
npm run analyze  # 使用 rollup-plugin-visualizer

# 预算检查
npm run bundle-budget  # 自定义脚本检查
```

### 4.4 运行时性能

| 场景 | 目标 | 验收方法 |
|------|------|---------|
| 1K 消息列表滚动 | 60fps | Performance API |
| 10K 消息列表滚动 | 60fps | Performance API |
| 100K 消息列表滚动 | ≥ 30fps | Performance API |
| 1MB 文件 diff 计算 | < 200ms | Performance API |
| 100MB 文件 diff 计算 | < 2s (Worker) | Performance API |
| Shiki 高亮 1000 行 | < 100ms | Performance API |
| 主题切换 | < 50ms | Performance API |
| Modal 打开 | < 200ms | Performance API |
| 模态搜索 fuzzy | < 50ms | Performance API |
| 撤销栈 push | < 10ms | Performance API |

#### 验收示例
```typescript
describe('运行时性能', () => {
  it('10K 消息列表滚动 60fps', async ({ page }) => {
    await page.goto('http://localhost:5173/chat/10k-messages');
    const fps = await page.evaluate(() => {
      return new Promise<number>((resolve) => {
        let frameCount = 0;
        const start = performance.now();
        function tick() {
          frameCount++;
          window.scrollBy(0, 10);
          if (performance.now() - start < 1000) {
            requestAnimationFrame(tick);
          } else {
            resolve(frameCount);
          }
        }
        requestAnimationFrame(tick);
      });
    });
    expect(fps).toBeGreaterThanOrEqual(55);  // 允许 5 帧误差
  });
});
```

---

## 5. 兼容性验收标准

### 5.1 桌面浏览器

| 浏览器 | 最低版本 | 验收 |
|--------|---------|------|
| Chrome | 100+ | ☐ |
| Firefox | 100+ | ☐ |
| Safari | 15+ | ☐ |
| Edge | 100+ | ☐ |

### 5.2 移动浏览器

| 浏览器 | 最低版本 | 验收 |
|--------|---------|------|
| iOS Safari | 15+ | ☐ |
| Android Chrome | 100+ | ☐ |
| Samsung Internet | 21+ | ☐ |

### 5.3 分辨率覆盖

| 断点 | 范围 | 验收 |
|------|------|------|
| Mobile | 375px - 767px | ☐ |
| Tablet | 768px - 1023px | ☐ |
| Desktop | 1024px - 1439px | ☐ |
| Large | 1440px+ | ☐ |

### 5.4 验收方法

#### 自动化（Playwright + BrowserStack）
```typescript
// playwright.config.ts
export default defineConfig({
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 5'] } },
    { name: 'mobile-safari', use: { ...devices['iPhone 13'] } },
  ],
});
```

#### 真机测试
- iPhone 14 / 15
- iPad Pro
- Pixel 7 / 8
- Samsung Galaxy S23

---

## 6. 代码质量验收标准

### 6.1 静态分析

| 工具 | 目标 | 验收 |
|------|------|------|
| TypeScript 严格模式 | 零错误 | ☐ |
| ESLint | 零 warning | ☐ |
| Prettier | 100% 格式统一 | ☐ |

### 6.2 测试覆盖

| 类型 | 目标 | 验收 |
|------|------|------|
| 单元测试覆盖率 | ≥ 80% | ☐ |
| 组件测试覆盖率 | ≥ 70% | ☐ |
| 集成测试覆盖 | 核心流程 100% | ☐ |
| E2E 测试 | 20+ 核心场景 | ☐ |

### 6.3 代码规范

- ✅ 命名规范 100% 符合
- ✅ 文件 ≤ 500 行（除 App.tsx、Provider）
- ✅ 组件嵌套 ≤ 3 层
- ✅ Hook 单一职责
- ✅ TypeScript any 零容忍
- ✅ 函数必须有中文注释
- ✅ 修改记录完整

---

## 7. 回归测试标准

### 7.1 回归范围

- ✅ 所有现有功能不受影响
- ✅ 所有现有 E2E 测试通过
- ✅ 所有现有单元测试通过
- ✅ API 兼容性 100%

### 7.2 回归测试方法

```bash
# 后端回归
pytest tests/ -v --cov=app --cov-report=term-missing

# 前端回归
npm run test:unit
npm run test:e2e
npm run test:visual

# 性能回归
npm run lighthouse
npm run bundle-budget
```

### 7.3 回归通过条件

- ✅ 后端 100% 测试通过
- ✅ 前端单元测试 100% 通过
- ✅ 前端 E2E 测试 100% 通过
- ✅ Lighthouse 评分无下降
- ✅ Bundle 大小无增加（除非计划内）

---

## 8. 安全验收标准

### 8.1 XSS 防护

- ✅ 所有用户输入转义
- ✅ dangerouslySetInnerHTML 零使用（或严格白名单）
- ✅ DOMPurify 清洗富文本

### 8.2 CSRF 防护

- ✅ 状态修改操作有 CSRF token
- ✅ Cookie SameSite=Strict

### 8.3 敏感信息

- ✅ API key 不在 localStorage 明文存储
- ✅ 错误信息不泄露敏感数据

---

## 9. 测试报告模板

### 9.1 测试报告结构

```markdown
# CYCLE 15 - 前端优化测试报告

> **测试日期**: 2026-07-XX
> **测试范围**: 视觉 / 交互 / 性能 / 兼容 / 回归
> **测试人员**: [QA Team]
> **测试环境**: [描述]

## 1. 测试总览

| 维度 | 通过率 | 状态 |
|------|--------|------|
| 视觉 | XX/YY | ✅/⚠️/❌ |
| 交互 | XX/YY | ✅/⚠️/❌ |
| 性能 | XX/YY | ✅/⚠️/❌ |
| 兼容 | XX/YY | ✅/⚠️/❌ |
| 回归 | XX/YY | ✅/⚠️/❌ |
| **总计** | **XX/YY** | **等级** |

## 2. 详细结果

### 2.1 视觉测试
- [用例1]: ✅ 通过 / ❌ 失败（问题截图、原因）
- [用例2]: ...

### 2.2 交互测试
- ...

### 2.3 性能测试
- Lighthouse: XX 分
- Bundle: XX KB
- ...

## 3. 未通过项

### 3.1 P0 必须修复
- [问题1]: 截图、根因、修复建议

### 3.2 P1 应当修复
- ...

## 4. 修复与回归

[每修复一项，重新测试一次]

## 5. 最终结论

- [ ] 达到 B 级（合格）
- [ ] 可进入下一阶段
```

### 9.2 问题分级

| 级别 | 定义 | 修复时限 |
|------|------|---------|
| P0 | 阻塞核心功能 / 数据丢失 / 安全漏洞 | 立即 |
| P1 | 主要功能不可用 / 体验严重下降 | 24h |
| P2 | 次要问题 / 边缘情况 | 1 周 |
| P3 | 优化建议 | 下一轮 |

---

## 10. Loop Engineering 工作流维护验证

### 10.1 工作流完整性验证

#### 验证项
- ✅ **未修改**: workflow_engine.py 主流程未变
- ✅ **未修改**: 6 阶段（需求分析 → 需求分解 → 技能规划 → 实施 → 测试 → 交付）完整
- ✅ **未修改**: 用户输入 → 架构师 → 质量保障 → 批判反思 → 提示词优化 → CLI 执行 → Hook 通知 → Git 提交
- ✅ **未修改**: 全局接口定义清单
- ✅ **未修改**: 自定义消息/服务规范
- ✅ **未修改**: 依赖版本统一规范

#### 验证方法

```bash
# 比对本次优化与 baseline 的 workflow_engine.py
git diff main -- backend/app/core/workflow_engine.py
# 预期: 无 diff

# 比对全局接口
git diff main -- backend/app/api/ -- backend/app/core/*/interface.py
# 预期: 无 diff
```

### 10.2 高风险模块标记

- ✅ 紧急停止模块: **极高风险**（已有完整安全验证）
- ✅ 碰撞检测模块: **极高风险**（已有完整安全验证）
- ✅ 运动控制模块: **高风险**（已有完整安全验证）
- ✅ 前端 UI 模块: **中风险**（本次优化重点）
- ✅ 工作流引擎: **高风险**（未修改）

---

## 11. 最终验收标准

### 11.1 准入条件

所有 P0 验收项必须 100% 通过，方可认为本轮优化完成：

- [ ] 视觉品质：3 项目统一、主题切换、色盲模式
- [ ] 交互体验：5 核心路径 E2E 通过
- [ ] 性能指标：Lighthouse ≥ 90、Bundle < 1MB
- [ ] 兼容性：4 桌面 + 2 移动浏览器通过
- [ ] 代码质量：TypeScript 零错误、测试覆盖率 ≥ 80%
- [ ] 回归测试：现有功能 100% 不受影响
- [ ] Loop Engineering 工作流：未修改

### 11.2 准出条件

- ✅ 所有 P0 问题已修复
- ✅ 所有 P1 问题已修复或有明确计划
- ✅ 测试报告已生成
- ✅ 修改日志已记录
- ✅ Git 分支已合并至 main
- ✅ 部署文档已更新
- ✅ 用户验收通过

### 11.3 验收签字

| 角色 | 签字 | 日期 |
|------|------|------|
| 产品负责人 | _____ | _____ |
| 技术负责人 | _____ | _____ |
| QA 负责人 | _____ | _____ |
| 用户 | _____ | _____ |

---

**文档完成时间**: 2026-07-29
**文档字数**: 5,500 字
**下一步**: 进入 Phase 3 前端开发实施
