/**
 * Tipos e Interfaces para o Módulo de Consulta PGMEI
 */

export type StatusConsulta =
  | 'NA_FILA'
  | 'EM_PROCESSAMENTO'
  | 'AGUARDANDO_VERIFICACAO_HUMANA'
  | 'CONCLUIDO'
  | 'FALHOU'
  | 'CANCELADO';

export type StatusLote =
  | 'CRIADO'
  | 'EM_ANDAMENTO'
  | 'CONCLUIDO'
  | 'CANCELADO';

export type SituacaoDas =
  | 'Liquidado'
  | 'Devedor'
  | 'A Vencer'
  | 'Dívida Ativa'
  | 'Não Optante'
  | 'Outro'
  | 'Indeterminada';

export interface LinhaApuracao {
  periodo: string; // Ex: "01/2026"
  apurado: string; // "Sim" / "Não"
  situacao: SituacaoDas;
  situacaoTextoOriginal: string;
  principal: string; // Ex: "R$ 75,00"
  multa: string;
  juros: string;
  total: string;
  dataVencimento: string;
  dataAcolhimento?: string;
}

export interface ConsultaResultado {
  id: string;
  loteId: string;
  cnpjSolicitado: string;
  cnpjFormatado: string;
  cnpjIdentificado?: string;
  nomeContribuinte?: string;
  anoSolicitado: number;
  anoConfirmado?: number;
  dataHoraInicio: string;
  dataHoraFim?: string;
  status: StatusConsulta;
  screenshotPath?: string;
  screenshotFilename?: string;
  urlOrigem?: string;
  linhasApuracao: LinhaApuracao[];
  resumoSituacao?: string;
  codigoErro?: string;
  mensagemErro?: string;
  requerIntervencao: boolean;
  tentativas: number;
}

export interface LoteConsultas {
  id: string;
  dataHoraCriacao: string;
  ano: number;
  status: StatusLote;
  totalConsultas: number;
  concluidas: number;
  falhas: number;
  consultas: ConsultaResultado[];
}

export interface Prestador {
  id: string;
  cnpj: string;
  razaoSocial: string;
  dataCadastro: string;
}

export interface IniciarLoteInput {
  prestadorIds?: string[];
  ano: number;
}

