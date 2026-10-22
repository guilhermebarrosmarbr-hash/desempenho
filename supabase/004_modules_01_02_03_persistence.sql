-- ==============================================================================
-- 004_MODULES_01_02_03_PERSISTENCE.SQL
-- Tabelas de persistência no Supabase para Módulos 01, 02 e 03
-- ==============================================================================

-- 1. MÓDULO 01: DESEMPENHO SEMANAL (MEDIÇÃO PMOC)
CREATE TABLE IF NOT EXISTS weekly_performance_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
    period_label VARCHAR(100) NOT NULL, -- Ex: 'Semana 42 - 12 a 18/10/2026'
    start_date DATE,
    end_date DATE,
    total_tasks INT DEFAULT 0,
    total_completed INT DEFAULT 0,
    total_pending INT DEFAULT 0,
    report_data JSONB NOT NULL, -- Estrutura completa de setores, técnicos e índices
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- 2. MÓDULO 02: CAPTURA DAS-MEI (PRESTADORES E LOTES DE CONSULTA)
CREATE TABLE IF NOT EXISTS mei_providers (
    id VARCHAR(100) PRIMARY KEY, -- Mantém id local ou UUID
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
    id VARCHAR(100) PRIMARY KEY, -- lote_...
    competencias JSONB, -- ['2026-08', '2026-09']
    status VARCHAR(50) NOT NULL DEFAULT 'PENDENTE', -- PENDENTE, PROCESSANDO, CONCLUIDO, FALHOU
    total INT DEFAULT 0,
    concluidos INT DEFAULT 0,
    falhas INT DEFAULT 0,
    consultas JSONB, -- Detalhamento de cada prestador e status
    zip_path TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- 3. MÓDULO 03: DESEMPENHO MENSAL
CREATE TABLE IF NOT EXISTS monthly_performance_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
    competence_month CHAR(7) NOT NULL, -- 'AAAA-MM'
    prestador_nome VARCHAR(255),
    categoria VARCHAR(50), -- GERAL, FINANCEIRO, TAREFAS
    taxa_conclusao NUMERIC(5,2),
    valor_excedente NUMERIC(15,2) DEFAULT 0.00,
    incentivo_veicular NUMERIC(15,2) DEFAULT 0.00,
    total_apurado NUMERIC(15,2) DEFAULT 0.00,
    report_data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
