import { expect, test } from 'bun:test'

test('Given 完整项目与会话 When 归档、恢复、忙碌或写入失败 Then 保留数据并返回真实结果', () => {
  // 独立进程隔离 Electron/服务替身，实际执行管理器与 safe-file，不接触用户数据。
  const script = `
    import { mock, spyOn } from 'bun:test';
    import { strict as assert } from 'node:assert';
    import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
    import { join } from 'node:path';
    import * as os from 'node:os';
    const home = mkdtempSync(join(os.tmpdir(), 'proma-archive-'));
    mock.module('node:os', () => ({ ...os, homedir: () => home }));
    mock.module('electron', () => ({ app: { isPackaged: true }, BrowserWindow: class {}, safeStorage: {}, shell: {}, dialog: {}, clipboard: {}, nativeImage: {}, nativeTheme: {}, screen: {}, powerMonitor: {}, powerSaveBlocker: {} }));
    let busy = false;
    mock.module('./apps/electron/src/main/lib/agent-service', () => ({ isAgentSessionBusy: () => busy }));
    const config = join(home, '.proma'); mkdirSync(config);
    const projects = [
      { id: 'default', slug: 'default', name: '默认', createdAt: 1, updatedAt: 1 },
      { id: 'a', slug: 'a', name: 'A', createdAt: 1, updatedAt: 1 },
      { id: 'x', slug: 'x', name: 'X', archived: true, createdAt: 1, updatedAt: 1 },
      { id: 'b', slug: 'b', name: 'B', createdAt: 1, updatedAt: 1 },
    ];
    writeFileSync(join(config, 'agent-workspaces.json'), JSON.stringify({ version: 2, workspaces: projects }));
    writeFileSync(join(config, 'agent-sessions.json'), JSON.stringify({ version: 2, openAIThinkingDefaultEnabledMigrationCompleted: true, sessions: [
      { id: 's', title: 's', workspaceId: 'a', pinned: true, globalPinned: true, isDraft: true, createdAt: 1, updatedAt: 1 },
      { id: 'other', title: 'other', workspaceId: 'b', createdAt: 1, updatedAt: 1 },
    ] }));
    mkdirSync(join(config, 'agent-sessions'));
    const body = join(config, 'agent-sessions', 's.jsonl'); writeFileSync(body, 'preserved');
    const { setAgentProjectArchived } = await import('./apps/electron/src/main/lib/agent-project-archive');
    const sessions = await import('./apps/electron/src/main/lib/agent-session-manager');
    const workspaces = await import('./apps/electron/src/main/lib/agent-workspace-manager');
    assert.throws(() => setAgentProjectArchived({ workspaceId: 'default', archived: true }), /默认/);
    assert.throws(() => setAgentProjectArchived({ workspaceId: 'a', archived: 'true' }), /参数/);
    busy = true;
    assert.throws(() => setAgentProjectArchived({ workspaceId: 'a', archived: true }), /停止/);
    assert.equal(sessions.getAgentSessionMeta('s').archived, undefined);
    busy = false;
    const result = setAgentProjectArchived({ workspaceId: 'a', archived: true });
    assert.equal(result.status, 'success'); assert.deepEqual(result.affectedSessionIds, ['s']);
    assert.equal(sessions.getAgentSessionMeta('s').isDraft, false);
    assert.equal(sessions.getAgentSessionMeta('other').archived, undefined);
    assert.equal(readFileSync(body, 'utf8'), 'preserved');
    assert.equal(sessions.isAgentSessionDeleting('s'), false);
    const time = sessions.getAgentSessionMeta('s').updatedAt;
    setAgentProjectArchived({ workspaceId: 'a', archived: true });
    assert.equal(sessions.getAgentSessionMeta('s').updatedAt, time);
    setAgentProjectArchived({ workspaceId: 'a', archived: false });
    assert.equal(sessions.getAgentSessionMeta('s').archived, true);
    sessions.updateAgentSessionMeta('s', { archived: false });
    const safe = await import('./apps/electron/src/main/lib/safe-file');
    const originalWrite = safe.writeJsonFileAtomic;
    const failedSave = spyOn(safe, 'writeJsonFileAtomic').mockImplementation((path, data) => {
      if (path.endsWith('agent-sessions.json')) throw new Error('disk');
      return originalWrite(path, data);
    });
    assert.throws(() => setAgentProjectArchived({ workspaceId: 'a', archived: true }));
    assert.equal(sessions.getAgentSessionMeta('s').archived, false);
    failedSave.mockRestore();
    const write = spyOn(workspaces, 'setAgentWorkspaceArchived').mockImplementation(() => { throw new Error('disk'); });
    assert.equal(setAgentProjectArchived({ workspaceId: 'a', archived: true }).status, 'partial');
    write.mockRestore();
    setAgentProjectArchived({ workspaceId: 'a', archived: true });
    const oldSessions = sessions.listAgentSessions().map(s => ({ ...s, archived: true, updatedAt: 1 }));
    originalWrite(join(config, 'agent-sessions.json'), { version: 2, openAIThinkingDefaultEnabledMigrationCompleted: true, sessions: oldSessions });
    const otherBody = join(config, 'agent-sessions', 'other.jsonl'); writeFileSync(otherBody, 'clearable');
    const { cleanupStorage } = await import('./apps/electron/src/main/lib/storage-service');
    await cleanupStorage({ categories: ['agent-sessions'], orphansOnly: false, archivedBeforeDays: 7 });
    assert.equal(readFileSync(body, 'utf8'), 'preserved');
    assert.equal(existsSync(otherBody), false);
    setAgentProjectArchived({ workspaceId: 'a', archived: false });
    workspaces.reorderAgentWorkspaces(['b', 'a', 'default']);
    assert.deepEqual(workspaces.listAgentWorkspaces().map(w => w.id), ['b', 'a', 'x', 'default']);
    rmSync(home, { recursive: true, force: true });
    console.log('ARCHIVE_OK');
  `
  const result = Bun.spawnSync([process.execPath, '-e', script], { stdout: 'pipe', stderr: 'pipe' })
  expect({ code: result.exitCode, error: result.stderr.toString() }).toMatchObject({ code: 0 })
  expect(result.stdout.toString()).toContain('ARCHIVE_OK')
})
