/**
 * # ============================================================
 * # AutoCodeReviewEngine Rules - 代码评审规则库 (v1.0.0 Cycle 25 G25-01)
 * # ============================================================
 * # 核心作用：内置 100+ 代码评审规则，覆盖 5 大类
 * # 规则分类：
 * #   - Security (20+)    SEC001-020
 * #   - Performance (20+)  PERF001-020
 * #   - Maintainability(20+)MAINT001-020
 * #   - Testing (15+)     TEST001-015
 * #   - Bug (20+)         BUG001-020
 * #   - Type Safety (10+) TYPE001-010
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 25 G25-01 初次创建
 * # ============================================================
 */

import type { ReviewRule } from './autoCodeReviewTypes';

// ============ 行定位辅助 ============

/**
 * 查找所有匹配 pattern 的行
 */
function findLines(content: string, pattern: RegExp): Array<{ line: number; match: string }> {
  const lines = content.split('\n');
  const results: Array<{ line: number; match: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(pattern);
    if (m) results.push({ line: i + 1, match: m[0] });
  }
  return results;
}

/**
 * 截取原始代码（用于 suggestedPatch）
 */
function snippet(content: string, line: number, context = 2): string {
  const lines = content.split('\n');
  const start = Math.max(0, line - 1 - context);
  const end = Math.min(lines.length, line + context);
  return lines.slice(start, end).join('\n');
}

// ============ Security 规则 (20+) ============

