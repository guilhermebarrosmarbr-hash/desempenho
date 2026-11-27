/**
 * financeiro/js/contrato_detalhe.js
 * Módulo 12 — Página de Detalhe do Contrato
 */

const API = '/api/contracts';
let contratoId = null;
let contratoAtual = null;
let buscaTimer = null;
let statusEquipFiltro = 'ativo';

// ── Inicialização ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  contratoId = params.get('id');
  if (!contratoId) { window.location.href = 'contratos.html'; return; }

  document.getElementById('btnEditarContrato').addEventListener('click', () => abrirModal());
  document.getElementById('btnFecharModal').addEventListener('click', fecharModal);
  document.getElementById('btnCancelarModal').addEventListener('click', fecharModal);
  document.getElementById('formContrato').addEventListener('submit', salvarContrato);
  document.getElementById('filtroBusca').addEventListener('input', e => {
    clearTimeout(buscaTimer);
    buscaTimer = setTimeout(() => filtrarUnidades(e.target.value), 300);
  });
  document.getElementById('filtroStatusEquip').addEventListener('change', e => {
    statusEquipFiltro = e.target.value;
    if (contratoAtual) {
      renderizarUnidades(contratoAtual.unidades, document.getElementById('filtroBusca').value);
    }
  });

  carregarContrato();
});

// ── Carregar Contrato ─────────────────────────────────────────────────────────
async function carregarContrato() {
  document.getElementById('loadingState').style.display = '';
  document.getElementById('conteudo').style.display = 'none';

  try {
    const r = await fetch(`${API}?action=contrato&id=${contratoId}`);
    const data = await r.json();
    if (!data.success) throw new Error(data.error || 'Erro desconhecido');

    contratoAtual = data.contrato;
    renderizarContrato(data.contrato, data.snapMesAnterior);
  } catch (err) {
    document.getElementById('loadingState').innerHTML =
      `<div style="font-size:1.5rem;margin-bottom:12px;">❌</div>
       <p style="color:#f87171;">Erro: ${err.message}</p>
       <a href="contratos.html" class="btn btn-secondary" style="margin-top:16px;">← Voltar</a>`;
  }
}

// ── Renderizar ────────────────────────────────────────────────────────────────
function renderizarContrato(c, snap) {
  document.getElementById('tituloContrato').textContent = c.nome;
  document.getElementById('subtituloContrato').textContent =
    (c.referencia ? `${c.referencia} · ` : '') + 'Módulo 12 — Contratos';

  // Alerta situação inferida
  if (c.situacaoInferida) {
    document.getElementById('alertaSituacao').style.display = '';
  }

  // Resumo
  const equipTotalGeral = c.unidades.reduce((s, u) => s + u.equipamentos.length, 0);
  const equipTotal = c.unidades.reduce((s, u) => s + u.equipamentos.filter(eq => eq.ativo).length, 0);
  const varMaquinas = snap
    ? equipTotal - (snap.total_equipamentos || 0)
    : null;
  const varLabel = varMaquinas === null ? 'Sem histórico'
    : varMaquinas === 0 ? '= igual ao mês anterior'
    : varMaquinas > 0 ? `+${varMaquinas} vs. mês anterior`
    : `${varMaquinas} vs. mês anterior`;
  const varColor = varMaquinas === null || varMaquinas === 0 ? '#94a3b8'
    : varMaquinas > 0 ? '#34d399' : '#f87171';

  document.getElementById('resumoGrid').innerHTML = `
    <div class="resumo-item">
      <div class="resumo-label">Situação</div>
      <div class="resumo-valor">${badgeSituacao(c.situacao)}${c.situacaoInferida ? ' <span style="font-size:0.7rem;color:#94a3b8;">(auto)</span>' : ''}</div>
    </div>
    <div class="resumo-item">
      <div class="resumo-label">Unidades / Locais</div>
      <div class="resumo-valor">${c.totalUnidades} <span style="font-size:0.8rem;color:#94a3b8;">(${c.unidadesAtivas} ativas)</span></div>
    </div>
    <div class="resumo-item">
      <div class="resumo-label">Equipamentos Ativos</div>
      <div class="resumo-valor">${equipTotal} <span style="font-size:0.78rem;color:var(--text-muted);">(${equipTotalGeral} total)</span> <span style="font-size:0.78rem;color:${varColor};">${varLabel}</span></div>
    </div>
    ${c.maquinasContratadas ? `
    <div class="resumo-item" style="border-left:4px solid ${equipTotal === c.maquinasContratadas ? '#34d399' : '#f59e0b'}">
      <div class="resumo-label">Contratado vs. Encontrado</div>
      <div class="resumo-valor">${c.maquinasContratadas} prev. / ${equipTotal} atual</div>
    </div>` : ''}
    ${c.responsavel ? `
    <div class="resumo-item">
      <div class="resumo-label">Responsável</div>
      <div class="resumo-valor" style="font-size:0.9rem;">${esc(c.responsavel)}</div>
    </div>` : ''}
    ${c.referencia ? `
    <div class="resumo-item">
      <div class="resumo-label">Referência</div>
      <div class="resumo-valor" style="font-size:0.9rem;">${esc(c.referencia)}</div>
    </div>` : ''}
    ${c.dataInicio || c.dataFim ? `
    <div class="resumo-item">
      <div class="resumo-label">Vigência</div>
      <div class="resumo-valor" style="font-size:0.85rem;">${c.dataInicio || '?'} → ${c.dataFim || 'em aberto'}</div>
    </div>` : ''}
    ${c.observacoes ? `
    <div class="resumo-item" style="grid-column: 1 / -1;">
      <div class="resumo-label">Observações</div>
      <div style="font-size:0.85rem;color:var(--text-secondary);margin-top:4px;">${esc(c.observacoes)}</div>
    </div>` : ''}
  `;

  document.getElementById('lblUnidades').textContent = `${c.totalUnidades} Unidade${c.totalUnidades !== 1 ? 's' : ''}`;

  // Renderiza unidades
  renderizarUnidades(c.unidades);

  // Total do contrato
  renderizarTotalContrato(c);

  document.getElementById('loadingState').style.display = 'none';
  document.getElementById('conteudo').style.display = '';
}

