# Sistema de Medição de Desempenho e BPO Financeiro — Mar Brasil & Ybox

Sistema integrado para gestão operacional e financeira do PMOC (Plano de Manutenção, Operação e Controle), relatórios de medição, apuração de tributos, comissões, intermediações, locações e consultas ao PGMEI.

---

## 🏛️ Módulos do Sistema

### 1. Operacional & Relatórios PMOC
- **Módulo 01 (`medicao.html`):** Medição Semanal PMOC com gráficos de desempenho, tabela financeira analítica, importação de planilhas e exportação PDF A4.
- **Módulo 02 (`bpo-financeiro-pgmei`):** Robô de consulta e processamento em lote de DASN-SIMEI via Playwright e fila FIFO.
- **Módulo 03 (`medicao_mensal.html`):** Apuração de Desempenho Mensal com reconciliação vertical de tarefas (preventivas, corretivas, EPIs e ferramentas).

### 2. BPO Financeiro
- **Módulo 04 (`financeiro/faturamento.html`):** Registro de contratos e lançamentos de faturamento com liquidação atômica de parcelas, recibos e alocações.
- **Módulo 05 (`financeiro/impostos.html`):** Memória de cálculo de tributos para Simples Nacional (Anexos I, III, IV, V com Fator R) e Lucro Presumido (Base 32% e ISS municipal).
- **Módulo 06 (`financeiro/comissoes.html`):** Apuração de comissões por regras contratuais com teto fixo/percentual e chave determinística de idempotência.
- **Módulo 07 (`financeiro/intermediacao.html`):** Gestão de acordos societários e repasses entre empresas (Mar Brasil / Ybox) com gatilhos por faturamento ou recebimento.
- **Módulo 08 (`financeiro/locacoes.html`):** Controle de patrimônio imobiliário e rateio proporcional com inquilinos e sócios participantes.
- **Configurações (`financeiro/config.html`):** Parametrização e validação de credenciais do Supabase.

---

## 🚀 Como Executar

### Interface Web (Frontend)
Abra os arquivos HTML diretamente no navegador ou utilize um servidor estático local (como Live Server ou Vercel):
```bash
# Abrir tela inicial integrada
open index.html
```

### Serviço BPO Financeiro PGMEI (Node/TypeScript)
```bash
cd bpo-financeiro-pgmei
npm install
npm run build
npm start
```

### Worker Cloudflare (Proxy WhatsApp / Evolution API)
```bash
cd worker
npx wrangler dev
```

---

## 🔐 Variáveis de Ambiente & Banco de Dados

1. **Supabase:** Execute o script consolidado `supabase/unified_schema_setup.sql` no Editor SQL do seu painel Supabase.
2. **Ambiente Local PGMEI:** Crie o arquivo `bpo-financeiro-pgmei/.env` baseado em `bpo-financeiro-pgmei/.env.example`.
3. **Worker Cloudflare:** Configure as variáveis no painel da Cloudflare ou `wrangler secret`:
   - `FRONTEND_ACCESS_TOKEN`: Token de autenticação Bearer para o frontend.
   - `EVOLUTION_API_URL`: URL base da Evolution API.
   - `EVOLUTION_API_KEY`: Chave de API da instância Evolution.
   - `EVOLUTION_INSTANCE_NAME`: Nome da instância WhatsApp configurada.
