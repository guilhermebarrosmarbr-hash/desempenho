/**
 * Utilitários para Validação, Normalização e Limpeza de CNPJs
 */

/**
 * Normaliza um texto com um ou múltiplos CNPJs (separados por quebra de linha, vírgula, ponto e vírgula, espaços)
 * Retorna uma lista de CNPJs limpos com 14 dígitos (preservando zeros à esquerda), sem duplicatas.
 */
export function processarListaCnpj(input: string): { validos: string[]; invalidos: string[] } {
  if (!input) return { validos: [], invalidos: [] };

  // Separa por quebra de linha, vírgula, ponto e vírgula ou tab
  const itens = input.split(/[\r\n,;]+/).map(item => item.trim()).filter(Boolean);

  const validosSet = new Set<string>();
  const invalidos: string[] = [];

  for (const raw of itens) {
    const limpo = raw.replace(/\D/g, '');
    
    // Se tiver menos de 14 dígitos, preenche com zeros à esquerda se parecer razoável, senão valida
    const cnpj14 = limpo.padStart(14, '0');

    if (limpo.length > 14 || limpo.length < 12 || !validarCnpj(cnpj14)) {
      invalidos.push(raw);
    } else {
      validosSet.add(cnpj14);
    }
  }

  return {
    validos: Array.from(validosSet),
    invalidos
  };
}

/**
 * Validação com cálculo oficial dos dois dígitos verificadores do CNPJ
 */
export function validarCnpj(cnpj: string): boolean {
  const limpo = cnpj.replace(/\D/g, '');
  if (limpo.length !== 14) return false;

  // Rejeita sequências de dígitos iguais conhecidas (ex: 00000000000000, 11111111111111, etc.)
  if (/^(\d)\1+$/.test(limpo)) return false;

  const calcularDigito = (fatia: string, pesos: number[]): number => {
    let soma = 0;
    for (let i = 0; i < pesos.length; i++) {
      soma += parseInt(fatia[i], 10) * pesos[i];
    }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  const pesosPrimeiro = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const primeiroDigito = calcularDigito(limpo.substring(0, 12), pesosPrimeiro);
  if (primeiroDigito !== parseInt(limpo[12], 10)) return false;

  const pesosSegundo = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const segundoDigito = calcularDigito(limpo.substring(0, 13), pesosSegundo);
  return segundoDigito === parseInt(limpo[13], 10);
}

/**
 * Formata um CNPJ de 14 dígitos para visualização padrão: 00.000.000/0000-00
 */
export function formatarCnpj(cnpj: string): string {
  const limpo = cnpj.replace(/\D/g, '').padStart(14, '0');
  if (limpo.length !== 14) return cnpj;
  return limpo.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}
