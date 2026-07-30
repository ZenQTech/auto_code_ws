/**
 * # ============================================================
 * # PerfOptimizerEngine Rules - React 性能反模式规则库 (v1.0.0 Cycle 25 G25-03)
 * # ============================================================
 * # 核心作用：内置 20+ React 性能反模式规则
 * # 规则分类：
 * #   - useMemo 反模式      PERF-R001 ~ R005
 * #   - useCallback 反模式  PERF-R010 ~ R013
 * #   - React.memo 反模式   PERF-R020 ~ R022
 * #   - 通用规则            PERF-R030 ~ R040
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 25 G25-03 初次创建
 * # ============================================================
 */

import type { PerfRule } from './perfOptimizerTypes';

// ============ 辅助函数 ============

/**
 * 简单的字符串是否包含字面量 token（避免关键词子串误判）
 */
function includesWord(haystack: string, needle: string): boolean {
  return new RegExp(`\\b${needle}\\b`).test(haystack);
}

/**
 * 检测是否包含简单算术（无副作用）
 */
function isSimpleExpression(expr: string): boolean {
  const trimmed = expr.trim();
  if (trimmed.length === 0) return true;
  // 排除包含函数调用/异步/await 的复杂表达式
  if (/\bawait\b/.test(trimmed)) return false;
  if (/\bnew\s+/.test(trimmed)) return false;
  if (/\.(then|catch|finally)\b/.test(trimmed)) return false;
  // 包含方法调用如 .map/.filter 但未嵌套异步可视为简单
  return true;
}

/**
 * 截取 wrapped 表达式简化版本
 */
function simplifyWrapped(wrapped: string): string {
  return wrapped.length > 100 ? wrapped.slice(0, 100) + '...' : wrapped;
}

// ============ useMemo 反模式 ============

