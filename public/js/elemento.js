// ---------------- CONFIGURAÇÃO FIREBASE ----------------
var firebaseConfig = {
    apiKey: "AIzaSyAqTSk9j6pRvRaDn6f1DlPX4w6xbRO3tL4",
    authDomain: "checkout-egaplast.firebaseapp.com",
    projectId: "checkout-egaplast",
    storageBucket: "checkout-egaplast.firebasestorage.app",
    messagingSenderId: "727373395159",
    appId: "1:727373395159:web:7c9cca0884b4fdfe5c2c92"
};
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// ---------------- VARIÁVEIS GLOBAIS E DOM ----------------
let currentUser = null;
let elementoId = null;
let unsubscribers = [];

// Contexto de Edição
let editingId = null;
let pedidoAtualId = null;
let pedidoAtualTipo = 'simples'; // 'simples' (legado) ou 'multi'
let pedidoAtualCriadorUid = null;
let pedidoAtualElementoId = null;
let caixaDocIndexAtual = null;

// Listas temporárias
let documentosTemporarios = [];
let emailToUidMap = {};
let elementoAtualTitulo = null;

// Elementos de UI (Loader e Navbar)
const userEmail = document.getElementById('user-email');
const pageLoader = document.getElementById('page-loader');
const appContent = document.getElementById('app-content');
const tituloElemento = document.getElementById('tituloElemento');
const voltarBtn = document.getElementById('voltarBtn');
const logoBtn = document.getElementById('logoBtn');
const logoutBtn = document.getElementById('logoutBtn');

// Modais
const multiPopupOverlay = document.getElementById('multiPopupOverlay');
const caixasPopup = document.getElementById('caixasPopup');
const addCaixaModal = document.getElementById('addCaixaModal');
const popupOrdens = document.getElementById('popupOrdens');
const logoutConfirmModal = document.getElementById('logoutConfirmModal');

// Inputs e Botões
const addMultiRowBtn = document.getElementById('addMultiRowBtn');
const abrirOrdensBtn = document.getElementById('abrirOrdensBtn');
const multiSaveBtn = document.getElementById('multiSaveBtn');
const multiCancelBtn = document.getElementById('multiCancelBtn');
const addDocumentoBtn = document.getElementById('addDocumentoBtn');
const addCaixaBtn = document.getElementById('addCaixaBtn');
const cancelAddCaixaBtn = document.getElementById('cancelAddCaixaBtn');
const salvarOrdemBtn = document.getElementById('salvarOrdemBtn');

// Campos de Formulário
const multiRomaneio = document.getElementById('multiRomaneio');
const multiLoja = document.getElementById('multiLoja');
const multiLocal = document.getElementById('multiLocal');
const multiUf = document.getElementById('multiUf');
const multiObservacoes = document.getElementById('multiObservacoes');
const multiDocTipo = document.getElementById('multiDocTipo');
const multiDocResponsavel = document.getElementById('multiDocResponsavel');
const documentosContainer = document.getElementById('documentosAdicionadosContainer');

// Container da Tabela
const multiOrdersTableBody = document.getElementById('multiOrdersTableBody');

// ---------------- INICIALIZAÇÃO ----------------

// Pega ID da URL
const urlParams = new URLSearchParams(window.location.search);
elementoId = urlParams.get('id');

// Transição de Página
window.transitionToPage = function(url) {
    appContent.classList.remove('content-visible');
    setTimeout(() => { window.location.href = url; }, 400);
}

voltarBtn.addEventListener('click', () => transitionToPage('dashboard.html'));
logoBtn.addEventListener('click', () => transitionToPage('dashboard.html'));

// Auth Observer
firebase.auth().onAuthStateChanged(async function(user) {
    if (user) {
        currentUser = user;
        userEmail.textContent = user.email;

        if (!elementoId) {
            alert("Elemento não especificado!");
            window.location.href = "dashboard.html";
            return;
        }

        // Inicialização de Dados
        await carregarTituloElemento();
        await carregarUsuarios();
        configurarListeners();
        carregarOrdens();

    } else {
        window.location.href = "index.html";
    }
});

// ---------------- CONFIGURAÇÃO UX / EVENTS ----------------

function setupEnterKey(modalId, actionBtnId) {
    const modal = document.getElementById(modalId);
    const btn = document.getElementById(actionBtnId);
    if(!modal || !btn) return;

    const inputs = modal.querySelectorAll('input, select, textarea');
    inputs.forEach(input => {
        input.addEventListener('keydown', (e) => {
            if(e.key === 'Enter') {
                if(input.tagName.toLowerCase() === 'textarea') return; 
                e.preventDefault();
                btn.click();
            }
        });
    });
}

function fecharModal(modal) {
    if (!modal) return;
    modal.classList.add('modal-closing');
    setTimeout(() => {
        modal.style.display = 'none';
        modal.classList.remove('modal-closing');
    }, 300); 
}

setupEnterKey('multiPopupOverlay', 'multiSaveBtn');
setupEnterKey('addCaixaModal', 'addCaixaBtn');
setupEnterKey('popupOrdens', 'salvarOrdemBtn');

logoutBtn.addEventListener('click', () => logoutConfirmModal.style.display = 'flex');
document.getElementById('closeLogoutModal').addEventListener('click', () => fecharModal(logoutConfirmModal));
document.getElementById('cancelLogoutBtn').addEventListener('click', () => fecharModal(logoutConfirmModal));
document.getElementById('confirmLogoutBtn').addEventListener('click', () => {
    logoutConfirmModal.style.display = 'none';
    appContent.classList.remove('content-visible');
    setTimeout(() => {
        firebase.auth().signOut().then(() => window.location.href = "index.html");
    }, 400);
});

