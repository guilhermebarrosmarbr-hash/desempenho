// Frontend Logic for BPO Financeiro - Consulta DAS MEI em Lote

let pollingInterval = null;
let loteAtivoId = null;

// Elementos de Cadastro e Seleção de Prestadores
const formNovoPrestador = document.getElementById('formNovoPrestador');
const cadCnpj = document.getElementById('cadCnpj');
const cadRazaoSocial = document.getElementById('cadRazaoSocial');
const btnSalvarPrestador = document.getElementById('btnSalvarPrestador');

const formNovoLote = document.getElementById('formNovoLote');
const inputAno = document.getElementById('inputAno');
const listaPrestadoresSelect = document.getElementById('listaPrestadoresSelect');
const prestadorCounter = document.getElementById('prestadorCounter');
const btnToggleSelectAll = document.getElementById('btnToggleSelectAll');
const btnIniciarLote = document.getElementById('btnIniciarLote');

let prestadoresCadastrados = [];

// Formatar CNPJ automaticamente no input
cadCnpj.addEventListener('input', (e) => {
  let v = e.target.value.replace(/\D/g, '').substring(0, 14);
  if (v.length > 12) {
    v = v.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{0,2})$/, '$1.$2.$3/$4-$5');
  } else if (v.length > 8) {
    v = v.replace(/^(\d{2})(\d{3})(\d{3})(\d{0,4})$/, '$1.$2.$3/$4');
  } else if (v.length > 5) {
    v = v.replace(/^(\d{2})(\d{3})(\d{0,3})$/, '$1.$2.$3');
  } else if (v.length > 2) {
    v = v.replace(/^(\d{2})(\d{0,3})$/, '$1.$2');
  }
  e.target.value = v;
});

// Cadastrar Prestador
formNovoPrestador.addEventListener('submit', async (e) => {
  e.preventDefault();
  const cnpj = cadCnpj.value.trim();
  const razaoSocial = cadRazaoSocial.value.trim();

  if (!cnpj || !razaoSocial) {
    alert('Informe o CNPJ e a Razão Social.');
    return;
  }

  btnSalvarPrestador.disabled = true;
  btnSalvarPrestador.textContent = '⏳ Salvando...';

  try {
    const res = await fetch('/api/prestadores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cnpj, razaoSocial })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(`Erro: ${data.erro}`);
      return;
    }

    cadCnpj.value = '';
    cadRazaoSocial.value = '';
    await carregarPrestadores();
  } catch (err) {
    alert('Erro de conexão: ' + err.message);
  } finally {
    btnSalvarPrestador.disabled = false;
    btnSalvarPrestador.textContent = '💾 Cadastrar Prestador';
  }
});

// Carregar lista de prestadores cadastrados
async function carregarPrestadores() {
  try {
    const res = await fetch('/api/prestadores');
    if (!res.ok) return;
    prestadoresCadastrados = await res.json();
    renderListaPrestadores();
  } catch (_) {}
}

function renderListaPrestadores() {
  listaPrestadoresSelect.innerHTML = '';
  if (prestadoresCadastrados.length === 0) {
    listaPrestadoresSelect.innerHTML = `
      <div style="padding: 20px 10px; text-align: center; color: #94a3b8; font-size: 12px;">
        Nenhum prestador cadastrado ainda.<br>Preencha os campos acima para cadastrar.
      </div>
    `;
    atualizarContadorSelecao();
    return;
  }

  prestadoresCadastrados.forEach(p => {
    const item = document.createElement('div');
    item.className = 'prestador-item';

    // Formatador visual
    const cnpjFmt = p.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');

    item.innerHTML = `
      <label class="prestador-label">
        <input type="checkbox" class="chk-prestador" value="${p.id}" checked />
        <div class="prestador-info">
          <strong>${p.razaoSocial}</strong>
          <span>${cnpjFmt}</span>
        </div>
      </label>
      <button type="button" class="btn-del-prest" title="Excluir prestador" onclick="excluirPrestador('${p.id}', '${p.razaoSocial}')">
        🗑️
      </button>
    `;
    listaPrestadoresSelect.appendChild(item);
  });

  // Event listener nos checkboxes
  listaPrestadoresSelect.querySelectorAll('.chk-prestador').forEach(chk => {
    chk.addEventListener('change', atualizarContadorSelecao);
  });

  atualizarContadorSelecao();
}

function atualizarContadorSelecao() {
  const marcados = listaPrestadoresSelect.querySelectorAll('.chk-prestador:checked');
  prestadorCounter.textContent = `${marcados.length} de ${prestadoresCadastrados.length} prestadores selecionados`;
  btnIniciarLote.disabled = marcados.length === 0;
}