// ── Renderizar Unidades ───────────────────────────────────────────────────────
function renderizarUnidades(unidades, filtro = '') {
  const container = document.getElementById('listaUnidades');
  container.innerHTML = '';

  const q = filtro.toLowerCase();
  let visiveis = 0;

  unidades.forEach((u, idx) => {
    const equipsFiltrados = u.equipamentos.filter(eq => {
      if (statusEquipFiltro === 'ativo') return eq.ativo;
      if (statusEquipFiltro === 'inativo') return !eq.ativo;
      return true;
    });

    // Filtro busca: unidade ou algum equipamento
    if (q) {
      const matchUnidade = u.nome.toLowerCase().includes(q) || (u.endereco || '').toLowerCase().includes(q);
      const matchEquip = equipsFiltrados.some(eq =>
        eq.nome.toLowerCase().includes(q) || (eq.identificacao || '').toLowerCase().includes(q)
      );
      if (!matchUnidade && !matchEquip) return;
    }
    visiveis++;

    const totalEquipsAtivos = u.equipamentos.filter(eq => eq.ativo).length;
    const totalEquipsUnidade = equipsFiltrados.length;
    const labelEquips = statusEquipFiltro === 'ativo'
      ? `${totalEquipsAtivos} ativos (${u.equipamentos.length} total)`
      : `${totalEquipsUnidade} equip.`;
    const subtotalFormatado = u.subtotalIncompleto
      ? `<span style="color:#f59e0b;">Incompleto</span>`
      : `R$ ${fmt(u.subtotal)}`;

    const div = document.createElement('div');
    div.className = 'unidade-row';
    div.dataset.idx = idx;

    div.innerHTML = `
      <div class="unidade-header" data-idx="${idx}">
        <button class="btn-expand" id="btnExp-${idx}" title="Expandir equipamentos">▶</button>
        <div style="flex: 1; min-width: 0;">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <span class="unidade-nome">${esc(u.nome)}</span>
            ${u.ativo ? '' : '<span class="badge-inativo">Inativa</span>'}
          </div>
          ${u.endereco ? `<div class="unidade-end">📍 ${esc(u.endereco)}</div>` : ''}
        </div>
        <div style="display:flex;align-items:center;gap:14px;flex-shrink:0;">
          <span style="font-size:0.82rem;color:var(--text-muted);">${labelEquips}</span>
          <span style="font-size:0.85rem;font-weight:700;color:#fff;">${subtotalFormatado}</span>
          <a href="${u.auvoUrl}" target="_blank" rel="noopener" class="link-auvo" title="Abrir cadastro na Auvo" onclick="event.stopPropagation()">
            🔗 Auvo
          </a>
        </div>
      </div>
      <div id="equips-${idx}" style="display:none;">
        ${renderizarEquipamentos(equipsFiltrados, idx)}
      </div>
    `;

    // Expandir via botão seta (somente botão, não o link)
    div.querySelector('.unidade-header').addEventListener('click', (e) => {
      if (e.target.closest('a')) return; // não abre se clicou no link Auvo
      toggleEquips(idx);
    });

    container.appendChild(div);
  });

  if (visiveis === 0) {
    container.innerHTML = `<div class="empty-state"><p>Nenhuma unidade encontrada para "${esc(filtro)}".</p></div>`;
  }
}

