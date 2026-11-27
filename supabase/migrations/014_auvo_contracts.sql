-- ============================================================
-- Migration 014: Módulo 12 — Contratos (Auvo)
-- ============================================================
-- Tabelas:
--   auvo_contracts              → metadados locais por grupo Auvo
--   auvo_contract_equipment_values → valor por equipamento × contrato
--   auvo_contract_value_audit   → auditoria de alterações de valor
--   auvo_contract_snapshots     → snapshots mensais de contagem
-- ============================================================

-- 1. Metadados locais do contrato (grupo de clientes Auvo)
CREATE TABLE IF NOT EXISTS auvo_contracts (
  id                  BIGSERIAL PRIMARY KEY,
  auvo_group_id       BIGINT UNIQUE NOT NULL,
  nome_exibicao       TEXT,
  referencia          TEXT,
  responsavel         TEXT,
  observacoes         TEXT,
  data_inicio         DATE,
  data_fim            DATE,
  situacao_manual     TEXT CHECK (situacao_manual IN ('ativo','inativo') OR situacao_manual IS NULL),
  maquinas_contratadas INTEGER,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Valor por equipamento dentro de um contrato
CREATE TABLE IF NOT EXISTS auvo_contract_equipment_values (
  id                  BIGSERIAL PRIMARY KEY,
  auvo_group_id       BIGINT NOT NULL,
  auvo_equipment_id   BIGINT NOT NULL,
  valor               NUMERIC(14,2),
  incluido_contrato   BOOLEAN DEFAULT TRUE,
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_by          TEXT DEFAULT 'sistema',
  UNIQUE (auvo_group_id, auvo_equipment_id)
);

-- 3. Auditoria de alterações de valor
CREATE TABLE IF NOT EXISTS auvo_contract_value_audit (
  id                  BIGSERIAL PRIMARY KEY,
  auvo_group_id       BIGINT NOT NULL,
  auvo_equipment_id   BIGINT NOT NULL,
  valor_anterior      NUMERIC(14,2),
  valor_novo          NUMERIC(14,2),
  alterado_por        TEXT,
  alterado_em         TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Snapshots mensais de quantidades
CREATE TABLE IF NOT EXISTS auvo_contract_snapshots (
  id                  BIGSERIAL PRIMARY KEY,
  ano_mes             TEXT NOT NULL,            -- "YYYY-MM"
  total_equipamentos  INTEGER,
  grupos_count        INTEGER,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auvo_contracts_group    ON auvo_contracts (auvo_group_id);
CREATE INDEX IF NOT EXISTS idx_auvo_equip_values_group ON auvo_contract_equipment_values (auvo_group_id);
CREATE INDEX IF NOT EXISTS idx_auvo_snapshots_mes      ON auvo_contract_snapshots (ano_mes);

-- RLS: acesso via service_role apenas (backend)
ALTER TABLE auvo_contracts                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE auvo_contract_equipment_values   ENABLE ROW LEVEL SECURITY;
ALTER TABLE auvo_contract_value_audit        ENABLE ROW LEVEL SECURITY;
ALTER TABLE auvo_contract_snapshots          ENABLE ROW LEVEL SECURITY;

-- Trigger: auditoria de valores
CREATE OR REPLACE FUNCTION fn_audit_equip_value()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.valor IS DISTINCT FROM NEW.valor THEN
    INSERT INTO auvo_contract_value_audit
      (auvo_group_id, auvo_equipment_id, valor_anterior, valor_novo, alterado_por)
    VALUES
      (NEW.auvo_group_id, NEW.auvo_equipment_id, OLD.valor, NEW.valor, NEW.updated_by);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_equip_value ON auvo_contract_equipment_values;
CREATE TRIGGER trg_audit_equip_value
  BEFORE UPDATE ON auvo_contract_equipment_values
  FOR EACH ROW EXECUTE FUNCTION fn_audit_equip_value();