// Alternar selecionar todos
btnToggleSelectAll.addEventListener('click', () => {
  const checkboxes = listaPrestadoresSelect.querySelectorAll('.chk-prestador');
  const algumDesmarcado = Array.from(checkboxes).some(c => !c.checked);
  checkboxes.forEach(c => c.checked = algumDesmarcado);
  atualizarContadorSelecao();
});

// Excluir Prestador
window.excluirPrestador = async function(id, nome) {
  if (confirm(`Deseja remover o prestador "${nome}" do cadastro?`)) {
    try {
      const res = await fetch(`/api/prestadores/${id}`, { method: 'DELETE' });
      if (res.ok) {
        await carregarPrestadores();
      }
    } catch (e) {
      alert('Erro ao excluir: ' + e.message);
    }
  }
};

// Envio do formulário para iniciar lote com prestadores selecionados
formNovoLote.addEventListener('submit', async (e) => {
  e.preventDefault();
  const selecionados = Array.from(listaPrestadoresSelect.querySelectorAll('.chk-prestador:checked')).map(c => c.value);
  const ano = parseInt(inputAno.value, 10);

  if (selecionados.length === 0) {
    alert('Selecione ao menos um prestador para consultar.');
    return;
  }

  btnIniciarLote.disabled = true;
  btnIniciarLote.textContent = '⏳ Iniciando Lote...';

  try {
    const res = await fetch('/api/lotes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prestadorIds: selecionados, ano })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(`Erro: ${data.erro}`);
      return;
    }

    loteAtivoId = data.lote.id;
    iniciarAcompanhamento(loteAtivoId);
  } catch (err) {
    alert(`Erro de conexão: ${err.message}`);
  } finally {
    btnIniciarLote.disabled = false;
    btnIniciarLote.textContent = '⚡ Iniciar Consulta dos Selecionados';
  }
});

// Acompanhamento em tempo real
function iniciarAcompanhamento(loteId) {
  if (pollingInterval) clearInterval(pollingInterval);
  painelLoteAtivo.style.display = 'block';
  painelLoteAtivo.scrollIntoView({ behavior: 'smooth' });

  const fetchStatus = async () => {
    try {
      const res = await fetch(`/api/lotes/${loteId}`);
      if (!res.ok) return;
      const lote = await res.json();
      atualizarPainelLote(lote);

      if (lote.status === 'CONCLUIDO' || lote.status === 'CANCELADO') {
        clearInterval(pollingInterval);
        carregarHistorico();
      }
    } catch (_) {}
  };

  fetchStatus();
  pollingInterval = setInterval(fetchStatus, 2500);
}

function atualizarPainelLote(lote) {
  ativoLoteId.textContent = lote.id;
  ativoLoteAno.textContent = lote.ano;
  ativoLoteData.textContent = new Date(lote.dataHoraCriacao).toLocaleTimeString('pt-BR');

  const total = lote.totalConsultas;
  const concluidas = lote.concluidas;
  const falhas = lote.falhas;
  const finalizadas = concluidas + falhas;
  const pct = total > 0 ? Math.round((finalizadas / total) * 100) : 0;

  loteProgressBar.style.width = `${pct}%`;
  loteProgressText.textContent = `${finalizadas} de ${total} processados (${concluidas} com sucesso, ${falhas} com falha)`;
  loteProgressPercent.textContent = `${pct}%`;

  if (concluidas > 0) {
    btnDownloadZip.style.display = 'inline-flex';
    btnDownloadZip.href = `/api/lotes/${lote.id}/download-zip`;
  }

  // Renderiza tabela de consultas
  tabelaConsultasCorpo.innerHTML = '';
  lote.consultas.forEach((c) => {
    const tr = document.createElement('tr');

    const badgeClass = {
      'NA_FILA': 'badge-na-fila',
      'EM_PROCESSAMENTO': 'badge-em-proc',
      'AGUARDANDO_VERIFICACAO_HUMANA': 'badge-humano',
      'CONCLUIDO': 'badge-concluido',
      'FALHOU': 'badge-falhou',
      'CANCELADO': 'badge-cancelado'
    }[c.status] || 'badge-na-fila';

    const statusLabel = {
      'NA_FILA': 'Na fila',
      'EM_PROCESSAMENTO': 'Em processamento ⚙️',
      'AGUARDANDO_VERIFICACAO_HUMANA': 'Aguardando Operador ⚠️',
      'CONCLUIDO': 'Concluído ✅',
      'FALHOU': 'Falhou ❌',
      'CANCELADO': 'Cancelado'
    }[c.status] || c.status;

    let printHtml = '<span style="color: #94a3b8; font-size: 11px;">Sem print</span>';
    if (c.screenshotFilename) {
      printHtml = `
        <button type="button" class="btn btn-secondary btn-sm" onclick="verPrint('${c.screenshotFilename}', '${c.cnpjFormatado}')">
          👁️ Ver Print
        </button>
      `;
    }

    let acoesHtml = '—';
    if (c.status === 'AGUARDANDO_VERIFICACAO_HUMANA') {
      acoesHtml = `
        <button type="button" class="btn btn-success btn-sm" onclick="liberarHumano('${c.id}')" title="Clique após resolver o hCaptcha na janela do navegador">
          🔓 Já resolvi o CAPTCHA
        </button>
      `;
    }

    tr.innerHTML = `
      <td>
        <strong>${c.cnpjFormatado}</strong>
        ${c.nomeContribuinte ? `<div style="font-size: 11px; color: #64748b;">${c.nomeContribuinte}</div>` : ''}
      </td>
      <td><span class="badge ${badgeClass}">${statusLabel}</span></td>
      <td style="font-size: 12.5px;">${c.resumoSituacao || c.mensagemErro || 'Aguardando...'}</td>
      <td style="font-size: 11.5px; color: #64748b;">
        ${c.linhasApuracao && c.linhasApuracao.length > 0 ? `${c.linhasApuracao.length} competências apuradas` : '—'}
      </td>
      <td>${printHtml}</td>
      <td>${acoesHtml}</td>
    `;

    tabelaConsultasCorpo.appendChild(tr);
  });
}

