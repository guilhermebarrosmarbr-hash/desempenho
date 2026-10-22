-- ==============================================================================
-- 005_FIX_RLS_POLICIES.SQL
-- Provisório: Permissões para service_role e authenticated
-- NOTA: Sem login/auth configurado no frontend, tabelas precisam de definição
-- de controle de acesso adequada (ver [DECISÃO] sobre caminhos A ou B).
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
        -- Permissões essenciais para operações autenticadas e service_role
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated, service_role;', r.tablename);
        -- NÃO conceder GRANT ALL indiscriminado ao role anon
    END LOOP;
END $$;

-- Garante que o Grupo Principal exista
INSERT INTO public.groups (id, name) 
VALUES ('00000000-0000-0000-0000-000000000001', 'Grupo Principal')
ON CONFLICT (id) DO NOTHING;
