// ==============================================================================
// supabase.js — Adaptador Supabase para o BPO Financeiro
// ==============================================================================

(function() {
    const STORAGE_KEY_URL = 'bpo_supabase_url';
    const STORAGE_KEY_ANON = 'bpo_supabase_anon_key';

    const DEFAULT_URL = 'https://rdjdieirkjlyoooxtdfw.supabase.co';
    const DEFAULT_ANON = 'sb_publishable_OSLZXYjeAk8dVmwAt5-QIQ_kkFxC-V_';

    function getValidKey() {
        const stored = (localStorage.getItem(STORAGE_KEY_ANON) || '').trim();
        // Se a chave no localStorage for a string invalida ("sua_chave_anon", vazia ou menor que 20 chars), descarta
        if (!stored || stored.includes('sua_chave') || stored.length < 20) {
            localStorage.setItem(STORAGE_KEY_ANON, DEFAULT_ANON);
            return DEFAULT_ANON;
        }
        return stored;
    }

    function getValidUrl() {
        const stored = (localStorage.getItem(STORAGE_KEY_URL) || '').trim();
        if (!stored || !stored.startsWith('https://')) {
            localStorage.setItem(STORAGE_KEY_URL, DEFAULT_URL);
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
            try {
                const res = await fetch('/api/config');
                if (res.ok) {
                    const data = await res.json();
                    if (data.supabaseUrl && data.supabaseAnonKey && data.supabaseAnonKey.length > 20 && !data.supabaseAnonKey.includes('sua_chave')) {
                        this.url = data.supabaseUrl;
                        this.anonKey = data.supabaseAnonKey;
                        localStorage.setItem(STORAGE_KEY_URL, this.url);
                        localStorage.setItem(STORAGE_KEY_ANON, this.anonKey);
                    }
                }
            } catch (_) {}
        }

        isConfigured() {
            return Boolean(this.url && this.anonKey && this.url.startsWith('https://'));
        }

        saveConfig(url, anonKey) {
            this.url = (url || '').trim().replace(/\/+$/, '');
            this.anonKey = (anonKey || '').trim();
            localStorage.setItem(STORAGE_KEY_URL, this.url);
            localStorage.setItem(STORAGE_KEY_ANON, this.anonKey);
        }

        clearConfig() {
            this.url = '';
            this.anonKey = '';
            localStorage.removeItem(STORAGE_KEY_URL);
            localStorage.removeItem(STORAGE_KEY_ANON);
        }

        async request(endpoint, options = {}) {
            if (this._initPromise) {
                await this._initPromise;
            }
            if (!this.isConfigured()) {
                throw new Error("SUPABASE_NOT_CONFIGURED: As credenciais do Supabase não foram informadas. Acesse a tela de configurações.");
            }

            const url = `${this.url}/rest/v1/${endpoint}`;
            const headers = {
                'apikey': this.anonKey,
                'Authorization': `Bearer ${this.anonKey}`,
                'Content-Type': 'application/json',
                'Prefer': options.prefer || 'return=representation',
                ...options.headers
            };

            const response = await fetch(url, {
                ...options,
                headers
            });

            if (!response.ok) {
                const errBody = await response.text();
                throw new Error(`Erro Supabase (${response.status}): ${errBody}`);
            }

            if (options.prefer && options.prefer.includes('return=minimal')) {
                return true;
            }

            return await response.json();
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
    window.BpoSupabase = new SupabaseClientAdapter();
})();
