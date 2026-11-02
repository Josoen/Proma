import { describe, expect, test } from 'bun:test'

describe('Agent 自动标题并发与写回', () => {
  test('Given real orchestrator methods When titles race with renames, deletion and duplicate triggers Then only eligible metadata is updated', () => {
    // 独立进程隔离 Electron 与元数据替身，不污染其他测试或访问用户会话。
    const script = `
      import { mock, spyOn } from 'bun:test';
      import { strict as assert } from 'node:assert';
      const empty = {};
      mock.module('electron', () => ({
        app: { isPackaged: true, getPath: () => 'unused-test-path', getAppPath: () => process.cwd(), on: () => {} },
        safeStorage: empty, screen: empty, shell: empty, dialog: empty, BrowserWindow: class {}, WebContentsView: class {},
        session: empty, nativeTheme: empty, ipcMain: empty, clipboard: empty, nativeImage: empty, net: empty,
        powerMonitor: empty, powerSaveBlocker: empty, utilityProcess: empty, MessageChannelMain: class {},
        globalShortcut: empty, systemPreferences: empty, Menu: empty, Tray: class {},
      }));
      process.env.PROMA_AGENT_RUNTIME = 'in-process';
      await import('./apps/electron/src/main/lib/agent-service');
      const { AgentOrchestrator } = await import('./apps/electron/src/main/lib/agent-orchestrator');
      const { AgentEventBus } = await import('./apps/electron/src/main/lib/agent-event-bus');
      const manager = await import('./apps/electron/src/main/lib/agent-session-manager');
      const metas = new Map();
      const deleting = new Set();
      spyOn(manager, 'getAgentSessionMeta').mockImplementation(id => metas.get(id));
      spyOn(manager, 'isAgentSessionDeleting').mockImplementation(id => deleting.has(id));
      const write = spyOn(manager, 'updateAgentSessionMeta').mockImplementation((id, changes) => {
        const next = { ...metas.get(id), ...changes }; metas.set(id, next); return next;
      });
      const orchestrator = new AgentOrchestrator({}, new AgentEventBus());
      const updated = mock(() => {});
      const callbacks = { onTitleUpdated: updated };
      const run = id => orchestrator.autoGenerateTitle(id, '用户原文', 'channel', 'model', callbacks);
      const reset = () => { metas.clear(); deleting.clear(); write.mockClear(); updated.mockClear(); };

      metas.set('named', { title: '用户命名' });
      orchestrator.generateTitle = mock(async () => '不应覆盖');
      await run('named');
      assert.equal(orchestrator.generateTitle.mock.calls.length, 0);
      assert.equal(write.mock.calls.length, 0);

      reset();
      metas.set('race', { title: '新 Agent 会话' });
      const renamed = Promise.withResolvers();
      orchestrator.generateTitle = mock(() => renamed.promise);
      const running = run('race');
      await run('race');
      assert.equal(orchestrator.generateTitle.mock.calls.length, 1);
      metas.set('race', { title: '请求期间手动命名' });
      renamed.resolve('模型标题'); await running;
      assert.equal(metas.get('race').title, '请求期间手动命名');
      assert.equal(write.mock.calls.length, 0);
      assert.equal(updated.mock.calls.length, 0);

      reset();
      metas.set('deleted', { title: '新 Agent 会话' });
      const removed = Promise.withResolvers();
      orchestrator.generateTitle = mock(() => removed.promise);
      const pending = run('deleted');
      deleting.add('deleted'); metas.delete('deleted');
      removed.resolve('迟到标题'); await pending;
      assert.equal(write.mock.calls.length, 0);
      assert.equal(updated.mock.calls.length, 0);

      reset();
      metas.set('one', { title: '新 Agent 会话' }); metas.set('two', { title: '新 Agent 会话' });
      const concurrent = Promise.withResolvers();
      orchestrator.generateTitle = mock(() => concurrent.promise);
      const one = run('one'); const two = run('two');
      assert.equal(orchestrator.generateTitle.mock.calls.length, 2);
      concurrent.resolve('最终标题'); await Promise.all([one, two]);
      assert.equal(write.mock.calls.length, 2); assert.equal(updated.mock.calls.length, 2);
      await run('one'); assert.equal(orchestrator.generateTitle.mock.calls.length, 2);

      reset();
      metas.set('branch', { title: '原标题 (fork)', explorationParentSessionId: 'parent' });
      orchestrator.generateTitle = mock(async () => '分支标题');
      await run('branch'); await run('branch');
      assert.equal(orchestrator.generateTitle.mock.calls.length, 1);
      assert.ok(metas.get('branch').explorationTitleInitializedAt);
      assert.equal(metas.get('branch').title, '分支标题');
      assert.equal(updated.mock.calls.length, 1);

      reset();
      metas.set('retry', { title: '新 Agent 会话' });
      orchestrator.generateTitle = mock(async () => { throw new Error('测试异常'); });
      await run('retry');
      orchestrator.generateTitle = mock(async () => '清理后可命名');
      await run('retry');
      assert.equal(metas.get('retry').title, '清理后可命名');

      console.log('AUTO_TITLE_RACE_OK');
    `
    const result = Bun.spawnSync([process.execPath, '-e', script], { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' })
    expect({ exitCode: result.exitCode, stderr: result.stderr.toString() }).toMatchObject({ exitCode: 0 })
    expect(result.stdout.toString()).toContain('AUTO_TITLE_RACE_OK')
  })
})
