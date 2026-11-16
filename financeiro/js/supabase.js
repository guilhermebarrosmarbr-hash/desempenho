// ==============================================================================
// supabase.js — Adaptador Supabase para o BPO Financeiro
// ==============================================================================

(function(global) {
    const STORAGE_KEY_URL = 'bpo_supabase_url';
    const STORAGE_KEY_ANON = 'bpo_supabase_anon_key';
    const STORAGE_KEY_OVERRIDE = 'bpo_supabase_manual_override';

    const DEFAULT_URL = 'https://rdjdieirkjlyoooxtdfw.supabase.co';
    const DEFAULT_ANON = 'sb_publishable_OSLZXYjeAk8dVmwAt5-QIQ_kkFxC-V_';

    function getStorage() {
        if (typeof localStorage !== 'undefined') {
            return localStorage;
        }
        // Fallback em memória para ambientes de teste Node.js
        if (!global.__bpo_mock_storage) {
            const mem = new Map();
            global.__bpo_mock_storage = {
                getItem: (k) => mem.has(k) ? mem.get(k) : null,
                setItem: (k, v) => mem.set(k, String(v)),
                removeItem: (k) => mem.delete(k)
            };
        }
        return global.__bpo_mock_storage;
    }

    function getValidKey() {
        const storage = getStorage();
        const stored = (storage.getItem(STORAGE_KEY_ANON) || '').trim();
        if (!stored || stored.includes('sua_chave') || stored.length < 20) {
            storage.setItem(STORAGE_KEY_ANON, DEFAULT_ANON);
            return DEFAULT_ANON;
        }
        return stored;
    }

    function getValidUrl() {
        const storage = getStorage();
        const stored = (storage.getItem(STORAGE_KEY_URL) || '').trim();
        if (!stored || !stored.startsWith('https://')) {
            storage.setItem(STORAGE_KEY_URL, DEFAULT_URL);
            return DEFAULT_URL;
        }
        return stored;
    }

    class SupabaseClientAdapter {
        constructor() {
            this.url = getValidUrl();
            this.anonKey = getValidKey();
            this._initPromise = this._fetchRemoteConfig();
        }

        async _fetchRemoteConfig() {
            const storage = getStorage();
            // F26: Se o operador salvou manualmente uma conexão na interface, não sobrescreve
            if (storage.getItem(STORAGE_KEY_OVERRIDE) === 'true') {
                return;
            }

            if (typeof fetch === 'undefined') {
                return;
            }

            try {
                const res = await fetch('/api/config');
                if (res.ok) {
                    const data = await res.json();
                    if (data.supabaseUrl && data.supabaseAnonKey && data.supabaseAnonKey.length > 20 && !data.supabaseAnonKey.includes('sua_chave')) {
                        // Re-checa após o await para garantir que não houve override concorrente
                        if (storage.getItem(STORAGE_KEY_OVERRIDE) !== 'true') {
                            this.url = data.supabaseUrl;
                            this.anonKey = data.supabaseAnonKey;
                            storage.setItem(STORAGE_KEY_URL, this.url);
                            storage.setItem(STORAGE_KEY_ANON, this.anonKey);
                        }
                    }
                }
            } catch (_) {}
        }

        isConfigured() {
            return Boolean(this.url && this.anonKey && this.url.startsWith('https://'));
        }

        saveConfig(url, anonKey) {
            const storage = getStorage();
            this.url = (url || '').trim().replace(/\/+$/, '');
            this.anonKey = (anonKey || '').trim();
            storage.setItem(STORAGE_KEY_URL, this.url);
            storage.setItem(STORAGE_KEY_ANON, this.anonKey);
            storage.setItem(STORAGE_KEY_OVERRIDE, 'true');
        }

        clearConfig() {
            const storage = getStorage();
            this.url = '';
            this.anonKey = '';
            storage.removeItem(STORAGE_KEY_URL);
            storage.removeItem(STORAGE_KEY_ANON);
            storage.removeItem(STORAGE_KEY_OVERRIDE);
        }

        async request(endpoint, options = {}) {
            if (this._initPromise) {
                await this._initPromise;
            }
            if (!this.isConfigured()) {
                throw new Error("SUPABASE_NOT_CONFIGURED: As credenciais do Supabase não foram informadas. Acesse a tela de configurações.");
            }

            const url = `${this.url}/rest/v1/${endpoint}`;
            
            // F01: Normalização robusta de cabeçalhos e Prefer
            const incomingHeaders = options.headers || {};
            let finalPrefer = options.prefer;
            for (const key of Object.keys(incomingHeaders)) {
                if (key.toLowerCase() === 'prefer') {
                    finalPrefer = incomingHeaders[key];
                    break;
                }
            }
            if (!finalPrefer) {
                finalPrefer = 'return=representation';
            }

            const headers = {
                'apikey': this.anonKey,
                'Authorization': `Bearer ${this.anonKey}`,
                'Content-Type': 'application/json',
                ...incomingHeaders,
                'Prefer': finalPrefer
            };

            const response = await fetch(url, {
                ...options,
                headers
            });

            if (!response.ok) {
                const errBody = await response.text();
                throw new Error(`Erro Supabase (${response.status}): ${errBody}`);
            }

            // HTTP 204 (No Content) ou 205 (Reset Content) nunca possui corpo JSON
            if (response.status === 204 || response.status === 205) {
                return true;
            }

            // Se o Prefer explicitamente pediu minimal, não tenta parsear JSON
            if (finalPrefer.includes('return=minimal')) {
                return true;
            }

            // Lê corpo como texto primeiro para proteger contra corpo vazio
            const text = await response.text();
            if (!text || text.trim() === '') {
                return true;
            }

            try {
                return JSON.parse(text);
            } catch (jsonErr) {
                throw new Error(`Erro Supabase: falha ao interpretar JSON retornado: ${jsonErr.message}`);
            }
        }

        // Helpers de consulta
        async from(table) {
            return new QueryBuilder(this, table);
        }
    }

    class QueryBuilder {
        constructor(adapter, table) {
            this.adapter = adapter;
            this.table = table;
            this.params = [];
            this.method = 'GET';
            this.body = null;
            this.headers = {};
        }

        select(columns = '*') {
            this.params.push(`select=${encodeURIComponent(columns)}`);
            return this;
        }

        eq(column, value) {
            this.params.push(`${encodeURIComponent(column)}=eq.${encodeURIComponent(value)}`);
            return this;
        }

        order(column, { ascending = true } = {}) {
            this.params.push(`order=${encodeURIComponent(column)}.${ascending ? 'asc' : 'desc'}`);
            return this;
        }

        limit(count) {
            this.params.push(`limit=${count}`);
            return this;
        }

        async insert(data) {
            this.method = 'POST';
            this.body = JSON.stringify(data);
            return this.execute();
        }

        async update(data) {
            this.method = 'PATCH';
            this.body = JSON.stringify(data);
            return this.execute();
        }

        async execute() {
            const query = this.params.length > 0 ? `?${this.params.join('&')}` : '';
            return this.adapter.request(`${this.table}${query}`, {
                method: this.method,
                body: this.body,
                headers: this.headers
            });
        }
    }

    // Instância global
    const client = new SupabaseClientAdapter();
    global.BpoSupabase = client;
    global.SupabaseClientAdapter = SupabaseClientAdapter;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { BpoSupabase: client, SupabaseClientAdapter, QueryBuilder };
    }
})(typeof window !== 'undefined' ? window : globalThis);
