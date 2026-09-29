import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface CodexCliModelProvider {
    id: string;
    name?: string;
    baseUrl: string;
    wireApi: 'responses' | 'chat';
    envKey?: string;
    bearerToken?: string;
}

export interface CodexCliConfig {
    configPath: string;
    forcedLoginMethod?: string;
    modelCatalogPath?: string;
    provider: CodexCliModelProvider;
}

type TomlScalar = string | boolean | number;

function stripComment(line: string): string {
    let quote: '"' | "'" | undefined;
    let escaped = false;
    for (let index = 0; index < line.length; index++) {
        const character = line[index];
        if (quote === '"' && character === '\\' && !escaped) {
            escaped = true;
            continue;
        }
        if ((character === '"' || character === "'") && !escaped) {
            quote = quote === character ? undefined : (quote ?? character);
        } else if (character === '#' && !quote) {
            return line.slice(0, index);
        }
        escaped = false;
    }
    return line;
}

function parseScalar(raw: string): TomlScalar | undefined {
    const value = raw.trim();
    if (value.startsWith('"') && value.endsWith('"')) {
        try {
            return JSON.parse(value) as string;
        } catch {
            return undefined;
        }
    }
    if (value.startsWith("'") && value.endsWith("'")) {
        return value.slice(1, -1);
    }
    if (value === 'true' || value === 'false') {
        return value === 'true';
    }
    const number = Number(value.replaceAll('_', ''));
    return value && Number.isFinite(number) ? number : undefined;
}

/**
 * Read the small Codex CLI config subset needed to route model requests.
 * Unknown TOML constructs are deliberately ignored, so newer Codex options do not break GCMP.
 */
export function readCodexCliConfig(
    configPath = path.join(os.homedir(), '.codex', 'config.toml')
): CodexCliConfig | null {
    let content: string;
    try {
        content = fs.readFileSync(configPath, 'utf8');
    } catch {
        return null;
    }

    const root = new Map<string, TomlScalar>();
    const providers = new Map<string, Map<string, TomlScalar>>();
    let current: Map<string, TomlScalar> | undefined = root;

    for (const rawLine of content.split(/\r?\n/u)) {
        const line = stripComment(rawLine).trim();
        if (!line) {
            continue;
        }
        const section = /^\[model_providers\.((?:"[^"]+")|(?:'[^']+')|[^\]]+)\]$/u.exec(line);
        if (section) {
            const providerId = section[1].replace(/^(?:"|')|(?:"|')$/gu, '').trim();
            current = providers.get(providerId) ?? new Map<string, TomlScalar>();
            providers.set(providerId, current);
            continue;
        }
        if (line.startsWith('[')) {
            current = undefined;
            continue;
        }
        const assignment = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/u.exec(line);
        if (!assignment || !current) {
            continue;
        }
        const value = parseScalar(assignment[2]);
        if (value !== undefined) {
            current.set(assignment[1], value);
        }
    }

    const providerId = root.get('model_provider');
    if (typeof providerId !== 'string' || !providerId.trim()) {
        return null;
    }
    const providerValues = providers.get(providerId);
    const baseUrl = providerValues?.get('base_url');
    if (typeof baseUrl !== 'string' || !/^https?:\/\//iu.test(baseUrl.trim())) {
        return null;
    }
    const wireApiValue = providerValues?.get('wire_api');
    const wireApi = wireApiValue === 'chat' ? 'chat' : 'responses';
    const catalog = root.get('model_catalog_json');
    const resolveOptionalString = (key: string): string | undefined => {
        const value = providerValues?.get(key);
        return typeof value === 'string' && value.trim() ? value.trim() : undefined;
    };

    return {
        configPath,
        forcedLoginMethod:
            typeof root.get('forced_login_method') === 'string' ?
                (root.get('forced_login_method') as string)
            :   undefined,
        modelCatalogPath:
            typeof catalog === 'string' && catalog.trim() ?
                path.resolve(path.dirname(configPath), catalog.trim())
            :   undefined,
        provider: {
            id: providerId,
            name: resolveOptionalString('name'),
            baseUrl: baseUrl.trim().replace(/\/+$/u, ''),
            wireApi,
            envKey: resolveOptionalString('env_key'),
            bearerToken: resolveOptionalString('experimental_bearer_token')
        }
    };
}

export function readCodexModelCatalog(catalogPath: string | undefined): unknown | undefined {
    if (!catalogPath) {
        return undefined;
    }
    try {
        return JSON.parse(fs.readFileSync(catalogPath, 'utf8')) as unknown;
    } catch {
        return undefined;
    }
}

export function resolveCodexCliProviderApiKey(config: CodexCliConfig): string | undefined {
    if (config.provider.bearerToken) {
        return config.provider.bearerToken;
    }
    if (config.provider.envKey) {
        const value = process.env[config.provider.envKey];
        return value?.trim() || undefined;
    }
    return undefined;
}
