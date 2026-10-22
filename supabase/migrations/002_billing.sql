-- ==============================================================================
-- 002_BILLING.SQL
-- Módulo 04: Contratos, Documentos de Faturamento, Parcelas e Recebimentos
-- ==============================================================================

-- 1. CONTRATOS
CREATE TABLE IF NOT EXISTS contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    client_id UUID NOT NULL REFERENCES people(id) ON DELETE RESTRICT,
    code VARCHAR(50) NOT NULL, -- Ex: CTR-2026-001
    name VARCHAR(255) NOT NULL,
    object TEXT,
    start_date DATE NOT NULL,
    end_date DATE,
    status VARCHAR(50) NOT NULL DEFAULT 'active', -- active, suspended, cancelled, terminated
    reference_value NUMERIC(15,2) NOT NULL DEFAULT 0.00,
    billing_frequency VARCHAR(20) NOT NULL DEFAULT 'monthly', -- monthly, quarterly, annual, punctual
    activity_type VARCHAR(100), -- Ex: servico_pmoc, locacao, intermediacao
    tax_profile_id UUID,
    municipality_code VARCHAR(10),
    
    -- Parâmetros de Comissão
    commission_eligible BOOLEAN NOT NULL DEFAULT false,
    commission_basis VARCHAR(20) DEFAULT 'net_proportional', -- gross_invoiced, gross_liquidated, net_proportional
    commission_cap_type VARCHAR(20) DEFAULT 'none', -- none, percentage, fixed_amount
    commission_cap_value NUMERIC(15,2) DEFAULT 0.00,
    
    -- Parâmetros de Intermediação e Locação
    intermediation_eligible BOOLEAN NOT NULL DEFAULT false,
    intermediation_agreement_id UUID,
    property_id UUID,
    
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    CONSTRAINT uq_contract_company_code UNIQUE (company_id, code)
);

-- 2. DOCUMENTOS DE FATURAMENTO (NOTAS FISCAIS, FATURAS, RECIBOS)
CREATE TABLE IF NOT EXISTS billing_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    contract_id UUID REFERENCES contracts(id) ON DELETE SET NULL,
    competence_month CHAR(7) NOT NULL, -- 'AAAA-MM'
    document_type VARCHAR(50) NOT NULL DEFAULT 'nfse', -- nfse, fatura, recibo, locacao
    document_number VARCHAR(100) NOT NULL,
    series VARCHAR(20) DEFAULT '1',
    issue_date DATE NOT NULL,
    due_date DATE NOT NULL,
    
    -- Valores em Numeric exato
    gross_amount NUMERIC(15,2) NOT NULL,
    discounts NUMERIC(15,2) NOT NULL DEFAULT 0.00,
    retentions NUMERIC(15,2) NOT NULL DEFAULT 0.00,
    net_amount NUMERIC(15,2) NOT NULL,
    
    description TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'emitted', -- draft, emitted, paid, partially_paid, cancelled
    cancelled_at TIMESTAMPTZ,
    cancellation_reason TEXT,
    replaces_id UUID REFERENCES billing_documents(id) ON DELETE SET NULL,
    attachment_path TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    CONSTRAINT chk_net_amount CHECK (net_amount = (gross_amount - discounts - retentions))
);

-- 3. PARCELAS DE COBRANÇA
CREATE TABLE IF NOT EXISTS billing_installments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES billing_documents(id) ON DELETE CASCADE,
    installment_number INT NOT NULL DEFAULT 1,
    due_date DATE NOT NULL,
    gross_amount NUMERIC(15,2) NOT NULL,
    paid_amount NUMERIC(15,2) NOT NULL DEFAULT 0.00,
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, partially_paid, paid, cancelled
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- 4. RECEBIMENTOS FINANCEIROS
CREATE TABLE IF NOT EXISTS receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    receipt_date DATE NOT NULL,
    gross_amount NUMERIC(15,2) NOT NULL,
    account VARCHAR(100) NOT NULL, -- Ex: Conta Banco Itaú, Inter, etc.
    comprovante_path TEXT,
    idempotency_key VARCHAR(100) UNIQUE,
    external_id VARCHAR(100),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- 5. ALOCAÇÃO DE RECEBIMENTOS ÀS PARCELAS
CREATE TABLE IF NOT EXISTS receipt_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_id UUID NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
    installment_id UUID NOT NULL REFERENCES billing_installments(id) ON DELETE RESTRICT,
    allocated_principal NUMERIC(15,2) NOT NULL DEFAULT 0.00,
    allocated_interest NUMERIC(15,2) NOT NULL DEFAULT 0.00,
    allocated_discount NUMERIC(15,2) NOT NULL DEFAULT 0.00,
    allocated_retention NUMERIC(15,2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_contracts_company ON contracts(company_id);
CREATE INDEX IF NOT EXISTS idx_billing_company_competence ON billing_documents(company_id, competence_month);
CREATE INDEX IF NOT EXISTS idx_billing_contract ON billing_documents(contract_id);
CREATE INDEX IF NOT EXISTS idx_installments_document ON billing_installments(document_id);
CREATE INDEX IF NOT EXISTS idx_receipts_company ON receipts(company_id);
CREATE INDEX IF NOT EXISTS idx_receipt_allocations_inst ON receipt_allocations(installment_id);