window.onclick = function(e) {
    if(e.target == multiPopupOverlay) fecharModal(multiPopupOverlay);
    if(e.target == caixasPopup) fecharModal(caixasPopup);
    if(e.target == addCaixaModal) fecharModal(addCaixaModal);
    if(e.target == popupOrdens) fecharModal(popupOrdens);
    if(e.target == logoutConfirmModal) fecharModal(logoutConfirmModal);
}

// --- SISTEMA DE LOGS E AUDITORIA ---
async function registrarLog(acao, tipo, detalhe = "") {
    try {
        // Gera data YYYY-MM-DD baseada no horário LOCAL do computador
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const dataLocal = `${year}-${month}-${day}`;

        const logData = {
            acao: acao, 
            tipo: tipo, 
            detalhe: detalhe,
            pedidoId: pedidoAtualId || "novo",
            romaneio: document.getElementById('multiRomaneio')?.value || (pedidoAtualId ? "Ver Detalhes" : "---"),
            usuario: currentUser.email,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(), // Hora do servidor
            timestamp: Date.now(), // Hora local numérica para ordenação garantida
            dataString: dataLocal 
        };

        console.log("Tentando gravar log:", logData); // DEBUG

        await db.collection("logs_globais").add(logData);
        
        console.log("LOG GRAVADO COM SUCESSO!"); // DEBUG
    } catch (e) { 
        console.error("ERRO FATAL AO LOGAR:", e); 
        alert("Erro ao registrar atividade: " + e.message);
    }
}

// ---------------- LÓGICA PRINCIPAL DE DADOS ----------------

function configurarListeners() {
    desativarListeners();

    // 1. Pedidos Simples
    const unsubSimples = db.collection("usuarios").doc(currentUser.uid)
        .collection("elementos").doc(elementoId).collection("pedidos")
        .onSnapshot(() => atualizarPaginaInteira());

    // 2. Pedidos Multi (Próprios)
    const unsubMulti = db.collection("usuarios").doc(currentUser.uid)
        .collection("elementos").doc(elementoId).collection("pedidosMultiDocumento")
        .onSnapshot(() => atualizarPaginaInteira());

    // 3. Pedidos Compartilhados
    const unsubShared = db.collection("usuarios").doc(currentUser.uid)
        .collection("pedidosCompartilhadosComigo")
        .onSnapshot(() => atualizarPaginaInteira());

    unsubscribers.push(unsubSimples, unsubMulti, unsubShared);
}

function desativarListeners() {
    unsubscribers.forEach(unsub => unsub());
    unsubscribers = [];
}

async function atualizarPaginaInteira() {
    const [resSimples, resMulti] = await Promise.all([
        carregarPedidosSimples(),
        carregarPedidosMulti()
    ]);

    let todos = [...resSimples.lista, ...resMulti.lista];
    todos.sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));

    renderizarTabela(todos);
    atualizarTotais(resSimples.detalhes, resMulti.detalhes);

    setTimeout(() => {
        pageLoader.classList.add('loader-hidden');
        appContent.classList.add('content-visible');
        document.body.classList.remove('loading-active');
    }, 500);
}

// ---------------- CARREGAMENTO DE DADOS ----------------

async function carregarTituloElemento() {
    const doc = await db.collection("usuarios").doc(currentUser.uid).collection("elementos").doc(elementoId).get();
    if (doc.exists) {
        const t = doc.data().titulo || "Pedidos";
        tituloElemento.textContent = t;
        elementoAtualTitulo = t;
        document.title = `${t} - Egaplast`;
    }
}

async function carregarUsuarios() {
    const snap = await db.collection("usuarios").get();
    const select = multiDocResponsavel;
    select.innerHTML = "";
    emailToUidMap = {};
    
    snap.forEach(doc => {
        const d = doc.data();
        if(d.email) {
            let opt = document.createElement('option');
            const emailLimpo = d.email.trim().toLowerCase();
            opt.value = emailLimpo;     
            opt.textContent = d.email; 
            select.appendChild(opt);
            emailToUidMap[emailLimpo] = doc.id; 
        }
    });

    if (currentUser && currentUser.email) {
        select.value = currentUser.email.trim().toLowerCase();
    }
}

function transformarSimplesEmMulti(doc) {
    const d = doc.data();
    let docs = [];
    if(d.notaFiscal === 'Sim') docs.push({ tipo: 'Nota Fiscal', responsavel: currentUser.email, caixas: d.caixas || [] });
    if(d.bonificacao === 'Sim') docs.push({ tipo: 'Bonificação', responsavel: currentUser.email, caixas: [] });
    if(d.minuta === 'Sim') docs.push({ tipo: 'Minuta', responsavel: currentUser.email, caixas: [] });
    
    if(docs.length === 0 && d.caixas && d.caixas.length > 0) {
        docs.push({ tipo: 'Geral', responsavel: currentUser.email, caixas: d.caixas });
    } else if(docs.length > 0) {
        docs[0].caixas = d.caixas || [];
    }

    return {
        id: doc.id,
        romaneio: d.romaneio,
        loja: d.loja,
        local: d.local,
        uf: d.uf,
        observacoes: d.observacoes,
        efetivado: d.efetivado || false,
        createdAt: d.createdAt,
        documentos: docs,
        criadorUid: currentUser.uid,
        criadorEmail: currentUser.email,
        uidsVinculados: [currentUser.uid],
        _isLegacy: true,
        elementoIdOriginal: elementoId
    };
}

