/**
 * m03_app.js - Lógica Principal do Redesign do Módulo 03
 * - Seleção de Competência na barra superior
 * - Resumo por Técnico na área central (cards no modelo da imagem)
 * - Lateral direita com lista de status (Pendente / OK) e Exportação PDF do técnico
 * - Alimentação de faturamento por planilha vinculada ao técnico selecionado
 * - Modais completos de cadastro de Técnicos, Contratos, Setores e Tarefas/Pesos
 */
(function(window) {
  'use strict';

  const M03 = {
    competencia: '2026-10',
    selectedTecnicoId: null,
    tecnicoSelecionadoParaPlanilha: null,

    init() {
      this.initCompetenciaSelector();
      this.bindEvents();
      this.renderTecnicosStatusList();
      this.renderCentralCards();
      this.initModals();
    },

    // -------------------------------------------------------------
    // Formatadores Seguros
    // -------------------------------------------------------------
    formatMoeda(val) {
      if (val === null || val === undefined || isNaN(Number(val))) return '0,00';
      return Number(val).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    },

    formatPct(val) {
      if (val === null || val === undefined || isNaN(Number(val))) return '0%';
      return `${Math.round(Number(val) * 100)}%`;
    },
    initCompetenciaSelector() {
      const select = document.getElementById('selectCompetenciaNav');
      if (!select) return;

      // Monta opções dos últimos 6 meses até próximos 3 meses
      const meses = [
        { val: '2026-07', label: 'Julho / 2026' },
        { val: '2026-08', label: 'Agosto / 2026' },
        { val: '2026-09', label: 'Setembro / 2026' },
        { val: '2026-10', label: 'Outubro / 2026' },
        { val: '2026-11', label: 'Novembro / 2026' },
        { val: '2026-12', label: 'Dezembro / 2026' }
      ];

      select.innerHTML = meses.map(m => `
        <option value="${m.val}" ${m.val === this.competencia ? 'selected' : ''}>${m.label}</option>
      `).join('');

      select.addEventListener('change', (e) => {
        this.competencia = e.target.value;
        this.renderTecnicosStatusList();
        this.renderCentralCards();
      });
    },

    // -------------------------------------------------------------
    // Bind Events Gerais
    // -------------------------------------------------------------
    bindEvents() {
      // Toggle Lateral Esquerda (Tópicos 2+3 unificados)
      const btnToggle = document.getElementById('btnToggleParametros');
      const boxParams = document.getElementById('boxParametrosUnificados');
      if (btnToggle && boxParams) {
        btnToggle.addEventListener('click', () => {
          const isHidden = boxParams.style.display === 'none';
          boxParams.style.display = isHidden ? 'block' : 'none';
          btnToggle.innerHTML = isHidden ? '👁️ Ocultar Parâmetros' : '⚙️ Exibir Parâmetros';
        });
      }

      // Botão Cadastros na barra / lateral
      const btnOpenCadastros = document.getElementById('btnOpenCadastros');
      if (btnOpenCadastros) {
        btnOpenCadastros.addEventListener('click', () => {
          this.openModalCadastros();
        });
      }

      // Drag and Drop e Input de Planilha
      const dropzone = document.getElementById('excelDropzone');
      const fileInput = document.getElementById('excelFileInput');

      if (dropzone && fileInput) {
        dropzone.addEventListener('click', () => fileInput.click());
        dropzone.addEventListener('dragover', (e) => {
          e.preventDefault();
          dropzone.classList.add('drag-active');
        });
        dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-active'));
        dropzone.addEventListener('drop', (e) => {
          e.preventDefault();
          dropzone.classList.remove('drag-active');
          if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            this.handleExcelFile(e.dataTransfer.files[0]);
          }
        });
        fileInput.addEventListener('change', (e) => {
          if (e.target.files && e.target.files[0]) {
            this.handleExcelFile(e.target.files[0]);
          }
        });
      }

      // Botão Limpar Tudo
      const btnClear = document.getElementById('btnClearData');
      if (btnClear) {
        btnClear.addEventListener('click', () => {
          if (confirm('Deseja limpar todos os faturamentos desta competência?')) {
            const tecnicos = window.M03Cadastros.getTecnicos();
            tecnicos.forEach(t => window.M03Cadastros.removerFaturamento(this.competencia, t.id));
            this.renderTecnicosStatusList();
            this.renderCentralCards();
            alert('Dados da competência resetados.');
          }
        });
      }

      // Botão Carregar Amostra
      const btnSample = document.getElementById('btnResetSample');
      if (btnSample) {
        btnSample.addEventListener('click', () => {
          this.carregarAmostraDemo();
        });
      }
    },

    // -------------------------------------------------------------
    // Planilha Excel e Atribuição de Faturamento
    // -------------------------------------------------------------
    handleExcelFile(file) {
      const tecnicos = window.M03Cadastros.getTecnicos();
      if (tecnicos.length === 0) {
        alert('Nenhum técnico cadastrado! Cadastre técnicos primeiro.');
        return;
      }

      // Se houver técnico selecionado na lista direita, sugere ele, senão pergunta
      let targetTec = null;
      if (this.selectedTecnicoId) {
        targetTec = tecnicos.find(t => t.id === this.selectedTecnicoId);
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          const parsed = window.MensalExcelParser.parseWorkbook(workbook);

          // Verifica se encontrou nome de técnico na planilha para auto-associar
          let matchTec = null;
          if (parsed.metadata && parsed.metadata.oficiais && parsed.metadata.oficiais.length > 0) {
            for (const ofc of parsed.metadata.oficiais) {
              const ofcNorm = ofc.toUpperCase();
              matchTec = tecnicos.find(t => ofcNorm.includes(t.nome.toUpperCase()) || t.nome.toUpperCase().includes(ofcNorm));
              if (matchTec) break;
            }
          }

          let tecEscolhido = matchTec || targetTec;
          if (!tecEscolhido) {
            const opcoes = tecnicos.map((t, i) => `${i + 1} - ${t.nome}`).join('\n');
            const resp = prompt(`Selecione o número do técnico para esta planilha:\n${opcoes}`, '1');
            const idx = parseInt(resp, 10) - 1;
            if (tecnicos[idx]) {
              tecEscolhido = tecnicos[idx];
            } else {
              tecEscolhido = tecnicos[0];
            }
          }

          // Salvar faturamento do técnico
          this.processarFaturamentoTecnico(tecEscolhido, parsed, file.name);

          const notice = document.getElementById('fileInfoNotice');
          const fileNameEl = document.getElementById('activeFileName');
          const fileBadge = document.getElementById('fileBadge');
          if (notice && fileNameEl && fileBadge) {
            notice.style.display = 'block';
            fileNameEl.textContent = `${file.name} ➔ ${tecEscolhido.nome}`;
            fileBadge.style.display = 'inline';
          }

          alert(`Faturamento de ${tecEscolhido.nome} importado e apurado com sucesso para ${this.competencia}!`);
          this.renderTecnicosStatusList();
          this.renderCentralCards();
        } catch (err) {
          console.error(err);
          alert('Erro ao processar planilha: ' + err.message);
        }
      };
      reader.readAsArrayBuffer(file);
    },

    processarFaturamentoTecnico(tecnico, parsed, fileName = '') {
      const q = parsed.quantitativos || {};
      const tarefas = window.M03Cadastros.getTarefas();
      
      // Mapeamento de quantidades planejadas, executadas e percentuais
      const quantMap = {
        'MENSAL': {
          planejado: q.preventivaMensal?.planejado !== undefined && q.preventivaMensal?.planejado !== null ? q.preventivaMensal.planejado : (q.equipamentosAtivos?.planejado || 0),
          executado: q.preventivaMensal?.executado !== undefined && q.preventivaMensal?.executado !== null ? q.preventivaMensal.executado : (q.preventivaMensal?.planejado || 0)
        },
        'SEMESTRAL': {
          planejado: q.preventivaSemestral?.planejado !== undefined && q.preventivaSemestral?.planejado !== null ? q.preventivaSemestral.planejado : '—',
          executado: q.preventivaSemestral?.executado !== undefined && q.preventivaSemestral?.executado !== null ? q.preventivaSemestral.executado : '—'
        },
        'CORRETIVA': {
          planejado: q.corretiva?.planejado !== undefined && q.corretiva?.planejado !== null ? q.corretiva.planejado : 0,
          executado: q.corretiva?.executado !== undefined && q.corretiva?.executado !== null ? q.corretiva.executado : 0
        },
        'EPI': {
          planejado: q.epi?.planejado !== undefined && q.epi?.planejado !== null ? q.epi.planejado : 0,
          executado: q.epi?.executado !== undefined && q.epi?.executado !== null ? q.epi.executado : 0
        }
      };

      const valorContrato = Number(tecnico.valorContrato) || window.M03Cadastros.getValorPadraoNivel(tecnico.nivel);

      // Calcular itens
      const itensCalculados = tarefas.map(tar => {
        const nomeNorm = tar.nome.toUpperCase();
        let planQtd = '—';
        let execQtd = '—';
        let execPct = 1.0;

        if (quantMap[nomeNorm]) {
          const itemQ = quantMap[nomeNorm];
          planQtd = itemQ.planejado;
          execQtd = itemQ.executado;
          if (planQtd && !isNaN(Number(planQtd)) && Number(planQtd) > 0) {
            execPct = (Number(execQtd) || 0) / Number(planQtd);
          } else {
            execPct = 1.0;
          }
        }
        execPct = Math.min(1.0, Math.max(0.0, execPct));

        const pesoPct = Number(tar.peso) / 100;
        const valorItem = valorContrato * pesoPct;
        const totalItem = valorItem * execPct;

        return {
          descricao: tar.nome,
          planejado: planQtd,
          executadoQtd: execQtd,
          executado: execPct,
          peso: pesoPct,
          valor: valorItem,
          total: totalItem
        };
      });

      // Excedente
      const excedenteQtd = (q.preventivaMensal?.executado || 0) + (q.preventivaSemestral?.executado || 0);
      const excedenteDiff = Math.max(0, excedenteQtd - 500);
      const tarifaExcedente = 10.75;
      const unitExcedente = 3.50;
      const totalExcedente = excedenteDiff * (tarifaExcedente + unitExcedente);

      const subtotal = itensCalculados.reduce((acc, it) => acc + it.total, 0) + totalExcedente;

      // Incentivo Veicular
      const hasIncentivo = !!tecnico.hasIncentivoVeicular;
      const valorIncentivo = hasIncentivo ? 1000.0 : 0.0;

      const totalFinal = subtotal + valorIncentivo;

      const faturamentoData = {
        apurado: true,
        fileName: fileName,
        valorContrato: valorContrato,
        itens: itensCalculados,
        excedente: {
          qtd: excedenteDiff,
          tarifa: tarifaExcedente,
          unitario: unitExcedente,
          total: totalExcedente
        },
        subtotal: subtotal,
        incentivoVeicular: {
          ativo: hasIncentivo,
          executado: 1.0,
          valor: 1000.0,
          total: valorIncentivo
        },
        totalGeral: totalFinal,
        parsedFull: parsed
      };

      window.M03Cadastros.setFaturamento(this.competencia, tecnico.id, faturamentoData);
    },

    carregarAmostraDemo() {
      const tecnicos = window.M03Cadastros.getTecnicos();
      if (tecnicos.length === 0) {
        window.M03Cadastros.init();
      }
      const tecs = window.M03Cadastros.getTecnicos();
      
      // Amostra exata da imagem para o primeiro técnico
      tecs.forEach((tec, idx) => {
        const valorBase = Number(tec.valorContrato) || 6000;
        const mockParsed = {
          metadata: {
            contrato: 'STS36693/22',
            setor: 'Setor 01',
            competencia: this.competencia,
            oficiais: [tec.nome]
          },
          quantitativos: {
            preventivaMensal: { planejado: 415, executado: 415 },
            preventivaSemestral: { planejado: 80, executado: 80 },
            corretiva: { planejado: 16, executado: idx === 0 ? 16 : 15 },
            epi: { planejado: 21, executado: 21 }
          }
        };
        this.processarFaturamentoTecnico(tec, mockParsed, `Amostra_Ciclo_${this.competencia}_${tec.nome}.xlsx`);
      });

      alert(`Dados de demonstração carregados com sucesso para ${this.competencia}!`);
      this.renderTecnicosStatusList();
      this.renderCentralCards();
    },

    // -------------------------------------------------------------
    // Render: Lista Lateral Direita (Status de Faturamento)
    // -------------------------------------------------------------
    renderTecnicosStatusList() {
      const container = document.getElementById('tecnicosStatusList');
      if (!container) return;

      const tecnicos = window.M03Cadastros.getTecnicos();
      const faturamentos = window.M03Cadastros.listarFaturamentos(this.competencia);

      if (tecnicos.length === 0) {
        container.innerHTML = `
          <div style="padding: 16px; text-align: center; color: #94a3b8; font-size: 13px;">
            Nenhum técnico cadastrado.<br>
            <button class="btn btn-primary btn-sm" style="margin-top: 8px;" onclick="window.M03.openModalCadastros('tecnicos')">
              + Cadastrar Técnico
            </button>
          </div>
        `;
        return;
      }

      let totalApurados = 0;

      const itemsHtml = tecnicos.map(tec => {
        const fat = faturamentos[tec.id];
        const isOk = !!fat && fat.apurado;
        if (isOk) totalApurados++;

        const isSelected = this.selectedTecnicoId === tec.id;

        return `
          <div class="tec-status-item ${isSelected ? 'selected' : ''}" 
               onclick="window.M03.selectTecnico('${tec.id}')"
               style="padding: 10px 12px; margin-bottom: 8px; border-radius: 8px; border: 1px solid ${isSelected ? '#3b82f6' : '#e2e8f0'}; background: ${isSelected ? '#eff6ff' : '#ffffff'}; cursor: pointer; transition: all 0.2s;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
              <strong style="font-size: 13px; color: #1e293b;">${tec.nome}</strong>
              ${isOk ? `
                <span class="badge badge-success" style="background: #dcfce7; color: #166534; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 12px;">
                  ✓ OK
                </span>
              ` : `
                <span class="badge badge-warning" style="background: #fef3c7; color: #92400e; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 12px;">
                  ⏳ Pendente
                </span>
              `}
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 11px; color: #64748b;">
              <span>Nível 0${tec.nivel || 1} &bull; ${tec.hasIncentivoVeicular ? '🚗 Com Incentivo' : 'Sem Incentivo'}</span>
              <span>${isOk ? `R$ ${this.formatMoeda(fat.totalGeral)}` : 'R$ 0,00'}</span>
            </div>
          </div>
        `;
      }).join('');

      container.innerHTML = `
        <div style="margin-bottom: 12px; font-size: 12px; color: #475569; display: flex; justify-content: space-between; font-weight: 600;">
          <span>Status do Ciclo:</span>
          <span style="color: ${totalApurados === tecnicos.length ? '#16a34a' : '#d97706'};">
            ${totalApurados}/${tecnicos.length} Apurados
          </span>
        </div>
        ${itemsHtml}
      `;

      // Atualiza botão de exportar
      this.updateExportButton();
    },

    selectTecnico(id) {
      this.selectedTecnicoId = id;
      this.renderTecnicosStatusList();
      
      // Rola a visualização para o card do técnico na tela central
      const cardEl = document.getElementById(`card-tecnico-${id}`);
      if (cardEl) {
        cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        cardEl.style.boxShadow = '0 0 0 3px #3b82f6';
        setTimeout(() => { cardEl.style.boxShadow = ''; }, 1500);
      }
    },

    updateExportButton() {
      const btnExport = document.getElementById('btnExportarTecnico');
      if (!btnExport) return;

      const tecnicos = window.M03Cadastros.getTecnicos();
      const tec = tecnicos.find(t => t.id === this.selectedTecnicoId);

      if (tec) {
        btnExport.disabled = false;
        btnExport.innerHTML = `📄 Exportar Relatório (${tec.nome.split(' ')[0]})`;
      } else {
        btnExport.disabled = true;
        btnExport.innerHTML = `📄 Selecione um Técnico para Exportar`;
      }
    },

    // -------------------------------------------------------------
    // Render: Cards Resumo por Técnico (Tela Central - Formato da Imagem)
    // -------------------------------------------------------------
    renderCentralCards() {
      const container = document.getElementById('centralCardsContainer');
      if (!container) return;

      const tecnicos = window.M03Cadastros.getTecnicos();
      const contratos = window.M03Cadastros.getContratos();
      const setores = window.M03Cadastros.getSetores();
      const faturamentos = window.M03Cadastros.listarFaturamentos(this.competencia);

      if (tecnicos.length === 0) {
        container.innerHTML = `
          <div style="text-align: center; padding: 48px 24px; background: #ffffff; border-radius: 12px; border: 2px dashed #cbd5e1;">
            <div style="font-size: 40px; margin-bottom: 12px;">👷</div>
            <h3 style="font-size: 18px; color: #1e293b; margin-bottom: 8px;">Nenhum técnico cadastrado</h3>
            <p style="color: #64748b; font-size: 14px; max-width: 480px; margin: 0 auto 20px;">
              Para começar a apuração mensal do ciclo, cadastre os técnicos de campo, contratos e tarefas clicando no botão abaixo.
            </p>
            <button class="btn btn-primary" onclick="window.M03.openModalCadastros('tecnicos')">
              + Cadastrar Técnicos &amp; Parâmetros
            </button>
          </div>
        `;
        return;
      }

      const cardsHtml = tecnicos.map(tec => {
        const contrato = contratos.find(c => c.id === tec.contratoId) || { codigo: 'STS36693/22', nome: 'SEDUC' };
        const setor = setores.find(s => s.id === tec.setorId) || { nome: 'Setor 01' };
        const fat = faturamentos[tec.id];

        const valorContrato = Number(tec.valorContrato) || window.M03Cadastros.getValorPadraoNivel(tec.nivel);

        if (!fat || !fat.apurado) {
          // Card de Técnico Pendente de Planilha
          return `
            <div id="card-tecnico-${tec.id}" class="m03-tec-card pendente" style="background: #ffffff; border-radius: 10px; border: 1px solid #e2e8f0; margin-bottom: 24px; box-shadow: 0 2px 4px rgba(0,0,0,0.04); overflow: hidden;">
              <div style="background: #f8fafc; border-bottom: 1px solid #e2e8f0; padding: 12px 18px; display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <h3 style="font-size: 16px; font-weight: 700; color: #1e293b; margin: 0;">${tec.nome}</h3>
                  <div style="font-size: 12px; color: #64748b; margin-top: 2px;">
                    Nível 0${tec.nivel || 1} &bull; Contrato: ${contrato.codigo} (${setor.nome}) &bull; ${tec.hasIncentivoVeicular ? '🚗 Incentivo Veicular Habilitado' : 'Sem Incentivo Veicular'}
                  </div>
                </div>
                <div style="text-align: right;">
                  <span class="badge" style="background: #fef3c7; color: #92400e; font-weight: 700; padding: 4px 10px; border-radius: 20px; font-size: 11px;">
                    ⏳ Faturamento Pendente
                  </span>
                  <div style="font-size: 12px; font-weight: 700; color: #475569; margin-top: 4px;">
                    Base Contrato: R$ ${this.formatMoeda(valorContrato)}
                  </div>
                </div>
              </div>
              <div style="padding: 24px; text-align: center; color: #64748b; font-size: 13px;">
                <p style="margin-bottom: 12px;">Planilha mensal ainda não inserida para este técnico no ciclo de <strong>${this.competencia}</strong>.</p>
                <button class="btn btn-outline btn-sm" onclick="window.M03.vincularPlanilhaTecnico('${tec.id}')" style="font-size: 12px;">
                  📥 Importar Planilha de ${tec.nome.split(' ')[0]}
                </button>
              </div>
            </div>
          `;
        }

        // Card com Tabela Fiel à Imagem Anexada
        const formatMoeda = (val) => this.formatMoeda(val);
        const formatPct = (val) => this.formatPct(val);

        const itens = Array.isArray(fat.itens) ? fat.itens : [];
        const rowsHtml = itens.map(it => `
          <tr style="border-bottom: 1px solid #cbd5e1;">
            <td style="padding: 6px 12px; font-weight: 700; text-align: left; color: #000000; font-size: 13px;">${it.descricao || ''}</td>
            <td style="padding: 6px 10px; text-align: center; color: #000000; font-size: 13px;">${it.planejado !== undefined ? it.planejado : '—'}</td>
            <td style="padding: 6px 10px; text-align: center; color: #000000; font-size: 13px;">${it.executadoQtd !== undefined ? it.executadoQtd : '—'}</td>
            <td style="padding: 6px 10px; text-align: center; color: #000000; font-size: 13px;">${formatPct(it.executado)}</td>
            <td style="padding: 6px 10px; text-align: right; color: #000000; font-size: 13px;">${formatPct(it.peso)}</td>
            <td style="padding: 6px 10px; text-align: right; color: #000000; font-size: 13px;">R$ ${formatMoeda(it.valor)}</td>
            <td style="padding: 6px 10px; text-align: right; color: #000000; font-size: 13px; font-weight: 600;">R$ ${formatMoeda(it.total)}</td>
          </tr>
        `).join('');

        const exc = fat.excedente || { qtd: 0, tarifa: 10.75, unitario: 3.50, total: 0 };
        const inc = fat.incentivoVeicular || { ativo: false, valor: 1000, total: 0 };

        return `
          <div id="card-tecnico-${tec.id}" class="m03-tec-card" style="background: #ffffff; border-radius: 8px; border: 1px solid #94a3b8; margin-bottom: 24px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); overflow: hidden;">
            
            <!-- Cabeçalho do Card -->
            <div style="background: #f1f5f9; border-bottom: 1px solid #cbd5e1; padding: 10px 16px; display: flex; justify-content: space-between; align-items: center;">
              <div>
                <span style="font-size: 15px; font-weight: 800; color: #0f172a;">${tec.nome}</span>
                <span style="font-size: 12px; color: #475569; margin-left: 8px;">(Nível 0${tec.nivel || 1} &bull; ${contrato.codigo} &bull; ${setor.nome})</span>
              </div>
              <div style="display: flex; gap: 8px; align-items: center;">
                <span class="badge" style="background: #dcfce7; color: #166534; font-weight: 700; padding: 3px 8px; border-radius: 12px; font-size: 11px;">
                  ✓ Apurado
                </span>
                <button class="btn btn-outline btn-sm" onclick="window.M03.exportarRelatorioTecnico('${tec.id}')" title="Exportar PDF A4 deste técnico" style="padding: 4px 8px; font-size: 11px;">
                  🖨️ PDF
                </button>
              </div>
            </div>

            <!-- Tabela Estilo Imagem Modelo com Planejado e Executado -->
            <div style="padding: 12px; overflow-x: auto;">
              <table style="width: 100%; border-collapse: collapse; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 13px;">
                <thead>
                  <tr style="background: #d1d5db; color: #000000; font-weight: 800; border-bottom: 2px solid #9ca3af;">
                    <th colspan="6" style="padding: 6px 12px; text-align: center; font-size: 14px; letter-spacing: 0.5px;">VALORES</th>
                    <th style="padding: 6px 12px; text-align: right; font-size: 14px; font-weight: 800;">R$ ${formatMoeda(valorContrato)}</th>
                  </tr>
                  <tr style="background: #e5e7eb; color: #000000; font-weight: 700; border-bottom: 1px solid #cbd5e1; font-size: 12px;">
                    <th style="padding: 6px 12px; text-align: left;">DESCRIÇÃO</th>
                    <th style="padding: 6px 10px; text-align: center;">PLANEJADO</th>
                    <th style="padding: 6px 10px; text-align: center;">EXECUTADO</th>
                    <th style="padding: 6px 10px; text-align: center;">% EXEC.</th>
                    <th style="padding: 6px 10px; text-align: right;">PESO</th>
                    <th style="padding: 6px 10px; text-align: right;">VALOR</th>
                    <th style="padding: 6px 10px; text-align: right;">TOTAL</th>
                  </tr>
                </thead>
                <tbody>
                  ${rowsHtml}
                  
                  <!-- Linha Excedente -->
                  <tr style="border-bottom: 1px solid #cbd5e1;">
                    <td style="padding: 6px 12px; font-weight: 700; text-align: left; color: #000000;">EXCEDENTE</td>
                    <td style="padding: 6px 10px; text-align: center; color: #000000;">500</td>
                    <td style="padding: 6px 10px; text-align: center; color: #000000;">${(exc.qtd || 0) > 0 ? (500 + Number(exc.qtd)) : 500}</td>
                    <td style="padding: 6px 10px; text-align: center; color: #000000;">${exc.qtd || 0} un.</td>
                    <td style="padding: 6px 10px; text-align: right; color: #000000;">R$ ${formatMoeda(exc.tarifa)}</td>
                    <td style="padding: 6px 10px; text-align: right; color: #000000;">R$ ${formatMoeda(exc.unitario)}</td>
                    <td style="padding: 6px 10px; text-align: right; color: #000000; font-weight: 600;">${(exc.total || 0) > 0 ? `R$ ${formatMoeda(exc.total)}` : 'R$ -'}</td>
                  </tr>

                  <!-- Linha Subtotal -->
                  <tr style="background: #e5e7eb; border-bottom: 1px solid #cbd5e1; font-weight: 700;">
                    <td colspan="6" style="padding: 6px 12px; text-align: left; font-weight: 800; color: #000000;">SUBTOTAL</td>
                    <td style="padding: 6px 10px; text-align: right; font-weight: 800; color: #000000;">R$ ${formatMoeda(fat.subtotal)}</td>
                  </tr>

                  <!-- Linha Incentivo Veicular (se ativo) -->
                  ${inc.ativo ? `
                    <tr style="border-bottom: 1px solid #cbd5e1;">
                      <td style="padding: 6px 12px; font-weight: 700; text-align: left; color: #000000;">INCENTIVO VEICULAR</td>
                      <td style="padding: 6px 10px; text-align: center; color: #000000;">1</td>
                      <td style="padding: 6px 10px; text-align: center; color: #000000;">1</td>
                      <td style="padding: 6px 10px; text-align: center; color: #000000;">100%</td>
                      <td style="padding: 6px 10px; text-align: right; color: #000000;">—</td>
                      <td style="padding: 6px 10px; text-align: right; color: #000000;">R$ ${formatMoeda(inc.valor)}</td>
                      <td style="padding: 6px 10px; text-align: right; color: #000000; font-weight: 600;">R$ ${formatMoeda(inc.total)}</td>
                    </tr>
                  ` : ''}

                  <!-- Linha TOTAL -->
                  <tr style="background: #d1d5db; border-top: 2px solid #9ca3af; font-weight: 800;">
                    <td colspan="6" style="padding: 8px 12px; text-align: left; font-size: 14px; color: #000000;">TOTAL</td>
                    <td style="padding: 8px 10px; text-align: right; font-size: 14px; color: #000000;">R$ ${formatMoeda(fat.totalGeral)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        `;
      }).join('');

      container.innerHTML = cardsHtml;
    },

    vincularPlanilhaTecnico(tecnicoId) {
      this.selectedTecnicoId = tecnicoId;
      const fileInput = document.getElementById('excelFileInput');
      if (fileInput) fileInput.click();
    },

    // -------------------------------------------------------------
    // Exportação em PDF do Relatório Completo do Técnico
    // -------------------------------------------------------------
    exportarRelatorioTecnico(tecnicoId = null) {
      const targetId = tecnicoId || this.selectedTecnicoId;
      if (!targetId) {
        alert('Selecione um técnico para exportar o relatório.');
        return;
      }

      const tecnicos = window.M03Cadastros.getTecnicos();
      const tec = tecnicos.find(t => t.id === targetId);
      const fat = window.M03Cadastros.getFaturamento(this.competencia, targetId);

      if (!tec || !fat) {
        alert('Este técnico ainda não possui faturamento apurado para esta competência.');
        return;
      }

      // Monta modelo completo para o MensalReportRenderer legado gerar o A4 oficial
      const cardEl = document.getElementById(`card-tecnico-${targetId}`);
      if (!cardEl) return;

      const opt = {
        margin: [10, 10, 10, 10],
        filename: `Relatorio_Mensal_${this.competencia}_${tec.nome.replace(/\s+/g, '_')}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
      };

      if (window.html2pdf) {
        window.html2pdf().set(opt).from(cardEl).save();
      } else {
        window.print();
      }
    },

    // -------------------------------------------------------------
    // Modais de Cadastro (Técnicos, Contratos, Setores, Tarefas)
    // -------------------------------------------------------------
    initModals() {
      // Cria o container do modal no body se não existir
      if (!document.getElementById('m03ModalContainer')) {
        const div = document.createElement('div');
        div.id = 'm03ModalContainer';
        document.body.appendChild(div);
      }
    },

    openModalCadastros(activeTab = 'tecnicos') {
      const container = document.getElementById('m03ModalContainer');
      if (!container) return;

      container.innerHTML = `
        <div class="m03-modal-overlay" style="position: fixed; inset: 0; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; z-index: 9999;">
          <div class="m03-modal-content" style="background: #ffffff; width: 90%; max-width: 800px; max-height: 90vh; border-radius: 12px; display: flex; flex-direction: column; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.3); overflow: hidden;">
            
            <!-- Cabeçalho do Modal -->
            <div style="padding: 16px 20px; background: #0f172a; color: #ffffff; display: flex; justify-content: space-between; align-items: center;">
              <h2 style="margin: 0; font-size: 16px; font-weight: 700;">⚙️ Gestão de Cadastros &bull; Módulo 03</h2>
              <button onclick="window.M03.closeModalCadastros()" style="background: none; border: none; color: #94a3b8; font-size: 20px; cursor: pointer;">&times;</button>
            </div>

            <!-- Tabs de Navegação -->
            <div style="display: flex; background: #f1f5f9; border-bottom: 1px solid #cbd5e1; padding: 0 16px;">
              <button class="m03-tab-btn ${activeTab === 'tecnicos' ? 'active' : ''}" onclick="window.M03.switchModalTab('tecnicos')" style="padding: 12px 16px; border: none; background: none; font-weight: 700; font-size: 13px; color: ${activeTab === 'tecnicos' ? '#2563eb' : '#64748b'}; border-bottom: 2px solid ${activeTab === 'tecnicos' ? '#2563eb' : 'transparent'}; cursor: pointer;">
                👷 Técnicos
              </button>
              <button class="m03-tab-btn ${activeTab === 'contratos' ? 'active' : ''}" onclick="window.M03.switchModalTab('contratos')" style="padding: 12px 16px; border: none; background: none; font-weight: 700; font-size: 13px; color: ${activeTab === 'contratos' ? '#2563eb' : '#64748b'}; border-bottom: 2px solid ${activeTab === 'contratos' ? '#2563eb' : 'transparent'}; cursor: pointer;">
                🏢 Contratos &amp; Setores
              </button>
              <button class="m03-tab-btn ${activeTab === 'tarefas' ? 'active' : ''}" onclick="window.M03.switchModalTab('tarefas')" style="padding: 12px 16px; border: none; background: none; font-weight: 700; font-size: 13px; color: ${activeTab === 'tarefas' ? '#2563eb' : '#64748b'}; border-bottom: 2px solid ${activeTab === 'tarefas' ? '#2563eb' : 'transparent'}; cursor: pointer;">
                📋 Tipos de Tarefas &amp; Pesos
              </button>
            </div>

            <!-- Corpo do Modal -->
            <div id="m03ModalTabBody" style="padding: 20px; overflow-y: auto; flex: 1;">
              <!-- Conteúdo dinâmico da tab -->
            </div>

          </div>
        </div>
      `;

      this.switchModalTab(activeTab);
    },

    closeModalCadastros() {
      const container = document.getElementById('m03ModalContainer');
      if (container) container.innerHTML = '';
      this.renderTecnicosStatusList();
      this.renderCentralCards();
    },

    switchModalTab(tab) {
      const body = document.getElementById('m03ModalTabBody');
      if (!body) return;

      if (tab === 'tecnicos') {
        this.renderTabTecnicos(body);
      } else if (tab === 'contratos') {
        this.renderTabContratos(body);
      } else if (tab === 'tarefas') {
        this.renderTabTarefas(body);
      }
    },

    // --- TAB TÉCNICOS ---
    renderTabTecnicos(container) {
      const tecnicos = window.M03Cadastros.getTecnicos();
      const contratos = window.M03Cadastros.getContratos();
      const setores = window.M03Cadastros.getSetores();

      container.innerHTML = `
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; margin-bottom: 16px;">
          <h4 style="margin: 0 0 10px 0; font-size: 14px; color: #1e293b;">Novo Técnico / Editar</h4>
          <form id="formNovoTecnico" onsubmit="window.M03.salvarTecnico(event)">
            <input type="hidden" id="editTecnicoId" value="" />
            <div style="display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 10px; margin-bottom: 10px;">
              <div>
                <label style="font-size: 11px; font-weight: 700; color: #475569;">Nome do Técnico:</label>
                <input type="text" id="tecNome" class="form-input" required placeholder="Ex: Carlos Oliveira" style="width: 100%;" />
              </div>
              <div>
                <label style="font-size: 11px; font-weight: 700; color: #475569;">Nível (01 a 03):</label>
                <select id="tecNivel" class="form-input" style="width: 100%;" onchange="window.M03.atualizarValorContratoNivel(this.value)">
                  <option value="1" selected>Nível 01 (R$ 6.000,00)</option>
                  <option value="2">Nível 02 (R$ 5.250,00)</option>
                  <option value="3">Nível 03 (R$ 4.250,00)</option>
                </select>
              </div>
              <div>
                <label style="font-size: 11px; font-weight: 700; color: #475569;">Valor Contrato (R$):</label>
                <input type="number" id="tecValorContrato" class="form-input" value="6000" step="50" style="width: 100%; font-weight: 700;" />
              </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; align-items: center;">
              <div>
                <label style="font-size: 11px; font-weight: 700; color: #475569;">Contrato:</label>
                <select id="tecContratoId" class="form-input" style="width: 100%;">
                  ${contratos.map(c => `<option value="${c.id}">${c.codigo} - ${c.nome}</option>`).join('')}
                </select>
              </div>
              <div>
                <label style="font-size: 11px; font-weight: 700; color: #475569;">Setor:</label>
                <select id="tecSetorId" class="form-input" style="width: 100%;">
                  ${setores.map(s => `<option value="${s.id}">${s.nome}</option>`).join('')}
                </select>
              </div>
              <div style="padding-top: 14px;">
                <label style="font-size: 12px; font-weight: 700; color: #1e293b; display: flex; align-items: center; gap: 6px; cursor: pointer;">
                  <input type="checkbox" id="tecIncentivo" checked />
                  🚗 Incentivo Veicular (R$ 1.000)
                </label>
              </div>
            </div>

            <div style="margin-top: 12px; text-align: right;">
              <button type="button" class="btn btn-secondary btn-sm" onclick="window.M03.resetFormTecnico()">Limpar</button>
              <button type="submit" class="btn btn-primary btn-sm">💾 Salvar Técnico</button>
            </div>
          </form>
        </div>

        <h4 style="margin: 0 0 8px 0; font-size: 13px; color: #475569;">Técnicos Cadastrados (${tecnicos.length})</h4>
        <div style="max-height: 240px; overflow-y: auto; border: 1px solid #e2e8f0; border-radius: 8px;">
          <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
            <thead style="background: #f1f5f9; color: #475569;">
              <tr>
                <th style="padding: 8px 10px; text-align: left;">Nome</th>
                <th style="padding: 8px 10px; text-align: center;">Nível</th>
                <th style="padding: 8px 10px; text-align: right;">Valor Contrato</th>
                <th style="padding: 8px 10px; text-align: center;">Incentivo (R$ 1.000)</th>
                <th style="padding: 8px 10px; text-align: center; width: 100px;">Ações</th>
              </tr>
            </thead>
            <tbody>
              ${tecnicos.map(t => `
                <tr style="border-bottom: 1px solid #f1f5f9;">
                  <td style="padding: 8px 10px; font-weight: 600; color: #1e293b;">${t.nome}</td>
                  <td style="padding: 8px 10px; text-align: center;">Nível 0${t.nivel}</td>
                  <td style="padding: 8px 10px; text-align: right; font-weight: 600;">R$ ${this.formatMoeda(t.valorContrato)}</td>
                  <td style="padding: 8px 10px; text-align: center;">${t.hasIncentivoVeicular ? '✅ Sim' : '❌ Não'}</td>
                  <td style="padding: 8px 10px; text-align: center;">
                    <button class="btn btn-outline btn-sm" onclick="window.M03.editarTecnico('${t.id}')" style="padding: 2px 6px; font-size: 11px;">✏️</button>
                    <button class="btn btn-danger btn-sm" onclick="window.M03.excluirTecnico('${t.id}')" style="padding: 2px 6px; font-size: 11px;">🗑️</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    },

    atualizarValorContratoNivel(nivel) {
      const input = document.getElementById('tecValorContrato');
      if (input) {
        input.value = window.M03Cadastros.getValorPadraoNivel(nivel);
      }
    },

    salvarTecnico(e) {
      e.preventDefault();
      const id = document.getElementById('editTecnicoId').value;
      const nome = document.getElementById('tecNome').value.trim();
      const nivel = document.getElementById('tecNivel').value;
      const valorContrato = parseFloat(document.getElementById('tecValorContrato').value) || 6000;
      const contratoId = document.getElementById('tecContratoId').value;
      const setorId = document.getElementById('tecSetorId').value;
      const hasIncentivo = document.getElementById('tecIncentivo').checked;

      window.M03Cadastros.saveTecnico({
        id: id || undefined,
        nome,
        nivel,
        valorContrato,
        contratoId,
        setorId,
        hasIncentivoVeicular: hasIncentivo
      });

      this.switchModalTab('tecnicos');
    },

    editarTecnico(id) {
      const tec = window.M03Cadastros.getTecnicos().find(t => t.id === id);
      if (!tec) return;
      document.getElementById('editTecnicoId').value = tec.id;
      document.getElementById('tecNome').value = tec.nome;
      document.getElementById('tecNivel').value = tec.nivel;
      document.getElementById('tecValorContrato').value = tec.valorContrato;
      document.getElementById('tecContratoId').value = tec.contratoId;
      document.getElementById('tecSetorId').value = tec.setorId;
      document.getElementById('tecIncentivo').checked = !!tec.hasIncentivoVeicular;
    },

    excluirTecnico(id) {
      if (confirm('Deseja excluir este técnico?')) {
        window.M03Cadastros.deleteTecnico(id);
        this.switchModalTab('tecnicos');
      }
    },

    resetFormTecnico() {
      document.getElementById('formNovoTecnico').reset();
      document.getElementById('editTecnicoId').value = '';
    },

    // --- TAB CONTRATOS & SETORES ---
    renderTabContratos(container) {
      const contratos = window.M03Cadastros.getContratos();
      const setores = window.M03Cadastros.getSetores();

      container.innerHTML = `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
          <!-- Contratos -->
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px;">
            <h4 style="margin: 0 0 10px 0; font-size: 14px; color: #1e293b;">Contratos</h4>
            <form onsubmit="window.M03.salvarContrato(event)" style="display: flex; gap: 6px; margin-bottom: 12px;">
              <input type="text" id="contratoCodigo" placeholder="Código (ex: STS36693/22)" class="form-input" required style="width: 40%; font-size: 12px;" />
              <input type="text" id="contratoNome" placeholder="Nome do Contrato" class="form-input" required style="width: 45%; font-size: 12px;" />
              <button type="submit" class="btn btn-primary btn-sm">+ Add</button>
            </form>
            <div style="max-height: 200px; overflow-y: auto;">
              ${contratos.map(c => `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 12px;">
                  <div>
                    <strong>${c.codigo}</strong> - ${c.nome}
                  </div>
                  <button class="btn btn-danger btn-sm" onclick="window.M03.excluirContrato('${c.id}')" style="padding: 2px 6px; font-size: 11px;">🗑️</button>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Setores -->
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px;">
            <h4 style="margin: 0 0 10px 0; font-size: 14px; color: #1e293b;">Setores do Contrato</h4>
            <form onsubmit="window.M03.salvarSetor(event)" style="display: flex; gap: 6px; margin-bottom: 12px;">
              <select id="setorContratoId" class="form-input" style="width: 45%; font-size: 12px;">
                ${contratos.map(c => `<option value="${c.id}">${c.codigo}</option>`).join('')}
              </select>
              <input type="text" id="setorNome" placeholder="Setor (ex: Setor 01)" class="form-input" required style="width: 40%; font-size: 12px;" />
              <button type="submit" class="btn btn-primary btn-sm">+ Add</button>
            </form>
            <div style="max-height: 200px; overflow-y: auto;">
              ${setores.map(s => {
                const c = contratos.find(x => x.id === s.contratoId);
                return `
                  <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 12px;">
                    <div>
                      <strong>${s.nome}</strong> (${c ? c.codigo : '—'})
                    </div>
                    <button class="btn btn-danger btn-sm" onclick="window.M03.excluirSetor('${s.id}')" style="padding: 2px 6px; font-size: 11px;">🗑️</button>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        </div>
      `;
    },

    salvarContrato(e) {
      e.preventDefault();
      const codigo = document.getElementById('contratoCodigo').value.trim();
      const nome = document.getElementById('contratoNome').value.trim();
      window.M03Cadastros.saveContrato({ codigo, nome });
      this.switchModalTab('contratos');
    },

    excluirContrato(id) {
      if (confirm('Deseja excluir este contrato e seus setores?')) {
        window.M03Cadastros.deleteContrato(id);
        this.switchModalTab('contratos');
      }
    },

    salvarSetor(e) {
      e.preventDefault();
      const contratoId = document.getElementById('setorContratoId').value;
      const nome = document.getElementById('setorNome').value.trim();
      window.M03Cadastros.saveSetor({ contratoId, nome });
      this.switchModalTab('contratos');
    },

    excluirSetor(id) {
      if (confirm('Deseja excluir este setor?')) {
        window.M03Cadastros.deleteSetor(id);
        this.switchModalTab('contratos');
      }
    },

    // --- TAB TAREFAS & PESOS ---
    renderTabTarefas(container) {
      const tarefas = window.M03Cadastros.getTarefas();
      const somaPesos = tarefas.reduce((acc, t) => acc + Number(t.peso || 0), 0);

      container.innerHTML = `
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; margin-bottom: 16px;">
          <h4 style="margin: 0 0 10px 0; font-size: 14px; color: #1e293b;">Nova Tarefa / Peso</h4>
          <form onsubmit="window.M03.salvarTarefa(event)" style="display: flex; gap: 8px; align-items: flex-end;">
            <div style="flex: 2;">
              <label style="font-size: 11px; font-weight: 700; color: #475569;">Descrição da Tarefa:</label>
              <input type="text" id="tarefaNome" placeholder="Ex: MENSAL, SEMESTRAL, CORRETIVA..." class="form-input" required style="width: 100%; text-transform: uppercase;" />
            </div>
            <div style="flex: 1;">
              <label style="font-size: 11px; font-weight: 700; color: #475569;">Peso (%):</label>
              <input type="number" id="tarefaPeso" placeholder="Ex: 50" class="form-input" required step="1" min="0" max="100" style="width: 100%; font-weight: 700;" />
            </div>
            <button type="submit" class="btn btn-primary btn-sm" style="height: 38px;">💾 Salvar</button>
          </form>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <h4 style="margin: 0; font-size: 13px; color: #475569;">Tarefas Configuradas</h4>
          <span style="font-size: 12px; font-weight: 700; color: ${somaPesos === 100 ? '#16a34a' : '#dc2626'};">
            Soma dos Pesos: ${somaPesos}% ${somaPesos === 100 ? '✓' : '(deve somar 100%)'}
          </span>
        </div>

        <div style="max-height: 220px; overflow-y: auto; border: 1px solid #e2e8f0; border-radius: 8px;">
          <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
            <thead style="background: #f1f5f9; color: #475569;">
              <tr>
                <th style="padding: 8px 10px; text-align: left;">Descrição</th>
                <th style="padding: 8px 10px; text-align: right;">Peso (%)</th>
                <th style="padding: 8px 10px; text-align: center; width: 80px;">Ações</th>
              </tr>
            </thead>
            <tbody>
              ${tarefas.map(t => `
                <tr style="border-bottom: 1px solid #f1f5f9;">
                  <td style="padding: 8px 10px; font-weight: 700; color: #1e293b;">${t.nome}</td>
                  <td style="padding: 8px 10px; text-align: right; font-weight: 700;">${t.peso}%</td>
                  <td style="padding: 8px 10px; text-align: center;">
                    <button class="btn btn-danger btn-sm" onclick="window.M03.excluirTarefa('${t.id}')" style="padding: 2px 6px; font-size: 11px;">🗑️</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    },

    salvarTarefa(e) {
      e.preventDefault();
      const nome = document.getElementById('tarefaNome').value.trim().toUpperCase();
      const peso = parseFloat(document.getElementById('tarefaPeso').value) || 0;
      window.M03Cadastros.saveTarefa({ nome, peso });
      this.switchModalTab('tarefas');
    },

    excluirTarefa(id) {
      if (confirm('Deseja excluir esta tarefa?')) {
        window.M03Cadastros.deleteTarefa(id);
        this.switchModalTab('tarefas');
      }
    }
  };

  window.M03 = M03;

  document.addEventListener('DOMContentLoaded', () => {
    M03.init();
  });
})(window);

