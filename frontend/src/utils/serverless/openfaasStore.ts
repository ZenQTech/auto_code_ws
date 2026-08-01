/**
 * # ============================================================
 * # OpenFaaS Function Store - 函数市场 (Cycle 56 G56-03)
 * # ============================================================
 * # 核心作用：预制官方 + 社区函数库
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 56 G56-03 初次创建
 * # ====================================
 */

import type { StoreFunction } from './openfaasTypes';

/** OpenFaaS 官方 Function Store */
export const OFFICIAL_FUNCTION_STORE: StoreFunction[] = [
  {
    name: 'nodeinfo',
    title: 'Node Info',
    description: '返回 Node.js 进程信息（版本/内存/CPU）',
    image: 'ghcr.io/openfaas/of-nodeinfo:latest',
    category: 'Utility',
    language: 'node20',
    tags: ['info', 'debug', 'node'],
    repository: 'https://github.com/openfaas/of-nodeinfo',
    env: {},
    official: true,
  },
  {
    name: 'echo',
    title: 'Echo Function',
    description: '回显输入内容，用于测试 Function 调用',
    image: 'ghcr.io/openfaas/of-echo:latest',
    category: 'Utility',
    language: 'node20',
    tags: ['echo', 'test', 'demo'],
    repository: 'https://github.com/openfaas/of-echo',
    env: {},
    official: true,
  },
  {
    name: 'figlet',
    title: 'Figlet ASCII Art',
    description: '将文本转换为 ASCII 艺术字',
    image: 'ghcr.io/openfaas/figlet:latest',
    category: 'Utility',
    language: 'go1.21',
    tags: ['ascii', 'art', 'fun'],
    repository: 'https://github.com/openfaas/figlet',
    env: {},
    official: true,
  },
  {
    name: 'sentimentanalysis',
    title: 'Sentiment Analysis',
    description: '基于 AI 的情感分析，支持中英文',
    image: 'ghcr.io/openfaas/sentimentanalysis:latest',
    category: 'AI/ML',
    language: 'python3.11',
    tags: ['nlp', 'ai', 'sentiment', 'analysis'],
    repository: 'https://github.com/openfaas/sentimentanalysis',
    env: {
      'WRITE_TIMEOUT': '60',
      'READ_TIMEOUT': '60',
    },
    official: true,
  },
  {
    name: 'face-detection',
    title: 'Face Detection',
    description: '使用 OpenCV 进行人脸检测',
    image: 'ghcr.io/openfaas/face-detection:latest',
    category: 'AI/ML',
    language: 'python3.11',
    tags: ['cv', 'detection', 'ai'],
    repository: 'https://github.com/openfaas/face-detection',
    env: {},
    official: true,
  },
  {
    name: 'ocr',
    title: 'OCR Text Recognition',
    description: 'Tesseract OCR 文字识别',
    image: 'ghcr.io/openfaas/ocr:latest',
    category: 'AI/ML',
    language: 'python3.10',
    tags: ['ocr', 'tesseract', 'image'],
    repository: 'https://github.com/openfaas/ocr',
    env: {},
    official: true,
  },
];

