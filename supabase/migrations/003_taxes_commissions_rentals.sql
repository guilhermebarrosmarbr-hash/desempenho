-- ==============================================================================
-- 003_TAXES_COMMISSIONS_RENTALS.SQL
-- Módulos 05, 06, 07, 08: Impostos, Comissões, Intermediações, Locações e RLS
-- ==============================================================================

-- 1. TABELAS DE IMPOSTOS E TRIBUTAÇÃO (Módulo 05)
CREATE TABLE IF NOT EXISTS tax_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    regime VARCHAR(50) NOT NULL, -- simples_nacional, lucro_presumido, lucro_real
    activity_type VARCHAR(100) NOT NULL,
    annex VARCHAR(10), -- anexo_iii, anexo_iv, anexo_v
    iss_rate NUMERIC(5,4) DEFAULT 0.05,
    valid_from DATE NOT NULL,
    valid_until DATE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS revenue_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    competence_month CHAR(7) NOT NULL, -- 'AAAA-MM'
    gross_revenue NUMERIC(15,2) NOT NULL DEFAULT 0.00,
    payroll_amount NUMERIC(15,2) NOT NULL DEFAULT 0.00, -- Para Fator R
    confirmed BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    CONSTRAINT uq_company_competence UNIQUE (company_id, competence_month)
);

CREATE TABLE IF NOT EXISTS tax_assessments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    competence_month CHAR(7) NOT NULL,
    period_type VARCHAR(20) NOT NULL DEFAULT 'monthly',
    status VARCHAR(50) NOT NULL DEFAULT 'draft', -- draft, calculated, confirmed, closed
    rbt12 NUMERIC(15,2) DEFAULT 0.00,
    factor_r NUMERIC(6,4) DEFAULT 0.0000,
    gross_revenue NUMERIC(15,2) NOT NULL DEFAULT 0.00,
    calculated_tax NUMERIC(15,2) NOT NULL DEFAULT 0.00,
    effective_rate NUMERIC(6,4) DEFAULT 0.0000,
    confirmed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- 2. TABELAS DE COMISSÕES (Módulo 06)
CREATE TABLE IF NOT EXISTS collaborators (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    document VARCHAR(18),
    email VARCHAR(255),
    role VARCHAR(100) DEFAULT 'vendedor',
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS contract_commission_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    collaborator_id UUID NOT NULL REFERENCES collaborators(id) ON DELETE RESTRICT,
    percentage NUMERIC(5,2) NOT NULL, -- Ex: 5.00 para 5%
    basis_override VARCHAR(30), -- gross_invoiced, gross_liquidated, net_proportional
    valid_from DATE NOT NULL,
    valid_until DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS commission_calculations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    collaborator_id UUID NOT NULL REFERENCES collaborators(id) ON DELETE RESTRICT,
    contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE RESTRICT,
    document_id UUID REFERENCES billing_documents(id) ON DELETE SET NULL,
    competence_month CHAR(7) NOT NULL,
    event_date DATE NOT NULL,
    base_amount NUMERIC(15,2) NOT NULL,
    percentage NUMERIC(5,2) NOT NULL,
    commission_amount NUMERIC(15,2) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, approved, paid, cancelled
    idempotency_key VARCHAR(100) UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- 3. INTERMEDIAÇÃO (Módulo 07)
CREATE TABLE IF NOT EXISTS intermediation_agreements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payer_company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    receiver_company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    rate NUMERIC(5,2) NOT NULL, -- Ex: 10.00 para 10%
    event_trigger VARCHAR(30) NOT NULL DEFAULT 'receipt', -- billing, receipt
    valid_from DATE NOT NULL,
    valid_until DATE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS intermediation_calculations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agreement_id UUID NOT NULL REFERENCES intermediation_agreements(id) ON DELETE RESTRICT,
    contract_id UUID REFERENCES contracts(id) ON DELETE SET NULL,
    document_id UUID REFERENCES billing_documents(id) ON DELETE SET NULL,
    competence_month CHAR(7) NOT NULL,
    base_amount NUMERIC(15,2) NOT NULL,
    rate NUMERIC(5,2) NOT NULL,
    intermediation_amount NUMERIC(15,2) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, invoiced, paid, cancelled
    idempotency_key VARCHAR(100) UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- 4. LOCAÇÕES E IMÓVEIS (Módulo 08)
CREATE TABLE IF NOT EXISTS properties (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    name VARCHAR(255) NOT NULL,
    address TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS property_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    person_id UUID NOT NULL REFERENCES people(id) ON DELETE RESTRICT,
    participation_pct NUMERIC(5,2) NOT NULL, -- Ex: 50.00 para 50%
    admin_pct NUMERIC(5,2) DEFAULT 0.00, -- Taxa administrativa se houver
    valid_from DATE NOT NULL,
    valid_until DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS rental_contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id UUID NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
    tenant_id UUID NOT NULL REFERENCES people(id) ON DELETE RESTRICT,
    start_date DATE NOT NULL,
    end_date DATE,
    monthly_amount NUMERIC(15,2) NOT NULL,
    due_day INT NOT NULL DEFAULT 10,
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS rental_distributions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id UUID NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
    participant_id UUID NOT NULL REFERENCES people(id) ON DELETE RESTRICT,
    competence_month CHAR(7) NOT NULL,
    gross_received NUMERIC(15,2) NOT NULL,
    deductions NUMERIC(15,2) NOT NULL DEFAULT 0.00,
    distributable_amount NUMERIC(15,2) NOT NULL,
    participation_pct NUMERIC(5,2) NOT NULL,
    distribution_amount NUMERIC(15,2) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, paid
    idempotency_key VARCHAR(100) UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