const useMemoRules: PerfRule[] = [
  {
    id: 'PERF-R001',
    pattern: 'useMemo',
    description: 'useMemo 包裹简单计算（过滤/排序 < 100 项）',
    check: (usage, _ctx) => {
      const wrapped = usage.wrapped;
      // 检测简单的 .filter / .map / .find / .slice 等
      const isSimpleTransform =
        /\.(filter|map|find|some|every|slice|reverse|sort)\s*\(/.test(wrapped) &&
        !wrapped.includes('await') &&
        !wrapped.includes('fetch');

      if (isSimpleTransform) {
        return {
          isNecessary: false,
          reason: 'useMemo 仅用于简单的数组 transform，无明显性能开销',
          confidence: 0.85,
          suggestion: '直接计算即可，移除 useMemo 包装',
          refactored: `// 直接计算\nconst value = ${wrapped};`,
        };
      }
      return {
        isNecessary: true,
        reason: '复杂计算保留 useMemo',
        confidence: 0.9,
        suggestion: '保留 useMemo',
        refactored: usage.wrapped,
      };
    },
  },
  {
    id: 'PERF-R002',
    pattern: 'useMemo',
    description: 'useMemo 依赖项与函数体引用不一致',
    check: (usage, _ctx) => {
      if (!usage.deps) {
        return {
          isNecessary: true,
          reason: '无依赖数组',
          confidence: 0.7,
          suggestion: '保留 useMemo',
          refactored: usage.wrapped,
        };
      }
      const wrapped = usage.wrapped;
      // 从 wrapped 提取标识符
      const identifiersInBody = new Set<string>();
      const idRe = /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\b/g;
      let m: RegExpExecArray | null;
      while ((m = idRe.exec(wrapped))) {
        identifiersInBody.add(m[1]);
      }
      // 检查 deps 中的每个变量是否在 body 中引用
      const missing = usage.deps.filter((d) => !identifiersInBody.has(d.trim()));
      if (missing.length > 0) {
        return {
          isNecessary: false,
          reason: `依赖项 [${missing.join(', ')}] 未在 body 中引用，可能导致闭包陷阱`,
          confidence: 0.75,
          suggestion: '从依赖项数组移除未使用的变量',
          refactored: `useMemo(() => ${wrapped}, [/* 移除未使用依赖 */])`,
        };
      }
      return {
        isNecessary: true,
        reason: '依赖项一致',
        confidence: 0.95,
        suggestion: '保留',
        refactored: usage.wrapped,
      };
    },
  },
  {
    id: 'PERF-R003',
    pattern: 'useMemo',
    description: '多个串联的 useMemo 应合并',
    check: (usage, ctx) => {
      // 检查同一文件内最近 5 行是否有其他 useMemo
      const sameFileUsages = ctx.allUsages.filter(
        (u) => u.file === usage.file && Math.abs(u.line - usage.line) <= 5 && u.pattern === 'useMemo'
      );
      if (sameFileUsages.length >= 3) {
        return {
          isNecessary: false,
          reason: '附近存在多个串联 useMemo，应合并为单个',
          confidence: 0.7,
          suggestion: '将多个 useMemo 合并为单个',
          refactored: `useMemo(() => {\n  // 合并逻辑\n  return result;\n}, [a, b, c]);`,
        };
      }
      return {
        isNecessary: true,
        reason: '独立 useMemo',
        confidence: 0.9,
        suggestion: '保留',
        refactored: usage.wrapped,
      };
    },
  },
  {
    id: 'PERF-R004',
    pattern: 'useMemo',
    description: 'useMemo 包装纯字面量',
    check: (usage, _ctx) => {
      const w = usage.wrapped.trim();
      // 提取箭头函数体
      const arrowMatch = w.match(/^\s*(?:\(\s*\)|\([^)]*\))\s*=>\s*(.+)$/s);
      let body = arrowMatch ? arrowMatch[1].trim() : w;
      // 去掉包裹的圆括号（对象/数组字面量场景）
      if (body.startsWith('(') && body.endsWith(')')) {
        const inner = body.slice(1, -1).trim();
        // 确保内部括号是平衡的
        let depth = 0;
        let balanced = true;
        for (const ch of inner) {
          if (ch === '(') depth++;
          else if (ch === ')') {
            depth--;
            if (depth < 0) {
              balanced = false;
              break;
            }
          }
        }
        if (balanced && depth === 0) body = inner;
      }
      const isLiteral =
        /^['"`].*['"`]$/.test(body) || // 字符串字面量
        /^-?\d+(\.\d+)?$/.test(body) || // 数字
        /^(true|false|null|undefined)$/.test(body) || // 关键字
        /^\{[^}]*\}$/.test(body) || // 简单对象字面量
        /^\[[^\]]*\]$/.test(body) || // 简单数组字面量
        /^[a-zA-Z_$][\w]*$/.test(body) || // 简单标识符
        /^-?\d+(\.\d+)?\s*[+\-*/]\s*-?\d+(\.\d+)?$/.test(body) || // 纯数字算术
        /^[a-zA-Z_$][\w]*\s*[+\-*/]\s*-?\d+(\.\d+)?$/.test(body); // 简单算术
      if (isLiteral) {
        return {
          isNecessary: false,
          reason: 'useMemo 包装纯字面量/常量，毫无意义',
          confidence: 0.95,
          suggestion: '提取为模块级常量 const X = ...',
          refactored: `// 模块顶层：\nconst CACHE_KEY = ${body};`,
        };
      }
      return {
        isNecessary: true,
        reason: '非字面量',
        confidence: 0.9,
        suggestion: '保留',
        refactored: usage.wrapped,
      };
    },
  },
  {
    id: 'PERF-R005',
    pattern: 'useMemo',
    description: 'useMemo 包裹函数定义（应使用 useCallback）',
    check: (usage, _ctx) => {
      const w = usage.wrapped.trim();
      // 提取箭头函数体
      const arrowMatch = w.match(/^\s*(?:\(\s*\)|\([^)]*\))\s*=>\s*(.+)$/s);
      const body = arrowMatch ? arrowMatch[1].trim() : w;
      // body 应该是 () => ... 或 function ...
      if (/^\(\s*\)\s*=>/.test(body) || /^\(\s*[a-zA-Z_$][\w$,\s]*\)\s*=>/.test(body) || /^function\s/.test(body)) {
        return {
          isNecessary: false,
          reason: 'useMemo 用于包装函数定义，应改用 useCallback',
          confidence: 0.88,
          suggestion: '改用 useCallback 包装函数',
          refactored: `const handler = useCallback(${w}, [deps]);`,
        };
      }
      return {
        isNecessary: true,
        reason: '非函数',
        confidence: 0.9,
        suggestion: '保留',
        refactored: usage.wrapped,
      };
    },
  },
];

// ============ useCallback 反模式 ============