async function carregarPedidosSimples() {
    const snap = await db.collection("usuarios").doc(currentUser.uid).collection("elementos").doc(elementoId).collection("pedidos").get();
    let lista = [];
    let detalhes = initDetalhes();

    snap.forEach(doc => {
        const p = transformarSimplesEmMulti(doc);
        lista.push(p);
        contabilizarDetalhes(p, detalhes);
    });
    return { lista, detalhes };
}

async function carregarPedidosMulti() {
    const propriosSnap = await db.collection("usuarios").doc(currentUser.uid).collection("elementos").doc(elementoId).collection("pedidosMultiDocumento").get();
    const atalhosSnap = await db.collection("usuarios").doc(currentUser.uid).collection("pedidosCompartilhadosComigo").get();

    let listaBruta = [];
    propriosSnap.forEach(doc => listaBruta.push({ id: doc.id, ...doc.data(), elementoIdOriginal: elementoId }));

    const promises = [];
    atalhosSnap.forEach(docAtalho => {
        const atalho = docAtalho.data();
        if(atalho.elementoTitulo === elementoAtualTitulo) {
            const p = db.collection("usuarios").doc(atalho.criadorUid)
                .collection("elementos").doc(atalho.elementoId)
                .collection("pedidosMultiDocumento").doc(atalho.pedidoId).get()
                .then(d => d.exists ? { id: d.id, ...d.data(), compartilhado: true, elementoIdOriginal: atalho.elementoId } : null);
            promises.push(p);
        }
    });
    
    const compartilhados = await Promise.all(promises);
    compartilhados.forEach(p => { if(p) listaBruta.push(p); });

    const unicos = listaBruta.reduce((acc, curr) => {
        if(!acc.find(x => x.id === curr.id)) acc.push(curr);
        return acc;
    }, []);

    let detalhes = initDetalhes();
    unicos.forEach(p => contabilizarDetalhes(p, detalhes));

    return { lista: unicos, detalhes };
}

function initDetalhes() {
    return { total: 0, nf: 0, bonif: 0, minuta: 0, caixas: 0, caixasBonus: 0, agrupado: {} };
}

function contabilizarDetalhes(pedido, det) {
    const userEmail = currentUser.email.trim().toLowerCase();

    (pedido.documentos || []).forEach(doc => {
        const respEmail = (doc.responsavel || "").trim().toLowerCase();
        if (respEmail !== userEmail) return; 

        // Só incrementa o TOTAL GERAL se for Nota Fiscal ou Minuta
        if (doc.tipo === 'Nota Fiscal' || doc.tipo === 'Minuta') {
            det.total++;
        }

        if(doc.tipo === 'Nota Fiscal') det.nf++;
        if(doc.tipo === 'Bonificação' || doc.tipo === 'Troca') det.bonif++;
        if(doc.tipo === 'Minuta') det.minuta++;

        (doc.caixas || []).forEach(cx => {
            let raw = String(cx.num || "").trim();
            let idCaixa = raw.replace(/^(cx|caixa)\s*/i, '').trim();
            if(!idCaixa) return;

            const num = `CAIXA ${idCaixa}`;

            if(cx.isBonificacao) {
                det.caixasBonus++;
                const k = `${num} (Bônus)`;
                det.agrupado[k] = (det.agrupado[k] || 0) + 1;
            } else {
                det.caixas++;
                det.agrupado[num] = (det.agrupado[num] || 0) + 1;
            }
        });
    });
}

function atualizarTotais(det1, det2) {
    const final = {
        total: det1.total + det2.total,
        nf: det1.nf + det2.nf,
        bonif: det1.bonif + det2.bonif,
        minuta: det1.minuta + det2.minuta,
        caixas: det1.caixas + det2.caixas,
        caixasBonus: det1.caixasBonus + det2.caixasBonus
    };

    document.getElementById('totalPedidosVisor').textContent = final.total;
    
    const tooltip = document.getElementById('detalhesTooltip');
    const rows = tooltip.querySelectorAll('.val');
    if(rows.length >= 5) {
        rows[0].textContent = final.nf;
        rows[1].textContent = final.bonif;
        rows[2].textContent = final.minuta;
        rows[3].textContent = final.caixas;
        rows[4].textContent = final.caixasBonus;
    }

    const agrupadoFinal = { ...det1.agrupado };
    Object.entries(det2.agrupado).forEach(([k, v]) => agrupadoFinal[k] = (agrupadoFinal[k] || 0) + v);

    const sorted = Object.keys(agrupadoFinal).sort((a, b) => {
        const numA = parseInt(a.replace(/\D/g, '')) || 0;
        const numB = parseInt(b.replace(/\D/g, '')) || 0;
        return numA - numB;
    });

    const listHtml = sorted.map(k => {
        const style = k.includes('Bônus') ? 'color:var(--secondary); font-weight:bold;' : '';
        return `<span style="display:inline-block; margin-right:5px; ${style}">${k}: ${agrupadoFinal[k]}</span>`;
    }).join(' | ');
    
    document.getElementById('caixasDetalhadasList').innerHTML = listHtml;
}

// ---------------- RENDERIZAÇÃO DA TABELA ----------------

