/**
 * financeiro/js/estoque.js
 * Módulo 11: Controle de Estoque & Produtos Auvo
 * 
 * Funcionalidades:
 * - Consulta ao backend (/api/stock) com preservação de cache local resiliente
 * - Paginação inteligente, ordenação de colunas e busca instantânea
 * - Filtros por categoria, situação (ativo/inativo) e estoque abaixo do mínimo
 * - Destaque visual em vermelho pulsante para produtos abaixo do estoque mínimo
 * - Modal detalhado com visualização de estoque em posse de técnicos/colaboradores
 * - Sincronização manual com botão "Atualizar agora" e automática a cada 15 minutos
 */

(function() {
    'use strict';

    const STORAGE_KEY_ESTOQUE = 'bpo_auvo_stock_cache_v1';
    const STORAGE_KEY_LAST_SYNC = 'bpo_auvo_stock_last_sync_v1';
    const INTERVALO_AUTO_SYNC_MS = 15 * 60 * 1000; // 15 minutos

    // Estado da Aplicação
    let produtosCarregados = [];
    let produtosFiltrados = [];
    let categorias = [];
    let sincronizando = false;
    let timerAutoSync = null;

    // Paginação
    let paginaAtual = 1;
    const itensPorPagina = 50;

    // Ordenação
    let colunaOrdenacao = 'name';
    let direcaoOrdenacao = 'asc';

    // Elementos DOM
    const btnSincronizarAgora = document.getElementById('btnSincronizarAgora');
    const syncIcon = document.getElementById('syncIcon');
    const syncText = document.getElementById('syncText');
    const infoUltimaSync = document.getElementById('infoUltimaSync');
    const errorBanner = document.getElementById('errorBanner');
    const errorBannerText = document.getElementById('errorBannerText');
    const loadingIndicator = document.getElementById('loadingIndicator');

    // Métricas
    const valTotalItens = document.getElementById('valTotalItens');
    const valItensComEstoque = document.getElementById('valItensComEstoque');
    const valItensAbaixoMinimo = document.getElementById('valItensAbaixoMinimo');
    const valItensComTecnicos = document.getElementById('valItensComTecnicos');

    // Filtros
    const filtroBusca = document.getElementById('filtroBusca');
    const filtroCategoria = document.getElementById('filtroCategoria');
    const filtroStatus = document.getElementById('filtroStatus');
    const filtroEstoqueNivel = document.getElementById('filtroEstoqueNivel');
    const btnLimparFiltros = document.getElementById('btnLimparFiltros');

    // Tabela e Paginação
    const listaEstoqueBody = document.getElementById('listaEstoqueBody');
    const resumoContagemProdutos = document.getElementById('resumoContagemProdutos');
    const infoPaginacao = document.getElementById('infoPaginacao');
    const btnPaginaAnt = document.getElementById('btnPaginaAnt');
    const btnPaginaProx = document.getElementById('btnPaginaProx');

    // Modal
    const modalDetalheProduto = document.getElementById('modalDetalheProduto');

    // =========================================================================
    // INICIALIZAÇÃO
    // =========================================================================

    window.addEventListener('DOMContentLoaded', async () => {
        // 1. Tenta carregar dados do cache local para renderização imediata (sem esperar rede)
        carregarDoCacheLocal();

        // 2. Registra eventos de interface
        configurarEventos();

        // 3. Busca dados atualizados da API
        await carregarEstoque(false);

        // 4. Inicia ciclo de atualização automática a cada 15 minutos
        iniciarAutoSync();
    });

    function configurarEventos() {
        btnSincronizarAgora.addEventListener('click', () => carregarEstoque(true));

        // Busca com debounce leve
        let debounceBusca = null;
        filtroBusca.addEventListener('input', () => {
            clearTimeout(debounceBusca);
            debounceBusca = setTimeout(() => {
                paginaAtual = 1;
                aplicarFiltros();
            }, 250);
        });

        filtroCategoria.addEventListener('change', () => {
            paginaAtual = 1;
            aplicarFiltros();
        });

        filtroStatus.addEventListener('change', () => {
            paginaAtual = 1;
            aplicarFiltros();
        });

        filtroEstoqueNivel.addEventListener('change', () => {
            paginaAtual = 1;
            aplicarFiltros();
        });

        btnLimparFiltros.addEventListener('click', () => {
            filtroBusca.value = '';
            filtroCategoria.value = 'all';
            filtroStatus.value = 'active';
            filtroEstoqueNivel.value = 'all';
            paginaAtual = 1;
            aplicarFiltros();
        });

        btnPaginaAnt.addEventListener('click', () => {
            if (paginaAtual > 1) {
                paginaAtual--;
                renderizarTabela();
            }
        });

        btnPaginaProx.addEventListener('click', () => {
            const maxPaginas = Math.ceil(produtosFiltrados.length / itensPorPagina) || 1;
            if (paginaAtual < maxPaginas) {
                paginaAtual++;
                renderizarTabela();
            }
        });

        // Ordenação de colunas
        document.querySelectorAll('.th-sort').forEach(btn => {
            btn.addEventListener('click', () => {
                const col = btn.dataset.col;
                if (colunaOrdenacao === col) {
                    direcaoOrdenacao = direcaoOrdenacao === 'asc' ? 'desc' : 'asc';
                } else {
                    colunaOrdenacao = col;
                    direcaoOrdenacao = 'asc';
                }
                ordenarEExibir();
            });
        });
    }

    // =========================================================================
    // COMUNICAÇÃO COM O BACKEND / API
    // =========================================================================

    async function carregarEstoque(forcarSincronizacao = false) {
        if (sincronizando) return;
        sincronizando = true;

        btnSincronizarAgora.classList.add('spinning');
        syncText.textContent = forcarSincronizacao ? 'Sincronizando...' : 'Atualizando...';
        esconderErro();

        if (produtosCarregados.length === 0) {
            loadingIndicator.style.display = 'block';
        }

        try {
            const url = forcarSincronizacao ? '/api/stock?action=sync' : '/api/stock?action=list';
            const method = forcarSincronizacao ? 'POST' : 'GET';

            const resp = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' }
            });

            if (!resp.ok) {
                throw new Error(`Erro na API de estoque: HTTP ${resp.status}`);
            }

            const json = await resp.json();

            if (!json.success && json.error) {
                throw new Error(json.error);
            }

            // Atualiza produtos
            if (Array.isArray(json.products)) {
                produtosCarregados = json.products;
                salvarNoCacheLocal(produtosCarregados, json.lastSync);
            } else if (forcarSincronizacao) {
                // Se foi sync, refaz busca simples para atualizar a lista
                const listResp = await fetch('/api/stock?action=list');
                const listJson = await listResp.json();
                if (Array.isArray(listJson.products)) {
                    produtosCarregados = listJson.products;
                    salvarNoCacheLocal(produtosCarregados, listJson.lastSync);
                }
            }

            // Categorias
            if (Array.isArray(json.categorias) && json.categorias.length > 0) {
                categorias = json.categorias;
                popularSelectCategorias();
            }

            atualizarStatusSync(json.lastSync);
            aplicarFiltros();

        } catch (err) {
            console.error('Falha na sincronização de estoque:', err);
            mostrarErro(err.message || 'Falha ao sincronizar com a Auvo. Os últimos dados válidos foram preservados.');
        } finally {
            sincronizando = false;
            btnSincronizarAgora.classList.remove('spinning');
            syncText.textContent = 'Atualizar agora';
            loadingIndicator.style.display = 'none';
        }
    }

    function popularSelectCategorias() {
        const valAtual = filtroCategoria.value;
        filtroCategoria.innerHTML = '<option value="all">Todas as Categorias</option>';
        categorias.forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat.id;
            opt.textContent = cat.description || cat.name || `Categoria #${cat.id}`;
            filtroCategoria.appendChild(opt);
        });
        filtroCategoria.value = valAtual || 'all';
    }

    // =========================================================================
    // FILTROS, ORDENAÇÃO E MÉTRICAS
    // =========================================================================

    function aplicarFiltros() {
        const termo = filtroBusca.value.toLowerCase().trim();
        const cat = filtroCategoria.value;
        const status = filtroStatus.value;
        const nivel = filtroEstoqueNivel.value;

        produtosFiltrados = produtosCarregados.filter(p => {
            // 1. Busca por código ou nome
            if (termo) {
                const matchNome = (p.name || '').toLowerCase().includes(termo);
                const matchCod = String(p.code || '').toLowerCase().includes(termo);
                const matchDesc = (p.description || '').toLowerCase().includes(termo);
                const matchExt = (p.externalId || '').toLowerCase().includes(termo);
                if (!matchNome && !matchCod && !matchDesc && !matchExt) return false;
            }

            // 2. Categoria
            if (cat !== 'all') {
                if (String(p.categoryId) !== String(cat)) return false;
            }

            // 3. Situação
            if (status !== 'all') {
                const ativo = status === 'active';
                if (p.active !== ativo) return false;
            }

            // 4. Nível de Estoque
            if (nivel === 'below_min') {
                if (p.minimumStock === null || p.totalStock === null || p.totalStock >= p.minimumStock) return false;
            } else if (nivel === 'positive') {
                if (p.totalStock === null || p.totalStock <= 0) return false;
            } else if (nivel === 'zero') {
                if (p.totalStock !== 0) return false;
            }

            return true;
        });

        atualizarMetricas();
        ordenarEExibir();
    }

    function ordenarEExibir() {
        produtosFiltrados.sort((a, b) => {
            let valA = a[colunaOrdenacao];
            let valB = b[colunaOrdenacao];

            // Trata nulos
            if (valA === null || valA === undefined) valA = -999999;
            if (valB === null || valB === undefined) valB = -999999;

            if (typeof valA === 'string') {
                const cmp = valA.localeCompare(String(valB), 'pt-BR', { numeric: true, sensitivity: 'base' });
                return direcaoOrdenacao === 'asc' ? cmp : -cmp;
            }

            return direcaoOrdenacao === 'asc' ? (valA - valB) : (valB - valA);
        });

        renderizarTabela();
    }

    function atualizarMetricas() {
        valTotalItens.textContent = produtosCarregados.length.toLocaleString('pt-BR');

        const comEstoque = produtosCarregados.filter(p => typeof p.totalStock === 'number' && p.totalStock > 0).length;
        valItensComEstoque.textContent = comEstoque.toLocaleString('pt-BR');

        const abaixoMinimo = produtosCarregados.filter(p => 
            p.minimumStock !== null && p.totalStock !== null && p.totalStock < p.minimumStock
        ).length;
        valItensAbaixoMinimo.textContent = abaixoMinimo.toLocaleString('pt-BR');

        const comTecnicos = produtosCarregados.filter(p => 
            Array.isArray(p.employeesStock) && p.employeesStock.some(e => e.amount > 0)
        ).length;
        valItensComTecnicos.textContent = comTecnicos.toLocaleString('pt-BR');
    }

    // =========================================================================
    // RENDERIZAÇÃO DA TABELA
    // =========================================================================

    function renderizarTabela() {
        const total = produtosFiltrados.length;
        resumoContagemProdutos.textContent = `Exibindo ${total.toLocaleString('pt-BR')} produto(s)`;

        if (total === 0) {
            listaEstoqueBody.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center; color: var(--text-muted); padding: 48px;">
                        Nenhum produto encontrado com os filtros selecionados.
                    </td>
                </tr>
            `;
            infoPaginacao.textContent = 'Página 0 de 0';
            btnPaginaAnt.disabled = true;
            btnPaginaProx.disabled = true;
            return;
        }

        const maxPaginas = Math.ceil(total / itensPorPagina);
        if (paginaAtual > maxPaginas) paginaAtual = maxPaginas;

        const inicio = (paginaAtual - 1) * itensPorPagina;
        const fim = inicio + itensPorPagina;
        const itensPagina = produtosFiltrados.slice(inicio, fim);

        listaEstoqueBody.innerHTML = itensPagina.map(p => {
            const codExibicao = p.code || (p.externalId ? escapeHtml(p.externalId) : '<span style="color:var(--text-muted);">Não informado</span>');
            const nomeExibicao = escapeHtml(p.name || 'Não informado');
            const catExibicao = escapeHtml(p.categoryName || 'Não informada');

            // Validação de Estoque
            const hasTotal = typeof p.totalStock === 'number';
            const hasMin = typeof p.minimumStock === 'number';
            const totalStockVal = hasTotal ? p.totalStock : null;
            const minStockVal = hasMin ? p.minimumStock : null;

            const isAbaixoMinimo = hasTotal && hasMin && (totalStockVal < minStockVal);

            let estoqueBadge = '';
            if (!hasTotal) {
                estoqueBadge = '<span style="color:var(--text-muted); font-size:0.8rem;">Não informado</span>';
            } else if (isAbaixoMinimo) {
                estoqueBadge = `
                    <div style="display:flex; flex-direction:column; align-items:flex-end;">
                        <span class="badge-estoque-baixo">⚠️ ${totalStockVal}</span>
                        <span class="tag-alerta-minimo">Abaixo do Mín (${minStockVal})</span>
                    </div>
                `;
            } else if (totalStockVal > 0) {
                estoqueBadge = `<span class="badge-estoque-ok">${totalStockVal}</span>`;
            } else {
                estoqueBadge = `<span style="color:var(--text-muted); font-weight:600;">0</span>`;
            }

            const minStockBadge = hasMin 
                ? `<span style="color: #fff; font-weight: 500;">${minStockVal}</span>` 
                : '<span style="color:var(--text-muted); font-size:0.8rem;">Não informado</span>';

            // Técnicos com saldo
            const qtdTecnicos = (p.employeesStock || []).filter(e => e.amount > 0).reduce((acc, e) => acc + (Number(e.amount) || 0), 0);
            const tecnicosBadge = qtdTecnicos > 0 
                ? `<span style="background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.3); padding: 2px 8px; border-radius: 4px; font-weight:600; font-size:0.8rem;">${qtdTecnicos} unid.</span>`
                : '<span style="color:var(--text-muted); font-size:0.8rem;">0</span>';

            // Situação
            const statusBadge = p.active 
                ? '<span class="badge badge-success" style="font-size:0.75rem;">Ativo</span>'
                : '<span class="badge badge-warning" style="font-size:0.75rem;">Inativo</span>';

            return `
                <tr style="${isAbaixoMinimo ? 'background: rgba(239, 68, 68, 0.03);' : ''}">
                    <td style="font-family: monospace; font-weight: 600; color: #fff;">${codExibicao}</td>
                    <td>
                        <strong style="color: #fff;">${nomeExibicao}</strong>
                        ${p.description && p.description !== p.name ? `<br><span style="font-size:0.75rem; color:var(--text-muted);">${escapeHtml(p.description)}</span>` : ''}
                    </td>
                    <td><span style="color: var(--text-secondary); font-size:0.82rem;">${catExibicao}</span></td>
                    <td style="text-align: right;">${estoqueBadge}</td>
                    <td style="text-align: right;">${minStockBadge}</td>
                    <td style="text-align: center;">${tecnicosBadge}</td>
                    <td style="text-align: center;">${statusBadge}</td>
                    <td style="text-align: center;">
                        <button class="btn btn-secondary btn-sm btn-ver-detalhes" data-id="${escapeHtml(String(p.id))}" style="padding: 4px 8px; font-size: 0.75rem;">
                            👁️ Ver
                        </button>
                    </td>
                </tr>
            `;
        }).join('');

        // Vincula cliques para modal de detalhes
        listaEstoqueBody.querySelectorAll('.btn-ver-detalhes').forEach(btn => {
            btn.addEventListener('click', () => abrirModalDetalhes(btn.dataset.id));
        });

        // Paginação
        infoPaginacao.textContent = `Página ${paginaAtual} de ${maxPaginas} (${total.toLocaleString('pt-BR')} itens)`;
        btnPaginaAnt.disabled = paginaAtual <= 1;
        btnPaginaProx.disabled = paginaAtual >= maxPaginas;
    }

    // =========================================================================
    // MODAL DE DETALHES DO PRODUTO & TÉCNICOS
    // =========================================================================

    function abrirModalDetalhes(prodId) {
        const prod = produtosCarregados.find(p => String(p.id) === String(prodId));
        if (!prod) return;

        document.getElementById('modalProdNome').textContent = prod.name || 'Produto';
        document.getElementById('modalProdCodigo').textContent = `Código: ${prod.code || 'Não informado'} • ID Auvo: ${prod.id}`;
        document.getElementById('modalProdCategoria').textContent = prod.categoryName || 'Não informada';
        document.getElementById('modalProdEstoqueTotal').textContent = typeof prod.totalStock === 'number' ? prod.totalStock : 'Não informado';
        document.getElementById('modalProdEstoqueMin').textContent = typeof prod.minimumStock === 'number' ? prod.minimumStock : 'Não informado';
        document.getElementById('modalProdStatus').innerHTML = prod.active 
            ? '<span class="badge badge-success">Ativo</span>' 
            : '<span class="badge badge-warning">Inativo</span>';

        const listaTecnicosEl = document.getElementById('modalProdListaTecnicos');
        const empStock = (prod.employeesStock || []).filter(e => typeof e.amount === 'number');

        if (empStock.length === 0) {
            listaTecnicosEl.innerHTML = `
                <tr>
                    <td colspan="3" style="text-align: center; color: var(--text-muted); padding: 24px;">
                        Nenhum saldo ou movimentação de técnicos vinculada a este produto.
                    </td>
                </tr>
            `;
        } else {
            listaTecnicosEl.innerHTML = empStock.map(es => {
                const dataMov = es.lastMovement && es.lastMovement.date 
                    ? new Date(es.lastMovement.date).toLocaleDateString('pt-BR') 
                    : '-';
                const qtdVal = es.amount;

                return `
                    <tr>
                        <td style="font-weight: 500; color: #fff;">${escapeHtml(es.userName || `Técnico #${es.userId}`)}</td>
                        <td style="text-align: right; font-weight: 600; color: ${qtdVal > 0 ? '#34d399' : 'var(--text-muted)'};">
                            ${qtdVal} unid.
                        </td>
                        <td style="text-align: right; color: var(--text-muted); font-size: 0.82rem;">${dataMov}</td>
                    </tr>
                `;
            }).join('');
        }

        modalDetalheProduto.style.display = 'flex';
    }

    window.fecharModalProduto = function() {
        modalDetalheProduto.style.display = 'none';
    };

    // =========================================================================
    // PERSISTÊNCIA EM CACHE & SINCRONIZAÇÃO RESILIENTE
    // =========================================================================

    function salvarNoCacheLocal(produtos, lastSync) {
        try {
            localStorage.setItem(STORAGE_KEY_ESTOQUE, JSON.stringify(produtos));
            if (lastSync) {
                localStorage.setItem(STORAGE_KEY_LAST_SYNC, JSON.stringify(lastSync));
            }
        } catch (e) {
            console.warn('Armazenamento local cheio para cache de estoque:', e);
        }
    }

    function carregarDoCacheLocal() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY_ESTOQUE);
            if (raw) {
                produtosCarregados = JSON.parse(raw);
                aplicarFiltros();
            }

            const rawSync = localStorage.getItem(STORAGE_KEY_LAST_SYNC);
            if (rawSync) {
                atualizarStatusSync(JSON.parse(rawSync));
            }
        } catch (e) {
            console.warn('Erro ao carregar cache local de estoque:', e);
        }
    }

    function atualizarStatusSync(lastSync) {
        if (!lastSync || !lastSync.timestamp) {
            infoUltimaSync.textContent = 'Última sincronização: Nenhuma registrada';
            return;
        }

        const data = new Date(lastSync.timestamp);
        const dataFmt = data.toLocaleDateString('pt-BR');
        const horaFmt = data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const qtd = lastSync.total ? ` (${lastSync.total} produtos)` : '';

        infoUltimaSync.innerHTML = `Última sincronização bem-sucedida: <strong style="color:#fff;">${dataFmt} às ${horaFmt}</strong>${qtd}`;
    }

    function iniciarAutoSync() {
        if (timerAutoSync) clearInterval(timerAutoSync);
        timerAutoSync = setInterval(() => {
            console.log('[AutoSync] Iniciando sincronização automática periódica (15 min)...');
            carregarEstoque(false);
        }, INTERVALO_AUTO_SYNC_MS);
    }

    function mostrarErro(msg) {
        errorBannerText.textContent = msg;
        errorBanner.style.display = 'block';
    }

    function esconderErro() {
        errorBanner.style.display = 'none';
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
})();
