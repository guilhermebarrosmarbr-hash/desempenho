-- ==============================================================================
-- 007_CONSTRAINTS_AND_RELATIONS.SQL
-- Idempotente (IF NOT EXISTS / DO BLOCKS)
-- ==============================================================================

-- 1. UNIQUE em billing_documents (company_id, document_type, series, document_number)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_billing_documents_series_number'
    ) THEN
        ALTER TABLE public.billing_documents
            ADD CONSTRAINT uq_billing_documents_series_number 
            UNIQUE (company_id, document_type, series, document_number);
    END IF;
END $$;

-- 2. UNIQUE em tax_assessments (company_id, competence_month, period_type)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_tax_assessments_competence'
    ) THEN
        ALTER TABLE public.tax_assessments
            ADD CONSTRAINT uq_tax_assessments_competence 
            UNIQUE (company_id, competence_month, period_type);
    END IF;
END $$;

-- 3. commission_calculations.contract_id NULLABLE
ALTER TABLE public.commission_calculations
    ALTER COLUMN contract_id DROP NOT NULL;

-- 4. company_id em intermediation_calculations
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

-- Backfill company_id via agreement
UPDATE public.intermediation_calculations ic
SET company_id = ia.payer_company_id
FROM public.intermediation_agreements ia
WHERE ic.agreement_id = ia.id AND ic.company_id IS NULL;

-- 5. company_id em rental_contracts
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'rental_contracts' AND column_name = 'company_id'
    ) THEN
        ALTER TABLE public.rental_contracts
            ADD COLUMN company_id UUID REFERENCES public.companies(id) ON DELETE RESTRICT;
    END IF;
END $$;

-- Backfill company_id em rental_contracts via property
UPDATE public.rental_contracts rc
SET company_id = p.company_id
FROM public.properties p
WHERE rc.property_id = p.id AND rc.company_id IS NULL;

-- 6. company_id em rental_distributions
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'rental_distributions' AND column_name = 'company_id'
    ) THEN
        ALTER TABLE public.rental_distributions
            ADD COLUMN company_id UUID REFERENCES public.companies(id) ON DELETE RESTRICT;
    END IF;
END $$;

-- Backfill company_id em rental_distributions via property
UPDATE public.rental_distributions rd
SET company_id = p.company_id
FROM public.properties p
WHERE rd.property_id = p.id AND rd.company_id IS NULL;

-- 7. Colunas regime e anexo em tax_assessments
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'tax_assessments' AND column_name = 'regime'
    ) THEN
        ALTER TABLE public.tax_assessments
            ADD COLUMN regime VARCHAR(50);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'tax_assessments' AND column_name = 'annex'
    ) THEN
        ALTER TABLE public.tax_assessments
            ADD COLUMN annex VARCHAR(10);
    END IF;
END $$;
