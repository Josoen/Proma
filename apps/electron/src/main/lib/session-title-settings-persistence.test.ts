import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'

describe('标题模型设置持久化', () => {
  test('Given isolated settings When saving, rejecting invalid data and failing atomic writes Then preserves existing settings', () => {
    const root = mkdtempSync(join(tmpdir(), 'proma-title-settings-'))
    const settingsPath = join(root, 'settings.json')
    const script = `
      import { mock } from 'bun:test';
      import { mkdirSync, readFileSync, existsSync } from 'node:fs';
      import { strict as assert } from 'node:assert';
      mock.module('./apps/electron/src/main/lib/config-paths', () => ({ getSettingsPath: () => ${JSON.stringify(settingsPath)} }));
      const { getSettings, updateSettings } = await import('./apps/electron/src/main/lib/settings-service');
      assert.equal(getSettings().sessionTitle, undefined);
      updateSettings({ themeMode: 'light', agentModelId: 'foreground', sessionTitle: { model: { channelId: 'title', modelId: 'cheap' } } });
      updateSettings({ notificationsEnabled: false });
      assert.equal(getSettings().themeMode, 'light');
      assert.equal(getSettings().agentModelId, 'foreground');
      assert.deepEqual(getSettings().sessionTitle, { model: { channelId: 'title', modelId: 'cheap' } });
      assert.ok(existsSync(${JSON.stringify(settingsPath + '.bak')}));
      const before = readFileSync(${JSON.stringify(settingsPath)}, 'utf8');
      assert.throws(() => updateSettings({ sessionTitle: { model: { channelId: 'partial' } } }));
      assert.equal(readFileSync(${JSON.stringify(settingsPath)}, 'utf8'), before);
      mkdirSync(${JSON.stringify(settingsPath + '.tmp')});
      assert.throws(() => updateSettings({ sessionTitle: {} }), /写入应用设置失败/);
      assert.equal(readFileSync(${JSON.stringify(settingsPath)}, 'utf8'), before);
      assert.equal(getSettings().notificationsEnabled, false);
    `
    try {
      const result = Bun.spawnSync([process.execPath, '-e', script], { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' })
      expect({ exitCode: result.exitCode, stderr: result.stderr.toString() }).toMatchObject({ exitCode: 0 })
    } finally {
      const target = resolve(root)
      if (!target.startsWith(resolve(tmpdir()) + sep) || !target.includes('proma-title-settings-')) throw new Error('拒绝清理测试目录以外的路径')
      rmSync(target, { recursive: true, force: true })
    }
  })
})
