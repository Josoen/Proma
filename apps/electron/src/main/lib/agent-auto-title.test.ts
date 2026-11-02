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

      const settings = await import('./apps/electron/src/main/lib/settings-service');
      spyOn(settings, 'getSettings').mockReturnValue({});
      const history = spyOn(manager, 'getAgentSessionSDKMessages').mockReturnValue([
        { type: 'user', isSynthetic: true, message: { content: [{ type: 'text', text: '合成指令' }] } },
        { type: 'user', parent_tool_use_id: 'tool', message: { content: [{ type: 'text', text: '工具文本' }] } },
        { type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'text', text: '首条用户原文' }] } },
        { type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'text', text: '第二条用户消息' }] } },
      ]);
      const emit = spyOn(orchestrator.eventBus, 'emit');
      reset();
      metas.set('manual', { title: '旧标题', channelId: 'saved-channel', modelId: 'saved-model', archived: true, explorationParentSessionId: 'parent' });
      orchestrator.generateTitle = mock(async () => '重新生成的标题');
      const regenerated = await orchestrator.regenerateTitle('manual');
      assert.equal(regenerated.title, '重新生成的标题');
      assert.equal(regenerated.archived, true);
      assert.ok(regenerated.explorationTitleInitializedAt);
      assert.deepEqual(orchestrator.generateTitle.mock.calls[0], [{ userMessage: '首条用户原文', channelId: 'saved-channel', modelId: 'saved-model' }, undefined, false]);
      assert.equal(emit.mock.calls.length, 1);
      assert.equal(emit.mock.calls[0][1].event.type, 'title_updated');

      reset(); history.mockReturnValue([]);
      metas.set('empty', { title: '空会话' });
      await assert.rejects(orchestrator.regenerateTitle('empty'), /没有用户文本/);
      assert.equal(write.mock.calls.length, 0);
      history.mockReturnValue([{ type: 'user', message: { content: [{ type: 'text', text: '原文' }] } }]);

      reset(); metas.set('manual-race', { title: '旧标题' });
      const manual = Promise.withResolvers();
      orchestrator.generateTitle = mock(() => manual.promise);
      const manualRun = orchestrator.regenerateTitle('manual-race');
      await assert.rejects(orchestrator.regenerateTitle('manual-race'), /正在生成标题/);
      await run('manual-race');
      assert.equal(orchestrator.generateTitle.mock.calls.length, 1);
      metas.set('manual-race', { title: '手动新名称' });
      manual.resolve('迟到结果');
      await assert.rejects(manualRun, /已保留最新名称/);
      assert.equal(write.mock.calls.length, 0);

      reset(); metas.set('manual-fail', { title: '保留原标题' });
      orchestrator.generateTitle = mock(async () => null);
      await assert.rejects(orchestrator.regenerateTitle('manual-fail'), /未能生成标题/);
      assert.equal(metas.get('manual-fail').title, '保留原标题');
      assert.equal(write.mock.calls.length, 0);
      orchestrator.generateTitle = mock(async () => '重试成功');
      assert.equal((await orchestrator.regenerateTitle('manual-fail')).title, '重试成功');

      reset(); metas.set('manual-delete', { title: '旧标题' });
      const manualDeleted = Promise.withResolvers();
      orchestrator.generateTitle = mock(() => manualDeleted.promise);
      const deletedRun = orchestrator.regenerateTitle('manual-delete');
      deleting.add('manual-delete'); metas.delete('manual-delete');
      manualDeleted.resolve('迟到结果');
      await assert.rejects(deletedRun, /会话已删除/);
      assert.equal(write.mock.calls.length, 0);
      console.log('AUTO_TITLE_RACE_OK');
    `
    const result = Bun.spawnSync([process.execPath, '-e', script], { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' })
    expect({ exitCode: result.exitCode, stderr: result.stderr.toString() }).toMatchObject({ exitCode: 0 })
    expect(result.stdout.toString()).toContain('AUTO_TITLE_RACE_OK')
  })
})
