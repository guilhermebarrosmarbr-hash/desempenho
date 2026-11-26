-- ==============================================================================
-- 013_AUVO_STOCK.SQL
-- Módulo 11: Estoque & Produtos Auvo
-- Compatível com Postgres / Supabase (Idempotente com IF NOT EXISTS)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.auvo_stock_products (
    id BIGINT PRIMARY KEY, -- ID numérico oficial do Auvo (ex: 990954)
    product_uuid TEXT NULL, -- UUID de produto da Auvo (ex: 'f8c78e2b-11cd-11ed-8adf-0a42a07a2d16')
    external_id TEXT NULL,
    code TEXT NULL,
    name TEXT NOT NULL,
    description TEXT NULL,
    category_id BIGINT NULL,
    category_name TEXT NULL,
    total_stock NUMERIC(15,2) NOT NULL DEFAULT 0,
    minimum_stock NUMERIC(15,2) NULL,
    active BOOLEAN NOT NULL DEFAULT true,
    unitary_value TEXT NULL,
    unitary_cost TEXT NULL,
    image_url TEXT NULL,
    employees_stock JSONB NULL DEFAULT '[]'::jsonb,
    raw_data JSONB NULL,
    account_origin TEXT NULL DEFAULT 'marbrauvo',
    last_synced_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Índices de consulta rápida
CREATE INDEX IF NOT EXISTS idx_auvo_stock_name ON public.auvo_stock_products (name);
CREATE INDEX IF NOT EXISTS idx_auvo_stock_code ON public.auvo_stock_products (code);
CREATE INDEX IF NOT EXISTS idx_auvo_stock_category ON public.auvo_stock_products (category_id);
CREATE INDEX IF NOT EXISTS idx_auvo_stock_active ON public.auvo_stock_products (active);
CREATE INDEX IF NOT EXISTS idx_auvo_stock_total_stock ON public.auvo_stock_products (total_stock);

-- Tabela de Histórico e Controle de Sincronizações
CREATE TABLE IF NOT EXISTS public.auvo_stock_sync (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status TEXT NOT NULL DEFAULT 'completed', -- 'in_progress', 'completed', 'failed'
    total_products_synced INT NOT NULL DEFAULT 0,
    total_pages INT NOT NULL DEFAULT 0,
    error_message TEXT NULL,
    duration_ms INT NOT NULL DEFAULT 0,
    started_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    completed_at TIMESTAMPTZ NULL
);

-- Habilita RLS e permissões de leitura/escrita
ALTER TABLE public.auvo_stock_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auvo_stock_sync ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'auvo_stock_products' AND policyname = 'auvo_stock_products_all_policy'
    ) THEN
        CREATE POLICY auvo_stock_products_all_policy ON public.auvo_stock_products
            FOR ALL TO public USING (true) WITH CHECK (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'auvo_stock_sync' AND policyname = 'auvo_stock_sync_all_policy'
    ) THEN
        CREATE POLICY auvo_stock_sync_all_policy ON public.auvo_stock_sync
            FOR ALL TO public USING (true) WITH CHECK (true);
    END IF;
END $$;

GRANT ALL ON TABLE public.auvo_stock_products TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.auvo_stock_sync TO anon, authenticated, service_role;
