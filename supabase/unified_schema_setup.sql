-- ==============================================================================
-- UNIFIED_SCHEMA_SETUP.SQL
-- Script unificado para executar no SQL Editor do Supabase Dashboard
-- BPO Financeiro: Estrutura Completa de Tabelas (Módulos 01 a 08)
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. GRUPOS E EMPRESAS
CREATE TABLE IF NOT EXISTS groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
    name VARCHAR(255) NOT NULL,
    trade_name VARCHAR(255),
    document VARCHAR(18) NOT NULL UNIQUE,
    tax_regime VARCHAR(50) NOT NULL DEFAULT 'simples_nacional',
    municipality_code VARCHAR(10),
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS people (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    document VARCHAR(18),
    document_type VARCHAR(10) DEFAULT 'CNPJ',
    email VARCHAR(255),
    phone VARCHAR(50),
    person_type VARCHAR(50) NOT NULL DEFAULT 'client',
    active BOOLEAN NOT NULL DEFAULT true,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- 2. FATURAMENTO E CONTRATOS (Módulo 04)
CREATE TABLE IF NOT EXISTS contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    client_id UUID NOT NULL REFERENCES people(id) ON DELETE RESTRICT,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    object TEXT,
    start_date DATE NOT NULL,
    end_date DATE,
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    reference_value NUMERIC(15,2) NOT NULL DEFAULT 0.00,
    billing_frequency VARCHAR(20) NOT NULL DEFAULT 'monthly',
    activity_type VARCHAR(100),
    commission_eligible BOOLEAN NOT NULL DEFAULT false,
    commission_basis VARCHAR(20) DEFAULT 'net_proportional',
    commission_cap_type VARCHAR(20) DEFAULT 'none',
    commission_cap_value NUMERIC(15,2) DEFAULT 0.00,
    intermediation_eligible BOOLEAN NOT NULL DEFAULT false,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    CONSTRAINT uq_contract_company_code UNIQUE (company_id, code)
);

CREATE TABLE IF NOT EXISTS billing_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    contract_id UUID REFERENCES contracts(id) ON DELETE SET NULL,
    competence_month CHAR(7) NOT NULL,
    document_type VARCHAR(50) NOT NULL DEFAULT 'nfse',
    document_number VARCHAR(100) NOT NULL,
    series VARCHAR(20) DEFAULT '1',
    issue_date DATE NOT NULL,
    due_date DATE NOT NULL,
    gross_amount NUMERIC(15,2) NOT NULL,
    discounts NUMERIC(15,2) NOT NULL DEFAULT 0.00,
    retentions NUMERIC(15,2) NOT NULL DEFAULT 0.00,
    net_amount NUMERIC(15,2) NOT NULL,
    description TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'emitted',
    cancelled_at TIMESTAMPTZ,
    cancellation_reason TEXT,
    attachment_path TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS billing_installments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES billing_documents(id) ON DELETE CASCADE,
    installment_number INT NOT NULL DEFAULT 1,
    due_date DATE NOT NULL,
    gross_amount NUMERIC(15,2) NOT NULL,
    paid_amount NUMERIC(15,2) NOT NULL DEFAULT 0.00,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    receipt_date DATE NOT NULL,
    gross_amount NUMERIC(15,2) NOT NULL,
    account VARCHAR(100) NOT NULL,
    comprovante_path TEXT,
    idempotency_key VARCHAR(100) UNIQUE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

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

-- 3. IMPOSTOS (Módulo 05)
CREATE TABLE IF NOT EXISTS tax_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    regime VARCHAR(50) NOT NULL,
    activity_type VARCHAR(100) NOT NULL,
    annex VARCHAR(10),
    iss_rate NUMERIC(5,4) DEFAULT 0.05,
    valid_from DATE NOT NULL,
    valid_until DATE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS revenue_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    competence_month CHAR(7) NOT NULL,
    gross_revenue NUMERIC(15,2) NOT NULL DEFAULT 0.00,
    payroll_amount NUMERIC(15,2) NOT NULL DEFAULT 0.00,
    confirmed BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    CONSTRAINT uq_company_competence UNIQUE (company_id, competence_month)
);

CREATE TABLE IF NOT EXISTS tax_assessments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    competence_month CHAR(7) NOT NULL,
    period_type VARCHAR(20) NOT NULL DEFAULT 'monthly',
    status VARCHAR(50) NOT NULL DEFAULT 'draft',
    rbt12 NUMERIC(15,2) DEFAULT 0.00,
    factor_r NUMERIC(6,4) DEFAULT 0.0000,
    gross_revenue NUMERIC(15,2) NOT NULL DEFAULT 0.00,
    calculated_tax NUMERIC(15,2) NOT NULL DEFAULT 0.00,
    effective_rate NUMERIC(6,4) DEFAULT 0.0000,
    confirmed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- 4. COMISSÕES (Módulo 06)
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
    percentage NUMERIC(5,2) NOT NULL,
    basis_override VARCHAR(30),
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
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    idempotency_key VARCHAR(100) UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- 5. INTERMEDIAÇÃO (Módulo 07)
CREATE TABLE IF NOT EXISTS intermediation_agreements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payer_company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    receiver_company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    rate NUMERIC(5,2) NOT NULL,
    event_trigger VARCHAR(30) NOT NULL DEFAULT 'receipt',
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
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    idempotency_key VARCHAR(100) UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- 6. LOCAÇÕES (Módulo 08)
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
    participation_pct NUMERIC(5,2) NOT NULL,
    admin_pct NUMERIC(5,2) DEFAULT 0.00,
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
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    idempotency_key VARCHAR(100) UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- 7. AUDITORIA
CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
    user_id UUID,
    entity_name VARCHAR(100) NOT NULL,
    entity_id VARCHAR(100) NOT NULL,
    action VARCHAR(20) NOT NULL,
    old_data JSONB,
    new_data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- INSERIR GRUPO INICIAL DEFAULT
INSERT INTO groups (id, name) 
VALUES ('00000000-0000-0000-0000-000000000001', 'Grupo Principal')
ON CONFLICT (id) DO NOTHING;

-- 8. PERSISTÊNCIA DOS MÓDULOS 01, 02 E 03
CREATE TABLE IF NOT EXISTS weekly_performance_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
    period_label VARCHAR(100) NOT NULL,
    start_date DATE,
    end_date DATE,
    total_tasks INT DEFAULT 0,
    total_completed INT DEFAULT 0,
    total_pending INT DEFAULT 0,
    report_data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS mei_providers (
    id VARCHAR(100) PRIMARY KEY,
    razao_social VARCHAR(255) NOT NULL,
    cnpj VARCHAR(18) NOT NULL UNIQUE,
    status VARCHAR(50) DEFAULT 'ativo',
    codigo_acesso VARCHAR(50),
    cpf_responsavel VARCHAR(14),
    ativo BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS mei_query_batches (
    id VARCHAR(100) PRIMARY KEY,
    competencias JSONB,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDENTE',
    total INT DEFAULT 0,
    concluidos INT DEFAULT 0,
    falhas INT DEFAULT 0,
    consultas JSONB,
    zip_path TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS monthly_performance_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
    competence_month CHAR(7) NOT NULL,
    prestador_nome VARCHAR(255),
    categoria VARCHAR(50),
    taxa_conclusao NUMERIC(5,2),
    valor_excedente NUMERIC(15,2) DEFAULT 0.00,
    incentivo_veicular NUMERIC(15,2) DEFAULT 0.00,
    total_apurado NUMERIC(15,2) DEFAULT 0.00,
    report_data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

