import { expect, test } from 'bun:test'

test('Given typed preload When 设置全局置顶与项目归档 Then 传递明确意图及 partial 结果', () => {
  const script = `
    import { mock } from 'bun:test'; import { strict as assert } from 'node:assert';
    let api; const calls = [];
    const result = { status: 'partial', affectedSessionIds: ['s'], workspace: { id: 'p' }, error: '重试' };
    mock.module('electron', () => ({
      contextBridge: { exposeInMainWorld: (_key, value) => { api = value; } },
      ipcRenderer: { invoke: async (...args) => { calls.push(args); return result; }, on: () => {}, send: () => {} },
      webUtils: {},
    }));
    await import('./apps/electron/src/preload/index');
    await api.setAgentSessionGlobalPinned({ sessionId: 's', globalPinned: true });
    assert.deepEqual(calls.pop(), ['agent:set-global-pin', { sessionId: 's', globalPinned: true }]);
    assert.equal(await api.setAgentWorkspaceArchived({ workspaceId: 'p', archived: false }), result);
    assert.deepEqual(calls.pop(), ['agent:set-workspace-archived', { workspaceId: 'p', archived: false }]);
  `
  const result = Bun.spawnSync([process.execPath, '-e', script], { stdout: 'pipe', stderr: 'pipe' })
  expect({ code: result.exitCode, error: result.stderr.toString() }).toMatchObject({ code: 0 })
})