function renderizarTabela(pedidos) {
    multiOrdersTableBody.innerHTML = "";

    if(pedidos.length === 0) {
        multiOrdersTableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#999; padding:30px;">Nenhum pedido encontrado.</td></tr>`;
        return;
    }

    pedidos.forEach((p, index) => {
        const tr = document.createElement('tr');
        tr.style.animationDelay = `${index * 0.05}s`;
        if(p.efetivado) tr.classList.add('efetivado');

        const criadorUid = p.criadorUid || currentUser.uid;
        const temPermissao = (p.uidsVinculados && p.uidsVinculados.includes(currentUser.uid)) || (criadorUid === currentUser.uid);
        const isLegacy = p._isLegacy === true;

        tr.style.cursor = 'pointer';
        tr.onclick = (e) => {
            if (!e.target.closest('.action-btn')) {
                abrirCaixas(p.id, isLegacy ? 'simples' : 'multi', criadorUid, p.elementoIdOriginal, p.romaneio);
            }
        };

        const docsHtml = (p.documentos || []).map(d => 
            `<span class="doc-pill">${d.tipo}<small>(${d.responsavel.split('@')[0]})</small></span>`
        ).join('');

        const allCaixas = (p.documentos || []).flatMap(d => d.caixas || []);
        const resumoCaixas = calcularResumoCaixas(allCaixas);

        const btnCopy = `<button class="action-btn btn-copy" title="Copiar Resumo" onclick="copiarResumo(event, this)"><i class="fa-regular fa-copy"></i></button>`;
        const btnEdit = `<button class="action-btn btn-edit" title="Editar" onclick="abrirEdicao('${p.id}', '${criadorUid}', '${p.elementoIdOriginal}', ${isLegacy})"><i class="fa-solid fa-pen"></i></button>`;
        const btnCaixas = `<button class="action-btn btn-caixas" title="Caixas" onclick="abrirCaixas('${p.id}', '${isLegacy ? 'simples' : 'multi'}', '${criadorUid}', '${p.elementoIdOriginal}', '${p.romaneio || ''}')"><i class="fa-solid fa-boxes-stacked"></i></button>`;
        const btnDel = temPermissao ? `<button class="action-btn btn-del" title="Excluir" onclick="excluirPedido('${p.id}', '${isLegacy ? 'pedidos' : 'pedidosMultiDocumento'}', '${criadorUid}')"><i class="fa-solid fa-trash"></i></button>` : '';
        const btnCheck = temPermissao ? `<button class="action-btn btn-check" title="${p.efetivado ? 'Desfazer' : 'Efetivar'}" onclick="toggleEfetivado('${p.id}', '${criadorUid}', '${p.elementoIdOriginal}', ${isLegacy})"><i class="fa-solid fa-check"></i></button>` : '';

        tr.innerHTML = `
            <td><strong>${p.romaneio || '---'}</strong> ${p.compartilhado ? '<i class="fa-solid fa-share-nodes" title="Compartilhado" style="color:#aaa; font-size:10px; margin-left:5px;"></i>' : ''}</td>
            <td>${p.loja || '---'}</td>
            <td>${p.local || 'DF'}</td>
            <td>${docsHtml}</td>
            <td style="font-size:12px; color:#666; max-width:200px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${p.observacoes || ''}</td>
            <td style="font-size:11px;">${resumoCaixas}</td>
            <td style="text-align:right; white-space:nowrap;">
                ${btnCheck}
                ${btnEdit}
                ${btnCopy}
                ${btnCaixas}
                ${btnDel}
            </td>
        `;
        multiOrdersTableBody.appendChild(tr);
    });
}

function calcularResumoCaixas(caixas) {
    if (!caixas || caixas.length === 0) return '<span style="color:#ccc;">Sem caixas</span>';

    const grupos = {};

    caixas.forEach(cx => {
        let nomeRaw = (cx.num || "S/N").toString().trim();
        let nomeFormatado = nomeRaw;
        if (/^\d+$/.test(nomeRaw)) {
            nomeFormatado = `CAIXA ${nomeRaw}`;
        } else {
            if (/^cx/i.test(nomeRaw)) nomeFormatado = nomeRaw.replace(/^cx\s*/i, 'CAIXA ').toUpperCase();
            else nomeFormatado = nomeRaw.toUpperCase();
        }

        const isBonus = !!cx.isBonificacao;
        const key = `${nomeFormatado}|${isBonus}`;

        if (!grupos[key]) grupos[key] = { nome: nomeFormatado, isBonus: isBonus, pesoTotal: 0, qtdVolumes: 0 };
        grupos[key].pesoTotal += parseFloat(cx.peso || 0);
        grupos[key].qtdVolumes += 1;
    });

    const listaOrdenada = Object.values(grupos).sort((a, b) => {
        if (a.isBonus !== b.isBonus) return a.isBonus ? 1 : -1; 
        const numA = parseInt(a.nome.replace(/\D/g, '')) || 0;
        const numB = parseInt(b.nome.replace(/\D/g, '')) || 0;
        if (numA !== numB) return numA - numB;
        return a.nome.localeCompare(b.nome);
    });

    return listaOrdenada.map(item => {
        const pesoStr = item.pesoTotal.toFixed(2);
        if (item.isBonus) return `<div style="margin-bottom:2px; color:var(--secondary);"><strong>${item.nome} (Bonificação)</strong> (Peso: ${pesoStr} kg): ${item.qtdVolumes} Un</div>`;
        return `<div style="margin-bottom:2px;"><strong>${item.nome}</strong> (Peso: ${pesoStr} kg): ${item.qtdVolumes} Un</div>`;
    }).join('');
}

// ---------------- AÇÕES (CRIAR / EDITAR / EXCLUIR) ----------------

addMultiRowBtn.addEventListener('click', () => {
    editingId = null;
    documentosTemporarios = [];
    limparFormMulti();
    renderizarDocsTemp();
    document.getElementById('multiPopupTitle').innerHTML = '<i class="fa-solid fa-file-invoice"></i> Novo Pedido';
    multiPopupOverlay.style.display = 'flex';
    if (currentUser && currentUser.email) multiDocResponsavel.value = currentUser.email.trim().toLowerCase();
    multiRomaneio.focus();
});

