-- ==============================================================================
-- 009_BILLING_DOCUMENTS_PAYMENT_DATE.SQL
-- Adiciona a coluna payment_date (Data de Recebimento) na tabela billing_documents
-- Idempotente (IF NOT EXISTS / DO BLOCKS)
-- ==============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'billing_documents' AND column_name = 'payment_date'
    ) THEN
        ALTER TABLE public.billing_documents
            ADD COLUMN payment_date DATE;
    END IF;
END $$;
