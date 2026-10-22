-- ==============================================================================
-- 005_FIX_RLS_POLICIES.SQL (CORRIGIDO E SEGURO)
-- Desabilita RLS apenas para tabelas que já existem no schema public
-- ==============================================================================

DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT tablename 
        FROM pg_tables 
        WHERE schemaname = 'public'
    ) 
    LOOP
        -- Desativa RLS para a tabela existente
        EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY;', r.tablename);
        
        -- Concede permissões para anon, authenticated e service_role
        EXECUTE format('GRANT ALL ON TABLE public.%I TO anon, authenticated, service_role;', r.tablename);
    END LOOP;
END $$;

-- Garante que o Grupo Principal exista
INSERT INTO public.groups (id, name) 
VALUES ('00000000-0000-0000-0000-000000000001', 'Grupo Principal')
ON CONFLICT (id) DO NOTHING;