const useCallbackRules: PerfRule[] = [
  {
    id: 'PERF-R010',
    pattern: 'useCallback',
    description: 'useCallback 包裹的函数没有作为 prop 传递',
    check: (usage, _ctx) => {
      // 简化启发：仅在 hook 后没有任何 JSX 中作为 prop 使用的迹象
      // 此处用 wrapped 内容判断
      if (usage.wrapped.length < 5) {
        return {
          isNecessary: false,
          reason: 'useCallback 包裹的函数过短，未被作为 prop 传递',
          confidence: 0.65,
          suggestion: '改用普通函数声明',
          refactored: `const handler = ${usage.wrapped};`,
        };
      }
      return {
        isNecessary: true,
        reason: 'useCallback 看起来合理',
        confidence: 0.6,
        suggestion: '保留',
        refactored: usage.wrapped,
      };
    },
  },
  {
    id: 'PERF-R011',
    pattern: 'useCallback',
    description: 'useCallback 依赖项为空但函数体引用外部变量',
    check: (usage, _ctx) => {
      if (!usage.deps || usage.deps.length === 0) {
        const w = usage.wrapped;
        // 检测函数体中是否有标识符
        const idRe = /\b([a-zA-Z_$][a-zA-Z0-9_$]{2,})\b/g;
        const identifiers: string[] = [];
        let m: RegExpExecArray | null;
        while ((m = idRe.exec(w))) {
          identifiers.push(m[1]);
        }
        // 排除 JS 内置关键字
        const builtins = new Set(['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'new', 'this', 'true', 'false', 'null', 'undefined', 'typeof', 'instanceof', 'in', 'of', 'void', 'delete', 'throw', 'try', 'catch', 'finally', 'class', 'extends', 'super', 'import', 'export', 'from', 'as', 'async', 'await', 'yield', 'static', 'get', 'set']);
        const external = identifiers.filter((i) => !builtins.has(i));
        if (external.length > 0) {
          return {
            isNecessary: false,
            reason: `useCallback 依赖项为空但函数体引用了外部变量 [${external.slice(0, 3).join(', ')}]`,
            confidence: 0.8,
            suggestion: '补充依赖项或移除 useCallback',
            refactored: `// 方案 1：补充依赖\nconst handler = useCallback(${usage.wrapped}, [${external.slice(0, 3).join(', ')}]);\n// 方案 2：直接函数\nconst handler = ${usage.wrapped};`,
          };
        }
      }
      return {
        isNecessary: true,
        reason: '依赖项合理或函数体无外部引用',
        confidence: 0.85,
        suggestion: '保留',
        refactored: usage.wrapped,
      };
    },
  },
  {
    id: 'PERF-R012',
    pattern: 'useCallback',
    description: 'useCallback 仅用于单个事件处理器',
    check: (usage, _ctx) => {
      const w = usage.wrapped;
      // 简单事件处理器检测：箭头函数 + 单条语句 + 无复杂闭包
      const arrowMatch = w.match(/^\s*(?:\([^)]*\))?\s*=>\s*(.+)$/s);
      if (arrowMatch) {
        const body = arrowMatch[1].trim();
        // body 是简单的 setX(...) 或 doSomething(...)
        const isSimpleStatement =
          /^\s*(set\w+|dispatch|close|toggle|reset|clear|focus|blur|click)\s*\([^)]*\)\s*$/.test(body) ||
          /^\{?\s*set\w+\([^)]*\)\s*;?\s*\}?$/.test(body);
        if (isSimpleStatement && w.length < 100) {
          return {
            isNecessary: false,
            reason: '简单事件处理器使用 useCallback 收益低',
            confidence: 0.75,
            suggestion: '直接定义内联函数或在外层组件中提取',
            refactored: `// 改用普通函数\nconst handleClick = ${w};`,
          };
        }
      }
      return {
        isNecessary: true,
        reason: '复杂回调保留 useCallback',
        confidence: 0.7,
        suggestion: '保留',
        refactored: usage.wrapped,
      };
    },
  },
  {
    id: 'PERF-R013',
    pattern: 'useCallback',
    description: 'useCallback 包裹的函数依赖项与 body 不一致',
    check: (usage, _ctx) => {
      if (!usage.deps || usage.deps.length === 0) {
        return {
          isNecessary: true,
          reason: '无依赖',
          confidence: 0.7,
          suggestion: '保留',
          refactored: usage.wrapped,
        };
      }
      const wrapped = usage.wrapped;
      const idRe = /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\b/g;
      const identifiersInBody = new Set<string>();
      let m: RegExpExecArray | null;
      while ((m = idRe.exec(wrapped))) {
        identifiersInBody.add(m[1]);
      }
      const unused = usage.deps.filter((d) => !identifiersInBody.has(d.trim()));
      if (unused.length > 0) {
        return {
          isNecessary: false,
          reason: `useCallback 依赖项 [${unused.join(', ')}] 未在 body 中使用`,
          confidence: 0.7,
          suggestion: '移除未使用依赖',
          refactored: `useCallback(${wrapped}, [/* 移除未使用依赖 */])`,
        };
      }
      return {
        isNecessary: true,
        reason: '依赖项一致',
        confidence: 0.95,
        suggestion: '保留',
        refactored: usage.wrapped,
      };
    },
  },
];

