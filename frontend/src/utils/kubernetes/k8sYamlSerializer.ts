/**
 * # ============================================================
 * # K8s YAML Serializer - Kubernetes YAML 序列化器 (Cycle 55 G55-01)
 * # ============================================================
 * # 核心作用：将 JavaScript 对象序列化为 Kubernetes YAML 格式
 * # 兼容标准：Kubernetes 1.28+ API 规范 (apiVersion/kind/metadata/spec)
 * # 输入：任意 JS 对象 (含嵌套数组/对象)
 * # 输出：符合 K8s YAML 规范的字符串 (含 --- 分隔符)
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 55 G55-01 初次创建
 * # ====================================
 */

/** YAML 缩进字符（2 空格，符合 K8s 官方规范） */
const INDENT = '  ';

/**
 * 序列化单个值（字符串/数字/布尔/null）
 */
function serializeValue(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : 'null';
  }
  if (typeof value === 'string') {
    return serializeString(value);
  }
  // 对象/数组不应直接调用 serializeValue
  return JSON.stringify(value);
}

/**
 * 序列化字符串值（处理特殊字符）
 * - 含特殊字符时使用双引号转义
 * - 多行字符串使用 | 块格式
 */
function serializeString(value: string): string {
  // 空字符串
  if (value === '') {
    return '""';
  }
  // 强制双引号的场景
  const needQuotes =
    /[:#@&*!|>'"%`,{}\[\]\n\r\t]/.test(value) ||
    /^(true|false|null|yes|no|on|off|~)$/i.test(value) ||
    /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(value) ||
    /^\s|\s$/.test(value);
  if (needQuotes) {
    const escaped = value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
    return `"${escaped}"`;
  }
  return value;
}

/**
 * 序列化对象（单层）
 */
function serializeObject(obj: Record<string, unknown>, indent: number): string {
  const prefix = INDENT.repeat(indent);
  const lines: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    if (value === null) {
      lines.push(`${prefix}${key}: null`);
    } else if (Array.isArray(value)) {
      const itemLines = serializeArray(value, indent + 1);
      if (itemLines.length === 0) {
        lines.push(`${prefix}${key}: []`);
      } else {
        lines.push(`${prefix}${key}:`);
        for (const line of itemLines) lines.push(line);
      }
    } else if (typeof value === 'object') {
      const nested = serializeObject(value as Record<string, unknown>, indent + 1);
      if (nested) {
        lines.push(`${prefix}${key}:`);
        for (const line of nested.split('\n')) lines.push(line);
      } else {
        lines.push(`${prefix}${key}: {}`);
      }
    } else {
      lines.push(`${prefix}${key}: ${serializeValue(value)}`);
    }
  }
  return lines.join('\n');
}

/**
 * 序列化数组
 */
function serializeArray(arr: unknown[], indent: number): string[] {
  const prefix = INDENT.repeat(indent - 1);
  const lines: string[] = [];
  for (const item of arr) {
    if (item === null || item === undefined) {
      lines.push(`${prefix}- null`);
    } else if (Array.isArray(item)) {
      const itemLines = serializeArray(item, indent);
      if (itemLines.length === 0) {
        lines.push(`${prefix}- []`);
      } else {
        lines.push(`${prefix}- `);
        for (const l of itemLines) {
          // 内部数组项缩进调整为 prefix + 2
          lines.push(`${INDENT}${l}`);
        }
      }
    } else if (typeof item === 'object') {
      // 对象在数组中：第一行紧跟 "- "，后续行缩进为 prefix + 2
      const objContent = serializeObjectLines(item as Record<string, unknown>, indent);
      if (objContent.length === 0) {
        lines.push(`${prefix}- {}`);
      } else {
        const [first, ...rest] = objContent;
        lines.push(`${prefix}- ${first}`);
        for (const r of rest) {
          lines.push(`${INDENT.repeat(indent)}${r}`);
        }
      }
    } else {
      lines.push(`${prefix}- ${serializeValue(item)}`);
    }
  }
  return lines;
}

