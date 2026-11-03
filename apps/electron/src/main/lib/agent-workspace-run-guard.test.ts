import { expect, test } from 'bun:test'

test('Given headless 异步预检或归档会话 When 归档或伪造项目启动 Then 拒绝绕过且释放占用', () => {
  const script = `
    import { mock } from 'bun:test'; import { strict as assert } from 'node:assert';
    import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
    import { join } from 'node:path'; import * as os from 'node:os';
    const home = mkdtempSync(join(os.tmpdir(), 'proma-run-guard-'));
    mock.module('node:os', () => ({ ...os, homedir: () => home }));
    const empty = {};
    mock.module('electron', () => ({
      app: { isPackaged: true, getPath: () => home, getAppPath: () => process.cwd(), on: () => {} },
      BrowserWindow: class { static getAllWindows() { return []; } }, WebContentsView: class {},
      safeStorage: empty, screen: empty, shell: empty, dialog: empty, session: empty,
      nativeTheme: empty, ipcMain: empty, clipboard: empty, nativeImage: empty, net: empty,
      powerMonitor: empty, powerSaveBlocker: empty, utilityProcess: empty, MessageChannelMain: class {},
      globalShortcut: empty, systemPreferences: empty, Menu: empty, Tray: class {},
    }));
    process.env.PROMA_AGENT_RUNTIME = 'in-process';
    const dir = join(home, '.proma'); mkdirSync(dir);
    writeFileSync(join(dir, 'agent-workspaces.json'), JSON.stringify({ version: 2, workspaces: [
      { id: 'p', name: '项目', slug: 'p', createdAt: 1, updatedAt: 1 },
      { id: 'archived', name: '历史', slug: 'history', archived: true, createdAt: 1, updatedAt: 1 },
    ] }));
    writeFileSync(join(dir, 'agent-sessions.json'), JSON.stringify({ version: 2, openAIThinkingDefaultEnabledMigrationCompleted: true, sessions: [
      { id: 's', title: 's', workspaceId: 'p', createdAt: 1, updatedAt: 1 },
      { id: 'history', title: 'history', workspaceId: 'archived', archived: true, createdAt: 1, updatedAt: 1 },
    ] }));
    const service = await import('./apps/electron/src/main/lib/agent-service');
    const { setAgentProjectArchived } = await import('./apps/electron/src/main/lib/agent-project-archive');
    let completed = 0; const errors = [];
    const callbacks = { onError: e => errors.push(e), onComplete: () => completed++, onTitleUpdated: () => {} };
    const run = service.runAgentHeadless({ sessionId: 's', channelId: 'missing', userMessage: '测试预检' }, callbacks);
    assert.equal(service.isAgentSessionBusy('s'), true);
    assert.throws(() => setAgentProjectArchived({ workspaceId: 'p', archived: true }), /停止/);
    await run;
    assert.equal(service.isAgentSessionBusy('s'), false);
    assert.ok(completed > 0);
    await service.runAgentHeadless({ sessionId: 'history', workspaceId: 'p', channelId: 'missing', userMessage: '不可写入' }, callbacks);
    assert.ok(errors.some(e => e.includes('先恢复项目')));
    assert.equal(existsSync(join(dir, 'agent-sessions', 'history.jsonl')), false);
    rmSync(home, { recursive: true, force: true }); console.log('RUN_GUARD_OK');
  `
  const result = Bun.spawnSync([process.execPath, '-e', script], { stdout: 'pipe', stderr: 'pipe' })
  expect({ code: result.exitCode, error: result.stderr.toString() }).toMatchObject({ code: 0 })
  expect(result.stdout.toString()).toContain('RUN_GUARD_OK')
})
