/**
 * financeiro/js/contratos.js
 * Módulo 12 — Lista de Contratos (dashboard principal)
 */

const API = '/api/contracts';
let statusFiltro = 'ativo';
let buscaTexto = '';
let syncTimer = null;

// ── Inicialização ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.filter-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      statusFiltro = btn.dataset.status;
      carregarContratos();
    });
  });

  document.getElementById('filtroBusca').addEventListener('input', e => {
    buscaTexto = e.target.value;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(carregarContratos, 350);
  });

  document.getElementById('btnSync').addEventListener('click', sincronizar);

  // Modal
  document.getElementById('btnFecharModal').addEventListener('click', fecharModal);
  document.getElementById('btnCancelarModal').addEventListener('click', fecharModal);
  document.getElementById('formContrato').addEventListener('submit', salvarContrato);

  carregarContratos();
});

// ── Carregar lista ────────────────────────────────────────────────────────────
async function carregarContratos() {
  mostrar('loadingState');
  esconder('tabelaWrapper');
  esconder('emptyState');

  try {
    const params = new URLSearchParams({ status: statusFiltro, q: buscaTexto });
    const r = await fetch(`${API}?${params}`);
    const data = await r.json();

    if (!data.success) throw new Error(data.error || 'Erro desconhecido');

    atualizarKPIs(data.kpis || {});
    atualizarBannerSync(data.lastSync);
    renderizarTabela(data.contratos || []);
  } catch (err) {
    mostrar('emptyState');
    document.querySelector('#emptyState p').textContent = 'Erro ao carregar: ' + err.message;
    esconder('loadingState');
  }
}

// ── KPIs ──────────────────────────────────────────────────────────────────────
function atualizarKPIs(kpis) {
  setText('kpiAtivos', kpis.contratosAtivos ?? '—');
  setText('kpiUnidades', kpis.unidadesAtivas ?? '—');
  setText('kpiMaquinas', kpis.maquinasAtendimento ?? '—');
  setText('kpiTotal', kpis.totalContratos ?? '—');
}

// ── Banner Sync ───────────────────────────────────────────────────────────────
function atualizarBannerSync(lastSync) {
  const el = document.getElementById('infoUltimaSync');
  if (!lastSync) { el.textContent = 'Nunca sincronizado'; return; }
  const dt = new Date(lastSync.timestamp);
  const dur = lastSync.duracaoMs ? ` · ${(lastSync.duracaoMs / 1000).toFixed(1)}s` : '';
  el.textContent = `Última: ${dt.toLocaleString('pt-BR')} · ${lastSync.grupos ?? '?'} grupos · ${lastSync.equipamentos ?? '?'} equipamentos${dur}`;
}

// ── Renderizar Tabela ─────────────────────────────────────────────────────────
function renderizarTabela(contratos) {
  esconder('loadingState');
  if (!contratos.length) { mostrar('emptyState'); return; }

  const tbody = document.getElementById('tbodyContratos');
  tbody.innerHTML = '';

  contratos.forEach(c => {
    const tr = document.createElement('tr');
    if (!c.hasLocalData) tr.classList.add('sem-dados');

    const badgeSit = badgeSituacao(c.situacao);
    const inferido = c.situacaoInferida ? ' <span style="font-size:0.68rem;color:#94a3b8;">(auto)</span>' : '';
    const pendencia = !c.hasLocalData ? '<span class="pendencia-dot"></span>Sem dados locais' : '';
    const refText = c.referencia || '<span style="color:var(--text-muted);">—</span>';
    const diff = c.maquinasContratadas
      ? ` <span style="color:${c.totalEquipamentos === c.maquinasContratadas ? '#34d399' : '#f59e0b'};font-size:0.75rem;">(prev. ${c.maquinasContratadas})</span>`
      : '';
    const totalGeralInfo = (c.totalEquipamentosGeral !== undefined && c.totalEquipamentosGeral !== c.totalEquipamentos)
      ? ` <span style="color:var(--text-muted);font-size:0.75rem;">(${c.totalEquipamentosGeral} total)</span>`
      : '';

    tr.innerHTML = `
      <td>
        <div style="font-weight:700;color:#fff;">${esc(c.nome)}</div>
        <div style="font-size:0.75rem;color:var(--text-muted);">ID Auvo: ${c.auvoId}</div>
      </td>
      <td>${refText}</td>
      <td>${badgeSit}${inferido}</td>
      <td style="text-align:center;">${c.totalUnidades} <span style="color:var(--text-muted);font-size:0.78rem;">(${c.unidadesAtivas} ativas)</span></td>
      <td style="text-align:center;"><strong>${c.totalEquipamentos}</strong> ativos${totalGeralInfo}${diff}</td>
      <td style="text-align:center;">${c.maquinasContratadas ?? '<span style="color:var(--text-muted);">—</span>'}</td>
      <td>${pendencia}</td>
    `;

    // Clique na linha: vai para a página de detalhe
    tr.addEventListener('click', (e) => {
      // Permite clicar no botão editar sem abrir detalhe
      if (e.target.closest('.btn-editar')) return;
      window.location.href = `contrato_detalhe.html?id=${c.auvoId}`;
    });

    tbody.appendChild(tr);
  });

  mostrar('tabelaWrapper');
}

