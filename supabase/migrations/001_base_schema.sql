-- ==============================================================================
-- 001_BASE_SCHEMA.SQL
-- BPO Financeiro: Estrutura Base (Grupos, Empresas, Usuários, Permissões, Pessoas)
-- ==============================================================================

-- Extensões necessárias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. GRUPOS EMPRESARIAIS
CREATE TABLE IF NOT EXISTS groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- 2. EMPRESAS DO GRUPO
CREATE TABLE IF NOT EXISTS companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
    name VARCHAR(255) NOT NULL,
    trade_name VARCHAR(255),
    document VARCHAR(18) NOT NULL UNIQUE, -- CNPJ: XX.XXX.XXX/XXXX-XX
    tax_regime VARCHAR(50) NOT NULL DEFAULT 'simples_nacional', -- simples_nacional, lucro_presumido, lucro_real, mei
    municipality_code VARCHAR(10),
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- 3. PERFIS DE ACESSO DO USUÁRIO POR EMPRESA
CREATE TABLE IF NOT EXISTS user_company_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL, -- Referencia auth.users do Supabase se existir
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL DEFAULT 'financeiro', -- admin, financeiro, consulta, integracao
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    CONSTRAINT uq_user_company UNIQUE (user_id, company_id)
);

-- 4. CADASTRO DE PESSOAS (CLIENTES, FORNECEDORES, PARCEIROS, PROPRIETÁRIOS)
CREATE TABLE IF NOT EXISTS people (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    document VARCHAR(18), -- CPF ou CNPJ
    document_type VARCHAR(10) DEFAULT 'CNPJ', -- CPF, CNPJ, ESTRANGEIRO
    email VARCHAR(255),
    phone VARCHAR(50),
    person_type VARCHAR(50) NOT NULL DEFAULT 'client', -- client, supplier, partner, landlord, tenant
    active BOOLEAN NOT NULL DEFAULT true,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- 5. LOG DE AUDITORIA IMUTÁVEL
CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
    user_id UUID,
    entity_name VARCHAR(100) NOT NULL,
    entity_id VARCHAR(100) NOT NULL,
    action VARCHAR(20) NOT NULL, -- INSERT, UPDATE, CANCEL, RECALCULATE, APPROVE
    old_data JSONB,
    new_data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- Índices essenciais
CREATE INDEX IF NOT EXISTS idx_companies_group ON companies(group_id);
CREATE INDEX IF NOT EXISTS idx_people_company ON people(company_id);
CREATE INDEX IF NOT EXISTS idx_people_document ON people(document);
CREATE INDEX IF NOT EXISTS idx_audit_company ON audit_log(company_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_name, entity_id);
