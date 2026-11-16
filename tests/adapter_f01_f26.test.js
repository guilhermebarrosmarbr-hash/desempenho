// ==============================================================================
// tests/adapter_f01_f26.test.js — Teste do Adaptador Supabase (F01 e F26)
// ==============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');

// Mock fetch global para simular PostgREST
let mockFetchHandler = null;
global.fetch = async function(url, options) {
    if (mockFetchHandler) {
        return mockFetchHandler(url, options);
    }
    return {
        ok: true,
        status: 200,
        text: async () => '[]',
        json: async () => []
    };
};

const { SupabaseClientAdapter } = require('../financeiro/js/supabase.js');

test('F01: Resposta HTTP 204 (No Content) retorna true sem falha de parsing JSON', async () => {
    const adapter = new SupabaseClientAdapter();
    adapter.url = 'https://mock.supabase.co';
    adapter.anonKey = 'sb_publishable_valid_test_key_longer_than_20_chars';

    mockFetchHandler = async (url, options) => {
        return {
            ok: true,
            status: 204,
            text: async () => '',
            json: async () => { throw new SyntaxError('Unexpected end of JSON input'); }
        };
    };

    const result = await adapter.request('billing_documents?id=eq.1', {
        method: 'DELETE'
    });

    assert.equal(result, true, 'HTTP 204 deve retornar true diretamente');
});

test('F01: Prefer nos headers sobrescreve options.prefer e não falha se resposta for vazia', async () => {
    const adapter = new SupabaseClientAdapter();
    adapter.url = 'https://mock.supabase.co';
    adapter.anonKey = 'sb_publishable_valid_test_key_longer_than_20_chars';

    let capturedPrefer = null;
    mockFetchHandler = async (url, options) => {
        capturedPrefer = options.headers['Prefer'];
        return {
            ok: true,
            status: 200,
            text: async () => '', // PostgREST com resolution=ignore-duplicates pode devolver texto vazio
            json: async () => { throw new SyntaxError('Unexpected end of JSON input'); }
        };
    };

    const result = await adapter.request('rental_distributions?on_conflict=idempotency_key', {
        method: 'POST',
        headers: { 'Prefer': 'resolution=ignore-duplicates' },
        body: JSON.stringify([{ id: 1 }])
    });

    assert.equal(capturedPrefer, 'resolution=ignore-duplicates');
    assert.equal(result, true, 'Corpo de texto vazio deve retornar true com segurança');
});

test('F01: Resposta com dados JSON válidos retorna o objeto parseado', async () => {
    const adapter = new SupabaseClientAdapter();
    adapter.url = 'https://mock.supabase.co';
    adapter.anonKey = 'sb_publishable_valid_test_key_longer_than_20_chars';

    mockFetchHandler = async (url, options) => {
        return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify([{ id: 'doc-123', gross_amount: 1000 }]),
            json: async () => [{ id: 'doc-123', gross_amount: 1000 }]
        };
    };

    const result = await adapter.request('billing_documents?limit=1');
    assert.equal(Array.isArray(result), true);
    assert.equal(result[0].id, 'doc-123');
});

test('F01: Erro HTTP do Supabase preserva mensagem estruturada', async () => {
    const adapter = new SupabaseClientAdapter();
    adapter.url = 'https://mock.supabase.co';
    adapter.anonKey = 'sb_publishable_valid_test_key_longer_than_20_chars';

    mockFetchHandler = async (url, options) => {
        return {
            ok: false,
            status: 400,
            text: async () => JSON.stringify({ code: 'PGRST204', message: 'column company_id not found' })
        };
    };

    await assert.rejects(
        async () => {
            await adapter.request('intermediation_calculations');
        },
        /Erro Supabase \(400\): {"code":"PGRST204"/
    );
});

test('F26: Override manual do operador não é sobrescrito por chamada remota /api/config', async () => {
    const adapter = new SupabaseClientAdapter();
    adapter.saveConfig('https://meu-projeto-proprio.supabase.co', 'sb_publishable_chave_manual_customizada_123456');

    // Simula resposta da API remota tentando devolver o projeto padrão
    mockFetchHandler = async (url) => {
        if (url === '/api/config') {
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    supabaseUrl: 'https://rdjdieirkjlyoooxtdfw.supabase.co',
                    supabaseAnonKey: 'sb_publishable_OSLZXYjeAk8dVmwAt5-QIQ_kkFxC-V_'
                })
            };
        }
        return { ok: true, status: 200, text: async () => '[]' };
    };

    await adapter._fetchRemoteConfig();

    assert.equal(adapter.url, 'https://meu-projeto-proprio.supabase.co', 'URL personalizada deve ser mantida');
    assert.equal(adapter.anonKey, 'sb_publishable_chave_manual_customizada_123456', 'Chave personalizada deve ser mantida');
});