multiCancelBtn.addEventListener('click', () => fecharModal(multiPopupOverlay));
document.querySelector('.close-modal-btn').addEventListener('click', () => fecharModal(multiPopupOverlay));

function limparFormMulti() {
    multiRomaneio.value = ""; multiLoja.value = ""; multiLocal.value = "DF"; multiUf.value = ""; multiObservacoes.value = "";
}

addDocumentoBtn.addEventListener('click', () => {
    const resp = multiDocResponsavel.value;
    if(!resp) return alert("Selecione um responsável");
    documentosTemporarios.push({
        idTemp: Date.now(),
        tipo: multiDocTipo.value,
        responsavel: resp,
        caixas: []
    });
    renderizarDocsTemp();
});

function renderizarDocsTemp() {
    documentosContainer.innerHTML = "";
    documentosTemporarios.forEach(doc => {
        const div = document.createElement('div');
        div.style.cssText = "display:flex; justify-content:space-between; background:#fff; padding:8px; border:1px solid #eee; border-radius:6px; margin-bottom:5px; align-items:center; font-size:13px;";
        div.innerHTML = `<span><strong>${doc.tipo}</strong> - ${doc.responsavel}</span><i class="fa-solid fa-trash" style="color:#dc3545; cursor:pointer;" onclick="removerDocTemp(${doc.idTemp})"></i>`;
        documentosContainer.appendChild(div);
    });
}

window.removerDocTemp = function(id) {
    documentosTemporarios = documentosTemporarios.filter(d => d.idTemp !== id);
    renderizarDocsTemp();
}

multiSaveBtn.addEventListener('click', async () => {
    if(!multiRomaneio.value) return alert("Informe o Romaneio");
    if(documentosTemporarios.length === 0) return alert("Adicione pelo menos um documento");

    const responsaveis = [...new Set(documentosTemporarios.map(d => d.responsavel))];
    if(!responsaveis.includes(currentUser.email)) responsaveis.push(currentUser.email);
    const uids = responsaveis.map(email => emailToUidMap[email.trim().toLowerCase()]).filter(Boolean);

    const data = {
        romaneio: multiRomaneio.value,
        loja: multiLoja.value,
        local: multiLocal.value,
        uf: multiUf.value,
        observacoes: multiObservacoes.value,
        documentos: documentosTemporarios.map(({idTemp, ...rest}) => rest),
        uidsVinculados: uids
    };

    try {
        multiSaveBtn.textContent = "Salvando...";
        
        if(editingId) {
            const ref = db.collection("usuarios").doc(pedidoAtualCriadorUid).collection("elementos").doc(pedidoAtualElementoId).collection("pedidosMultiDocumento").doc(editingId);
            await ref.update(data);
        } else {
            data.criadorUid = currentUser.uid;
            data.criadorEmail = currentUser.email;
            data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            
            const ref = db.collection("usuarios").doc(currentUser.uid).collection("elementos").doc(elementoId).collection("pedidosMultiDocumento");
            const docRef = await ref.add(data);
            
            // LOG DE CRIAÇÃO
            registrarLog("Criação de Pedido", "sucesso", `Romaneio ${data.romaneio} criado.`);

            const batch = db.batch();
            uids.forEach(uid => {
                if(uid === currentUser.uid) return;
                const shareRef = db.collection("usuarios").doc(uid).collection("pedidosCompartilhadosComigo").doc(docRef.id);
                batch.set(shareRef, {
                    criadorUid: currentUser.uid,
                    pedidoId: docRef.id,
                    elementoId: elementoId,
                    elementoTitulo: elementoAtualTitulo
                });
            });
            await batch.commit();
        }

        fecharModal(multiPopupOverlay);
    } catch(e) {
        alert("Erro: " + e.message);
    } finally {
        multiSaveBtn.textContent = "Salvar Pedido";
    }
});

window.abrirEdicao = async function(id, criadorUid, elemIdOriginal, isLegacy) {
    if(isLegacy) return alert("Edite pedidos antigos recriando-os no novo formato."); 
    
    const docSnap = await db.collection("usuarios").doc(criadorUid).collection("elementos").doc(elemIdOriginal).collection("pedidosMultiDocumento").doc(id).get();
    if(!docSnap.exists) return;

    const d = docSnap.data();
    editingId = id;
    pedidoAtualCriadorUid = criadorUid;
    pedidoAtualElementoId = elemIdOriginal;

    multiRomaneio.value = d.romaneio;
    multiLoja.value = d.loja;
    multiLocal.value = d.local;
    multiUf.value = d.uf;
    multiObservacoes.value = d.observacoes;
    
    documentosTemporarios = (d.documentos || []).map((doc, i) => ({ ...doc, idTemp: i }));
    renderizarDocsTemp();

    document.getElementById('multiPopupTitle').innerHTML = '<i class="fa-solid fa-pen-to-square"></i> Editar Pedido';
    multiPopupOverlay.style.display = 'flex';
}

window.toggleEfetivado = async function(id, criadorUid, elemIdOriginal, isLegacy) {
    const coll = isLegacy ? 'pedidos' : 'pedidosMultiDocumento';
    const ref = db.collection("usuarios").doc(criadorUid).collection("elementos").doc(elemIdOriginal).collection(coll).doc(id);
    
    const snap = await ref.get();
    if(snap.exists) {
        const novoStatus = !snap.data().efetivado;
        const updateData = { efetivado: novoStatus };
        
        // MARCA HORA DE CONCLUSÃO SE EFETIVADO
        if(novoStatus) {
            updateData.completedAt = firebase.firestore.FieldValue.serverTimestamp();
            registrarLog("Finalização de Pedido", "sucesso", `Pedido efetivado manualmente.`);
        } else {
             // Se desmarcar, remove o completedAt (opcional)
             updateData.completedAt = firebase.firestore.FieldValue.delete();
        }

        await ref.update(updateData);
    }
}

