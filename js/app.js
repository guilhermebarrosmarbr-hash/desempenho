/**
 * Aplicação Principal - Orquestrador de Estado, Eventos, Modal e Renderização
 * Segue princípios de Clean Code, baixo acoplamento e reatividade direta.
 */

import { Formatter, MeasurementCalculator } from './calculator.js';
import { ExcelParser } from './excelParser.js';
import { ReportRenderer } from './reportRenderer.js';
import { PdfExporter } from './pdfExporter.js';
import { ContractStore } from './contractStore.js';
import { DEFAULT_REPORT_DATA, SAMPLE_SPREADSHEET_ROWS } from './sampleData.js';

class MeasurementApp {
  constructor() {
    this.config = ContractStore.load();
    this.state = JSON.parse(JSON.stringify(DEFAULT_REPORT_DATA));
    
    this.spreadsheetData = {
      rows: SAMPLE_SPREADSHEET_ROWS,
      groups: ExcelParser.groupRowsByContract(SAMPLE_SPREADSHEET_ROWS)
    };

    this.initElements();
    this.initEvents();
    this.initModalEvents();
    this.populateContractSelect();
    this.onSectorChange();
  }

  initElements() {
    this.reportContainer = document.getElementById('reportContainer');
    
    // Botões Navbar
    this.btnOpenConfigModal = document.getElementById('btnOpenConfigModal');
    this.btnDownloadTemplate = document.getElementById('btnDownloadTemplate');
    this.btnLoadSample = document.getElementById('btnLoadSample');
    this.btnPrint = document.getElementById('btnPrint');
    this.btnQuickPrint = document.getElementById('btnQuickPrint');
    this.btnDownloadPdf = document.getElementById('btnDownloadPdf');

    // Dropzone & Arquivo
    this.dropzone = document.getElementById('excelDropzone');
    this.fileInput = document.getElementById('excelFileInput');
    this.fileBadge = document.getElementById('fileBadge');
    this.fileInfoNotice = document.getElementById('fileInfoNotice');
    this.activeFileName = document.getElementById('activeFileName');

    // Seletor & Box Informativo da Sidebar
    this.contractSectorSelect = document.getElementById('contractSectorSelect');
    this.sidebarCompany = document.getElementById('sidebarCompany');
    this.sidebarClient = document.getElementById('sidebarClient');
    this.sidebarTech = document.getElementById('sidebarTech');
    this.sidebarSector = document.getElementById('sidebarSector');

    // Pílulas de Estatísticas Rápidas
    this.pillEquipamentos = document.getElementById('pillEquipamentos');
    this.pillMensal = document.getElementById('pillMensal');
    this.pillSemestral = document.getElementById('pillSemestral');
    this.pillCorretivas = document.getElementById('pillCorretivas');

    // Inputs de Parâmetros
    this.inputContractBadge = document.getElementById('inputContractBadge');
    this.inputPeriodLabel = document.getElementById('inputPeriodLabel');
    this.inputContractValue = document.getElementById('inputContractValue');

    this.inputEpiPrevista = document.getElementById('inputEpiPrevista');
    this.inputEpiRealizada = document.getElementById('inputEpiRealizada');
    this.inputEpiPeso = document.getElementById('inputEpiPeso');

    this.inputInstPerf = document.getElementById('inputInstPerf');
    this.inputInstPeso = document.getElementById('inputInstPeso');

    this.inputExcedenteQtd = document.getElementById('inputExcedenteQtd');
    this.inputExcedenteTarifa = document.getElementById('inputExcedenteTarifa');
    this.inputExcedenteUnit = document.getElementById('inputExcedenteUnit');

    this.inputIncentivoMeta = document.getElementById('inputIncentivoMeta');
    this.inputIncentivoBase = document.getElementById('inputIncentivoBase');
    this.inputIncentivoRec = document.getElementById('inputIncentivoRec');

    // Elementos do Modal
    this.configModal = document.getElementById('configModal');
    this.btnCloseConfigModal = document.getElementById('btnCloseConfigModal');
    this.btnCloseConfigModalBottom = document.getElementById('btnCloseConfigModalBottom');
    this.btnResetConfig = document.getElementById('btnResetConfig');

    this.tabBtnContracts = document.getElementById('tabBtnContracts');
    this.tabBtnTechs = document.getElementById('tabBtnTechs');
    this.paneContracts = document.getElementById('paneContracts');
    this.paneTechs = document.getElementById('paneTechs');

    this.contractsListContainer = document.getElementById('contractsListContainer');
    this.techniciansListContainer = document.getElementById('techniciansListContainer');

    // Formulários da Modal
    this.btnShowAddContract = document.getElementById('btnShowAddContract');
    this.contractFormBox = document.getElementById('contractFormBox');
    this.btnCancelContractForm = document.getElementById('btnCancelContractForm');
    this.btnSaveContractForm = document.getElementById('btnSaveContractForm');
    this.formContractId = document.getElementById('formContractId');
    this.formContractCode = document.getElementById('formContractCode');
    this.formClientName = document.getElementById('formClientName');
    this.formClientFullName = document.getElementById('formClientFullName');
    this.formContractValue = document.getElementById('formContractValue');
    this.formContractDesc = document.getElementById('formContractDesc');
    this.formContractTech = document.getElementById('formContractTech');

    this.btnShowAddTech = document.getElementById('btnShowAddTech');
    this.techFormBox = document.getElementById('techFormBox');
    this.btnCancelTechForm = document.getElementById('btnCancelTechForm');
    this.btnSaveTechForm = document.getElementById('btnSaveTechForm');
    this.formTechId = document.getElementById('formTechId');
    this.formTechName = document.getElementById('formTechName');
    this.formTechPhone = document.getElementById('formTechPhone');
    this.formTechNotes = document.getElementById('formTechNotes');
  }

