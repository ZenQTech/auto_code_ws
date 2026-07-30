/**
 * # ============================================================
 * # RemoteControlPanel 组件测试 (v1.0.0 Cycle 27 G27-06)
 * # ============================================================
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
// @vitest-environment happy-dom
import { RemoteControlPanel } from './RemoteControlPanel';
import { RemoteControlEngine } from '../utils/remoteControlEngine';

describe('RemoteControlPanel', () => {
  let engine: RemoteControlEngine;

  beforeEach(() => {
    engine = new RemoteControlEngine({ persist: false, latencyMinMs: 1, latencyMaxMs: 2 });
    vi.spyOn(window, 'alert').mockImplementation(() => {});
  });

  it('打开时显示面板', () => {
    render(<RemoteControlPanel isOpen={true} onClose={() => {}} engine={engine} />);
    expect(screen.getByTestId('remote-control-panel')).toBeTruthy();
    expect(screen.getByText(/远程控制/)).toBeTruthy();
  });

  it('关闭时不渲染', () => {
    const { container } = render(<RemoteControlPanel isOpen={false} onClose={() => {}} engine={engine} />);
    expect(container.firstChild).toBeNull();
  });

  it('显示 4 个 Tab', () => {
    render(<RemoteControlPanel isOpen={true} onClose={() => {}} engine={engine} />);
    expect(screen.getByTestId('tab-devices')).toBeTruthy();
    expect(screen.getByTestId('tab-pairing')).toBeTruthy();
    expect(screen.getByTestId('tab-handoff')).toBeTruthy();
    expect(screen.getByTestId('tab-commands')).toBeTruthy();
  });

  it('默认显示设备视图', () => {
    render(<RemoteControlPanel isOpen={true} onClose={() => {}} engine={engine} />);
    expect(screen.getByTestId('devices-view')).toBeTruthy();
  });

  it('切换到配对视图', async () => {
    render(<RemoteControlPanel isOpen={true} onClose={() => {}} engine={engine} />);
    fireEvent.click(screen.getByTestId('tab-pairing'));
    await waitFor(() => {
      expect(screen.getByTestId('pairing-view')).toBeTruthy();
    });
  });

  it('启动配对生成 QR 码', async () => {
    render(<RemoteControlPanel isOpen={true} onClose={() => {}} engine={engine} />);
    fireEvent.click(screen.getByTestId('tab-pairing'));
    await waitFor(() => {
      expect(screen.getByTestId('pairing-view')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('start-pairing-button'));
    await waitFor(() => {
      expect(screen.getByTestId('qr-mock')).toBeTruthy();
      expect(screen.getByTestId('short-code')).toBeTruthy();
    });
  });

  it('模拟扫描', async () => {
    render(<RemoteControlPanel isOpen={true} onClose={() => {}} engine={engine} />);
    fireEvent.click(screen.getByTestId('tab-pairing'));
    fireEvent.click(screen.getByTestId('start-pairing-button'));
    await waitFor(() => {
      expect(screen.getByTestId('qr-mock')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('simulate-scan-button'));
    // 验证：扫码后 QR 仍显示，但状态文本会变化
    await waitFor(() => {
      expect(screen.getByTestId('qr-mock')).toBeTruthy();
    });
  });

  it('取消配对', async () => {
    render(<RemoteControlPanel isOpen={true} onClose={() => {}} engine={engine} />);
    fireEvent.click(screen.getByTestId('tab-pairing'));
    fireEvent.click(screen.getByTestId('start-pairing-button'));
    await waitFor(() => {
      expect(screen.getByTestId('qr-mock')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('cancel-pairing-button'));
    await waitFor(() => {
      expect(screen.queryByTestId('qr-mock')).toBeNull();
    });
  });

  it('模拟完成配对', async () => {
    render(<RemoteControlPanel isOpen={true} onClose={() => {}} engine={engine} />);
    fireEvent.click(screen.getByTestId('tab-pairing'));
    fireEvent.click(screen.getByTestId('start-pairing-button'));
    await waitFor(() => {
      expect(screen.getByTestId('qr-mock')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('simulate-complete-button'));
    await waitFor(() => {
      // 完成后视图会切回 pairing 但 QR 应消失
      expect(screen.queryByTestId('qr-mock')).toBeNull();
    });
  });

  it('切换到迁移视图', async () => {
    render(<RemoteControlPanel isOpen={true} onClose={() => {}} engine={engine} />);
    fireEvent.click(screen.getByTestId('tab-handoff'));
    await waitFor(() => {
      expect(screen.getByTestId('handoff-view')).toBeTruthy();
    });
  });

  it('切换到命令视图', async () => {
    render(<RemoteControlPanel isOpen={true} onClose={() => {}} engine={engine} />);
    fireEvent.click(screen.getByTestId('tab-commands'));
    await waitFor(() => {
      expect(screen.getByTestId('commands-view')).toBeTruthy();
    });
  });

  it('关闭按钮回调', () => {
    const onClose = vi.fn();
    render(<RemoteControlPanel isOpen={true} onClose={onClose} engine={engine} />);
    fireEvent.click(screen.getByLabelText('关闭'));
    expect(onClose).toHaveBeenCalled();
  });

  it('显示统计信息', () => {
    render(<RemoteControlPanel isOpen={true} onClose={() => {}} engine={engine} />);
    // 统计信息包括 "设备 X · 活跃 Y"
    const header = screen.getByText(/设备 \d+ · 活跃/);
    expect(header).toBeTruthy();
  });
});