window.excluirPedido = async function(id, coll, criadorUid) {
    if(!confirm("Tem certeza que deseja excluir este pedido?")) return;
    await db.collection("usuarios").doc(criadorUid).collection("elementos").doc(elementoId).collection(coll).doc(id).delete();
    registrarLog("Exclusão de Pedido", "alerta", `Pedido removido.`);
}


// ---------------- GERENCIAMENTO DE CAIXAS ----------------

window.abrirCaixas = async function(id, tipo, criadorUid, elemId, romaneioNum) {
    pedidoAtualId = id;
    pedidoAtualTipo = tipo;
    pedidoAtualCriadorUid = criadorUid;
    pedidoAtualElementoId = elemId;

    const titleEl = document.getElementById('caixasPopupTitle');
    titleEl.innerHTML = `<i class="fa-solid fa-boxes-stacked"></i> Caixas do Pedido <span style="font-weight:300; color:#999; margin-left:10px;">Romaneio ${romaneioNum || '---'}</span>`;

    caixasPopup.style.display = 'flex';
    await renderizarGridCaixas();
}

document.getElementById('fecharCaixasBtn').addEventListener('click', () => fecharModal(caixasPopup));

async function renderizarGridCaixas() {
    const container = document.getElementById('listaCaixasContainer');
    container.innerHTML = '<div style="text-align:center; width:100%;"><i class="fa-solid fa-spinner fa-spin"></i> Carregando...</div>';

    const coll = pedidoAtualTipo === 'simples' ? 'pedidos' : 'pedidosMultiDocumento';
    const docSnap = await db.collection("usuarios").doc(pedidoAtualCriadorUid).collection("elementos").doc(pedidoAtualElementoId).collection(coll).doc(pedidoAtualId).get();
    
    if(!docSnap.exists) return;
    
    let dados = pedidoAtualTipo === 'simples' ? transformarSimplesEmMulti(docSnap) : docSnap.data();
    const temPermissao = (dados.uidsVinculados && dados.uidsVinculados.includes(currentUser.uid)) || (dados.criadorUid === currentUser.uid) || pedidoAtualTipo === 'simples';

    container.innerHTML = "";

    (dados.documentos || []).forEach((doc, index) => {
        const section = document.createElement('div');
        section.className = 'doc-section';

        let caixasHtml = '';
        (doc.caixas || []).forEach((cx, cxIndex) => {
            const icon = cx.isBonificacao ? '<i class="fa-solid fa-star" style="color:var(--secondary)"></i>' : '<i class="fa-regular fa-star"></i>';
            const temProdutos = cx.produtos && cx.produtos.length > 0;
            const produtosList = temProdutos ? cx.produtos.map(p => 
                `<tr><td>${p.referencia}</td><td>${p.descricao}</td><td style="text-align:right;">${p.quantidade || 1}</td></tr>`
            ).join('') : '<tr><td colspan="3" style="text-align:center; color:#999;">Caixa Manual</td></tr>';

            caixasHtml += `
                <div class="caixa-item ${temProdutos ? '' : 'manual'}">
                    <div class="caixa-header" onclick="this.parentElement.classList.toggle('open')">
                        <div style="display:flex; align-items:center; gap:10px;">
                            <span class="bonificacao-star" onclick="event.stopPropagation(); toggleBonus(${index}, ${cxIndex})">${icon}</span>
                            <strong>${cx.num || 'CX ?'}</strong> 
                            <span style="color:#666; font-weight:400;">(${cx.peso} kg)</span>
                        </div>
                        <div>
                            ${temPermissao ? `<i class="fa-solid fa-trash" style="color:#dc3545; margin-left:10px;" onclick="event.stopPropagation(); excluirCaixa(${index}, ${cxIndex})"></i>` : ''}
                        </div>
                    </div>
                    <div class="caixa-body">
                        <table style="font-size:11px;">
                            <thead style="background:#eee;"><tr><th>Ref</th><th>Desc</th><th style="text-align:right;">Qtd</th></tr></thead>
                            <tbody>${produtosList}</tbody>
                        </table>
                    </div>
                </div>
            `;
        });

        if(!caixasHtml) caixasHtml = '<p style="text-align:center; color:#ccc; font-style:italic;">Nenhuma caixa.</p>';

        const acoesHtml = temPermissao ? `
            <div class="import-area">
                <label class="import-label" for="csvFile-${index}"><i class="fa-solid fa-file-csv"></i> Importar CSV (Substituir)</label>
                <input type="file" id="csvFile-${index}" accept=".csv" style="display:none;" onchange="processarCSV(this, ${index})">
                <div id="fileName-${index}" class="file-status">${doc.arquivoCsv ? 'Arquivo atual: ' + doc.arquivoCsv : ''}</div>
            </div>
            <button class="btn-add-manual" onclick="abrirModalAddCaixa(${index})">+ Caixa Manual</button>
        ` : '';

        section.innerHTML = `
            <div class="doc-header">
                <h4>${doc.tipo} <small style="color:#999; font-weight:400;">(${doc.responsavel})</small></h4>
            </div>
            ${acoesHtml}
            <div style="max-height:300px; overflow-y:auto;">${caixasHtml}</div>
        `;
        container.appendChild(section);
    });
}