function toggleEquips(idx) {
  const painel = document.getElementById(`equips-${idx}`);
  const btn = document.getElementById(`btnExp-${idx}`);
  const aberto = painel.style.display !== 'none';
  painel.style.display = aberto ? 'none' : '';
  btn.textContent = aberto ? '▶' : '▼';
  btn.classList.toggle('open', !aberto);
}

// ── Renderizar Equipamentos ───────────────────────────────────────────────────
function renderizarEquipamentos(equips, unidadeIdx) {
  if (!equips.length) {
    return `<div style="padding:20px 24px;color:var(--text-muted);font-size:0.85rem;">Nenhum equipamento cadastrado nesta unidade.</div>`;
  }

  const linhas = equips.map((eq, eqIdx) => {
    const valorAtual = eq.valor !== undefined && eq.valor !== null
      ? eq.valor.toFixed(2)
      : '';
    const tagStatus = eq.valorPendente
      ? `<span class="tag-pendente">⚠ Valor pendente</span>`
      : (eq.incluidoContrato === false ? `<span class="tag-nao-incluido">Não incluído</span>` : '');

    return `
      <tr>
        <td>
          <div style="font-weight:600;color:#fff;">${esc(eq.nome)}</div>
          ${eq.identificacao ? `<div style="font-size:0.76rem;color:var(--text-muted);">S/N: ${esc(eq.identificacao)}</div>` : ''}
        </td>
        <td>${eq.ativo ? '<span class="badge-ativo">Ativo</span>' : '<span class="badge-inativo">Inativo</span>'}</td>
        <td>
          <div class="valor-cell">
            <input type="number" class="input-valor" id="val-${unidadeIdx}-${eqIdx}"
              value="${valorAtual}" placeholder="Não informado" min="0" step="0.01"
              data-grupo="${contratoId}" data-equip="${eq.auvoId}">
            <button class="btn-save-valor" onclick="salvarValorEquip('${unidadeIdx}','${eqIdx}','${eq.auvoId}')">✓</button>
          </div>
          ${tagStatus}
        </td>
        <td>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:0.82rem;">
            <input type="checkbox" id="chk-${unidadeIdx}-${eqIdx}" ${eq.incluidoContrato !== false ? 'checked' : ''}
              onchange="salvarInclusaoEquip('${unidadeIdx}','${eqIdx}','${eq.auvoId}',this.checked)">
            Incluído
          </label>
        </td>
      </tr>`;
  }).join('');

  const subtotalTexto = (() => {
    const unidade = contratoAtual?.unidades?.[unidadeIdx];
    if (!unidade) return 'Calculando...';
    if (unidade.subtotalIncompleto) return '<span style="color:#f59e0b;">Total incompleto — valores pendentes</span>';
    return `Subtotal: <strong>R$ ${fmt(unidade.subtotal)}</strong>`;
  })();

  return `
    <table class="table-equips">
      <thead><tr>
        <th>Equipamento</th>
        <th>Status</th>
        <th>Valor no Contrato (R$)</th>
        <th>Inclusão</th>
      </tr></thead>
      <tbody>${linhas}</tbody>
      <tfoot><tr>
        <td colspan="2"></td>
        <td colspan="2" style="text-align:right;">${subtotalTexto}</td>
      </tr></tfoot>
    </table>`;
}