/** OpenFaaS 社区 Function Store */
export const COMMUNITY_FUNCTION_STORE: StoreFunction[] = [
  {
    name: 'hash',
    title: 'Hash Calculator',
    description: '计算 MD5/SHA1/SHA256 哈希值',
    image: 'ghcr.io/mcp-hermes/hash:latest',
    category: 'Security',
    language: 'go1.21',
    tags: ['hash', 'crypto', 'security'],
    repository: 'https://github.com/mcp-hermes/hash-fn',
    env: {},
    official: false,
  },
  {
    name: 'json-formatter',
    title: 'JSON Formatter',
    description: 'JSON 格式化与验证工具',
    image: 'ghcr.io/mcp-hermes/json-formatter:latest',
    category: 'Utility',
    language: 'node20',
    tags: ['json', 'format', 'validate'],
    repository: 'https://github.com/mcp-hermes/json-formatter',
    env: {},
    official: false,
  },
  {
    name: 'csv-transform',
    title: 'CSV Transformer',
    description: 'CSV 数据转换与转换管线',
    image: 'ghcr.io/mcp-hermes/csv-transform:latest',
    category: 'Data',
    language: 'python3.11',
    tags: ['csv', 'etl', 'transform'],
    repository: 'https://github.com/mcp-hermes/csv-transform',
    env: {},
    official: false,
  },
  {
    name: 'image-resize',
    title: 'Image Resize',
    description: '图片缩放与裁剪 (sharp/ImageMagick)',
    image: 'ghcr.io/mcp-hermes/image-resize:latest',
    category: 'Data',
    language: 'node20',
    tags: ['image', 'resize', 'sharp'],
    repository: 'https://github.com/mcp-hermes/image-resize',
    env: {},
    official: false,
  },
  {
    name: 'webhook-receiver',
    title: 'Webhook Receiver',
    description: '接收 Webhook 并触发下游事件',
    image: 'ghcr.io/mcp-hermes/webhook-receiver:latest',
    category: 'HTTP',
    language: 'python3.11',
    tags: ['webhook', 'event', 'http'],
    repository: 'https://github.com/mcp-hermes/webhook-receiver',
    env: {},
    official: false,
  },
  {
    name: 'markdown-render',
    title: 'Markdown Renderer',
    description: 'Markdown 转 HTML 渲染器',
    image: 'ghcr.io/mcp-hermes/markdown-render:latest',
    category: 'Utility',
    language: 'node20',
    tags: ['markdown', 'html', 'render'],
    repository: 'https://github.com/mcp-hermes/markdown-render',
    env: {},
    official: false,
  },
  {
    name: 'jwt-verify',
    title: 'JWT Verifier',
    description: 'JWT Token 验证与解码',
    image: 'ghcr.io/mcp-hermes/jwt-verify:latest',
    category: 'Security',
    language: 'go1.21',
    tags: ['jwt', 'auth', 'security'],
    repository: 'https://github.com/mcp-hermes/jwt-verify',
    env: {},
    official: false,
  },
  {
    name: 'qrcode-generator',
    title: 'QR Code Generator',
    description: '生成 QR 码图片',
    image: 'ghcr.io/mcp-hermes/qrcode:latest',
    category: 'Utility',
    language: 'python3.10',
    tags: ['qrcode', 'image', 'generator'],
    repository: 'https://github.com/mcp-hermes/qrcode',
    env: {},
    official: false,
  },
  {
    name: 'cron-scheduler',
    title: 'Cron Scheduler',
    description: 'Cron 定时任务调度器',
    image: 'ghcr.io/mcp-hermes/cron-scheduler:latest',
    category: 'Utility',
    language: 'go1.21',
    tags: ['cron', 'scheduler', 'task'],
    repository: 'https://github.com/mcp-hermes/cron-scheduler',
    env: {},
    official: false,
  },
  {
    name: 'http-to-kafka',
    title: 'HTTP to Kafka Bridge',
    description: 'HTTP 请求桥接到 Kafka Topic',
    image: 'ghcr.io/mcp-hermes/http-to-kafka:latest',
    category: 'Data',
    language: 'java17',
    tags: ['http', 'kafka', 'bridge'],
    repository: 'https://github.com/mcp-hermes/http-to-kafka',
    env: {
      'KAFKA_BROKERS': 'kafka:9092',
    },
    official: false,
  },
];

/** Store 分类列表 */
export const STORE_CATEGORIES: StoreFunction['category'][] = [
  'AI/ML', 'Data', 'HTTP', 'Storage', 'Utility', 'Security',
];

/** 编程语言列表 */
export const STORE_LANGUAGES = [
  'node18', 'node20', 'python3.10', 'python3.11', 'go1.21', 'java17', 'ruby3', 'rust', 'php8', 'dockerfile',
] as const;
