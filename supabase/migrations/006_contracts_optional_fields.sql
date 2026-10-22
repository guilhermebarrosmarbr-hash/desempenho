-- Migration: tornar client_id e start_date opcionais na tabela contracts
-- Executar no SQL Editor do Supabase

ALTER TABLE public.contracts
    ALTER COLUMN client_id DROP NOT NULL,
    ALTER COLUMN start_date DROP NOT NULL;