// ── Salvar Valor de Equipamento ───────────────────────────────────────────────
async function salvarValorEquip(uIdx, eIdx, auvoEquipId) {
  const input = document.getElementById(`val-${uIdx}-${eIdx}`);
  const valor = input.value.trim();
  const btn = input.nextElementSibling;
  btn.disabled = true;
  btn.textContent = '...';
  try {
    const r = await fetch(`${API}?action=save_equip_value`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auvoGroupId: contratoId,
        auvoEquipId,
        valor: valor === '' ? null : parseFloat(valor),
        incluidoContrato: document.getElementById(`chk-${uIdx}-${eIdx}`)?.checked !== false
      })
    });
    const data = await r.json();
    if (!data.success) throw new Error(data.error);
    btn.textContent = '✓';
    btn.style.background = '#059669';
    setTimeout(() => { btn.style.background = ''; btn.textContent = '✓'; }, 1500);
    // Atualiza subtotal local
    if (contratoAtual?.unidades?.[uIdx]) {
      await carregarContrato(); // recarrega para recalcular totais
    }
  } catch (err) {
    alert('Erro ao salvar: ' + err.message);
    btn.textContent = '✓';
  } finally {
    btn.disabled = false;
  }
}

async function salvarInclusaoEquip(uIdx, eIdx, auvoEquipId, incluido) {
  const input = document.getElementById(`val-${uIdx}-${eIdx}`);
  try {
    await fetch(`${API}?action=save_equip_value`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auvoGroupId: contratoId,
        auvoEquipId,
        valor: input?.value ? parseFloat(input.value) : null,
        incluidoContrato: incluido
      })
    });
  } catch { /* silencioso */ }
}

// ── Total do Contrato ─────────────────────────────────────────────────────────
function renderizarTotalContrato(c) {
  let total = 0;
  let incompleto = false;
  c.unidades.forEach(u => {
    if (u.subtotalIncompleto) incompleto = true;
    else total += u.subtotal || 0;
  });

  const el = document.getElementById('totalContratoValor');
  if (incompleto) {
    el.innerHTML = `<span style="color:#f59e0b;">R$ ${fmt(total)} + valores pendentes</span>`;
  } else {
    el.textContent = `R$ ${fmt(total)}`;
  }
}

// ── Filtro Busca ──────────────────────────────────────────────────────────────
function filtrarUnidades(q) {
  if (!contratoAtual) return;
  renderizarUnidades(contratoAtual.unidades, q);
}

// ── Modal Editar Contrato ─────────────────────────────────────────────────────
function abrirModal() {
  if (!contratoAtual) return;
  const c = contratoAtual;
  document.getElementById('contratoAuvoId').value = c.auvoId;
  document.getElementById('cNome').value = c.nome || '';
  document.getElementById('cReferencia').value = c.referencia || '';
  document.getElementById('cResponsavel').value = c.responsavel || '';
  document.getElementById('cDataInicio').value = c.dataInicio || '';
  document.getElementById('cDataFim').value = c.dataFim || '';
  document.getElementById('cSituacao').value = c.situacaoManual || '';
  document.getElementById('cMaquinas').value = c.maquinasContratadas || '';
  document.getElementById('cObs').value = c.observacoes || '';
  document.getElementById('modalContrato').style.display = 'flex';
}

function fecharModal() {
  document.getElementById('modalContrato').style.display = 'none';
}

async function salvarContrato(e) {
  e.preventDefault();
  const btn = e.submitter;
  if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }
  try {
    const r = await fetch(`${API}?action=save_contract`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
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
    await carregarContrato();
  } catch (err) {
    alert('Erro: ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Salvar'; }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function badgeSituacao(sit) {
  const map = { ativo: 'badge-ativo', inativo: 'badge-inativo', a_revisar: 'badge-revisar' };
  const label = { ativo: 'Ativo', inativo: 'Inativo', a_revisar: 'A revisar' };
  return `<span class="${map[sit] || 'badge-inativo'}">${label[sit] || sit}</span>`;
}
function fmt(n) { return Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
