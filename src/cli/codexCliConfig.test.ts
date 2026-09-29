import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readCodexCliConfig, readCodexModelCatalog, resolveCodexCliProviderApiKey } from './codexCliConfig';

test('reads an API-login custom Codex provider and resolves its relative model catalog', () => {
    const directory = mkdtempSync(join(tmpdir(), 'gcmp-codex-config-'));
    try {
        const configPath = join(directory, 'config.toml');
        const catalogPath = join(directory, 'cpa-gui-model-catalog.json');
        writeFileSync(
            configPath,
            [
                'forced_login_method = "api"',
                'model_provider = "cpa-gui"',
                'model_catalog_json = "cpa-gui-model-catalog.json"',
                '',
                '[model_providers.cpa-gui]',
                'name = "EasyCLIProxyAPI"',
                'base_url = "http://127.0.0.1:15867/v1/"',
                'wire_api = "responses"'
            ].join('\n')
        );
        writeFileSync(catalogPath, '{"models":[]}');

        const config = readCodexCliConfig(configPath);
        assert.ok(config);
        assert.equal(config.forcedLoginMethod, 'api');
        assert.equal(config.provider.id, 'cpa-gui');
        assert.equal(config.provider.name, 'EasyCLIProxyAPI');
        assert.equal(config.provider.baseUrl, 'http://127.0.0.1:15867/v1');
        assert.equal(config.provider.wireApi, 'responses');
        assert.equal(config.modelCatalogPath, catalogPath);
        assert.deepEqual(readCodexModelCatalog(config.modelCatalogPath), { models: [] });
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test('supports quoted provider ids, comments, chat wire API and env-key auth', () => {
    const directory = mkdtempSync(join(tmpdir(), 'gcmp-codex-config-'));
    const previous = process.env.GCMP_CODEX_TEST_KEY;
    try {
        const configPath = join(directory, 'config.toml');
        writeFileSync(
            configPath,
            [
                'model_provider = "local.proxy" # selected provider',
                '[model_providers."local.proxy"]',
                'base_url = "https://localhost/v1#fragment" # trailing comment',
                'wire_api = "chat"',
                'env_key = "GCMP_CODEX_TEST_KEY"'
            ].join('\n')
        );
        process.env.GCMP_CODEX_TEST_KEY = '  test-secret  ';

        const config = readCodexCliConfig(configPath);
        assert.ok(config);
        assert.equal(config.provider.id, 'local.proxy');
        assert.equal(config.provider.baseUrl, 'https://localhost/v1#fragment');
        assert.equal(config.provider.wireApi, 'chat');
        assert.equal(resolveCodexCliProviderApiKey(config), 'test-secret');
    } finally {
        if (previous === undefined) {
            delete process.env.GCMP_CODEX_TEST_KEY;
        } else {
            process.env.GCMP_CODEX_TEST_KEY = previous;
        }
        rmSync(directory, { recursive: true, force: true });
    }
});

test('ignores configs without a selected valid custom provider', () => {
    const directory = mkdtempSync(join(tmpdir(), 'gcmp-codex-config-'));
    try {
        const configPath = join(directory, 'config.toml');
        writeFileSync(configPath, 'model_provider = "missing"\n');
        assert.equal(readCodexCliConfig(configPath), null);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});
