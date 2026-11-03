import { expect, test } from 'bun:test'

test('Given 周期与一次性任务 When 归档跨重启后恢复 Then 不补跑、不改启用偏好或刷历史', () => {
  const script = `
    import { mock } from 'bun:test'; import { strict as assert } from 'node:assert';
    import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
    import { join } from 'node:path'; import * as os from 'node:os';
    const home = mkdtempSync(join(os.tmpdir(), 'proma-archive-automation-'));
    mock.module('node:os', () => ({ ...os, homedir: () => home }));
    mock.module('electron', () => ({ app: { isPackaged: true } }));
    const dir = join(home, '.proma'); mkdirSync(dir);
    const base = { name: '任务', prompt: '工作', active: true, workspaceId: 'a', channelId: 'c', createdAt: 1, updatedAt: 1, nextRunAt: 1, intervalMinutes: 10, runHistory: [], runCount: 2, permissionMode: 'bypassPermissions' };
    writeFileSync(join(dir, 'automations.json'), JSON.stringify({ version: 4, automations: [
      ...['interval','daily','weekly','monthly'].map((scheduleType, i) => ({ ...base, id: String(i), scheduleType, timeOfDay: '09:00', dayOfWeek: 1, dayOfMonth: 1 })),
      { ...base, id: 'once', scheduleType: 'once', scheduledAt: 1 },
      { ...base, id: 'paused', scheduleType: 'interval', active: false },
    ] }));
    const manager = await import('./apps/electron/src/main/lib/automation-manager');
    const now = Date.now(); manager.deferArchivedProjectAutomations('a', now);
    for (const task of manager.listAutomations().filter(a => ['0','1','2','3'].includes(a.id))) {
      assert.ok(task.nextRunAt > now); assert.equal(task.runCount, 2); assert.equal(task.active, true);
    }
    const once = manager.getAutomation('once');
    assert.equal(manager.hasMissedArchivedOnce(once), true);
    manager.deferArchivedProjectAutomations('a', now + 1);
    assert.equal(manager.getAutomation('once').runHistory.length, 1);
    assert.equal(manager.getAutomation('once').runCount, 2);
    assert.equal(manager.getAutomation('once').active, true);
    assert.equal(manager.getAutomation('paused').nextRunAt, 1);
    manager.updateAutomation({ id: 'once', scheduledAt: now + 3600000 });
    assert.equal(manager.hasMissedArchivedOnce(manager.getAutomation('once')), false);
    rmSync(home, { recursive: true, force: true }); console.log('AUTOMATION_ARCHIVE_OK');
  `
  const result = Bun.spawnSync([process.execPath, '-e', script], { stdout: 'pipe', stderr: 'pipe' })
  expect({ code: result.exitCode, error: result.stderr.toString() }).toMatchObject({ code: 0 })
  expect(result.stdout.toString()).toContain('AUTOMATION_ARCHIVE_OK')
})
