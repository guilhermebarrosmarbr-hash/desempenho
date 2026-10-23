-- ==============================================================================
-- 008_CONTRACT_TYPE_AND_CLIENT_DOCS.SQL
-- Adiciona tipo de contrato (B2G, B2B, B2C) na tabela contracts
-- Garante campos de tipo de cliente e documentos em people e contracts
-- Idempotente (IF NOT EXISTS / DO BLOCKS)
-- ==============================================================================

-- 1. Coluna contract_type na tabela contracts (B2G, B2B, B2C)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'contracts' AND column_name = 'contract_type'
    ) THEN
        ALTER TABLE public.contracts
            ADD COLUMN contract_type VARCHAR(10) DEFAULT 'B2B';
    END IF;
END $$;

-- 2. Garantir colunas cpf e cnpj explícitas ou segregadas em people (além do document genérico)
-- para evitar qualquer confusão entre PF e PJ no banco de dados
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'people' AND column_name = 'cpf'
    ) THEN
        ALTER TABLE public.people
            ADD COLUMN cpf VARCHAR(14);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'people' AND column_name = 'cnpj'
    ) THEN
        ALTER TABLE public.people
            ADD COLUMN cnpj VARCHAR(18);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'people' AND column_name = 'client_category'
    ) THEN
        ALTER TABLE public.people
            ADD COLUMN client_category VARCHAR(10) DEFAULT 'PJ'; -- 'PF' ou 'PJ'
    END IF;
END $$;