window.abrirModalAddCaixa = function(docIndex) {
    caixaDocIndexAtual = docIndex;
    document.getElementById('numCaixa').value = "";
    document.getElementById('pesoCaixa').value = "";
    addCaixaModal.style.display = 'flex';
    document.getElementById('numCaixa').focus();
}

document.getElementById('cancelAddCaixaBtn').addEventListener('click', () => fecharModal(addCaixaModal));

addCaixaBtn.addEventListener('click', async () => {
    const num = document.getElementById('numCaixa').value;
    const peso = document.getElementById('pesoCaixa').value;
    const qtd = parseInt(document.getElementById('quantidadeCaixa').value) || 1;

    if(!num || !peso) return alert("Preencha número e peso");

    const novas = Array(qtd).fill().map(() => ({
        num: num,
        peso: parseFloat(peso.replace(',','.')) || 0,
        produtos: [],
        isBonificacao: false
    }));

    await salvarNovasCaixas(novas, caixaDocIndexAtual);
    registrarLog("Adição de Caixa", "info", `Caixa Manual ${num} adicionada.`);
    fecharModal(addCaixaModal);
});

async function salvarNovasCaixas(novasCaixas, docIndex, arquivoNome = null) {
    const coll = pedidoAtualTipo === 'simples' ? 'pedidos' : 'pedidosMultiDocumento';
    const ref = db.collection("usuarios").doc(pedidoAtualCriadorUid)
                  .collection("elementos").doc(pedidoAtualElementoId)
                  .collection(coll).doc(pedidoAtualId);

    try {
        const docSnap = await ref.get();
        if (!docSnap.exists) throw new Error("O pedido não existe mais.");

        let data = docSnap.data();
        let updateData = {}; 
        let documentosAtualizados = [];

        if (pedidoAtualTipo === 'simples') {
            if (arquivoNome) {
                updateData = { caixas: novasCaixas, arquivoCsv: arquivoNome };
            } else {
                const atuais = data.caixas || [];
                updateData = { caixas: [...atuais, ...novasCaixas] };
            }
        } else {
            let documentos = data.documentos || [];
            if (!documentos[docIndex]) throw new Error("Documento alvo não encontrado.");

            if (arquivoNome) {
                documentos[docIndex].caixas = novasCaixas;
                documentos[docIndex].arquivoCsv = arquivoNome;
            } else {
                const atuais = documentos[docIndex].caixas || [];
                documentos[docIndex].caixas = [...atuais, ...novasCaixas];
            }
            updateData = { documentos: documentos };
            documentosAtualizados = documentos;
        }

        // VERIFICA SE DEVE FINALIZAR AUTOMATICAMENTE (Se todos docs tem CSV)
        if(pedidoAtualTipo !== 'simples' && documentosAtualizados.length > 0) {
            const todosComCsv = documentosAtualizados.every(d => d.arquivoCsv && d.arquivoCsv.length > 0);
            if(todosComCsv && !data.efetivado) {
                updateData.efetivado = true;
                updateData.completedAt = firebase.firestore.FieldValue.serverTimestamp();
                registrarLog("Finalização Automática", "sucesso", "Todos documentos possuem CSV.");
            }
        }

        await ref.update(updateData);
        await renderizarGridCaixas(); 

    } catch (error) {
        console.error("Erro ao salvar:", error);
        if (error.code === 'invalid-argument') alert("Erro: Arquivo CSV muito grande.");
        else throw error; 
    }
}

window.excluirCaixa = async function(docIndex, caixaIndex) {
    if(!confirm("Excluir caixa?")) return;
    const coll = pedidoAtualTipo === 'simples' ? 'pedidos' : 'pedidosMultiDocumento';
    const ref = db.collection("usuarios").doc(pedidoAtualCriadorUid).collection("elementos").doc(pedidoAtualElementoId).collection(coll).doc(pedidoAtualId);

    const doc = await ref.get();
    let data = doc.data();

    if(pedidoAtualTipo === 'simples') {
        data.caixas.splice(caixaIndex, 1);
        await ref.update({ caixas: data.caixas });
    } else {
        data.documentos[docIndex].caixas.splice(caixaIndex, 1);
        await ref.update({ documentos: data.documentos });
    }
    registrarLog("Remoção de Caixa", "alerta", `Caixa removida.`);
    await renderizarGridCaixas();
}

window.toggleBonus = async function(docIndex, caixaIndex) {
    const coll = pedidoAtualTipo === 'simples' ? 'pedidos' : 'pedidosMultiDocumento';
    const ref = db.collection("usuarios").doc(pedidoAtualCriadorUid).collection("elementos").doc(pedidoAtualElementoId).collection(coll).doc(pedidoAtualId);

    const doc = await ref.get();
    let data = doc.data();

    if(pedidoAtualTipo === 'simples') {
        data.caixas[caixaIndex].isBonificacao = !data.caixas[caixaIndex].isBonificacao;
        await ref.update({ caixas: data.caixas });
    } else {
        let target = data.documentos[docIndex].caixas[caixaIndex];
        target.isBonificacao = !target.isBonificacao;
        await ref.update({ documentos: data.documentos });
    }
    await renderizarGridCaixas();
}

function setImportando(status, inputId) {
    const label = document.querySelector(`label[for="${inputId}"]`);
    if (status) {
        document.body.style.cursor = 'wait';
        if (label) {
            label.dataset.originalText = label.innerHTML;
            label.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processando...';
            label.style.pointerEvents = 'none';
            label.style.opacity = '0.7';
        }
    } else {
        document.body.style.cursor = 'default';
        if (label && label.dataset.originalText) {
            label.innerHTML = label.dataset.originalText;
            label.style.pointerEvents = 'auto';
            label.style.opacity = '1';
        }
        const input = document.getElementById(inputId);
        if(input) input.value = ''; 
    }
}

