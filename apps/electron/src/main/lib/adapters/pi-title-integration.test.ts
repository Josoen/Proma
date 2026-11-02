import { describe, expect, test } from 'bun:test'

describe('标题模型本地 HTTP 集成', () => {
  test('Given real Pi transport and a local SSE endpoint When generating with independent API models Then uses off, scoped auth and local fallback without retries', () => {
    const script = String.raw`
      import { mock } from 'bun:test';
      import { strict as assert } from 'node:assert';
      for (const key of Object.keys(process.env)) {
        if (['http_proxy', 'https_proxy', 'all_proxy'].includes(key.toLowerCase())) delete process.env[key];
      }
      const resolvedChannels = [];
      mock.module('./apps/electron/src/main/lib/channel-manager', () => ({
        resolveChannelRuntimeApiKey: async id => { resolvedChannels.push(id); return 'local-test-key'; },
      }));
      mock.module('./apps/electron/src/main/lib/proxy-settings-service', () => ({ getEffectiveProxyUrl: async () => undefined }));
      mock.module('./apps/electron/src/main/lib/models-dev-catalog', () => ({ lookupModelsDevModel: async () => null }));
      const { generatePiTitle } = await import('./apps/electron/src/main/lib/adapters/pi-title-generator');
      const { generateSessionTitle } = await import('./apps/electron/src/main/lib/session-title-service');
      const requests = [];
      const server = Bun.serve({
        hostname: '127.0.0.1', port: 0,
        async fetch(request) {
          const body = await request.json();
          requests.push({ body, url: request.url, auth: request.headers.get('authorization') });
          if (request.url.includes('/fail/')) return Response.json({ error: 'rate limited' }, { status: 429 });
          const chunk = delta => JSON.stringify({ id: 'test-title', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, ...delta }] });
          const data = 'data: ' + chunk({ delta: { role: 'assistant', content: '本地模拟标题' }, finish_reason: null }) + '\n\n'
            + 'data: ' + chunk({ delta: {}, finish_reason: 'stop' }) + '\n\ndata: [DONE]\n\n';
          return new Response(data, { headers: { 'Content-Type': 'text/event-stream' } });
        },
      });
      const channel = (provider, id, prefix = '') => ({
        id: provider, name: provider, provider, enabled: true, apiKey: 'encrypted', createdAt: 0, updatedAt: 0,
        baseUrl: 'http://127.0.0.1:' + server.port + prefix + '/v1',
        models: [{ id, name: id, enabled: true, thinkingLevels: ['off', 'high'] }],
      });
      try {
        const openai = channel('openai', 'gpt-6-sol');
        const qwen = channel('qwen', 'qwen-title-test');
        assert.equal(await generatePiTitle(openai, 'gpt-6-sol', '固定 Prompt'), '本地模拟标题');
        assert.equal(await generatePiTitle(qwen, 'qwen-title-test', '固定 Prompt'), '本地模拟标题');
        assert.equal(requests.length, 2);
        assert.equal(requests[0].body.reasoning_effort, 'none');
        assert.equal(requests[0].body.max_completion_tokens, 256);
        assert.equal(requests[1].body.enable_thinking, false);
        assert.ok(requests.every(item => item.auth === 'Bearer local-test-key' && item.url.endsWith('/v1/chat/completions')));
        assert.deepEqual(resolvedChannels, ['openai', 'qwen']);
        const failed = channel('openai', 'gpt-6-sol', '/fail');
        const title = await generateSessionTitle(
          { userMessage: '# 修复本地集成', channelId: 'foreground', modelId: 'unusable' },
          { model: { channelId: 'openai', modelId: 'gpt-6-sol' } },
          { getChannel: () => failed, complete: generatePiTitle },
        );
        assert.equal(title, '修复本地集成');
        assert.equal(requests.length, 3);
        console.log('LOCAL_TITLE_SSE_OK');
      } finally { server.stop(true); }
    `
    const result = Bun.spawnSync([process.execPath, '-e', script], { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' })
    expect({ exitCode: result.exitCode, stderr: result.stderr.toString() }).toMatchObject({ exitCode: 0 })
    expect(result.stdout.toString()).toContain('LOCAL_TITLE_SSE_OK')
  })
})
