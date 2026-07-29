/**
 * 乐观更新工具函数单元测试 (v6.43.0 Cycle 18 P1-3)
 */

import { describe, it, expect, vi } from 'vitest';
import {
  optimisticUpdate,
  createOptimisticExecutor,
  replaceByTempId,
  removeById,
  restoreItem,
  generateTempId,
} from './optimisticUpdate';

describe('optimisticUpdate', () => {
  describe('成功路径', () => {
    it('立即执行 optimistic，然后 await mutation', async () => {
      const order: string[] = [];
      const result = await optimisticUpdate(
        {
          optimistic: () => order.push('optimistic'),
          mutation: async () => {
            order.push('mutation-start');
            await new Promise((r) => setTimeout(r, 10));
            order.push('mutation-end');
            return { id: 'real' };
          },
          rollback: () => order.push('rollback'),
        },
        { id: 'temp' },
      );

      expect(order).toEqual(['optimistic', 'mutation-start', 'mutation-end']);
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ id: 'real' });
    });

    it('onSuccess 在 mutation 成功后调用', async () => {
      const onSuccess = vi.fn();
      await optimisticUpdate(
        {
          optimistic: vi.fn(),
          mutation: async () => ({ value: 42 }),
          rollback: vi.fn(),
          onSuccess,
        },
        { id: 'x' },
      );
      expect(onSuccess).toHaveBeenCalledWith({ value: 42 }, { id: 'x' });
    });
  });

  describe('失败路径', () => {
    it('失败时调用 rollback', async () => {
      const rollback = vi.fn();
      const onError = vi.fn();
      const result = await optimisticUpdate(
        {
          optimistic: vi.fn(),
          mutation: async () => {
            throw new Error('network error');
          },
          rollback,
          onError,
        },
        { id: 'x' },
      );

      expect(rollback).toHaveBeenCalledWith({ id: 'x' });
      expect(onError).toHaveBeenCalledWith(expect.any(Error), { id: 'x' });
      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('network error');
    });

    it('rollback 异常不覆盖原 error', async () => {
      const onError = vi.fn();
      const result = await optimisticUpdate(
        {
          optimistic: vi.fn(),
          mutation: async () => {
            throw new Error('original error');
          },
          rollback: () => {
            throw new Error('rollback error');
          },
          onError,
        },
        {},
      );

      // 报告的是原始错误
      expect(result.error?.message).toBe('original error');
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'original error' }),
        {},
      );
    });

    it('optimistic 阶段失败返回 success=false', async () => {
      const result = await optimisticUpdate(
        {
          optimistic: () => {
            throw new Error('optimistic failed');
          },
          mutation: vi.fn(),
          rollback: vi.fn(),
        },
        {},
      );
      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('optimistic failed');
    });
  });

  describe('onSettled 钩子', () => {
    it('成功时 onSettled error=null', async () => {
      const onSettled = vi.fn();
      await optimisticUpdate(
        {
          optimistic: vi.fn(),
          mutation: async () => ({}),
          rollback: vi.fn(),
          onSettled,
        },
        { id: 'x' },
      );
      expect(onSettled).toHaveBeenCalledWith({ id: 'x' }, null);
    });

    it('失败时 onSettled 接收错误', async () => {
      const onSettled = vi.fn();
      await optimisticUpdate(
        {
          optimistic: vi.fn(),
          mutation: async () => {
            throw new Error('boom');
          },
          rollback: vi.fn(),
          onSettled,
        },
        {},
      );
      expect(onSettled).toHaveBeenCalledWith({}, expect.any(Error));
    });

    it('onSettled 异常不影响主流程', async () => {
      const result = await optimisticUpdate(
        {
          optimistic: vi.fn(),
          mutation: async () => ({ ok: true }),
          rollback: vi.fn(),
          onSettled: () => {
            throw new Error('settled failed');
          },
        },
        {},
      );
      expect(result.success).toBe(true);
    });
  });
});

describe('createOptimisticExecutor', () => {
  it('返回可复用的执行器', async () => {
    const executor = createOptimisticExecutor({
      optimistic: vi.fn(),
      mutation: async (v: { n: number }) => v.n * 2,
      rollback: vi.fn(),
    });

    expect(await executor({ n: 5 })).toEqual({ success: true, data: 10 });
    expect(await executor({ n: 10 })).toEqual({ success: true, data: 20 });
  });
});

describe('工具函数', () => {
  describe('replaceByTempId', () => {
    it('用真实项替换 temp 项', () => {
      const items = [
        { id: 'temp_1', name: 'New' },
        { id: 'a', name: 'A' },
      ];
      const result = replaceByTempId(items, 'temp_1', { id: 'real_1', name: 'New' });
      expect(result).toEqual([
        { id: 'real_1', name: 'New' },
        { id: 'a', name: 'A' },
      ]);
    });

    it('未找到 tempId 时返回原数组（不修改）', () => {
      const items = [{ id: 'a', name: 'A' }];
      const result = replaceByTempId(items, 'temp_1', { id: 'real_1', name: 'New' });
      expect(result).toBe(items); // 引用相等（未修改）
    });
  });

  describe('removeById', () => {
    it('从列表中移除指定 ID', () => {
      const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
      expect(removeById(items, 'b')).toEqual([{ id: 'a' }, { id: 'c' }]);
    });
  });

  describe('restoreItem', () => {
    it('未指定 position 时添加到末尾', () => {
      const items = [{ id: 'a' }];
      expect(restoreItem(items, { id: 'b' })).toEqual([{ id: 'a' }, { id: 'b' }]);
    });

    it('指定 position 时插入到对应位置', () => {
      const items = [{ id: 'a' }, { id: 'c' }];
      expect(restoreItem(items, { id: 'b' }, 1)).toEqual([
        { id: 'a' },
        { id: 'b' },
        { id: 'c' },
      ]);
    });

    it('position 越界时添加到末尾', () => {
      const items = [{ id: 'a' }];
      expect(restoreItem(items, { id: 'b' }, 100)).toEqual([{ id: 'a' }, { id: 'b' }]);
    });
  });

  describe('generateTempId', () => {
    it('生成唯一 ID（带前缀）', () => {
      const id1 = generateTempId('item');
      const id2 = generateTempId('item');
      expect(id1).toMatch(/^item_/);
      expect(id2).toMatch(/^item_/);
      expect(id1).not.toBe(id2);
    });

    it('默认前缀为 temp', () => {
      const id = generateTempId();
      expect(id).toMatch(/^temp_/);
    });
  });
});