// ============ React.memo 反模式 ============

const reactMemoRules: PerfRule[] = [
  {
    id: 'PERF-R020',
    pattern: 'React.memo',
    description: 'React.memo 包裹的组件接受对象/数组字面量 prop',
    check: (_usage, _ctx) => {
      // 静态分析无法确定 props 变化情况，给出建议
      return {
        isNecessary: false,
        reason: 'React.memo 在 props 频繁变化时反而增加开销（shallowEqual 也会执行）',
        confidence: 0.6,
        suggestion: '确保 props 都是稳定引用（useMemo）或移除 React.memo',
        refactored: `// 移除 React.memo 或稳定化 props\nconst StableComponent = ({ data, onClick }) => {\n  // ...\n};`,
      };
    },
  },
  {
    id: 'PERF-R021',
    pattern: 'React.memo',
    description: 'React.memo 包裹叶子组件（无子组件 prop）',
    check: (_usage, _ctx) => {
      return {
        isNecessary: false,
        reason: '叶子组件（无 children / 无复杂 props）的 React.memo 收益有限',
        confidence: 0.55,
        suggestion: '评估是否真的需要 React.memo',
        refactored: `// 视情况移除 React.memo\nexport default Component;`,
      };
    },
  },
  {
    id: 'PERF-R022',
    pattern: 'React.memo',
    description: 'React.memo 包裹组件但未提供比较函数（默认 shallowEqual 对函数 prop 无效）',
    check: (usage, _ctx) => {
      const w = usage.wrapped;
      if (w.includes('React.memo(') && !w.includes('areEqual') && !w.includes('(prev, next)')) {
        return {
          isNecessary: false,
          reason: '未提供自定义比较函数，默认 shallowEqual 对函数 prop 失效',
          confidence: 0.7,
          suggestion: '提供自定义比较函数或稳定函数引用',
          refactored: `const areEqual = (prev, next) => prev.id === next.id;\nexport default React.memo(Component, areEqual);`,
        };
      }
      return {
        isNecessary: true,
        reason: '已提供比较函数',
        confidence: 0.9,
        suggestion: '保留',
        refactored: usage.wrapped,
      };
    },
  },
];

// ============ 通用规则 ============