// ── Sincronizar ───────────────────────────────────────────────────────────────
async function sincronizar() {
  const btn = document.getElementById('btnSync');
  btn.classList.add('spinning');
  document.getElementById('syncText').textContent = 'Sincronizando...';
  btn.disabled = true;

  try {
    const r = await fetch(API + '?action=sync', { method: 'POST' });
    const data = await r.json();
    if (!data.success) throw new Error(data.error);
    atualizarBannerSync(data);
    await carregarContratos();
  } catch (err) {
    alert('Erro na sincronização: ' + err.message);
  } finally {
    btn.classList.remove('spinning');
    document.getElementById('syncText').textContent = 'Atualizar agora';
    btn.disabled = false;
  }
}

// ── Modal Editar ──────────────────────────────────────────────────────────────
function abrirModal(contrato) {
  document.getElementById('contratoAuvoId').value = contrato.auvoId;
  document.getElementById('cNome').value = contrato.nome || '';
  document.getElementById('cReferencia').value = contrato.referencia || '';
  document.getElementById('cResponsavel').value = contrato.responsavel || '';
  document.getElementById('cDataInicio').value = contrato.dataInicio || '';
  document.getElementById('cDataFim').value = contrato.dataFim || '';
  document.getElementById('cSituacao').value = contrato.situacaoManual || '';
  document.getElementById('cMaquinas').value = contrato.maquinasContratadas || '';
  document.getElementById('cObs').value = contrato.observacoes || '';
  document.getElementById('modalContrato').style.display = 'flex';
}

function fecharModal() {
  document.getElementById('modalContrato').style.display = 'none';
}

async function salvarContrato(e) {
  e.preventDefault();
  const btn = document.getElementById('btnSalvarContrato');
  btn.disabled = true;
  btn.textContent = 'Salvando...';
  try {
    const r = await fetch(API + '?action=save_contract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auvoId: document.getElementById('contratoAuvoId').value,
        nomeExibicao: document.getElementById('cNome').value,
        referencia: document.getElementById('cReferencia').value,
        responsavel: document.getElementById('cResponsavel').value,
        dataInicio: document.getElementById('cDataInicio').value || null,
        dataFim: document.getElementById('cDataFim').value || null,
        situacaoManual: document.getElementById('cSituacao').value || null,
        maquinasContratadas: document.getElementById('cMaquinas').value || null,
        observacoes: document.getElementById('cObs').value
      })
    });
    const data = await r.json();
    if (!data.success) throw new Error(data.error || 'Falha ao salvar.');
    fecharModal();
    await carregarContratos();
  } catch (err) {
    alert('Erro: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Salvar';
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function badgeSituacao(sit) {
  const map = { ativo: 'badge-ativo', inativo: 'badge-inativo', a_revisar: 'badge-revisar' };
  const label = { ativo: 'Ativo', inativo: 'Inativo', a_revisar: 'A revisar' };
  return `<span class="${map[sit] || 'badge-inativo'}">${label[sit] || sit}</span>`;
}
function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function mostrar(id) { const el = document.getElementById(id); if (el) el.style.display = ''; }
function esconder(id) { const el = document.getElementById(id); if (el) el.style.display = 'none'; }
function setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }
