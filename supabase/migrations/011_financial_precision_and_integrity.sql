-- ==============================================================================
-- 011_FINANCIAL_PRECISION_AND_INTEGRITY.SQL
-- Módulos 04 a 08: Precisão decimal NUMERIC(12,6), Vigências e Acréscimos Financeiros
-- Compatível com Postgres / Supabase (Idempotente com IF NOT EXISTS)
-- ==============================================================================

-- 1. F06: Precisão de percentuais de comissão e intermediação para suportar 0.225%, 0.135%, etc.
DO $$
BEGIN
    -- contract_commission_rules.percentage
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'contract_commission_rules' AND column_name = 'percentage'
    ) THEN
        ALTER TABLE public.contract_commission_rules
            ALTER COLUMN percentage TYPE NUMERIC(12,6);
    END IF;

    -- commission_calculations.percentage
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'commission_calculations' AND column_name = 'percentage'
    ) THEN
        ALTER TABLE public.commission_calculations
            ALTER COLUMN percentage TYPE NUMERIC(12,6);
    END IF;

    -- intermediation_agreements.rate
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'intermediation_agreements' AND column_name = 'rate'
    ) THEN
        ALTER TABLE public.intermediation_agreements
            ALTER COLUMN rate TYPE NUMERIC(12,6);
    END IF;

    -- intermediation_calculations.rate
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'intermediation_calculations' AND column_name = 'rate'
    ) THEN
        ALTER TABLE public.intermediation_calculations
            ALTER COLUMN rate TYPE NUMERIC(12,6);
    END IF;

    -- property_participants.participation_pct e admin_pct
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'property_participants' AND column_name = 'participation_pct'
    ) THEN
        ALTER TABLE public.property_participants
            ALTER COLUMN participation_pct TYPE NUMERIC(12,6),
            ALTER COLUMN admin_pct TYPE NUMERIC(12,6);
    END IF;

    -- rental_distributions.participation_pct
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'rental_distributions' AND column_name = 'participation_pct'
    ) THEN
        ALTER TABLE public.rental_distributions
            ALTER COLUMN participation_pct TYPE NUMERIC(12,6);
    END IF;
END $$;

-- 2. F07: Vigências em colaboradores (valid_from e valid_until)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'collaborators' AND column_name = 'valid_from'
    ) THEN
        ALTER TABLE public.collaborators
            ADD COLUMN valid_from DATE DEFAULT '2000-01-01';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'collaborators' AND column_name = 'valid_until'
    ) THEN
        ALTER TABLE public.collaborators
            ADD COLUMN valid_until DATE;
    END IF;
END $$;

-- 3. F08: Acréscimos explicitamente modelados em billing_documents (multa, juros, extras)
-- e ajuste da constraint chk_net_amount para comportar acréscimos sem violar a integridade
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'billing_documents' AND column_name = 'additions'
    ) THEN
        ALTER TABLE public.billing_documents
            ADD COLUMN additions NUMERIC(15,2) NOT NULL DEFAULT 0.00;
    END IF;

    -- Se payment_date não existir ainda (migração 009)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'billing_documents' AND column_name = 'payment_date'
    ) THEN
        ALTER TABLE public.billing_documents
            ADD COLUMN payment_date DATE;
    END IF;

    -- Atualiza a constraint de verificação do líquido para considerar acréscimos:
    -- net_amount = gross_amount + additions - discounts - retentions
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE table_name = 'billing_documents' AND constraint_name = 'chk_net_amount'
    ) THEN
        ALTER TABLE public.billing_documents
            DROP CONSTRAINT chk_net_amount;
    END IF;

    ALTER TABLE public.billing_documents
        ADD CONSTRAINT chk_net_amount 
        CHECK (net_amount = (gross_amount + additions - discounts - retentions));
END $$;

-- 4. F12: Garantir company_id em intermediation_calculations para consistência relacional
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'intermediation_calculations' AND column_name = 'company_id'
    ) THEN
        ALTER TABLE public.intermediation_calculations
            ADD COLUMN company_id UUID REFERENCES public.companies(id) ON DELETE RESTRICT;
    END IF;
END $$;