window.processarCSV = function(input, docIndex) {
    const file = input.files[0];
    if (!file) return;

    const inputId = input.id;
    setImportando(true, inputId); 

    const reader = new FileReader();
    
    reader.onload = async (e) => {
        try {
            const text = e.target.result;
            const caixas = await parseCsvParaCaixas(text);
            
            if (caixas.length > 0) {
                if (caixas.length > 2000) {
                    if(!confirm(`Arquivo muito grande (${caixas.length} caixas). Continuar?`)) {
                        setImportando(false, inputId);
                        return;
                    }
                }
                await salvarNovasCaixas(caixas, docIndex, file.name);
                registrarLog("Importação CSV", "info", `Arquivo ${file.name} importado.`);
                alert(`Sucesso! ${caixas.length} caixas foram importadas.`);
            } else {
                alert("Nenhuma caixa válida 'EFETIVADO' encontrada.");
            }
        } catch (err) {
            console.error(err);
            alert("Erro no processamento: " + err.message);
        } finally {
            setImportando(false, inputId); 
        }
    };

    reader.onerror = () => {
        alert("Erro ao ler arquivo.");
        setImportando(false, inputId);
    };

    reader.readAsText(file, 'ISO-8859-1');
}

async function parseCsvParaCaixas(csvContent) {
    const linhas = csvContent.trim().split('\n');
    if(linhas.length < 2) return [];
    const cabecalho = linhas.shift().split(';').map(c => c.trim().replace(/"/g, ''));
    
    const idxId = cabecalho.indexOf("ID Embalagem Expedição");
    const idxNum = cabecalho.indexOf("Descrição Tipo Embalagem Expedição");
    const idxPeso = cabecalho.indexOf("Peso Embalagem");
    const idxRef = cabecalho.indexOf("Produto");
    const idxDesc = cabecalho.indexOf("Descrição Produto");
    const idxQtd = cabecalho.indexOf("Quantidade");
    const idxStatus = cabecalho.indexOf("Estado Conferência");

    if([idxId, idxNum, idxPeso].some(i => i === -1)) throw new Error("Colunas obrigatórias não encontradas");

    const map = {};
    linhas.forEach(l => {
        const cols = l.split(';');
        if(cols[idxStatus]?.trim() !== "EFETIVADO") return;

        const id = cols[idxId];
        if(!map[id]) map[id] = [];
        map[id].push({
            num: cols[idxNum],
            peso: parseFloat(cols[idxPeso]?.replace(',','.')) || 0,
            ref: cols[idxRef],
            desc: cols[idxDesc],
            qtd: cols[idxQtd]
        });
    });

    return Object.keys(map).map(id => {
        const prods = map[id];
        const peso = prods[0].peso; 
        return {
            num: prods[0].num,
            peso: peso,
            isBonificacao: false,
            produtos: prods.map(p => ({ referencia: p.ref, descricao: p.desc, quantidade: p.qtd }))
        };
    });
}

// ---------------- ORDENS DE PRODUÇÃO ----------------

abrirOrdensBtn.addEventListener('click', () => {
    popupOrdens.style.display = 'flex';
    document.getElementById('inputOrdem').focus();
});

document.getElementById('fecharPopupOrdens').addEventListener('click', () => fecharModal(popupOrdens));

salvarOrdemBtn.addEventListener('click', async () => {
    const val = document.getElementById('inputOrdem').value;
    if(!val) return;
    
    await db.collection("usuarios").doc(currentUser.uid).collection("elementos").doc(elementoId).collection("ordens").add({
        romaneio: val, createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    document.getElementById('inputOrdem').value = "";
    carregarOrdens();
});

async function carregarOrdens() {
    const ul = document.getElementById('listaOrdens');
    ul.innerHTML = "Carregando...";
    const snap = await db.collection("usuarios").doc(currentUser.uid).collection("elementos").doc(elementoId).collection("ordens").orderBy("createdAt", "desc").get();
    ul.innerHTML = "";
    snap.forEach(doc => {
        const li = document.createElement('li');
        li.style.cssText = "display:flex; justify-content:space-between; padding:8px; border-bottom:1px solid #eee;";
        li.innerHTML = `<span>${doc.data().romaneio}</span> <i class="fa-solid fa-trash" style="color:#dc3545; cursor:pointer;" onclick="excluirOrdem('${doc.id}')"></i>`;
        ul.appendChild(li);
    });
}

window.excluirOrdem = async function(id) {
    if(confirm("Excluir ordem?")) {
        await db.collection("usuarios").doc(currentUser.uid).collection("elementos").doc(elementoId).collection("ordens").doc(id).delete();
        carregarOrdens();
    }
}

window.copiarResumo = function(event, btn) {
    event.stopPropagation();
    const row = btn.closest('tr');
    const celulaResumo = row.cells[5];
    const textoParaCopiar = celulaResumo.innerText;

    navigator.clipboard.writeText(textoParaCopiar).then(() => {
        const iconeOriginal = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-check"></i>';
        btn.style.backgroundColor = '#d4edda'; 
        btn.style.color = '#155724';
        setTimeout(() => {
            btn.innerHTML = iconeOriginal;
            btn.style.backgroundColor = ''; 
            btn.style.color = '';
        }, 1500);
    }).catch(err => {
        console.error('Erro ao copiar:', err);
        alert('Não foi possível copiar automaticamente.');
    });
}