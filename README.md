# Sistema de Medição de Desempenho e Faturamento - Mar Brasil (PMOC)

Sistema web corporativo desenvolvido sob os princípios de **Clean Code** e **Engenharia de Software Sênior** para gestão de medições contratuais de manutenção (PMOC e correlatos) e geração de relatórios oficiais em **PDF** para a **Mar Brasil**.

---

## 🏢 Contratos Ativos e Mapeamento Operacional

| Contrato | Órgão / Cliente | Setor / Abrangência | Técnico / Empresa Responsável |
| :--- | :--- | :--- | :--- |
| **STS 36693/22** | **SEDUC Santos** (Secretaria de Educação) | Setor 01 | **GB Climatização** |
| **STS 36693/22** | **SEDUC Santos** (Secretaria de Educação) | Setor 02 | **RavTech Climatização** |
| **STS 36693/22** | **SEDUC Santos** (Secretaria de Educação) | Setor 03 | **RN Climatização** |
| **STS 36693/22** | **SEDUC Santos** (Secretaria de Educação) | Setor 04 | **GR Ar Condicionado** |
| **STS 36693/22** | **SEDUC Santos** (Secretaria de Educação) | Setor 05 | **CJ Refrigeração** |
| **STS 36693/22** | **SEDUC Santos** (Secretaria de Educação) | Setor 06 | **Santo Ar** |
| **PSP 6018/25** | **CRSN** (Coordenadoria Regional de Saúde Norte de SP) | Geral (CRSN) | **JR Refrigeração** |
| **PSP 6029/25** | **SMSU** (Sec. Municipal de Segurança Urbana de SP) | Geral (SMSU) | **CM2D Refrigeração** |

---

## 🚀 Arquitetura para Escalar (Novos Contratos e Técnicos)

O sistema foi preparado para crescer e permite gerenciar novos contratos e profissionais através do botão **`⚙️ Contratos & Técnicos`**:
- **Cadastro e Edição de Contratos**: Código do contrato, órgão contratante, descrição, valor base e divisão em subsetores.
- **Distribuição de Técnicos por Setor**: Cada setor pode ter seu técnico atribuído dinamicamente através de menus suspensos interativos.
- **Cadastro e Edição de Técnicos/Parceiros**: Nome da empresa/técnico, telefone e atribuição.
- **Persistência Local (`localStorage`)**: Todas as alterações feitas ficam salvas no navegador e persistem entre sessões, com botão de **"Restaurar Padrões Mar Brasil"** caso queira voltar às configurações originais.

---

## 🎨 Fidelidade Visual no Relatório Oficial

- **Identificação Completa no Relatório**:
  - Badge do Contrato (`CONTRATO STS 36693/22 • SETOR 01`)
  - Tag de Responsabilidade Técnica (`👷 Responsável Técnico: GB Climatização`)
  - Título Oficial (`Medição de Desempenho - Mar Brasil`)
  - Subtítulo com o Órgão Contratante (SEDUC Santos, CRSN ou SMSU)
  - Logo Isométrico 3D da marca
  - Tabela Financeira com cabeçalho personalizado (`VALORES - MAR BRASIL 06/2026`)
- **4 Gráficos Donut em SVG Nativo**: Escala vetorial nítida sem perdas, renderizando fielmente as cores **laranja vibrante** (`#ea580c`) e **pêssego suave** (`#ffedd5`).

---

## 💻 Como Iniciar e Usar

1. **Abrir a Aplicação**:
   - Dê um duplo-clique no executável [`abrir_sistema.bat`](file:///C:/Users/Financeiro%201/.gemini/antigravity-ide/scratch/relatorio-medicao-pmoc/abrir_sistema.bat) ou abra o [`index.html`](file:///C:/Users/Financeiro%201/.gemini/antigravity-ide/scratch/relatorio-medicao-pmoc/index.html).
2. **Selecionar ou Alimentar Dados**:
   - Escolha diretamente no seletor de contratos/setores (já mapeado com os respectivos técnicos da Mar Brasil).
   - Ou arraste uma planilha do Excel (`.xlsx`, `.xls` ou `.csv`). O sistema detecta automaticamente o setor e vincula ao técnico responsável.
3. **Gerenciar Contratos e Técnicos**:
   - Clique em **"⚙️ Contratos & Técnicos"** na barra superior para adicionar novos contratos, subsetores ou técnicos parceiros.
4. **Gerar PDF**:
   - Clique em **"🖨️ Imprimir / Salvar PDF"** para abrir a impressão em folha A4 com renderização vetorial cristalina.
