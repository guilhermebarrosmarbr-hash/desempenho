-- ==============================================================================
-- PENDING MIGRATION (NÃO EXECUTAR AUTOMATICAMENTE): 010_tax_preview_and_item_details.sql
-- Objetivo: Suporte a detalhamento de retenções explícitas (IRRF, INSS, ISS retido),
-- segregação de receita (serviço vs produto) e histórico de apuração trimestral
-- de IRPJ/CSLL em billing_documents e tax_assessments.
-- ==============================================================================

-- 1. Detalhamento opcional de retenções e tipo de item em billing_documents
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'billing_documents' AND column_name = 'item_type'
    ) THEN
        ALTER TABLE public.billing_documents
            ADD COLUMN item_type VARCHAR(20) DEFAULT 'service'; -- 'service' ou 'product'
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'billing_documents' AND column_name = 'irrf_retained'
    ) THEN
        ALTER TABLE public.billing_documents
            ADD COLUMN irrf_retained NUMERIC(15,2) DEFAULT 0.00;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'billing_documents' AND column_name = 'inss_retained'
    ) THEN
        ALTER TABLE public.billing_documents
            ADD COLUMN inss_retained NUMERIC(15,2) DEFAULT 0.00;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'billing_documents' AND column_name = 'iss_retained'
    ) THEN
        ALTER TABLE public.billing_documents
            ADD COLUMN iss_retained NUMERIC(15,2) DEFAULT 0.00;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'billing_documents' AND column_name = 'iss_rate'
    ) THEN
        ALTER TABLE public.billing_documents
            ADD COLUMN iss_rate NUMERIC(5,2) DEFAULT 5.00;
    END IF;
END $$;

-- 2. Memória trimestral detalhada em tax_assessments
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'tax_assessments' AND column_name = 'quarterly_details'
    ) THEN
        ALTER TABLE public.tax_assessments
            ADD COLUMN quarterly_details JSONB;
    END IF;
END $$;