/**
 * 序列化对象为多行字符串（无外部缩进）
 * 用于在数组项中嵌入对象
 */
function serializeObjectLines(obj: Record<string, unknown>, baseIndent: number): string[] {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    if (value === null) {
      lines.push(`${key}: null`);
    } else if (Array.isArray(value)) {
      const itemLines = serializeArray(value, baseIndent + 1);
      if (itemLines.length === 0) {
        lines.push(`${key}: []`);
      } else {
        lines.push(`${key}:`);
        for (const l of itemLines) lines.push(l);
      }
    } else if (typeof value === 'object') {
      const nested = serializeObjectLines(value as Record<string, unknown>, baseIndent + 1);
      if (nested.length > 0) {
        lines.push(`${key}:`);
        for (const l of nested) lines.push(l);
      } else {
        lines.push(`${key}: {}`);
      }
    } else {
      lines.push(`${key}: ${serializeValue(value)}`);
    }
  }
  return lines;
}

/**
 * 序列化 K8s 资源（单文档）
 */
export function serializeK8sResource(resource: Record<string, unknown>): string {
  return serializeObject(resource, 0);
}

/**
 * 序列化多文档 YAML（用 --- 分隔，符合 K8s 规范）
 */
export function serializeK8sManifest(resources: Array<Record<string, unknown>>): string {
  if (!resources || resources.length === 0) return '';
  return resources.map((r) => serializeK8sResource(r)).join('\n---\n') + '\n';
}

/**
 * 解析 K8s YAML 字符串为对象（简单 K8s YAML 解析器）
 * 支持：apiVersion/kind/metadata/spec/status 嵌套结构
 * 限制：不支持复杂锚点/引用（实际 K8s YAML 很少使用）
 */
export function parseK8sYaml(yaml: string): Array<Record<string, unknown>> {
  const docs: Array<Record<string, unknown>> = [];
  const lines = yaml.split('\n');
  // 按 --- 分隔多文档
  const sections: string[][] = [[]];
  for (const line of lines) {
    if (/^---\s*$/.test(line)) {
      sections.push([]);
    } else {
      sections[sections.length - 1].push(line);
    }
  }
  for (const section of sections) {
    if (section.every((l) => l.trim() === '' || l.trim().startsWith('#'))) continue;
    // 顶层使用 parentIndent = -1，确保第一行（indent 0）也能被识别
    const parsed = parseObject(section, 0, -1);
    if (parsed.value && typeof parsed.value === 'object' && !Array.isArray(parsed.value) && Object.keys(parsed.value).length > 0) {
      docs.push(parsed.value);
    }
  }
  return docs;
}

interface ParseResult {
  value: Record<string, unknown> | unknown[] | string | number | boolean | null;
  nextIndex: number;
}

/**
 * 计算行的缩进
 */
function getIndent(line: string): number {
  return line.length - line.trimStart().length;
}

/**
 * 跳过空行和注释行，返回下一个非空行索引
 */
function skipEmpty(lines: string[], start: number): number {
  let i = start;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (t !== '' && !t.startsWith('#')) break;
    i++;
  }
  return i;
}

/**
 * 解析对象
 * 找到首个非空行的缩进作为子项基准缩进
 */
function parseObject(lines: string[], start: number, parentIndent: number): ParseResult {
  const result: Record<string, unknown> = {};
  // 找到第一个有效行，确定子项缩进
  let i = skipEmpty(lines, start);
  let childIndent = -1;
  if (i < lines.length) {
    const line = lines[i];
    const indent = getIndent(line);
    if (indent > parentIndent) {
      childIndent = indent;
    }
  }
  if (childIndent < 0) {
    return { value: result, nextIndex: i };
  }
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (t === '' || t.startsWith('#')) {
      i++;
      continue;
    }
    const indent = getIndent(line);
    if (indent < childIndent) break;
    if (indent > childIndent) {
      // 缩进异常，跳过避免死循环
      i++;
      continue;
    }
    const content = line.trimStart();
    const match = content.match(/^([A-Za-z0-9_.-]+|"[^"]+")\s*:\s*(.*)$/);
    if (!match) {
      i++;
      continue;
    }
    const [, key, rest] = match;
    if (rest === '' || rest === '|' || rest === '>') {
      const next = parseNested(lines, i + 1, indent);
      result[key] = next.value;
      i = next.nextIndex;
    } else {
      result[key] = parseScalar(rest);
      i++;
    }
  }
  return { value: result, nextIndex: i };
}