// Intervenção humana
window.liberarHumano = async function(consultaId) {
  try {
    const res = await fetch(`/api/consultas/${consultaId}/liberar-humano`, { method: 'POST' });
    if (res.ok) {
      alert('Operador confirmou resolução. O sistema está retomando a coleta dos dados...');
    }
  } catch (e) {
    alert('Erro ao confirmar: ' + e.message);
  }
};

// Cancelar lote
btnCancelarLote.addEventListener('click', async () => {
  if (!loteAtivoId) return;
  if (confirm('Deseja realmente cancelar o processamento deste lote?')) {
    await fetch(`/api/lotes/${loteAtivoId}/cancelar`, { method: 'POST' });
    alert('Lote cancelado.');
  }
});

// Modal de visualização do Print
window.verPrint = function(filename, cnpj) {
  modalPrintTitle.textContent = `Evidência Oficial PGMEI - CNPJ ${cnpj}`;
  modalPrintImage.src = `/screenshots/${filename}`;
  btnDownloadSinglePrint.href = `/screenshots/${filename}`;
  btnDownloadSinglePrint.setAttribute('download', filename);
  modalPrint.classList.add('active');
};

btnFecharModalPrint.addEventListener('click', () => {
  modalPrint.classList.remove('active');
});

modalPrint.addEventListener('click', (e) => {
  if (e.target === modalPrint) modalPrint.classList.remove('active');
});

// Histórico de Lotes
async function carregarHistorico() {
  try {
    const res = await fetch('/api/lotes');
    if (!res.ok) return;
    const lotes = await res.json();

    if (lotes.length === 0) {
      historicoContainer.innerHTML = '<p class="empty-state">Nenhum lote realizado ainda.</p>';
      return;
    }

    let html = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Identificador do Lote</th>
            <th>Ano</th>
            <th>Data de Criação</th>
            <th>Total CNPJs</th>
            <th>Status</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
    `;

    lotes.forEach(l => {
      const dataFormatada = new Date(l.dataHoraCriacao).toLocaleString('pt-BR');
      html += `
        <tr>
          <td><strong>${l.id}</strong></td>
          <td>${l.ano}</td>
          <td>${dataFormatada}</td>
          <td>${l.concluidas} / ${l.totalConsultas} concluídos</td>
          <td><span class="badge ${l.status === 'CONCLUIDO' ? 'badge-concluido' : 'badge-na-fila'}">${l.status}</span></td>
          <td>
            <button class="btn btn-secondary btn-sm" onclick="iniciarAcompanhamento('${l.id}')">Ver Lote</button>
            ${l.concluidas > 0 ? `<a class="btn btn-success btn-sm" href="/api/lotes/${l.id}/download-zip">📦 Baixar ZIP</a>` : ''}
          </td>
        </tr>
      `;
    });

    html += '</tbody></table>';
    historicoContainer.innerHTML = html;
  } catch (_) {}
}

btnRecarregarHistorico.addEventListener('click', carregarHistorico);

// Inicia carregando o histórico e os prestadores
carregarHistorico();
carregarPrestadores();
