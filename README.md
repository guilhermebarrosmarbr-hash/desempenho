# Sistema de Medição de Desempenho — Mar Brasil

Sistema web para geração de relatórios PDF de medição e PMOC dos contratos ativos da Mar Brasil.

## Contratos Ativos

| Contrato | Órgão | Técnico / Distribuição |
|---|---|---|
| STS 36693/22 | SEDUC Santos | 6 Setores (GB, RavTech, RN, GR, CJ, Santo Ar) |
| CRSN PSP 6018/25 | Coord. Regional de Saúde Norte SP | JR Refrigeração |
| SMSU PSP 6029/25 | Secretaria Municipal de Segurança Urbana SP | CM2D Refrigeração |

## Como Usar

1. Acesse o sistema via GitHub Pages ou abra o `index.html` localmente
2. Importe a planilha `.xlsx` ou `.csv` com os dados de medição
3. Selecione o contrato ou setor no painel lateral
4. Ajuste os parâmetros financeiros conforme necessário
5. Clique em **Imprimir / Salvar PDF** para gerar o relatório

## Estrutura de Arquivos

```
index.html            — Página principal
styles.css            — Design system e estilos
js/app.bundle.js      — Toda a lógica da aplicação (bundle único)
xlsx.full.min.js      — Biblioteca de leitura de planilhas
html2pdf.bundle.min.js — Biblioteca de exportação PDF
planilha_medicao_pmoc_exemplo.csv — Modelo de planilha
```

## Funcionalidades

- ✅ Importação de planilha (`.xlsx`, `.xls`, `.csv`) via drag & drop
- ✅ Gráficos donut com percentuais de desempenho (PMOC Mensal, Semestral, Corretiva, EPI)
- ✅ Tabela financeira com cálculo automático de valores reconhecidos
- ✅ Gestão escalável de contratos, setores e técnicos (persistida no localStorage)
- ✅ Exportação em PDF de alta qualidade (formato A4)
- ✅ Funciona 100% offline (bibliotecas embutidas)