/**
 * 解析嵌套结构（对象或数组）
 */
function parseNested(lines: string[], start: number, baseIndent: number): ParseResult {
  const firstIdx = skipEmpty(lines, start);
  if (firstIdx >= lines.length) return { value: null, nextIndex: start };
  const firstLine = lines[firstIdx];
  const firstIndent = getIndent(firstLine);
  if (firstIndent < baseIndent) return { value: null, nextIndex: firstIdx };
  const firstTrim = firstLine.trimStart();
  if (firstTrim.startsWith('- ')) {
    return parseArray(lines, start, baseIndent);
  }
  return parseObject(lines, start, baseIndent);
}

/**
 * 解析数组（- 开头的项）
 */
function parseArray(lines: string[], start: number, parentIndent: number): ParseResult {
  const result: unknown[] = [];
  // 找到第一个有效行，确定数组项的缩进
  let i = skipEmpty(lines, start);
  let itemIndent = -1;
  if (i < lines.length) {
    const line = lines[i];
    const indent = getIndent(line);
    const t = line.trimStart();
    if (indent >= parentIndent && t.startsWith('- ')) {
      itemIndent = indent;
    }
  }
  if (itemIndent < 0) {
    return { value: result, nextIndex: i };
  }
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (t === '' || t.startsWith('#')) {
      i++;
      continue;
    }
    const indent = getIndent(line);
    if (indent < itemIndent) break;
    if (indent > itemIndent) {
      i++;
      continue;
    }
    const content = line.trimStart();
    if (!content.startsWith('- ')) break;
    const itemContent = content.slice(2);
    if (itemContent === '' || itemContent === '|' || itemContent === '>') {
      const next = parseNested(lines, i + 1, itemIndent);
      result.push(next.value);
      i = next.nextIndex;
    } else {
      const kvMatch = itemContent.match(/^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
      if (kvMatch) {
        const [, k, v] = kvMatch;
        const obj: Record<string, unknown> = {};
        if (v === '' || v === '|' || v === '>') {
          const next = parseNested(lines, i + 1, itemIndent);
          obj[k] = next.value;
          i = next.nextIndex;
        } else {
          obj[k] = parseScalar(v);
          i++;
        }
        // 继续读取同一对象的后续字段（缩进为 itemIndent + 2）
        while (i < lines.length) {
          const nextLine = lines[i];
          const nextIndent = getIndent(nextLine);
          if (nextIndent !== itemIndent + 2) break;
          const nextContent = nextLine.trimStart();
          const nextMatch = nextContent.match(/^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
          if (!nextMatch) break;
          const [, nk, nv] = nextMatch;
          if (nv === '' || nv === '|' || nv === '>') {
            const nextNext = parseNested(lines, i + 1, nextIndent);
            obj[nk] = nextNext.value;
            i = nextNext.nextIndex;
          } else {
            obj[nk] = parseScalar(nv);
            i++;
          }
        }
        result.push(obj);
      } else {
        result.push(parseScalar(itemContent));
        i++;
      }
    }
  }
  return { value: result, nextIndex: i };
}

function parseScalar(value: string): string | number | boolean | null {
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === '~' || trimmed === 'null') return null;
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  // 数字
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  if (/^-?\d+\.\d+([eE][+-]?\d+)?$/.test(trimmed)) return Number(trimmed);
  // 字符串去引号
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\');
  }
  return trimmed;
}