  initEvents() {
    this.btnDownloadTemplate.addEventListener('click', () => ExcelParser.downloadTemplate());
    this.btnLoadSample.addEventListener('click', () => this.loadDefaultSample());
    this.btnPrint.addEventListener('click', () => PdfExporter.printVector());
    this.btnQuickPrint.addEventListener('click', () => PdfExporter.printVector());
    
    this.btnDownloadPdf.addEventListener('click', () => {
      const paper = document.querySelector('.report-paper');
      const filename = `relatorio_medicao_${(this.state.contractBadge || 'MAR_BRASIL').replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
      PdfExporter.downloadPdf(paper, filename);
    });

    this.dropzone.addEventListener('click', () => this.fileInput.click());
    this.dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.dropzone.classList.add('dragover');
    });
    this.dropzone.addEventListener('dragleave', () => this.dropzone.classList.remove('dragover'));
    this.dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      this.dropzone.classList.remove('dragover');
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        this.processExcelFile(e.dataTransfer.files[0]);
      }
    });

    this.fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        this.processExcelFile(e.target.files[0]);
      }
    });

    this.contractSectorSelect.addEventListener('change', () => this.onSectorChange());

    const reactiveInputs = [
      this.inputContractBadge, this.inputPeriodLabel, this.inputContractValue,
      this.inputEpiPrevista, this.inputEpiRealizada, this.inputEpiPeso,
      this.inputInstPerf, this.inputInstPeso,
      this.inputExcedenteQtd, this.inputExcedenteTarifa, this.inputExcedenteUnit,
      this.inputIncentivoMeta, this.inputIncentivoBase, this.inputIncentivoRec
    ];

    reactiveInputs.forEach(input => {
      input.addEventListener('input', () => this.syncStateFromInputs());
    });
  }

  initModalEvents() {
    this.btnOpenConfigModal.addEventListener('click', () => {
      this.renderContractsList();
      this.renderTechniciansList();
      this.configModal.classList.add('active');
    });

    const closeModal = () => {
      this.configModal.classList.remove('active');
      this.contractFormBox.classList.remove('active');
      this.techFormBox.classList.remove('active');
      this.populateContractSelect();
      this.onSectorChange();
    };

    this.btnCloseConfigModal.addEventListener('click', closeModal);
    this.btnCloseConfigModalBottom.addEventListener('click', closeModal);
    this.configModal.addEventListener('click', (e) => {
      if (e.target === this.configModal) closeModal();
    });

    this.tabBtnContracts.addEventListener('click', () => {
      this.tabBtnContracts.classList.add('active');
      this.tabBtnTechs.classList.remove('active');
      this.paneContracts.classList.add('active');
      this.paneTechs.classList.remove('active');
    });

    this.tabBtnTechs.addEventListener('click', () => {
      this.tabBtnTechs.classList.add('active');
      this.tabBtnContracts.classList.remove('active');
      this.paneTechs.classList.add('active');
      this.paneContracts.classList.remove('active');
    });

    this.btnResetConfig.addEventListener('click', () => {
      if (confirm('Deseja restaurar os contratos e técnicos padrão da Mar Brasil?')) {
        this.config = ContractStore.resetToDefault();
        this.renderContractsList();
        this.renderTechniciansList();
        alert('Configurações restauradas com sucesso!');
      }
    });

    // Contratos
    this.btnShowAddContract.addEventListener('click', () => {
      this.formContractId.value = '';
      this.formContractCode.value = '';
      this.formClientName.value = '';
      this.formClientFullName.value = '';
      this.formContractValue.value = '6000.00';
      this.formContractDesc.value = 'Avaliação objetiva da execução contratual de manutenção (PMOC e correlatos) realizada pela Mar Brasil.';
      this.populateTechSelectOptions(this.formContractTech);
      this.contractFormBox.classList.add('active');
    });

    this.btnCancelContractForm.addEventListener('click', () => {
      this.contractFormBox.classList.remove('active');
    });

    this.btnSaveContractForm.addEventListener('click', () => {
      const id = this.formContractId.value || `contract-${Date.now()}`;
      const code = this.formContractCode.value.trim();
      const clientName = this.formClientName.value.trim();
      const clientFullName = this.formClientFullName.value.trim();
      const contractValue = parseFloat(this.formContractValue.value) || 6000.0;
      const description = this.formContractDesc.value.trim();
      const technicianId = this.formContractTech.value;

      if (!code || !clientName) {
        alert('Por favor, preencha o código do contrato e o nome do órgão/cliente.');
        return;
      }

      const existingIdx = this.config.contracts.findIndex(c => c.id === id);
      if (existingIdx >= 0) {
        this.config.contracts[existingIdx].code = code;
        this.config.contracts[existingIdx].clientName = clientName;
        this.config.contracts[existingIdx].clientFullName = clientFullName;
        this.config.contracts[existingIdx].contractValue = contractValue;
        this.config.contracts[existingIdx].description = description;
        this.config.contracts[existingIdx].technicianId = technicianId;
      } else {
        this.config.contracts.push({
          id,
          code,
          clientName,
          clientFullName,
          company: 'Mar Brasil',
          description,
          contractValue,
          technicianId,
          sectors: []
        });
      }

      ContractStore.save(this.config);
      this.contractFormBox.classList.remove('active');
      this.renderContractsList();
    });

    // Técnicos
    this.btnShowAddTech.addEventListener('click', () => {
      this.formTechId.value = '';
      this.formTechName.value = '';
      this.formTechPhone.value = '';
      this.formTechNotes.value = '';
      this.techFormBox.classList.add('active');
    });

    this.btnCancelTechForm.addEventListener('click', () => {
      this.techFormBox.classList.remove('active');
    });

    this.btnSaveTechForm.addEventListener('click', () => {
      const id = this.formTechId.value || `tech-${Date.now()}`;
      const name = this.formTechName.value.trim();
      const phone = this.formTechPhone.value.trim();
      const notes = this.formTechNotes.value.trim();

      if (!name) {
        alert('Por favor, informe o nome do técnico ou empresa parceira.');
        return;
      }

      const existingIdx = this.config.technicians.findIndex(t => t.id === id);
      if (existingIdx >= 0) {
        this.config.technicians[existingIdx].name = name;
        this.config.technicians[existingIdx].phone = phone;
        this.config.technicians[existingIdx].notes = notes;
      } else {
        this.config.technicians.push({ id, name, phone, notes });
      }

      ContractStore.save(this.config);
      this.techFormBox.classList.remove('active');
      this.renderTechniciansList();
    });
  }

  populateTechSelectOptions(selectEl, selectedId = '') {
    selectEl.innerHTML = '<option value="">-- Selecione o Técnico --</option>';
    this.config.technicians.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name;
      if (t.id === selectedId) opt.selected = true;
      selectEl.appendChild(opt);
    });
  }

  renderContractsList() {
    this.contractsListContainer.innerHTML = '';

    this.config.contracts.forEach(contract => {
      const card = document.createElement('div');
      card.className = 'contract-card-item';

      let defaultTechLabel = '';
      if (contract.technicianId) {
        defaultTechLabel = ` • Técnico Geral: <strong>${ContractStore.getTechName(this.config.technicians, contract.technicianId)}</strong>`;
      }

      card.innerHTML = `
        <div class="contract-card-top">
          <div>
            <span class="contract-code-badge">${contract.code}</span>
            <span style="font-weight: 700; color: #1e293b; margin-left: 6px;">${contract.clientName}</span>
            <div class="contract-client-label">${contract.clientFullName || ''}${defaultTechLabel}</div>
            <div style="font-size: 11px; color: #64748b; margin-top: 2px;">Valor Base: ${Formatter.currency(contract.contractValue)}</div>
          </div>
          <div class="contract-actions">
            <button type="button" class="btn-icon" data-action="edit-contract" data-id="${contract.id}" title="Editar Contrato">✏️ Editar</button>
            <button type="button" class="btn-icon danger" data-action="delete-contract" data-id="${contract.id}" title="Excluir Contrato">🗑️</button>
          </div>
        </div>
      `;

      if (contract.sectors && contract.sectors.length > 0) {
        const sectorsBox = document.createElement('div');
        sectorsBox.className = 'sectors-accordion';
        sectorsBox.innerHTML = `
          <div style="font-size: 11.5px; font-weight: 700; color: #475569; margin-bottom: 6px;">
            Distribuição de Subsetores e Técnicos Responsáveis (${contract.sectors.length} setores):
          </div>
          <div class="sectors-grid" id="grid-${contract.id}"></div>
        `;

        const grid = sectorsBox.querySelector(`#grid-${contract.id}`);
        contract.sectors.forEach(sec => {
          const secRow = document.createElement('div');
          secRow.className = 'sector-item-row';
          secRow.innerHTML = `
            <span class="sector-name">${sec.code || sec.fullName}</span>
            <select class="sector-tech-select" data-contract-id="${contract.id}" data-sector-id="${sec.id}"></select>
          `;
          const secSelect = secRow.querySelector('select');
          this.populateTechSelectOptions(secSelect, sec.technicianId);

          secSelect.addEventListener('change', (e) => {
            sec.technicianId = e.target.value;
            ContractStore.save(this.config);
          });

          grid.appendChild(secRow);
        });

        card.appendChild(sectorsBox);
      }

      card.querySelector('[data-action="edit-contract"]').addEventListener('click', () => {
        this.formContractId.value = contract.id;
        this.formContractCode.value = contract.code;
        this.formClientName.value = contract.clientName;
        this.formClientFullName.value = contract.clientFullName || '';
        this.formContractValue.value = contract.contractValue || 6000;
        this.formContractDesc.value = contract.description || '';
        this.populateTechSelectOptions(this.formContractTech, contract.technicianId);
        this.contractFormBox.classList.add('active');
        this.contractFormBox.scrollIntoView({ behavior: 'smooth' });
      });

      card.querySelector('[data-action="delete-contract"]').addEventListener('click', () => {
        if (confirm(`Excluir o contrato ${contract.code}?`)) {
          this.config.contracts = this.config.contracts.filter(c => c.id !== contract.id);
          ContractStore.save(this.config);
          this.renderContractsList();
        }
      });

      this.contractsListContainer.appendChild(card);
    });
  }

  renderTechniciansList() {
    this.techniciansListContainer.innerHTML = '';

    const table = document.createElement('table');
    table.className = 'tech-table';
    table.innerHTML = `
      <thead>
        <tr>
          <th>Nome do Técnico / Empresa</th>
          <th>Atribuição / Setores</th>
          <th>Telefone / Contato</th>
          <th style="text-align: right;">Ações</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;

    const tbody = table.querySelector('tbody');
    this.config.technicians.forEach(tech => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${tech.name}</strong></td>
        <td style="color: #64748b; font-size: 11.5px;">${tech.notes || '—'}</td>
        <td style="color: #475569;">${tech.phone || '—'}</td>
        <td style="text-align: right;">
          <button type="button" class="btn-icon" data-action="edit-tech" data-id="${tech.id}">✏️</button>
          <button type="button" class="btn-icon danger" data-action="delete-tech" data-id="${tech.id}">🗑️</button>
        </td>
      `;

      tr.querySelector('[data-action="edit-tech"]').addEventListener('click', () => {
        this.formTechId.value = tech.id;
        this.formTechName.value = tech.name;
        this.formTechPhone.value = tech.phone || '';
        this.formTechNotes.value = tech.notes || '';
        this.techFormBox.classList.add('active');
        this.techFormBox.scrollIntoView({ behavior: 'smooth' });
      });

      tr.querySelector('[data-action="delete-tech"]').addEventListener('click', () => {
        if (confirm(`Excluir o técnico ${tech.name}?`)) {
          this.config.technicians = this.config.technicians.filter(t => t.id !== tech.id);
          ContractStore.save(this.config);
          this.renderTechniciansList();
        }
      });

      tbody.appendChild(tr);
    });

    this.techniciansListContainer.appendChild(table);
  }

  populateContractSelect() {
    this.contractSectorSelect.innerHTML = '';

    const optDefault = document.createElement('option');
    optDefault.value = 'PRINT_DEFAULT';
    optDefault.textContent = '★ Santos (SEDUC) - Consolidado Geral (Mar Brasil)';
    this.contractSectorSelect.appendChild(optDefault);

    const optGroupContracts = document.createElement('optgroup');
    optGroupContracts.label = '── Contratos Cadastrados (Consolidado) ──';

    this.config.contracts.forEach(contract => {
      let techText = '';
      if (contract.technicianId) {
        techText = ` (${ContractStore.getTechName(this.config.technicians, contract.technicianId)})`;
      } else if (contract.sectors && contract.sectors.length > 0) {
        techText = ` (${contract.sectors.length} Setores)`;
      }

      const opt = document.createElement('option');
      opt.value = `CONTRACT_${contract.id}`;
      opt.textContent = `${contract.code} - ${contract.clientName}${techText}`;
      optGroupContracts.appendChild(opt);
    });
    this.contractSectorSelect.appendChild(optGroupContracts);

    if (this.spreadsheetData && this.spreadsheetData.rows) {
      const optGroupSectors = document.createElement('optgroup');
      optGroupSectors.label = '── Setores Individuais com Técnicos ──';

      this.spreadsheetData.rows.forEach((row, idx) => {
        const resolved = ContractStore.resolveSectorInfo(this.config, row.setor);
        const opt = document.createElement('option');
        opt.value = `ROW_${idx}`;
        opt.textContent = `${row.setor} ➔ ${resolved.technicianName} (${row.equipamentosAtivos} maq.)`;
        optGroupSectors.appendChild(opt);
      });
      this.contractSectorSelect.appendChild(optGroupSectors);
    }
  }

  onSectorChange() {
    const val = this.contractSectorSelect.value;

    if (val === 'PRINT_DEFAULT') {
      this.state = JSON.parse(JSON.stringify(DEFAULT_REPORT_DATA));
      this.state.technicianName = 'Múltiplos Setores • Equipe Especializada';
      this.updateSidebarInfo('Mar Brasil', 'SEDUC Santos', 'Múltiplos Setores (Santos)', 'Consolidado Geral (6 setores)');
      this.syncInputsFromState();
      this.updateQuickStats({
        equipamentos: 402,
        mensalPrev: 402,
        mensalReal: 211,
        semestralPrev: 80,
        semestralReal: 0,
        corretivaPrev: 0,
        corretivaReal: 0
      });
      this.update();
      return;
    }

    if (val.startsWith('CONTRACT_')) {
      const contractId = val.replace('CONTRACT_', '');
      const contract = this.config.contracts.find(c => c.id === contractId);
      if (contract) {
        this.state.contractBadge = `CONTRATO ${contract.code}`;
        this.state.contractTitle = `Medição de Desempenho - ${contract.company || 'Mar Brasil'}`;
        this.state.contractSubtitle = contract.description;
        this.state.periodLabel = `VALORES - MAR BRASIL 06/2026`;
        this.state.contractValue = contract.contractValue;

        let techName = contract.technicianId 
          ? ContractStore.getTechName(this.config.technicians, contract.technicianId)
          : `${contract.sectors.length} Setores • Equipe Especializada`;

        this.state.technicianName = techName;

        this.updateSidebarInfo(contract.company || 'Mar Brasil', contract.clientName, techName, 'Consolidado');

        const groupKey = Object.keys(this.spreadsheetData.groups).find(k => 
          contract.code.toUpperCase().replace(/[^A-Z0-9]/g, '').includes(k.replace(/[^A-Z0-9]/g, ''))
        );

        if (groupKey && this.spreadsheetData.groups[groupKey]) {
          const grp = this.spreadsheetData.groups[groupKey];
          this.state.pmocMensal.prevista = grp.totals.mensalPrevista;
          this.state.pmocMensal.realizada = grp.totals.mensalRealizada;
          this.state.pmocSemestral.prevista = grp.totals.semestralPrevista;
          this.state.pmocSemestral.realizada = grp.totals.semestralRealizada;
          this.state.corretiva.prevista = grp.totals.corretivasPrevista;
          this.state.corretiva.realizada = grp.totals.corretivasRealizada;

          this.updateQuickStats({
            equipamentos: grp.totals.equipamentosAtivos,
            mensalPrev: grp.totals.mensalPrevista,
            mensalReal: grp.totals.mensalRealizada,
            semestralPrev: grp.totals.semestralPrevista,
            semestralReal: grp.totals.semestralRealizada,
            corretivaPrev: grp.totals.corretivasPrevista,
            corretivaReal: grp.totals.corretivasRealizada
          });
        }

        this.syncInputsFromState();
        this.update();
      }
      return;
    }

    if (val.startsWith('ROW_')) {
      const idx = parseInt(val.replace('ROW_', ''), 10);
      const row = this.spreadsheetData.rows[idx];
      if (row) {
        const resolved = ContractStore.resolveSectorInfo(this.config, row.setor);

        this.state.contractBadge = resolved.contract ? `${resolved.contract.code} • ${resolved.sectorDisplayName}` : `SETOR: ${row.setor}`;
        this.state.contractTitle = `Medição de Desempenho - ${resolved.company || 'Mar Brasil'}`;
        this.state.contractSubtitle = resolved.contract ? resolved.contract.description : DEFAULT_REPORT_DATA.contractSubtitle;
        this.state.periodLabel = `VALORES - MAR BRASIL 06/2026`;
        this.state.contractValue = resolved.contract ? resolved.contract.contractValue : 6000.0;
        this.state.technicianName = resolved.technicianName;

        this.state.pmocMensal.prevista = row.mensalPrevista;
        this.state.pmocMensal.realizada = row.mensalRealizada;
        this.state.pmocSemestral.prevista = row.semestralPrevista;
        this.state.pmocSemestral.realizada = row.semestralRealizada;
        this.state.corretiva.prevista = row.corretivasPrevista;
        this.state.corretiva.realizada = row.corretivasRealizada;

        this.updateSidebarInfo(resolved.company || 'Mar Brasil', resolved.clientName, resolved.technicianName, resolved.sectorDisplayName);

        this.syncInputsFromState();
        this.updateQuickStats({
          equipamentos: row.equipamentosAtivos,
          mensalPrev: row.mensalPrevista,
          mensalReal: row.mensalRealizada,
          semestralPrev: row.semestralPrevista,
          semestralReal: row.semestralRealizada,
          corretivaPrev: row.corretivasPrevista,
          corretivaReal: row.corretivasRealizada
        });
        this.update();
      }
    }
  }

  updateSidebarInfo(company, client, tech, sector) {
    if (this.sidebarCompany) this.sidebarCompany.textContent = company;
    if (this.sidebarClient) this.sidebarClient.textContent = client;
    if (this.sidebarTech) this.sidebarTech.textContent = tech;
    if (this.sidebarSector) this.sidebarSector.textContent = sector;
  }

  async processExcelFile(file) {
    try {
      const buffer = await file.arrayBuffer();
      const parsed = await ExcelParser.parseWorkbook(buffer);

      this.spreadsheetData = parsed;
      this.fileBadge.style.display = 'inline-block';
      this.fileInfoNotice.style.display = 'block';
      this.activeFileName.textContent = `${file.name} (${parsed.rows.length} setores encontrados)`;

      this.populateContractSelect();
      this.onSectorChange();
    } catch (err) {
      alert(`Erro ao ler planilha: ${err.message}`);
      console.error(err);
    }
  }

  updateQuickStats(stats) {
    const perfMensal = stats.mensalPrev > 0 ? Math.round((stats.mensalReal / stats.mensalPrev) * 100) : 100;
    const perfSemestral = stats.semestralPrev > 0 ? Math.round((stats.semestralReal / stats.semestralPrev) * 100) : 0;
    const perfCorretiva = stats.corretivaPrev > 0 ? Math.round((stats.corretivaReal / stats.corretivaPrev) * 100) : 100;

    this.pillEquipamentos.textContent = `${stats.equipamentos} ativos`;
    this.pillMensal.textContent = `${stats.mensalReal} / ${stats.mensalPrev} (${perfMensal}%)`;
    this.pillSemestral.textContent = `${stats.semestralReal} / ${stats.semestralPrev} (${perfSemestral}%)`;
    this.pillCorretivas.textContent = `${stats.corretivaReal} / ${stats.corretivaPrev} (${perfCorretiva}%)`;
  }

  syncInputsFromState() {
    this.inputContractBadge.value = this.state.contractBadge;
    this.inputPeriodLabel.value = this.state.periodLabel;
    this.inputContractValue.value = this.state.contractValue;

    this.inputEpiPrevista.value = this.state.epi.prevista;
    this.inputEpiRealizada.value = this.state.epi.realizada;
    this.inputEpiPeso.value = Math.round(this.state.epi.peso * 100);

    this.inputInstPerf.value = Math.round(this.state.instDesins.performance * 100);
    this.inputInstPeso.value = Math.round(this.state.instDesins.peso * 100);

    this.inputExcedenteQtd.value = this.state.excedente.quantidade;
    this.inputExcedenteTarifa.value = this.state.excedente.tarifa;
    this.inputExcedenteUnit.value = this.state.excedente.unitario;

    this.inputIncentivoMeta.value = Math.round(this.state.incentivoVeicular.metaPerformance * 100);
    this.inputIncentivoBase.value = this.state.incentivoVeicular.baseValue;
    this.inputIncentivoRec.value = this.state.incentivoVeicular.reconhecido;
  }

  syncStateFromInputs() {
    this.state.contractBadge = this.inputContractBadge.value || 'CONTRATO STS 36693/22';
    this.state.periodLabel = this.inputPeriodLabel.value || 'VALORES - MAR BRASIL 06/2026';
    this.state.contractValue = parseFloat(this.inputContractValue.value) || 6000.0;

    this.state.epi.prevista = parseInt(this.inputEpiPrevista.value, 10) || 0;
    this.state.epi.realizada = parseInt(this.inputEpiRealizada.value, 10) || 0;
    this.state.epi.peso = (parseFloat(this.inputEpiPeso.value) || 10) / 100;

    this.state.instDesins.performance = (parseFloat(this.inputInstPerf.value) || 100) / 100;
    this.state.instDesins.peso = (parseFloat(this.inputInstPeso.value) || 5) / 100;

    this.state.excedente.quantidade = parseInt(this.inputExcedenteQtd.value, 10) || 0;
    this.state.excedente.tarifa = parseFloat(this.inputExcedenteTarifa.value) || 10.75;
    this.state.excedente.unitario = parseFloat(this.inputExcedenteUnit.value) || 3.50;

    this.state.incentivoVeicular.metaPerformance = (parseFloat(this.inputIncentivoMeta.value) || 59) / 100;
    this.state.incentivoVeicular.baseValue = parseFloat(this.inputIncentivoBase.value) || 1000.0;
    this.state.incentivoVeicular.reconhecido = parseFloat(this.inputIncentivoRec.value) || 0;

    this.update();
  }

  loadDefaultSample() {
    this.state = JSON.parse(JSON.stringify(DEFAULT_REPORT_DATA));
    this.contractSectorSelect.value = 'PRINT_DEFAULT';
    this.syncInputsFromState();
    this.updateSidebarInfo('Mar Brasil', 'SEDUC Santos', 'GB Climatização', 'Setor 01');
    this.updateQuickStats({
      equipamentos: 402,
      mensalPrev: 402,
      mensalReal: 211,
      semestralPrev: 80,
      semestralReal: 0,
      corretivaPrev: 0,
      corretivaReal: 0
    });
    this.update();
  }

  update() {
    const computed = MeasurementCalculator.calculate(this.state);
    ReportRenderer.renderReport(this.reportContainer, this.state, computed);
  }
}

// Inicialização segura
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new MeasurementApp());
} else {
  new MeasurementApp();
}