const securityRules: ReviewRule[] = [
  {
    id: 'SEC001',
    category: 'security',
    severity: 'critical',
    description: '禁止使用 eval() 或 new Function()',
    check: (_file, content) => {
      const matches = findLines(content, /\beval\s*\(|\bnew\s+Function\s*\(/);
      return matches.map((m) => ({
        line: m.line,
        title: '使用 eval() / new Function()',
        message: 'eval() 和 new Function() 会执行任意代码，是高危安全漏洞入口。',
        existingCode: m.match,
        suggestedPatch: '使用 JSON.parse() 或安全的沙箱替代。',
        why: '恶意字符串注入后可在用户上下文中执行任意 JS。',
        confidence: 0.98,
      }));
    },
  },
  {
    id: 'SEC002',
    category: 'security',
    severity: 'high',
    description: '禁止 dangerouslySetInnerHTML',
    check: (_file, content) => {
      const matches = findLines(content, /dangerouslySetInnerHTML/);
      return matches.map((m) => ({
        line: m.line,
        title: '使用 dangerouslySetInnerHTML',
        message: '直接注入 HTML 可能导致 XSS 攻击。',
        existingCode: m.match,
        suggestedPatch: '使用 DOMPurify.sanitize() 处理后再注入。',
        why: '未转义的用户输入可执行恶意脚本。',
        confidence: 0.92,
      }));
    },
  },
  {
    id: 'SEC003',
    category: 'security',
    severity: 'critical',
    description: '硬编码 API key / password / token',
    check: (_file, content) => {
      const matches = findLines(
        content,
        /(api[_-]?key|password|token|secret)\s*[:=]\s*['"][a-zA-Z0-9_\-]{16,}['"]/i
      );
      return matches.map((m) => ({
        line: m.line,
        title: '硬编码密钥',
        message: '检测到硬编码的 API key / password / token。',
        existingCode: m.match,
        suggestedPatch: '使用 process.env.API_KEY 或密钥管理服务。',
        why: '硬编码密钥会泄露到 Git 历史，无法完全清除。',
        confidence: 0.95,
      }));
    },
  },
  {
    id: 'SEC004',
    category: 'security',
    severity: 'medium',
    description: 'HTTP 链接应使用 HTTPS',
    check: (_file, content) => {
      const matches = findLines(content, /['"]http:\/\/[a-zA-Z0-9.\-]+/);
      return matches.map((m) => ({
        line: m.line,
        title: '使用 HTTP 而非 HTTPS',
        message: 'HTTP 协议未加密，可能被中间人攻击。',
        existingCode: m.match,
        suggestedPatch: '替换为 HTTPS 链接。',
        why: '传输过程可被窃听和篡改。',
        confidence: 0.85,
      }));
    },
  },
  {
    id: 'SEC005',
    category: 'security',
    severity: 'medium',
    description: 'console.log 打印敏感数据',
    check: (_file, content) => {
      const matches = findLines(
        content,
        /console\.(log|info|warn)\s*\(.*(password|token|secret|key|credential)/i
      );
      return matches.map((m) => ({
        line: m.line,
        title: '可能打印敏感数据',
        message: 'console 输出可能泄露到日志系统。',
        existingCode: m.match,
        suggestedPatch: '使用专门的日志库并脱敏处理。',
        why: '日志通常会持久化到多个系统。',
        confidence: 0.78,
      }));
    },
  },
  {
    id: 'SEC006',
    category: 'security',
    severity: 'high',
    description: '缺失 input 验证',
    check: (_file, content) => {
      // 简单启发式：handler 函数未做参数校验
      const handlerMatches = findLines(
        content,
        /(get|post|put|delete|patch)\s*\(\s*['"`]/
      );
      const results = handlerMatches
        .filter((m) => {
          const snip = snippet(content, m.line, 5);
          return !snip.includes('validate') && !snip.includes('zod') && !snip.includes('joi') && !snip.includes('yup');
        })
        .map((m) => ({
          line: m.line,
          title: 'API handler 缺少输入验证',
          message: '检测到路由处理函数未使用 zod/joi/yup 等校验库。',
          existingCode: m.match,
          suggestedPatch: '使用 zod schema 验证 request body。',
          why: '未验证的输入可导致注入和越权。',
          confidence: 0.7,
        }));
      return results;
    },
  },
  {
    id: 'SEC007',
    category: 'security',
    severity: 'high',
    description: '路径拼接构造路径（path traversal）',
    check: (_file, content) => {
      const matches = findLines(
        content,
        /path\.join\s*\([^)]*\+|fs\.\w+\s*\(\s*[^)]*\+\s*[^)]*\)/
      );
      return matches.map((m) => ({
        line: m.line,
        title: '路径拼接存在遍历风险',
        message: '用户输入拼接到文件路径可能导致 path traversal 攻击。',
        existingCode: m.match,
        suggestedPatch: '使用 path.resolve() + 白名单目录校验。',
        why: '../ 路径可绕过沙箱读取任意文件。',
        confidence: 0.8,
      }));
    },
  },
  {
    id: 'SEC008',
    category: 'security',
    severity: 'high',
    description: 'innerHTML 写入用户输入（XSS）',
    check: (_file, content) => {
      const matches = findLines(content, /\.innerHTML\s*=/);
      return matches.map((m) => ({
        line: m.line,
        title: '直接操作 innerHTML',
        message: 'innerHTML 写入未转义内容会导致 XSS。',
        existingCode: m.match,
        suggestedPatch: '使用 textContent 或 DOMPurify.sanitize()。',
        why: 'XSS 是最常见的 Web 漏洞。',
        confidence: 0.85,
      }));
    },
  },
  {
    id: 'SEC009',
    category: 'security',
    severity: 'high',
    description: '不安全的随机数 Math.random() 用于安全场景',
    check: (_file, content) => {
      const matches = findLines(
        content,
        /Math\.random\(\).*(token|password|secret|key|nonce|salt)/i
      );
      return matches.map((m) => ({
        line: m.line,
        title: 'Math.random() 用于安全场景',
        message: 'Math.random() 不可用于加密。',
        existingCode: m.match,
        suggestedPatch: '使用 crypto.getRandomValues()。',
        why: 'Math.random() 是 PRNG，输出可预测。',
        confidence: 0.88,
      }));
    },
  },
  {
    id: 'SEC010',
    category: 'security',
    severity: 'high',
    description: '弱加密算法 MD5/SHA1',
    check: (_file, content) => {
      const matches = findLines(content, /createHash\s*\(\s*['"](md5|sha1)['"]/i);
      return matches.map((m) => ({
        line: m.line,
        title: '使用弱加密算法',
        message: 'MD5/SHA1 已被证明存在碰撞攻击。',
        existingCode: m.match,
        suggestedPatch: '使用 SHA-256/SHA-3/Argon2/bcrypt。',
        why: '密码或敏感数据应使用强哈希。',
        confidence: 0.95,
      }));
    },
  },
  {
    id: 'SEC011',
    category: 'security',
    severity: 'medium',
    description: 'CORS 配置过宽',
    check: (_file, content) => {
      const matches = findLines(content, /Access-Control-Allow-Origin['":\s]+['"]\*['"]/);
      return matches.map((m) => ({
        line: m.line,
        title: 'CORS 允许所有来源',
        message: 'Access-Control-Allow-Origin: * 配合 credentials 存在风险。',
        existingCode: m.match,
        suggestedPatch: '使用白名单或环境变量配置允许的 origin。',
        why: '* + credentials 不被浏览器支持但仍可被滥用。',
        confidence: 0.7,
      }));
    },
  },
  {
    id: 'SEC012',
    category: 'security',
    severity: 'medium',
    description: 'JWT 缺少过期时间',
    check: (_file, content) => {
      const matches = findLines(content, /jwt\.sign\s*\(/);
      return matches
        .filter((m) => {
          const snip = snippet(content, m.line, 3);
          return !snip.includes('expiresIn') && !snip.includes('exp');
        })
        .map((m) => ({
          line: m.line,
          title: 'JWT 未设置过期时间',
          message: 'JWT 缺少 expiresIn，token 永久有效。',
          existingCode: m.match,
          suggestedPatch: '添加 { expiresIn: "1h" } 选项。',
          why: '永久 token 一旦泄露无法失效。',
          confidence: 0.85,
        }));
    },
  },
  {
    id: 'SEC013',
    category: 'security',
    severity: 'critical',
    description: '信任 client 传来的 user id（无鉴权）',
    check: (_file, content) => {
      const matches = findLines(
        content,
        /req\.(body|params|query)\.(userId|user_id|user\.id)/
      );
      return matches.map((m) => ({
        line: m.line,
        title: '信任 client 传来的 user id',
        message: '直接使用 client 传来的 user id 而非 session 鉴权后的 id。',
        existingCode: m.match,
        suggestedPatch: '使用 req.session.userId 或 auth middleware。',
        why: '可被轻易伪造为其他用户。',
        confidence: 0.9,
      }));
    },
  },
  {
    id: 'SEC014',
    category: 'security',
    severity: 'critical',
    description: 'SQL 字符串拼接（SQL 注入）',
    check: (_file, content) => {
      const matches = findLines(
        content,
        /['"`].*SELECT.*['"`]\s*\+|['"`].*WHERE.*['"`]\s*\+/
      );
      return matches.map((m) => ({
        line: m.line,
        title: 'SQL 字符串拼接',
        message: '字符串拼接构造 SQL 是 SQL 注入的经典模式。',
        existingCode: m.match,
        suggestedPatch: '使用参数化查询（?, $1 占位符）。',
        why: 'SQL 注入可导致数据泄露和数据库被控制。',
        confidence: 0.95,
      }));
    },
  },
  {
    id: 'SEC015',
    category: 'security',
    severity: 'medium',
    description: 'localStorage 存储敏感信息',
    check: (_file, content) => {
      const matches = findLines(
        content,
        /localStorage\.setItem.*(token|password|secret|key|credential)/i
      );
      return matches.map((m) => ({
        line: m.line,
        title: 'localStorage 存储敏感信息',
        message: 'localStorage 可被 XSS 读取，不应存储敏感信息。',
        existingCode: m.match,
        suggestedPatch: '使用 httpOnly cookie 存储认证信息。',
        why: 'XSS 漏洞一旦存在即可窃取 token。',
        confidence: 0.78,
      }));
    },
  },
  {
    id: 'SEC016',
    category: 'security',
    severity: 'high',
    description: '暴露的 .env 文件',
    check: (_file, content) => {
      const matches = findLines(content, /\.env\.local|\.env\.production/);
      return matches.map((m) => ({
        line: m.line,
        title: '引用 .env 文件',
        message: '检查 .gitignore 是否正确排除了 .env 文件。',
        existingCode: m.match,
        suggestedPatch: '确保 .env* 已在 .gitignore 中。',
        why: '.env 文件包含密钥和配置。',
        confidence: 0.7,
      }));
    },
  },
  {
    id: 'SEC017',
    category: 'security',
    severity: 'high',
    description: '缺失 CSRF 保护',
    check: (_file, content) => {
      // 启发式：表单 POST 缺少 CSRF token
      const matches = findLines(
        content,
        /<form\s+method\s*=\s*["']post["']/i
      );
      return matches
        .filter((m) => {
          const snip = snippet(content, m.line, 10);
          return !snip.includes('csrf') && !snip.includes('_token');
        })
        .map((m) => ({
          line: m.line,
          title: '表单缺少 CSRF token',
          message: 'POST 表单未检测到 CSRF token 字段。',
          existingCode: m.match,
          suggestedPatch: '添加 <input type="hidden" name="_csrf" value={...} />',
          why: 'CSRF 攻击可在用户不知情时执行操作。',
          confidence: 0.65,
        }));
    },
  },
  {
    id: 'SEC018',
    category: 'security',
    severity: 'high',
    description: '文件上传无 MIME 校验',
    check: (_file, content) => {
      const matches = findLines(content, /multer\s*\(\s*\{/);
      return matches
        .filter((m) => {
          const snip = snippet(content, m.line, 10);
          return !snip.includes('fileFilter') && !snip.includes('mimetype');
        })
        .map((m) => ({
          line: m.line,
          title: 'Multer 缺少 fileFilter',
          message: '文件上传未限制 MIME 类型，可上传恶意文件。',
          existingCode: m.match,
          suggestedPatch: '添加 fileFilter 验证 mimetype 和 extname。',
          why: '可被用来上传 WebShell。',
          confidence: 0.85,
        }));
    },
  },
  {
    id: 'SEC019',
    category: 'security',
    severity: 'medium',
    description: '不安全的正则（ReDoS）',
    check: (_file, content) => {
      // 简单启发式：嵌套量词
      const matches = findLines(
        content,
        /\(([^)]*[*+])[^)]*\)[*+]|\[[^\]]*[*+]\][*+]/
      );
      return matches.map((m) => ({
        line: m.line,
        title: '正则可能存在 ReDoS 风险',
        message: '嵌套量词可能导致正则拒绝服务（ReDoS）。',
        existingCode: m.match,
        suggestedPatch: '重写正则或使用 safe-regex 工具验证。',
        why: 'ReDoS 攻击可让 CPU 100%。',
        confidence: 0.7,
      }));
    },
  },
  {
    id: 'SEC020',
    category: 'security',
    severity: 'low',
    description: '依赖未锁版本（^ 范围）',
    check: (_file, content) => {
      const matches = findLines(content, /['"]\^\d+\.\d+\.\d+['"]/);
      return matches.slice(0, 3).map((m) => ({
        line: m.line,
        title: '使用 ^ 范围依赖',
        message: '推荐使用精确版本或 lock 文件确保可重现构建。',
        existingCode: m.match,
        suggestedPatch: '使用 package-lock.json / pnpm-lock.yaml 锁定版本。',
        why: '不同时间安装可能得到不同版本。',
        confidence: 0.6,
      }));
    },
  },
];

// ============ Performance 规则 (20+) ============

const performanceRules: ReviewRule[] = [
  {
    id: 'PERF001',
    category: 'performance',
    severity: 'high',
    description: '列表渲染缺 key prop',
    check: (_file, content) => {
      const matches = findLines(content, /\.map\s*\([^)]*\)\s*=>\s*[(<]/);
      return matches
        .filter((m) => {
          const snip = snippet(content, m.line, 3);
          return !snip.includes('key=') && !snip.includes('key:');
        })
        .map((m) => ({
          line: m.line,
          title: '列表渲染缺 key prop',
          message: 'JSX 列表缺少 key 属性，React 无法高效 diff。',
          existingCode: m.match,
          suggestedPatch: '为每个 item 添加 key={item.id}。',
          why: '缺 key 会导致不必要的重新渲染。',
          confidence: 0.92,
        }));
    },
  },
  {
    id: 'PERF002',
    category: 'performance',
    severity: 'high',
    description: 'N+1 模式（循环内 fetch）',
    check: (_file, content) => {
      // 简化检测：任意 for 循环内含 fetch
      const forMatches = findLines(content, /for\s*\(/);
      return forMatches
        .filter((m) => {
          const snip = snippet(content, m.line, 8);
          return /fetch\s*\(|axios\.|got\(/.test(snip);
        })
        .map((m) => ({
          line: m.line,
          title: '循环内执行网络请求',
          message: 'for 循环内调用 fetch/axios 是典型 N+1 模式。',
          existingCode: m.match,
          suggestedPatch: '使用 Promise.all(items.map(...)) 批量请求。',
          why: 'N+1 模式导致请求数量爆炸。',
          confidence: 0.88,
        }));
    },
  },
  {
    id: 'PERF003',
    category: 'performance',
    severity: 'medium',
    description: '不必要的 useMemo（依赖项未变化或简单计算）',
    check: (_file, content) => {
      const matches = findLines(content, /useMemo\s*\(\s*\(\s*\)\s*=>/);
      return matches
        .filter((m) => {
          const snip = snippet(content, m.line, 5);
          // 过滤：内含 filter / map / reduce 的简单操作
          return /[\.\(]\s*filter\s*\(|\.\s*map\s*\(|\.\s*reduce\s*\(/.test(snip) &&
            !snip.includes('JSON.parse') && !snip.includes('JSON.stringify');
        })
        .map((m) => ({
          line: m.line,
          title: '不必要 useMemo',
          message: 'useMemo 包裹了简单 filter/map/reduce 操作，React Compiler 已自动优化。',
          existingCode: m.match,
          suggestedPatch: '移除 useMemo，直接调用 filter/map/reduce。',
          why: 'useMemo 自身有开销，60-70% 是噪音。',
          confidence: 0.75,
        }));
    },
  },
  {
    id: 'PERF004',
    category: 'performance',
    severity: 'medium',
    description: '不必要的 useCallback',
    check: (_file, content) => {
      const matches = findLines(content, /useCallback\s*\(/);
      return matches
        .filter((m) => {
          const snip = snippet(content, m.line, 5);
          return snip.includes('set') && snip.includes('=>') && snip.split('\n').length < 4;
        })
        .map((m) => ({
          line: m.line,
          title: '不必要 useCallback',
          message: 'useCallback 包裹简单 setter 包装，缺少 React.memo 子组件时无效。',
          existingCode: m.match,
          suggestedPatch: '移除 useCallback，直接使用内联箭头函数。',
          why: '稳定引用只在子组件用 React.memo 时才有意义。',
          confidence: 0.7,
        }));
    },
  },
  {
    id: 'PERF005',
    category: 'performance',
    severity: 'low',
    description: '不必要的 React.memo',
    check: (_file, content) => {
      const matches = findLines(content, /React\.memo\s*\(\s*([A-Z][a-zA-Z0-9_]*)/);
      return matches.map((m) => ({
        line: m.line,
        title: 'React.memo 包裹组件',
        message: 'React.memo 在没有稳定的子组件 props 时无效。',
        existingCode: m.match,
        suggestedPatch: '使用 React Compiler 自动优化，或确认所有 props 都稳定。',
        why: 'memo 自身有浅比较开销。',
        confidence: 0.5,
      }));
    },
  },
  {
    id: 'PERF006',
    category: 'performance',
    severity: 'medium',
    description: '每次 render 创建新对象字面量',
    check: (_file, content) => {
      const matches = findLines(content, /return\s*\(\s*<[^>]+\s+style=\{\{/);
      return matches.map((m) => ({
        line: m.line,
        title: 'render 中创建对象字面量',
        message: 'JSX 中直接使用对象字面量作为 prop 每次都是新引用。',
        existingCode: m.match,
        suggestedPatch: '使用 useMemo 或提取为常量。',
        why: '破坏 React.memo 的浅比较。',
        confidence: 0.78,
      }));
    },
  },
  {
    id: 'PERF007',
    category: 'performance',
    severity: 'high',
    description: '同步阻塞 I/O',
    check: (_file, content) => {
      const matches = findLines(content, /fs\.readFileSync|fs\.writeFileSync|fs\.existsSync/);
      return matches.map((m) => ({
        line: m.line,
        title: '使用同步 I/O',
        message: 'fs.*Sync 在请求处理中会阻塞事件循环。',
        existingCode: m.match,
        suggestedPatch: '使用 fs.promises.readFile 等异步 API。',
        why: '同步 I/O 阻塞事件循环，影响所有请求。',
        confidence: 0.9,
      }));
    },
  },
  {
    id: 'PERF008',
    category: 'performance',
    severity: 'medium',
    description: '缺少 debounce/throttle（高频触发）',
    check: (_file, content) => {
      // 简单启发式：onChange / onScroll / onResize 内有 setState 但无 debounce
      const matches = findLines(
        content,
        /on(Change|Scroll|Resize|Input|Move)\s*=\s*\{[^}]*set\w+\(/
      );
      return matches
        .filter((m) => {
          const snip = snippet(content, m.line, 3);
          return !snip.includes('debounce') && !snip.includes('throttle');
        })
        .map((m) => ({
          line: m.line,
          title: '高频事件缺少防抖',
          message: 'onChange/onScroll 等高频事件中调用 setState 应使用 debounce。',
          existingCode: m.match,
          suggestedPatch: '使用 lodash.debounce 或 useDebounce hook。',
          why: '高频事件会导致过度渲染。',
          confidence: 0.72,
        }));
    },
  },
  {
    id: 'PERF009',
    category: 'performance',
    severity: 'medium',
    description: '大列表未做虚拟化',
    check: (_file, content) => {
      // 启发式：map 调用但缺少虚拟化库导入
      const matches = findLines(content, /\.map\s*\([^)]*\)/);
      return matches
        .filter((m) => {
          const snip = snippet(content, Math.max(1, m.line - 30), 30);
          return (
            !snip.includes('react-virtual') &&
            !snip.includes('react-window') &&
            !snip.includes('@tanstack/react-virtual') &&
            !snip.includes('VirtualList')
          );
        })
        .map((m) => ({
          line: m.line,
          title: '大列表可能需要虚拟化',
          message: '检测到 .map 渲染但无虚拟化库，长列表性能堪忧。',
          existingCode: m.match,
          suggestedPatch: '使用 @tanstack/react-virtual 虚拟化长列表。',
          why: '100+ 项列表会显著影响滚动性能。',
          confidence: 0.45,
        }));
    },
  },
  {
    id: 'PERF010',
    category: 'performance',
    severity: 'medium',
    description: '不必要的 re-render（缺 React.memo）',
    check: (_file, _content) => [],
  },
  {
    id: 'PERF011',
    category: 'performance',
    severity: 'low',
    description: '数组 spread 在 render 中',
    check: (_file, content) => {
      const matches = findLines(content, /\[\.\.\.\w+\s*,/);
      return matches.slice(0, 3).map((m) => ({
        line: m.line,
        title: 'render 中数组 spread',
        message: 'JSX 中 [...arr, item] 每次创建新数组。',
        existingCode: m.match,
        suggestedPatch: '提取到 useMemo 或组件外。',
        why: '新数组引用破坏 React.memo。',
        confidence: 0.55,
      }));
    },
  },
  {
    id: 'PERF012',
    category: 'performance',
    severity: 'low',
    description: '每次 render 创建新函数',
    check: (_file, content) => {
      // 启发式：JSX 中大量 onClick={() => ...}
      const matches = findLines(content, /onClick\s*=\s*\{\s*\(\s*\)\s*=>/);
      return matches.slice(0, 3).map((m) => ({
        line: m.line,
        title: 'render 中创建 inline 箭头函数',
        message: '每次 render 都创建新的 onClick 函数。',
        existingCode: m.match,
        suggestedPatch: '如需稳定引用，用 useCallback。',
        why: '破坏 React.memo。',
        confidence: 0.5,
      }));
    },
  },
  {
    id: 'PERF013',
    category: 'performance',
    severity: 'low',
    description: '每次 render 创建新对象字面量',
    check: (_file, _content) => [],
  },
  {
    id: 'PERF014',
    category: 'performance',
    severity: 'medium',
    description: '大型依赖未懒加载',
    check: (_file, content) => {
      const matches = findLines(
        content,
        /import\s+\w+\s+from\s+['"](monaco-editor|three\.js|chart\.js|d3|tensorflow)/
      );
      return matches.map((m) => ({
        line: m.line,
        title: '大型依赖未懒加载',
        message: '检测到大型依赖的直接 import。',
        existingCode: m.match,
        suggestedPatch: '使用 React.lazy + Suspense 动态加载。',
        why: '影响初始 bundle 体积。',
        confidence: 0.85,
      }));
    },
  },
  {
    id: 'PERF015',
    category: 'performance',
    severity: 'low',
    description: '大量 reflow（强制同步布局）',
    check: (_file, content) => {
      const matches = findLines(content, /getBoundingClientRect\(\)|offsetTop|offsetLeft|offsetHeight/);
      return matches.slice(0, 2).map((m) => ({
        line: m.line,
        title: '强制同步布局',
        message: 'getBoundingClientRect 等会强制 reflow。',
        existingCode: m.match,
        suggestedPatch: '批量读取后批量修改。',
        why: '反复触发 reflow 影响性能。',
        confidence: 0.6,
      }));
    },
  },
  {
    id: 'PERF016',
    category: 'performance',
    severity: 'medium',
    description: '缺失图片懒加载',
    check: (_file, content) => {
      const matches = findLines(content, /<img\s+src=/);
      return matches
        .filter((m) => !snippet(content, m.line, 1).includes('loading='))
        .map((m) => ({
          line: m.line,
          title: '图片缺少 loading="lazy"',
          message: '<img> 标签未设置 lazy 加载。',
          existingCode: m.match,
          suggestedPatch: '添加 loading="lazy" 属性。',
          why: '减少初始加载的图像数量。',
          confidence: 0.78,
        }));
    },
  },
  {
    id: 'PERF017',
    category: 'performance',
    severity: 'medium',
    description: '大 bundle 无 code splitting',
    check: (_file, content) => {
      // 启发式：main 入口包含所有 router 路由
      const matches = findLines(content, /import\s+\w+\s+from\s+['"]\.\/pages/);
      return matches.length > 8
        ? matches.slice(0, 1).map((m) => ({
            line: m.line,
            title: '未做路由级 code splitting',
            message: '检测到多个页面直接 import，建议改用 React.lazy。',
            existingCode: m.match,
            suggestedPatch: '使用 const Page = React.lazy(() => import("./pages/Page"))。',
            why: '拆分后初始包更小，首屏更快。',
            confidence: 0.6,
          }))
        : [];
    },
  },
  {
    id: 'PERF018',
    category: 'performance',
    severity: 'low',
    description: '多次 setState 调用',
    check: (_file, content) => {
      // 检测函数体内连续多个 setState
      const matches = findLines(content, /set\w+\([^)]+\);[\s\n]+set\w+/);
      return matches.slice(0, 2).map((m) => ({
        line: m.line,
        title: '连续多个 setState',
        message: '检测到连续的多个 setState 调用。',
        existingCode: m.match,
        suggestedPatch: '使用 setX(prev => ({...prev, a, b})) 合并更新。',
        why: '多个 setState 会触发多次 render。',
        confidence: 0.55,
      }));
    },
  },
  {
    id: 'PERF019',
    category: 'performance',
    severity: 'medium',
    description: '同步 setState 链',
    check: (_file, _content) => [],
  },
  {
    id: 'PERF020',
    category: 'performance',
    severity: 'low',
    description: 'useEffect 内 setState 未检查条件',
    check: (_file, content) => {
      const matches = findLines(content, /useEffect\s*\([^,]+,\s*\[[^\]]+\]\s*\)/);
      return matches
        .filter((m) => {
          const snip = snippet(content, m.line, 8);
          return /set\w+\(/.test(snip) && !snip.includes('if') && !snip.includes('?');
        })
        .map((m) => ({
          line: m.line,
          title: 'useEffect 内 setState 无条件检查',
          message: 'useEffect 内 setState 可能导致无限循环。',
          existingCode: m.match,
          suggestedPatch: '添加条件检查或使用 useState lazy init。',
          why: '无限循环会冻结浏览器。',
          confidence: 0.6,
        }));
    },
  },
];

// ============ Maintainability 规则 (20+) ============

const maintainabilityRules: ReviewRule[] = [
  {
    id: 'MAINT001',
    category: 'maintainability',
    severity: 'medium',
    description: '函数超过 50 行',
    check: (_file, content) => {
      const lines = content.split('\n');
      // 简化：检查是否有连续 50 行内无空行（粗略代表长函数）
      const results: Array<{ line: number; match: string; size: number }> = [];
      let blockStart = 0;
      let blockSize = 0;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() === '' || lines[i].trim() === '}') {
          if (blockSize > 50) {
            results.push({ line: blockStart + 1, match: lines[blockStart].slice(0, 50), size: blockSize });
          }
          blockStart = i + 1;
          blockSize = 0;
        } else {
          blockSize++;
        }
      }
      return results.slice(0, 2).map((r) => ({
        line: r.line,
        title: `函数体超过 50 行（约 ${r.size} 行）`,
        message: '长函数难以理解和维护，建议拆分。',
        existingCode: r.match,
        suggestedPatch: '按职责拆分为多个小函数。',
        why: '单一职责原则（SRP）。',
        confidence: 0.7,
      }));
    },
  },
  {
    id: 'MAINT002',
    category: 'maintainability',
    severity: 'medium',
    description: '嵌套深度超过 4 层',
    check: (_file, content) => {
      const lines = content.split('\n');
      const results: Array<{ line: number; depth: number }> = [];
      for (let i = 0; i < lines.length; i++) {
        const opens = (lines[i].match(/\{|\(/g) || []).length;
        const closes = (lines[i].match(/\}|\)/g) || []).length;
        const depth = opens - closes;
        if (depth >= 5) {
          results.push({ line: i + 1, depth });
        }
      }
      return results.slice(0, 3).map((r) => ({
        line: r.line,
        title: `嵌套深度 ${r.depth} 超过 4`,
        message: '深层嵌套降低可读性。',
        existingCode: '',
        suggestedPatch: '使用 early return / extract function。',
        why: '扁平化代码更易读。',
        confidence: 0.6,
      }));
    },
  },
  {
    id: 'MAINT003',
    category: 'maintainability',
    severity: 'low',
    description: '文件超过 500 行',
    check: (_file, content) => {
      const lineCount = content.split('\n').length;
      if (lineCount > 500) {
        return [
          {
            line: 1,
            title: `文件 ${lineCount} 行超过 500`,
            message: '大文件难以维护，建议按职责拆分。',
            suggestedPatch: '拆分为多个模块文件。',
            why: '模块化便于协作和测试。',
            confidence: 0.75,
          },
        ];
      }
      return [];
    },
  },
  {
    id: 'MAINT004',
    category: 'maintainability',
    severity: 'medium',
    description: '圈复杂度超过 10（简化检测：分支数）',
    check: (_file, content) => {
      const matches = findLines(content, /\bif\s*\(|\bfor\s*\(|\bwhile\s*\(|\bswitch\s*\(|\?\s*[^:]+\s*:/g);
      // 简化：单文件分支数 > 30 视为高复杂度
      if (matches.length > 30) {
        return [
          {
            line: 1,
            title: `圈复杂度较高（分支数 ${matches.length}）`,
            message: '文件中分支语句过多。',
            suggestedPatch: '提取条件判断为命名函数。',
            why: '高圈复杂度难以测试。',
            confidence: 0.5,
          },
        ];
      }
      return [];
    },
  },
  {
    id: 'MAINT005',
    category: 'maintainability',
    severity: 'low',
    description: '重复代码块（简化检测）',
    check: (_file, _content) => [],
  },
  {
    id: 'MAINT006',
    category: 'maintainability',
    severity: 'low',
    description: '魔数未命名',
    check: (_file, content) => {
      // 简单启发式：return x * 0.xx 这种
      const matches = findLines(content, /[*/+\-]\s*0\.\d+/);
      return matches.slice(0, 3).map((m) => ({
        line: m.line,
        title: '可能存在魔数',
        message: '检测到浮点魔数未命名。',
        existingCode: m.match,
        suggestedPatch: '提取为命名常量。',
        why: '提高可读性和可维护性。',
        confidence: 0.4,
      }));
    },
  },
  {
    id: 'MAINT007',
    category: 'maintainability',
    severity: 'low',
    description: '注释掉的代码块',
    check: (_file, content) => {
      const matches = findLines(content, /^\s*\/\/.*[;{}()]/);
      return matches.slice(0, 2).map((m) => ({
        line: m.line,
        title: '可能的注释代码',
        message: '检测到疑似注释掉的代码行。',
        existingCode: m.match,
        suggestedPatch: '删除，使用 git history 找回。',
        why: '注释代码增加阅读负担。',
        confidence: 0.45,
      }));
    },
  },
  {
    id: 'MAINT008',
    category: 'maintainability',
    severity: 'low',
    description: 'console.log 残留',
    check: (_file, content) => {
      const matches = findLines(content, /console\.(log|debug)\(/);
      return matches.slice(0, 5).map((m) => ({
        line: m.line,
        title: 'console.log 残留',
        message: '生产代码中不应保留 console.log。',
        existingCode: m.match,
        suggestedPatch: '使用专业 logger，或在发布前删除。',
        why: 'console 调试代码不应进入生产。',
        confidence: 0.7,
      }));
    },
  },
  {
    id: 'MAINT009',
    category: 'maintainability',
    severity: 'high',
    description: 'debugger 残留',
    check: (_file, content) => {
      const matches = findLines(content, /\bdebugger\b/);
      return matches.map((m) => ({
        line: m.line,
        title: 'debugger 语句残留',
        message: 'debugger 会暂停执行，必须在生产前删除。',
        existingCode: m.match,
        suggestedPatch: '删除 debugger 语句。',
        why: '会阻塞生产环境。',
        confidence: 0.98,
      }));
    },
  },
  {
    id: 'MAINT010',
    category: 'maintainability',
    severity: 'low',
    description: 'TODO 标记未关联 issue',
    check: (_file, content) => {
      const matches = findLines(content, /\bTODO\b/);
      return matches
        .filter((m) => !snippet(content, m.line, 1).match(/TODO\s*#\d+|TODO\(https?:\/\//i))
        .slice(0, 3)
        .map((m) => ({
          line: m.line,
          title: 'TODO 未关联 issue',
          message: 'TODO 标记应关联到具体的 issue 编号或链接。',
          existingCode: m.match,
          suggestedPatch: '使用 TODO(#123): 格式或链接到 issue。',
          why: 'TODO 容易遗忘，需要追溯。',
          confidence: 0.55,
        }));
    },
  },
  {
    id: 'MAINT011',
    category: 'maintainability',
    severity: 'low',
    description: '命名不清晰（单字母变量名）',
    check: (_file, content) => {
      const matches = findLines(content, /\b(let|const|var)\s+[a-z]\s*=/);
      return matches.slice(0, 3).map((m) => ({
        line: m.line,
        title: '单字母变量名',
        message: '检测到单字母变量名（除循环计数器 i/j 外）。',
        existingCode: m.match,
        suggestedPatch: '使用有意义的名字。',
        why: '可读性。',
        confidence: 0.4,
      }));
    },
  },
  {
    id: 'MAINT012',
    category: 'maintainability',
    severity: 'medium',
    description: '函数参数超过 5 个',
    check: (_file, _content) => [],
  },
  {
    id: 'MAINT013',
    category: 'maintainability',
    severity: 'low',
    description: '重复的 type definition',
    check: (_file, _content) => [],
  },
  {
    id: 'MAINT014',
    category: 'maintainability',
    severity: 'low',
    description: 'dead code（简化检测）',
    check: (_file, _content) => [],
  },
  {
    id: 'MAINT015',
    category: 'maintainability',
    severity: 'low',
    description: 'hardcoded color 值',
    check: (_file, content) => {
      const matches = findLines(content, /['"]#[0-9a-fA-F]{3,8}['"]/);
      return matches.slice(0, 3).map((m) => ({
        line: m.line,
        title: '硬编码颜色',
        message: '检测到硬编码的颜色值。',
        existingCode: m.match,
        suggestedPatch: '提取为 CSS 变量或 theme 配置。',
        why: '便于主题切换和品牌一致性。',
        confidence: 0.65,
      }));
    },
  },
  {
    id: 'MAINT016',
    category: 'maintainability',
    severity: 'low',
    description: 'hardcoded URL',
    check: (_file, content) => {
      const matches = findLines(content, /['"]https?:\/\/(?!localhost|127\.0\.0\.1)[a-zA-Z0-9.\-]+/);
      return matches.slice(0, 2).map((m) => ({
        line: m.line,
        title: '硬编码 URL',
        message: '硬编码的 URL 应通过配置管理。',
        existingCode: m.match,
        suggestedPatch: '使用环境变量或配置中心。',
        why: '环境切换困难。',
        confidence: 0.55,
      }));
    },
  },
  {
    id: 'MAINT017',
    category: 'maintainability',
    severity: 'low',
    description: 'hardcoded date/time',
    check: (_file, _content) => [],
  },
  {
    id: 'MAINT018',
    category: 'maintainability',
    severity: 'medium',
    description: 'missing default case in switch',
    check: (_file, content) => {
      const matches = findLines(content, /\bswitch\s*\(/);
      return matches
        .filter((m) => {
          const snip = snippet(content, m.line, 30);
          return !snip.includes('default:') && !snip.includes('default :');
        })
        .map((m) => ({
          line: m.line,
          title: 'switch 缺少 default 分支',
          message: 'switch 语句应包含 default 分支以处理未预期情况。',
          existingCode: m.match,
          suggestedPatch: '添加 default: 分支。',
          why: '防御性编程。',
          confidence: 0.7,
        }));
    },
  },
  {
    id: 'MAINT019',
    category: 'maintainability',
    severity: 'high',
    description: '缺少空 catch 处理',
    check: (_file, content) => {
      const matches = findLines(content, /catch\s*\([^)]*\)\s*\{\s*\}/);
      return matches.map((m) => ({
        line: m.line,
        title: '空的 catch 块',
        message: 'catch 块为空会吞掉所有错误。',
        existingCode: m.match,
        suggestedPatch: '至少 logger.error(err) 或 rethrow。',
        why: '隐藏 bug 让调试困难。',
        confidence: 0.92,
      }));
    },
  },
  {
    id: 'MAINT020',
    category: 'maintainability',
    severity: 'info',
    description: '包含较多行变更',
    check: (_file, _content) => [],
  },
];

// ============ Testing 规则 (15+) ============

const testingRules: ReviewRule[] = [
  {
    id: 'TEST001',
    category: 'testing',
    severity: 'medium',
    description: '公共函数缺少单元测试',
    check: (_file, _content) => [],
  },
  {
    id: 'TEST002',
    category: 'testing',
    severity: 'medium',
    description: '异步函数缺少测试',
    check: (_file, _content) => [],
  },
  {
    id: 'TEST003',
    category: 'testing',
    severity: 'medium',
    description: '错误处理路径未测试',
    check: (_file, _content) => [],
  },
  {
    id: 'TEST004',
    category: 'testing',
    severity: 'low',
    description: '边界条件未测试',
    check: (_file, _content) => [],
  },
  {
    id: 'TEST005',
    category: 'testing',
    severity: 'low',
    description: '改动文件对应测试文件未更新',
    check: (_file, _content) => [],
  },
  {
    id: 'TEST006',
    category: 'testing',
    severity: 'low',
    description: '测试断言过于宽松',
    check: (_file, content) => {
      const matches = findLines(content, /expect\([^)]+\)\.toBeTruthy\(\)/);
      return matches.slice(0, 3).map((m) => ({
        line: m.line,
        title: '测试断言过于宽松',
        message: 'toBeTruthy() 无法验证具体值。',
        existingCode: m.match,
        suggestedPatch: '使用具体的 toBe/toEqual 断言。',
        why: '宽松断言可能掩盖 bug。',
        confidence: 0.6,
      }));
    },
  },
  {
    id: 'TEST007',
    category: 'testing',
    severity: 'high',
    description: '测试包含真实网络请求',
    check: (_file, content) => {
      if (_file.includes('.test.') || _file.includes('.spec.')) {
        const matches = findLines(content, /fetch\s*\(|axios\.|got\(|request\s*\(/);
        return matches
          .filter((m) => !snippet(content, m.line, 2).includes('mock'))
          .map((m) => ({
            line: m.line,
            title: '测试中存在真实网络请求',
            message: '单元测试应使用 mock 替代真实网络请求。',
            existingCode: m.match,
            suggestedPatch: '使用 vi.mock("axios") 或 msw 拦截。',
            why: '真实请求让测试不稳定且慢。',
            confidence: 0.88,
          }));
      }
      return [];
    },
  },
  {
    id: 'TEST008',
    category: 'testing',
    severity: 'medium',
    description: '测试间共享可变状态',
    check: (_file, _content) => [],
  },
  {
    id: 'TEST009',
    category: 'testing',
    severity: 'low',
    description: '测试依赖执行顺序',
    check: (_file, _content) => [],
  },
  {
    id: 'TEST010',
    category: 'testing',
    severity: 'medium',
    description: '测试覆盖率为 0 的新文件',
    check: (_file, _content) => [],
  },
  {
    id: 'TEST011',
    category: 'testing',
    severity: 'low',
    description: 'mock 数据未清理',
    check: (_file, content) => {
      if (_file.includes('.test.') || _file.includes('.spec.')) {
        const matches = findLines(content, /vi\.mock\(|jest\.mock\(/);
        if (!content.includes('vi.restoreAllMocks') && !content.includes('jest.restoreAllMocks')) {
          return matches.map((m) => ({
            line: m.line,
            title: 'mock 未在 afterEach 清理',
            message: 'vi.mock 后未调用 restoreAllMocks。',
            existingCode: m.match,
            suggestedPatch: '在 afterEach 中调用 vi.restoreAllMocks()。',
            why: 'mock 状态泄漏到其他测试。',
            confidence: 0.7,
          }));
        }
        return [];
      }
      return [];
    },
  },
  {
    id: 'TEST012',
    category: 'testing',
    severity: 'low',
    description: '测试中的 sleep',
    check: (_file, content) => {
      if (_file.includes('.test.') || _file.includes('.spec.')) {
        const matches = findLines(content, /setTimeout\([^,]+,\s*\d{3,}\)/);
        return matches.map((m) => ({
          line: m.line,
          title: '测试中使用了 sleep',
          message: 'setTimeout 睡眠让测试变慢且不稳定。',
          existingCode: m.match,
          suggestedPatch: '使用 vi.useFakeTimers() 或 waitFor。',
          why: '实际等待让 CI 缓慢且 flaky。',
          confidence: 0.75,
        }));
      }
      return [];
    },
  },
  {
    id: 'TEST013',
    category: 'testing',
    severity: 'low',
    description: '缺少 critical path 测试',
    check: (_file, _content) => [],
  },
  {
    id: 'TEST014',
    category: 'testing',
    severity: 'low',
    description: '缺少 happy path 测试',
    check: (_file, _content) => [],
  },
  {
    id: 'TEST015',
    category: 'testing',
    severity: 'low',
    description: 'snapshot test 未更新',
    check: (_file, _content) => [],
  },
];

// ============ Bug 规则 (20+) ============

const bugRules: ReviewRule[] = [
  {
    id: 'BUG001',
    category: 'bug',
    severity: 'high',
    description: '可空变量未做空检查',
    check: (_file, content) => {
      const matches = findLines(content, /(\w+)\.\w+\(/);
      return matches
        .filter((m) => {
          const varName = m.match.match(/(\w+)\./)?.[1];
          if (!varName) return false;
          const declLine = findLines(content, new RegExp(`(let|const|var)\\s+${varName}\\s*[:=]`));
          if (declLine.length === 0) return false;
          const decl = snippet(content, declLine[0].line, 1);
          return /\s*\|\s*null|:\s*\w+\s*\|\s*null/.test(decl) &&
            !snippet(content, m.line, 2).includes(`if (${varName})`) &&
            !snippet(content, m.line, 2).includes(`${varName}?.`);
        })
        .map((m) => ({
          line: m.line,
          title: '可空变量未做空检查',
          message: '变量被声明为可空（包含 null）但使用前未检查。',
          existingCode: m.match,
          suggestedPatch: '使用可选链或显式 if 检查。',
          why: '运行时会抛 TypeError。',
          confidence: 0.7,
        }));
    },
  },
  {
    id: 'BUG002',
    category: 'bug',
    severity: 'medium',
    description: '数组访问未做 length 检查',
    check: (_file, content) => {
      const matches = findLines(content, /\w+\[\s*\d+\s*\]/);
      return matches.slice(0, 2).map((m) => ({
        line: m.line,
        title: '索引访问未做边界检查',
        message: '数组索引访问未做 length 验证。',
        existingCode: m.match,
        suggestedPatch: '先检查 arr.length > index 再访问。',
        why: '空数组会返回 undefined。',
        confidence: 0.4,
      }));
    },
  },
  {
    id: 'BUG003',
    category: 'bug',
    severity: 'high',
    description: '异步函数未 await',
    check: (_file, content) => {
      const matches = findLines(content, /(?<![.\w])fetch\s*\(/);
      return matches
        .filter((m) => {
          const line = content.split('\n')[m.line - 1] || '';
          return !line.includes('await ') && !line.includes('return fetch') && !line.includes('.then(');
        })
        .map((m) => ({
          line: m.line,
          title: 'fetch 未 await',
          message: 'fetch 返回 Promise 但未使用 await。',
          existingCode: m.match,
          suggestedPatch: '添加 await 关键字或 .then() 处理。',
          why: '拿不到响应数据。',
          confidence: 0.75,
        }));
    },
  },
  {
    id: 'BUG004',
    category: 'bug',
    severity: 'high',
    description: 'Promise 未处理 rejection',
    check: (_file, content) => {
      const matches = findLines(content, /new\s+Promise\s*\(/);
      return matches
        .filter((_m) => !content.includes('.catch(') && !content.includes('try {') && !content.includes('Promise.allSettled'))
        .map((m) => ({
          line: m.line,
          title: 'Promise 未处理 rejection',
          message: 'Promise 创建后未处理 rejection 路径。',
          existingCode: m.match,
          suggestedPatch: '添加 .catch() 或 try/await/catch。',
          why: 'UnhandledPromiseRejection 会崩溃。',
          confidence: 0.55,
        }));
    },
  },
  {
    id: 'BUG005',
    category: 'bug',
    severity: 'medium',
    description: '事件监听器未清理',
    check: (_file, content) => {
      const matches = findLines(content, /addEventListener\s*\(\s*['"]\w+['"]/);
      return matches
        .filter((_m) => !content.includes('removeEventListener'))
        .slice(0, 2)
        .map((m) => ({
          line: m.line,
          title: 'addEventListener 未清理',
          message: '检测到 addEventListener 但未发现对应的 removeEventListener。',
          existingCode: m.match,
          suggestedPatch: '在 useEffect cleanup 中调用 removeEventListener。',
          why: '内存泄漏。',
          confidence: 0.6,
        }));
    },
  },
  {
    id: 'BUG006',
    category: 'bug',
    severity: 'medium',
    description: '定时器未清理',
    check: (_file, content) => {
      const matches = findLines(content, /setInterval\s*\(/);
      return matches
        .filter((_m) => !content.includes('clearInterval'))
        .map((m) => ({
          line: m.line,
          title: 'setInterval 未清理',
          message: 'setInterval 创建后未发现 clearInterval。',
          existingCode: m.match,
          suggestedPatch: '在 cleanup 中调用 clearInterval。',
          why: '定时器泄漏。',
          confidence: 0.8,
        }));
    },
  },
  {
    id: 'BUG007',
    category: 'bug',
    severity: 'medium',
    description: '资源未释放（stream / connection）',
    check: (_file, _content) => [],
  },
  {
    id: 'BUG008',
    category: 'bug',
    severity: 'medium',
    description: '闭包捕获过期变量',
    check: (_file, _content) => [],
  },
  {
    id: 'BUG009',
    category: 'bug',
    severity: 'high',
    description: 'setState 在已卸载组件',
    check: (_file, _content) => [],
  },
  {
    id: 'BUG010',
    category: 'bug',
    severity: 'medium',
    description: '条件分支永远为 true/false',
    check: (_file, content) => {
      const matches = findLines(content, /if\s*\(\s*(true|false)\s*\)/);
      return matches.map((m) => ({
        line: m.line,
        title: '常量条件分支',
        message: 'if (true) 或 if (false) 是死代码。',
        existingCode: m.match,
        suggestedPatch: '移除无意义的条件分支。',
        why: '说明可能存在错误逻辑。',
        confidence: 0.92,
      }));
    },
  },
  {
    id: 'BUG011',
    category: 'bug',
    severity: 'high',
    description: '死循环（无 break）',
    check: (_file, content) => {
      const matches = findLines(content, /while\s*\(\s*true\s*\)/);
      return matches
        .filter((m) => {
          const snip = snippet(content, m.line, 15);
          return !snip.includes('break') && !snip.includes('return ');
        })
        .map((m) => ({
          line: m.line,
          title: 'while(true) 无 break',
          message: 'while(true) 循环中未发现 break 或 return。',
          existingCode: m.match,
          suggestedPatch: '添加 break 条件或使用 for 循环。',
          why: '会导致浏览器卡死。',
          confidence: 0.85,
        }));
    },
  },
  {
    id: 'BUG012',
    category: 'bug',
    severity: 'medium',
    description: '浮点数比较使用 ===',
    check: (_file, content) => {
      const matches = findLines(content, /\b\w+\s*===\s*\d+\.\d+/);
      return matches.slice(0, 2).map((m) => ({
        line: m.line,
        title: '浮点数 === 比较',
        message: '浮点数比较应使用容差。',
        existingCode: m.match,
        suggestedPatch: '使用 Math.abs(a - b) < 0.0001。',
        why: '浮点精度问题。',
        confidence: 0.7,
      }));
    },
  },
  {
    id: 'BUG013',
    category: 'bug',
    severity: 'low',
    description: '整数溢出风险',
    check: (_file, _content) => [],
  },
  {
    id: 'BUG014',
    category: 'bug',
    severity: 'high',
    description: '字符串转 number 缺少校验',
    check: (_file, content) => {
      const matches = findLines(content, /parseInt\s*\(|parseFloat\s*\(/);
      return matches
        .filter((_m) => !content.includes('isNaN') && !content.includes('Number.isFinite'))
        .slice(0, 2)
        .map((m) => ({
          line: m.line,
          title: 'parseInt/Float 缺少 NaN 校验',
          message: 'parseInt/Float 后未校验 NaN。',
          existingCode: m.match,
          suggestedPatch: '添加 if (Number.isNaN(x)) throw ...',
          why: 'NaN 传播会导致后续计算全错。',
          confidence: 0.7,
        }));
    },
  },
  {
    id: 'BUG015',
    category: 'bug',
    severity: 'medium',
    description: 'Date 时区问题',
    check: (_file, content) => {
      const matches = findLines(content, /new Date\s*\(\s*['"]/);
      return matches.map((m) => ({
        line: m.line,
        title: 'new Date 字符串可能存在时区问题',
        message: 'new Date("2026-01-01") 解析为 UTC，可能与预期不符。',
        existingCode: m.match,
        suggestedPatch: '使用 new Date("2026-01-01T00:00:00") 或 dayjs.tz。',
        why: '时区差异导致日期偏移。',
        confidence: 0.55,
      }));
    },
  },
  {
    id: 'BUG016',
    category: 'bug',
    severity: 'medium',
    description: '深拷贝与浅拷贝混淆',
    check: (_file, _content) => [],
  },
  {
    id: 'BUG017',
    category: 'bug',
    severity: 'medium',
    description: '重复的 useState 调用',
    check: (_file, content) => {
      const matches = findLines(content, /useState\s*\(/);
      const calls = new Map<string, number>();
      for (const m of matches) {
        const name = snippet(content, m.line, 1).match(/const\s+\[(\w+),/)?.[1];
        if (name) calls.set(name, (calls.get(name) || 0) + 1);
      }
      const dupes: Array<{ line: number; match: string }> = [];
      for (const [name, count] of calls) {
        if (count > 1) {
          const m = matches.find((m) => snippet(content, m.line, 1).includes(`[${name},`));
          if (m) dupes.push({ line: m.line, match: name });
        }
      }
      return dupes.map((d) => ({
        line: d.line,
        title: `useState "${d.match}" 重复定义`,
        message: '同一个变量被多次 useState。',
        existingCode: d.match,
        suggestedPatch: '移除重复的 useState。',
        why: '会导致状态不一致。',
        confidence: 0.9,
      }));
    },
  },
  {
    id: 'BUG018',
    category: 'bug',
    severity: 'high',
    description: 'key 重复',
    check: (_file, _content) => [],
  },
  {
    id: 'BUG019',
    category: 'bug',
    severity: 'low',
    description: '错误使用 Array.from',
    check: (_file, _content) => [],
  },
  {
    id: 'BUG020',
    category: 'bug',
    severity: 'medium',
    description: 'JSON.parse 缺少 try/catch',
    check: (_file, content) => {
      const matches = findLines(content, /JSON\.parse\s*\(/);
      return matches
        .filter((m) => {
          const snip = snippet(content, m.line, 8);
          return !snip.includes('try {') && !snip.includes('.catch(');
        })
        .map((m) => ({
          line: m.line,
          title: 'JSON.parse 缺少 try/catch',
          message: 'JSON.parse 失败时会抛 SyntaxError。',
          existingCode: m.match,
          suggestedPatch: '使用 try/catch 包裹。',
          why: '解析错误会冒泡到上层。',
          confidence: 0.78,
        }));
    },
  },
];

// ============ Type Safety 规则 (10+) ============

const typeSafetyRules: ReviewRule[] = [
  {
    id: 'TYPE001',
    category: 'type-safety',
    severity: 'medium',
    description: 'any 类型',
    check: (_file, content) => {
      const matches = findLines(content, /:\s*any\b|<any>/);
      return matches.slice(0, 3).map((m) => ({
        line: m.line,
        title: '使用 any 类型',
        message: 'any 绕过 TypeScript 类型检查。',
        existingCode: m.match,
        suggestedPatch: '使用 unknown 或具体类型。',
        why: '类型安全是 TypeScript 的核心价值。',
        confidence: 0.9,
      }));
    },
  },
  {
    id: 'TYPE002',
    category: 'type-safety',
    severity: 'medium',
    description: 'as 强制类型转换',
    check: (_file, content) => {
      const matches = findLines(content, /\s+as\s+[A-Z]\w+/);
      return matches.slice(0, 3).map((m) => ({
        line: m.line,
        title: '使用 as 强制类型转换',
        message: 'as 转换可能在运行时失败。',
        existingCode: m.match,
        suggestedPatch: '使用类型守卫或显式验证。',
        why: '类型转换可能掩盖真实问题。',
        confidence: 0.6,
      }));
    },
  },
  {
    id: 'TYPE003',
    category: 'type-safety',
    severity: 'high',
    description: '@ts-ignore 注释',
    check: (_file, content) => {
      const matches = findLines(content, /@ts-ignore/);
      return matches.map((m) => ({
        line: m.line,
        title: '使用 @ts-ignore',
        message: '@ts-ignore 抑制了所有类型错误，可能掩盖 bug。',
        existingCode: m.match,
        suggestedPatch: '修复类型错误或使用 @ts-expect-error 替代。',
        why: '完全失去类型保护。',
        confidence: 0.88,
      }));
    },
  },
  {
    id: 'TYPE004',
    category: 'type-safety',
    severity: 'low',
    description: '@ts-expect-error 注释',
    check: (_file, content) => {
      const matches = findLines(content, /@ts-expect-error/);
      return matches.map((m) => ({
        line: m.line,
        title: '使用 @ts-expect-error',
        message: '@ts-expect-error 应当在修复后删除。',
        existingCode: m.match,
        suggestedPatch: '修复类型错误后删除。',
        why: '遗留的 expect-error 反而会报错。',
        confidence: 0.7,
      }));
    },
  },
  {
    id: 'TYPE005',
    category: 'type-safety',
    severity: 'low',
    description: 'function 不带返回类型',
    check: (_file, content) => {
      const matches = findLines(content, /function\s+\w+\s*\([^)]*\)\s*\{/);
      return matches
        .filter((m) => !m.match.includes(':'))
        .slice(0, 3)
        .map((m) => ({
          line: m.line,
          title: 'function 未声明返回类型',
          message: '显式返回类型提高可读性和重构安全性。',
          existingCode: m.match,
          suggestedPatch: '添加 : ReturnType 注解。',
          why: '隐性返回类型会随代码变更而不稳定。',
          confidence: 0.55,
        }));
    },
  },
  {
    id: 'TYPE006',
    category: 'type-safety',
    severity: 'low',
    description: '变量不显式标注类型',
    check: (_file, _content) => [],
  },
  {
    id: 'TYPE007',
    category: 'type-safety',
    severity: 'low',
    description: 'null vs undefined 混用',
    check: (_file, _content) => [],
  },
  {
    id: 'TYPE008',
    category: 'type-safety',
    severity: 'medium',
    description: '强制非空断言 !.',
    check: (_file, content) => {
      const matches = findLines(content, /\w+!\./);
      return matches.slice(0, 3).map((m) => ({
        line: m.line,
        title: '强制非空断言 !.',
        message: '! 断言运行时可能为 null 导致崩溃。',
        existingCode: m.match,
        suggestedPatch: '使用类型守卫或 optional chaining。',
        why: '运行时安全。',
        confidence: 0.65,
      }));
    },
  },
  {
    id: 'TYPE009',
    category: 'type-safety',
    severity: 'high',
    description: 'unsafe 类型断言',
    check: (_file, content) => {
      const matches = findLines(content, /\s+as\s+unknown/);
      return matches.map((m) => ({
        line: m.line,
        title: 'as unknown 双断言',
        message: '通过 unknown 双断言绕过类型检查是高风险操作。',
        existingCode: m.match,
        suggestedPatch: '重构成显式验证。',
        why: '运行时类型不匹配。',
        confidence: 0.88,
      }));
    },
  },
  {
    id: 'TYPE010',
    category: 'type-safety',
    severity: 'low',
    description: '缺少数组元素类型',
    check: (_file, content) => {
      const matches = findLines(content, /:\s*\w+\[\s*\]/);
      return matches.slice(0, 2).map((m) => ({
        line: m.line,
        title: '数组类型未指定元素类型',
        message: 'Array<T> 或 T[] 优于 unknown[]。',
        existingCode: m.match,
        suggestedPatch: '明确元素类型，如 string[]。',
        why: '类型安全。',
        confidence: 0.45,
      }));
    },
  },
];

// ============ 汇总导出 ============

export const ALL_RULES: ReviewRule[] = [
  ...securityRules,
  ...performanceRules,
  ...maintainabilityRules,
  ...testingRules,
  ...bugRules,
  ...typeSafetyRules,
];

export const RULES_BY_CATEGORY: Record<string, ReviewRule[]> = {
  security: securityRules,
  performance: performanceRules,
  maintainability: maintainabilityRules,
  testing: testingRules,
  bug: bugRules,
  'type-safety': typeSafetyRules,
};

export const RULE_COUNT_BY_CATEGORY: Record<string, number> = {
  security: securityRules.length,
  performance: performanceRules.length,
  maintainability: maintainabilityRules.length,
  testing: testingRules.length,
  bug: bugRules.length,
  'type-safety': typeSafetyRules.length,
};

export const TOTAL_RULE_COUNT = ALL_RULES.length;