const commonRules: PerfRule[] = [
  {
    id: 'PERF-R030',
    pattern: 'list-key',
    description: '列表渲染使用 index 作为 key',
    check: (usage, _ctx) => {
      // wrapped 应包含 key={index} 或 key={i} 模式
      if (/\bkey\s*=\s*\{\s*(index|i|idx)\s*\}/.test(usage.wrapped)) {
        return {
          isNecessary: false,
          reason: '使用 index 作为 React key 会导致不必要的重渲染',
          confidence: 0.9,
          suggestion: '使用稳定的唯一 ID 作为 key',
          refactored: usage.wrapped.replace(/\bkey\s*=\s*\{\s*(index|i|idx)\s*\}/g, 'key={item.id}'),
        };
      }
      return {
        isNecessary: true,
        reason: '非 index key',
        confidence: 0.9,
        suggestion: '保留',
        refactored: usage.wrapped,
      };
    },
  },
  {
    id: 'PERF-R031',
    pattern: 'list-key',
    description: '列表渲染缺 key',
    check: (usage, _ctx) => {
      // 简单 .map() 返回 JSX 但没有 key 属性
      if (/\.map\s*\(/.test(usage.wrapped) && !/\bkey\s*=/.test(usage.wrapped)) {
        return {
          isNecessary: false,
          reason: '列表渲染未提供 key 属性',
          confidence: 0.85,
          suggestion: '为每个列表项添加稳定的 key',
          refactored: usage.wrapped.replace(/<(\w+)/g, '<$1 key={item.id}'),
        };
      }
      return {
        isNecessary: true,
        reason: '已有 key',
        confidence: 0.95,
        suggestion: '保留',
        refactored: usage.wrapped,
      };
    },
  },
  {
    id: 'PERF-R032',
    pattern: 'useState',
    description: 'useState 初始值是 expensive computation（应使用 lazy init）',
    check: (usage, _ctx) => {
      const w = usage.wrapped;
      // 检测 useState(expensiveCall()) 模式
      const match = w.match(/useState\s*\(\s*([^()]+(?:\([^)]*\))?[^()]*)\s*\)/);
      if (match) {
        const arg = match[1];
        if (/(JSON\.parse|Array\.from|new\s+Map|new\s+Set|\.map\(|\.filter\(|\.reduce\()/.test(arg)) {
          return {
            isNecessary: false,
            reason: 'useState 初始值是 expensive computation',
            confidence: 0.75,
            suggestion: '使用 lazy initialization: useState(() => expensive())',
            refactored: `const [state, setState] = useState(() => ${arg});`,
          };
        }
      }
      return {
        isNecessary: true,
        reason: '简单初始值',
        confidence: 0.9,
        suggestion: '保留',
        refactored: usage.wrapped,
      };
    },
  },
  {
    id: 'PERF-R033',
    pattern: 'inline-arrow',
    description: 'JSX 中大量 inline arrow function',
    check: (usage, ctx) => {
      const sameFile = ctx.allUsages.filter(
        (u) => u.file === usage.file && u.pattern === 'inline-arrow'
      );
      if (sameFile.length >= 3) {
        return {
          isNecessary: false,
          reason: '同一文件存在多个 inline arrow function',
          confidence: 0.7,
          suggestion: '提取到 useCallback 或组件方法',
          refactored: '// 在组件内：\nconst handler = useCallback((e) => { ... }, [deps]);\nreturn <Child onClick={handler} />;',
        };
      }
      return {
        isNecessary: true,
        reason: 'inline 函数数量少',
        confidence: 0.85,
        suggestion: '保留',
        refactored: usage.wrapped,
      };
    },
  },
  {
    id: 'PERF-R034',
    pattern: 'inline-object',
    description: 'JSX 中 inline object/array 传递 props',
    check: (_usage, _ctx) => {
      return {
        isNecessary: false,
        reason: 'inline 对象/数组作为 prop 每次渲染都是新引用',
        confidence: 0.7,
        suggestion: '提取到 useMemo 或组件外部',
        refactored: '// 提取常量：\nconst CONSTANT = { foo: 1, bar: 2 };\n// 或 useMemo：\nconst options = useMemo(() => ({ ... }), [deps]);',
      };
    },
  },
  {
    id: 'PERF-R035',
    pattern: 'useEffect',
    description: 'useEffect 缺少清理函数（订阅/定时器泄漏）',
    check: (usage, _ctx) => {
      const w = usage.wrapped;
      // 检测添加订阅/定时器但没有 return cleanup
      const hasSubscription = /(addEventListener|setInterval|setTimeout|subscribe|new\s+EventSource|WebSocket|new\s+MutationObserver)/.test(w);
      const hasCleanup = /return\s+(?:\(\s*\)\s*=>|function|async\s+function)/.test(w);
      if (hasSubscription && !hasCleanup) {
        return {
          isNecessary: false,
          reason: 'useEffect 订阅/定时器缺少清理函数，可能导致内存泄漏',
          confidence: 0.85,
          suggestion: '在 useEffect 中 return cleanup 函数',
          refactored: `useEffect(() => {\n  // ...\n  return () => {\n    // cleanup\n  };\n}, [deps]);`,
        };
      }
      return {
        isNecessary: true,
        reason: '无需清理或已有清理',
        confidence: 0.9,
        suggestion: '保留',
        refactored: usage.wrapped,
      };
    },
  },
  {
    id: 'PERF-R036',
    pattern: 'useEffect',
    description: 'useEffect 内 setState 未检查条件（可能死循环）',
    check: (usage, _ctx) => {
      const w = usage.wrapped;
      // 简化检测：setX(...) 调用但函数体没有 if 守卫
      const hasSetState = /\bset\w+\s*\(/.test(w);
      const hasGuard = /\bif\s*\(/.test(w) || /\?.*:/.test(w);
      if (hasSetState && !hasGuard) {
        return {
          isNecessary: false,
          reason: 'useEffect 内 setState 无条件守卫，可能导致死循环',
          confidence: 0.7,
          suggestion: '在 setState 前添加条件检查',
          refactored: 'useEffect(() => {\n  if (condition) {\n    setState(value);\n  }\n}, [deps]);',
        };
      }
      return {
        isNecessary: true,
        reason: '已有条件守卫',
        confidence: 0.9,
        suggestion: '保留',
        refactored: usage.wrapped,
      };
    },
  },
  {
    id: 'PERF-R037',
    pattern: 'useState',
    description: 'useState 同步链式调用（多次 setState 合并）',
    check: (usage, _ctx) => {
      const w = usage.wrapped;
      const setCalls = w.match(/\bset\w+\s*\(/g);
      if (setCalls && setCalls.length >= 3) {
        return {
          isNecessary: false,
          reason: '连续多次 setState，应使用单一 setState 合并更新',
          confidence: 0.65,
          suggestion: '合并为单个 setState(prev => ({ ...prev, ... }))',
          refactored: '// 使用函数式更新：\nsetState((prev) => ({ ...prev, a: 1, b: 2, c: 3 }));',
        };
      }
      return {
        isNecessary: true,
        reason: '少量 setState',
        confidence: 0.9,
        suggestion: '保留',
        refactored: usage.wrapped,
      };
    },
  },
  {
    id: 'PERF-R038',
    pattern: 'useState',
    description: '组件包含过多 useState（应使用 useReducer）',
    check: (usage, ctx) => {
      const sameFile = ctx.allUsages.filter(
        (u) => u.file === usage.file && u.pattern === 'useState'
      );
      if (sameFile.length >= 6) {
        return {
          isNecessary: false,
          reason: '同一文件存在 6+ useState，应使用 useReducer 整合',
          confidence: 0.75,
          suggestion: '使用 useReducer 整合相关 state',
          refactored: 'const [state, dispatch] = useReducer(reducer, initialState);',
        };
      }
      return {
        isNecessary: true,
        reason: 'useState 数量合理',
        confidence: 0.9,
        suggestion: '保留',
        refactored: usage.wrapped,
      };
    },
  },
  {
    id: 'PERF-R039',
    pattern: 'useEffect',
    description: '未使用 React.lazy 做代码分割',
    check: (usage, _ctx) => {
      // 检查同文件是否有 import 大依赖但未 lazy
      const w = usage.wrapped;
      const hasBigImport = /from\s+['"][^'"]*(chart|monaco|monaco-editor|lodash|moment)/i.test(w);
      const hasLazy = /React\.lazy|lazy\s*\(/.test(w);
      if (hasBigImport && !hasLazy) {
        return {
          isNecessary: false,
          reason: '导入大依赖但未使用 React.lazy',
          confidence: 0.6,
          suggestion: '使用 React.lazy + Suspense 分割',
          refactored: 'const Heavy = React.lazy(() => import(\'./Heavy\'));\n<Suspense fallback={<Loader />}><Heavy /></Suspense>',
        };
      }
      return {
        isNecessary: true,
        reason: '无大依赖或已使用 lazy',
        confidence: 0.9,
        suggestion: '保留',
        refactored: usage.wrapped,
      };
    },
  },
  {
    id: 'PERF-R040',
    pattern: 'useState',
    description: 'state 直接存储 DOM 引用（应使用 useRef）',
    check: (usage, _ctx) => {
      const w = usage.wrapped;
      if (/useState\s*\(\s*null\s*\)/.test(w) && /\.current/.test(w)) {
        return {
          isNecessary: false,
          reason: 'state 存储 DOM 引用会导致不必要的重渲染',
          confidence: 0.7,
          suggestion: '改用 useRef 存储 DOM 引用',
          refactored: 'const ref = useRef(null);\n// ref.current 获取 DOM',
        };
      }
      return {
        isNecessary: true,
        reason: '非 DOM 引用',
        confidence: 0.9,
        suggestion: '保留',
        refactored: usage.wrapped,
      };
    },
  },
];

// ============ 汇总 ============

export const ALL_PERF_RULES: PerfRule[] = [
  ...useMemoRules,
  ...useCallbackRules,
  ...reactMemoRules,
  ...commonRules,
];

export const RULES_BY_PATTERN: Record<string, PerfRule[]> = ALL_PERF_RULES.reduce(
  (acc, rule) => {
    if (!acc[rule.pattern]) acc[rule.pattern] = [];
    acc[rule.pattern].push(rule);
    return acc;
  },
  {} as Record<string, PerfRule[]>
);

// 简单表达式工具导出
export { isSimpleExpression, simplifyWrapped, includesWord };
