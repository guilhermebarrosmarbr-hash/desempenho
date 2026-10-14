# BPO Financeiro &bull; Módulo 02: Consulta DAS MEI em Lote (PGMEI)

Sistema automatizado com Playwright para consulta da situação fiscal do DAS de prestadores MEI no portal oficial da Receita Federal (PGMEI), com captura de evidências visuais completas e exportação em lote.

---

## 🛠️ Arquitetura e Tecnologias

- **Backend / Orquestrador:** Node.js + TypeScript com Express.
- **Automação Web:** Playwright (Chromium oficial).
- **Processamento Assíncrono:** Fila gerenciada fora da requisição HTTP (`QueueManager`).
- **Persistência Local:** Banco JSON atômico com histórico completo de lotes e consultas (`DatabaseStore`).
- **Evidências Visuais:** Capturas completas (`fullPage`) salvas no formato seguro `CNPJ_ANO_DATA_HORA_IDCONSULTA.png`.
- **Exportação:** Streaming de arquivo ZIP compactado com todas as evidências e relatório JSON.

---

## 🚀 Como Executar

### 1. Pré-requisitos
- Node.js instalado (v18+)
- Playwright Chromium (`npx playwright install chromium`)

### 2. Iniciar a Aplicação
No diretório `bpo-financeiro-pgmei`:

```bash
# Instalar dependências (caso seja a primeira vez)
npm install

# Iniciar servidor em modo desenvolvimento
npm run dev
```

O painel web estará disponível em:
👉 **`http://localhost:3000`**

---

## 🧪 Como Funciona o Fluxo de Consulta

1. O operador informa uma lista de CNPJs (copiar e colar de planilhas, notas ou texto separado por vírgula/quebra de linha) e seleciona o ano-calendário (ex: 2026);
2. O sistema valida os dígitos verificadores do CNPJ, remove duplicidades no lote e cria a fila;
3. O Playwright acessa o portal oficial da Receita Federal:
   `https://www8.receita.fazenda.gov.br/SimplesNacional/Aplicacoes/ATSPO/pgmei.app/Identificacao`
4. Preenche o CNPJ e avança normalmente para emissão do DAS do ano solicitado;
5. **Tratamento de hCaptcha e Intervenção Humana:**
   - O portal utiliza hCaptcha invisível. Em caso de desafio visual, o navegador visível permite que o operador resolva.
   - O painel exibe o status **"Aguardando Operador ⚠️"** e disponibiliza o botão **"Já resolvi o CAPTCHA"** para retomada controlada.
6. A tabela de competências é lida diretamente do DOM (categorizando *Liquidado*, *Devedor*, *A Vencer*, *Dívida Ativa* etc.);
7. O print da tela inteira é salvo e vinculado aos metadados;
8. O operador pode visualizar o print no painel e fazer o download de **todas as evidências em um único arquivo ZIP**.

---

## 🛡️ Segurança e Boas Práticas

- **Sem alteração fiscal:** O crawler apenas navega e consulta. Não clica em "Apurar/Gerar DAS" nem em "Pagar Online".
- **Limpeza e isolamento:** Cada prestador é consultado em um contexto de navegação novo e isolado, garantindo que cookies ou sessões não se misturem.
- **Cancelamento Seguro:** O lote pode ser cancelado a qualquer momento pelo painel sem travar o servidor.
