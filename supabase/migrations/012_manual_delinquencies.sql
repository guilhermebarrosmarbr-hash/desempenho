-- ==============================================================================
-- 012_MANUAL_DELINQUENCIES.SQL
-- Módulo 09: Inadimplência — Tabela de pendências manuais
-- Compatível com Postgres / Supabase (Idempotente com IF NOT EXISTS)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.manual_delinquencies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    contract_name TEXT NOT NULL,
    issue_date DATE NOT NULL,
    due_date DATE NOT NULL,
    gross_amount NUMERIC(15,2) NOT NULL DEFAULT 0.00,
    net_amount NUMERIC(15,2) NULL,
    notes TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Índices para buscas rápidas por empresa e data de vencimento
CREATE INDEX IF NOT EXISTS idx_manual_delinquencies_company_id ON public.manual_delinquencies(company_id);
CREATE INDEX IF NOT EXISTS idx_manual_delinquencies_due_date ON public.manual_delinquencies(due_date);

-- Permissões RLS (se habilitadas)
ALTER TABLE public.manual_delinquencies ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'manual_delinquencies' AND policyname = 'manual_delinquencies_all_policy'
    ) THEN
        CREATE POLICY manual_delinquencies_all_policy ON public.manual_delinquencies
            FOR ALL TO public USING (true) WITH CHECK (true);
    END IF;
END $$;

GRANT ALL ON TABLE public.manual_delinquencies TO anon, authenticated, service_role;
