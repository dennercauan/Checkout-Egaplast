// Config Firebase
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

// Globais de Controle e Permissão
let currentUser = null;
let isAdmin = false;
let elementsUnsubscriber = null;

// DOM Elements Principais
const userEmail = document.getElementById('user-email');
const userName = document.getElementById('user-name');
const pageLoader = document.getElementById('page-loader');
const appContent = document.getElementById('app-content');
const logoBtn = document.getElementById("logoBtn");

// Elements de Visão
const personalHeader = document.getElementById('personal-header');
const itemContainer = document.getElementById('item-container');
const globalHeader = document.getElementById('global-header');
const datesContainer = document.getElementById('dates-container');
const sortSelect = document.getElementById('sort-select');

// Actions & Navbar
const openModalBtn = document.getElementById('openModalBtn');
const tvModeBtn = document.getElementById('tvModeBtn');
const logoutBtn = document.getElementById('logoutBtn');

// Modais Pessoais / Criação
const modal = document.getElementById('modal');
const createElementBtn = document.getElementById('createElementBtn');
const elementTitleInput = document.getElementById('element-title');
const userSelectGroup = document.getElementById('userSelectGroup');
const elementUserSelect = document.getElementById('element-user');

const renameModal = document.getElementById('renameModal');
const renameInput = document.getElementById('renameInput');
const confirmRenameBtn = document.getElementById('confirmRenameBtn');
const deleteModal = document.getElementById('deleteModal');
const deleteTargetName = document.getElementById('deleteTargetName');
const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');

// Search & Detalhes (Modais Compartilhados)
const searchInput = document.getElementById('searchInput');
const searchResultsModal = document.getElementById('searchResultsModal');
const searchResultsContainer = document.getElementById('searchResultsContainer');
const searchTitle = document.getElementById('searchTitle');
const detailsModal = document.getElementById('detailsModal');
const modalTitle = document.getElementById('modalTitle');
const modalBody = document.getElementById('modalBody');

// Logout Modal
const logoutConfirmModal = document.getElementById('logoutConfirmModal');
const cancelLogoutBtn = document.getElementById('cancelLogoutBtn');
const confirmLogoutBtn = document.getElementById('confirmLogoutBtn');

// --- TRANSIÇÃO SUAVE DE PÁGINA ---
window.transitionToPage = function(url) {
    if(appContent) appContent.classList.remove('content-visible');
    setTimeout(() => { window.location.href = url; }, 400);
}

// ==========================================
// AUTENTICAÇÃO E ROTEAMENTO DE VISÃO
// ==========================================
firebase.auth().onAuthStateChanged(async user => {
    if(user){
        currentUser = user;
        userEmail.textContent = user.email;
        const namePart = user.email.split('@')[0];
        userName.textContent = namePart.charAt(0).toUpperCase() + namePart.slice(1);
        
        try {
            const userDoc = await db.collection("usuarios").doc(user.uid).get();
            if (userDoc.exists && userDoc.data().isAdmin === true) {
                isAdmin = true;
            }
        } catch (e) {
            console.error("Erro ao verificar permissão: ", e);
        }

        if (isAdmin) {
            tvModeBtn.style.display = 'flex';
            tvModeBtn.addEventListener('click', () => transitionToPage('painel-tv.html'));
            switchToGlobal(); // Joga direto pro Global
        } else {
            tvModeBtn.style.display = 'none';
            switchToPersonal(); // Joga direto pro Pessoal
        }
        
    } else {
        window.location.href = "index.html";
    }
});

// ==========================================
// CONTROLE DE INTERFACE DIRETO
// ==========================================
function switchToGlobal() {
    personalHeader.style.display = 'none';
    itemContainer.style.display = 'none';
    
    globalHeader.style.display = 'flex';
    datesContainer.style.display = 'grid';
    
    openModalBtn.style.display = 'flex'; 
    loadDatesGrouped();
}

function switchToPersonal() {
    globalHeader.style.display = 'none';
    datesContainer.style.display = 'none';
    
    personalHeader.style.display = 'flex';
    itemContainer.style.display = 'grid';
    
    openModalBtn.style.display = 'flex';
    loadElementsRealtime();
}

// ==========================================
// CRIAÇÃO DE ELEMENTO (INTELIGENTE)
// ==========================================
openModalBtn.addEventListener('click', async () => { 
    modal.style.display = "flex"; 
    elementTitleInput.focus(); 
    
    // Se for Admin, mostra a caixa para escolher o dono da pasta
    if (isAdmin) {
        userSelectGroup.style.display = 'block';
        await loadUsersForSelect();
    } else {
        userSelectGroup.style.display = 'none';
    }
});

async function loadUsersForSelect() {
    elementUserSelect.innerHTML = '<option value="">Carregando usuários...</option>';
    try {
        const snapshot = await db.collection("usuarios").orderBy("email").get();
        let options = '';
        snapshot.forEach(doc => {
            const data = doc.data();
            const emailText = data.email || doc.id; 
            options += `<option value="${doc.id}">${emailText}</option>`;
        });
        elementUserSelect.innerHTML = options;
    } catch (error) {
        elementUserSelect.innerHTML = '<option value="">Erro ao carregar (Padrão para seu usuário)</option>';
    }
}

createElementBtn.addEventListener('click', async () => {
    const title = elementTitleInput.value.trim();
    if(!title || !currentUser) return;
    
    let targetUid = currentUser.uid;
    
    if (isAdmin) {
        targetUid = elementUserSelect.value;
        if (!targetUid) return alert("Por favor, selecione um usuário para atribuir o novo elemento.");
    }

    try {
        createElementBtn.textContent = "Criando...";
        const docRef = await db.collection("usuarios").doc(targetUid).collection("elementos").add({
            titulo: title, 
            createdAt: firebase.firestore.FieldValue.serverTimestamp(), 
            contagemDocumentos: 0
        });
        
        modal.style.display="none"; 
        elementTitleInput.value="";
        createElementBtn.textContent = "Criar Elemento";
        
        if (targetUid === currentUser.uid) {
            transitionToPage(`elemento.html?id=${docRef.id}`);
        } else {
            alert(`Pasta / Elemento "${title}" atribuído com sucesso ao usuário!`);
        }
    } catch(e) { 
        alert("Erro: "+e.message); 
        createElementBtn.textContent = "Criar Elemento";
    }
});


// ==========================================
// VISÃO PESSOAL (ELEMENTOS DO USUÁRIO)
// ==========================================
let currentEditId = null;
let currentDeleteId = null;

function loadElementsRealtime(orderByField = "createdAt", orderByDirection = "desc") {
    if (elementsUnsubscriber) elementsUnsubscriber();

    setTimeout(() => {
        pageLoader.classList.add('loader-hidden');
        appContent.classList.add('content-visible');
        document.body.classList.remove('loading-active');
    }, 1200);

    elementsUnsubscriber = db.collection("usuarios")
        .doc(currentUser.uid)
        .collection("elementos")
        .orderBy(orderByField, orderByDirection)
        .onSnapshot(snapshot => {
            if (isAdmin) return; // Segurança extra

            itemContainer.innerHTML = "";
            
            if (snapshot.empty) {
                itemContainer.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: #999; padding: 60px;">
                    <i class="fa-regular fa-folder-open fa-3x" style="margin-bottom:15px; opacity:0.5;"></i><br>
                    Nenhum elemento criado.<br>Clique em "Novo Elemento" para começar.
                </div>`;
                return;
            }

            snapshot.docs.forEach((doc, index) => {
                const data = doc.data();
                const elementoId = doc.id;
                const docCount = data.contagemDocumentos || 0;
                verifyRealCount(currentUser.uid, elementoId, docCount);

                const card = document.createElement('div');
                card.className = 'element-card';
                card.style.animationDelay = `${index * 0.05}s`;

                card.innerHTML = `
                    <div class="card-actions-top">
                        <button class="icon-btn edit-btn" title="Renomear"><i class="fa-solid fa-pencil"></i></button>
                        <button class="icon-btn del-btn" title="Excluir"><i class="fa-solid fa-trash-can"></i></button>
                    </div>
                    <div class="card-main">
                        <div class="card-title">${data.titulo}</div>
                        <div class="card-info">
                            <i class="fa-solid fa-file-lines"></i>
                            <span>${docCount} Arquivo${docCount !== 1 ? 's' : ''}</span>
                        </div>
                    </div>
                    <div class="card-overlay">
                        <div class="overlay-stat">${docCount}</div>
                        <div class="overlay-label">Documentos</div>
                        <button class="overlay-btn access-btn">Abrir Pasta <i class="fa-solid fa-arrow-right"></i></button>
                    </div>
                `;

                card.querySelector('.edit-btn').addEventListener('click', (e) => { e.stopPropagation(); openRenameModal(elementoId, data.titulo); });
                card.querySelector('.del-btn').addEventListener('click', (e) => { e.stopPropagation(); openDeleteModal(elementoId, data.titulo); });
                
                const goToElement = () => transitionToPage(`elemento.html?id=${elementoId}`);
                card.querySelector('.access-btn').addEventListener('click', (e) => { e.stopPropagation(); goToElement(); });
                card.addEventListener('click', (e) => { if(!e.target.closest('.icon-btn')) goToElement(); });

                itemContainer.appendChild(card);
            });
        });
}

sortSelect.addEventListener('change', (e) => {
    const sortType = e.target.value;
    itemContainer.innerHTML = "";
    if (sortType === 'recentes') loadElementsRealtime('createdAt', 'desc');
    else if (sortType === 'antigos') loadElementsRealtime('createdAt', 'asc');
    else if (sortType === 'quantidade') loadElementsRealtime('contagemDocumentos', 'desc');
});

window.openRenameModal = function(id, currentTitle) {
    currentEditId = id; renameInput.value = currentTitle; renameModal.style.display = "flex"; renameInput.focus();
}
window.closeRenameModal = function() { renameModal.style.display = "none"; currentEditId = null; }
confirmRenameBtn.addEventListener('click', async () => {
    const newTitle = renameInput.value.trim();
    if (!newTitle || !currentEditId) return;
    try {
        confirmRenameBtn.textContent = "Salvando...";
        await db.collection("usuarios").doc(currentUser.uid).collection("elementos").doc(currentEditId).update({ titulo: newTitle });
        closeRenameModal();
    } catch (error) { alert("Erro ao renomear: " + error.message); } 
    finally { confirmRenameBtn.textContent = "Salvar Alteração"; }
});

window.openDeleteModal = function(id, title) {
    currentDeleteId = id; deleteTargetName.textContent = title; deleteModal.style.display = "flex";
}
window.closeDeleteModal = function() { deleteModal.style.display = "none"; currentDeleteId = null; }
confirmDeleteBtn.addEventListener('click', async () => {
    if (!currentDeleteId) return;
    try {
        confirmDeleteBtn.textContent = "Excluindo...";
        await db.collection("usuarios").doc(currentUser.uid).collection("elementos").doc(currentDeleteId).delete();
        closeDeleteModal();
    } catch (error) { alert("Erro ao excluir: " + error.message); } 
    finally { confirmDeleteBtn.textContent = "Sim, Excluir"; }
});


// ==========================================
// VISÃO GLOBAL ADMIN (AGRUPADA POR DATA)
// ==========================================
async function loadDatesGrouped() {
    datesContainer.innerHTML = '<div style="grid-column: 1/-1; text-align:center; padding:40px;"><i class="fa-solid fa-spinner fa-spin fa-2x" style="color:var(--primary)"></i><p style="margin-top: 15px; color: var(--text-muted);">Carregando dados globais...</p></div>';
    
    setTimeout(() => {
        pageLoader.classList.add('loader-hidden');
        appContent.classList.add('content-visible');
        document.body.classList.remove('loading-active');
    }, 800);

    try {
        const snapshot = await db.collectionGroup('pedidosMultiDocumento')
            .orderBy('createdAt', 'desc')
            .limit(300) 
            .get();

        const datesMap = {};

        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.createdAt) {
                const dateObj = data.createdAt.toDate();
                const ano = dateObj.getFullYear();
                const mes = String(dateObj.getMonth() + 1).padStart(2, '0');
                const dia = String(dateObj.getDate()).padStart(2, '0');
                
                const dateStr = `${dia}/${mes}/${ano}`; 
                const rawDate = `${ano}-${mes}-${dia}`; 

                if (!datesMap[dateStr]) datesMap[dateStr] = { rawDate: rawDate, count: 0, usersSet: new Set() };

                let qtdDocsNoPedido = 0;
                if (data.documentos && Array.isArray(data.documentos)) {
                    qtdDocsNoPedido = data.documentos.filter(d => d.tipo === 'Nota Fiscal' || d.tipo === 'Minuta').length;
                }
                datesMap[dateStr].count += qtdDocsNoPedido;
                if (data.criadorEmail) datesMap[dateStr].usersSet.add(data.criadorEmail);
            }
        });
        
        renderDates(datesMap);
        
    } catch (error) {
        datesContainer.innerHTML = `<p style="color: #dc3545; grid-column: 1/-1; text-align: center;">Erro ao puxar dados da matriz: ${error.message}</p>`;
    }
}

function renderDates(datesMap) {
    if (!isAdmin) return;

    datesContainer.innerHTML = "";
    const sortedKeys = Object.keys(datesMap).sort((a,b) => {
        const dateA = new Date(a.split('/').reverse().join('-'));
        const dateB = new Date(b.split('/').reverse().join('-'));
        return dateB - dateA;
    });

    if (sortedKeys.length === 0) {
        datesContainer.innerHTML = "<p style='color: #aaa; grid-column: 1/-1; text-align: center;'>Nenhum registro encontrado no sistema global.</p>";
        return;
    }

    sortedKeys.forEach((dateStr, index) => {
        const info = datesMap[dateStr];
        const uniqueUsers = info.usersSet.size;
        const displayDate = dateStr.split('/').slice(0, 2).join('/');

        const card = document.createElement('div');
        card.className = 'adm-card';
        card.style.animationDelay = `${index * 0.05}s`;

        card.innerHTML = `
            <div class="card-normal-content">
                <div class="adm-date"><i class="fa-regular fa-calendar-days"></i> ${displayDate}</div>
                <div class="card-footer-row">
                    <div class="stat-item">
                        <span>Usuários Ativos</span>
                        <strong><i class="fa-solid fa-users-rectangle icon-users"></i> ${uniqueUsers}</strong>
                    </div>
                    <div class="stat-item">
                        <span>Documentos (NF/Min)</span>
                        <strong><i class="fa-solid fa-file-invoice icon-docs"></i> ${info.count}</strong>
                    </div>
                </div>
            </div>
            <div class="card-overlay" style="background: rgba(13, 50, 105, 0.95);">
                <div class="overlay-stat" style="color:#fff;">${uniqueUsers > 0 ? (info.count / uniqueUsers).toFixed(1) : 0}</div>
                <div class="overlay-label" style="color:#a6cbf3;">Média Docs / Usuário</div>
                <button class="overlay-btn">Acessar Relatório <i class="fa-solid fa-arrow-right"></i></button>
            </div>
        `;
        
        // Manda o Admin para a nova visão unificada do elemento.html com a query ?date=
        card.addEventListener('click', () => transitionToPage(`elemento.html?date=${info.rawDate}`));
        datesContainer.appendChild(card);
    });
}


// ==========================================
// BUSCA INTELIGENTE (ADM VS USER)
// ==========================================
searchInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
        const searchTerm = searchInput.value.trim();
        if (searchTerm.length < 2) { alert("Digite pelo menos 2 caracteres."); return; }
        
        if (isAdmin) performAdminGlobalSearch(searchTerm);
        else performPersonalSearch(searchTerm);
    }
});

// Busca Pessoal
async function performPersonalSearch(term) {
    if (!currentUser) return;
    searchResultsModal.style.display = "flex"; 
    searchResultsContainer.innerHTML = '<div style="text-align:center; padding:20px;"><i class="fa-solid fa-spinner fa-spin"></i> Procurando nas suas pastas...</div>';
    searchTitle.innerHTML = `<i class="fa-solid fa-search"></i> Resultados Pessoais: "${term}"`;

    let allResults = [];
    const elementosRef = db.collection("usuarios").doc(currentUser.uid).collection("elementos");
    
    try {
        const elementosSnapshot = await elementosRef.get();
        const searchPromises = [];

        elementosSnapshot.forEach(elementoDoc => {
            const elementoData = elementoDoc.data();
            const elementoId = elementoDoc.id;
            const p1 = elementosRef.doc(elementoId).collection('pedidos').where('romaneio', '==', term).get();
            const p2 = elementosRef.doc(elementoId).collection('pedidos').where('loja', '==', term).get();
            const p3 = elementosRef.doc(elementoId).collection('pedidosMultiDocumento').where('romaneio', '==', term).get();
            const p4 = elementosRef.doc(elementoId).collection('pedidosMultiDocumento').where('loja', '==', term).get();

            searchPromises.push(Promise.all([p1, p2, p3, p4]).then(results => {
                results.forEach(snapshot => {
                    snapshot.forEach(doc => {
                        allResults.push({ id: doc.id, data: doc.data(), elemento: { id: elementoId, titulo: elementoData.titulo } });
                    });
                });
            }));
        });
        await Promise.all(searchPromises);
        const uniqueResults = allResults.reduce((acc, current) => { if (!acc.find(item => item.id === current.id)) acc.push(current); return acc; }, []);
        
        if (uniqueResults.length === 0) {
            searchResultsContainer.innerHTML = `<p style="text-align:center; color:#999; padding:20px;">Nada encontrado nas suas pastas para "<strong>${term}</strong>".</p>`;
            return;
        }
        let html = '';
        uniqueResults.forEach(result => {
            const pedido = result.data;
            html += `
                <div class="search-result-item">
                    <div class="res-info">
                        <h4><i class="fa-solid fa-box"></i> ${pedido.romaneio || 'S/N'}</h4>
                        <p><strong>Loja:</strong> ${pedido.loja || '---'} | <strong>Local:</strong> ${pedido.local || '---'}</p>
                        <p style="font-size:11px; color:var(--secondary);"><i class="fa-solid fa-folder"></i> Pasta: ${result.elemento.titulo}</p>
                    </div>
                    <div class="res-action">
                        <button onclick="window.transitionToPage('elemento.html?id=${result.elemento.id}')">Ir para Pasta</button>
                    </div>
                </div>`;
        });
        searchResultsContainer.innerHTML = html;
    } catch (error) { searchResultsContainer.innerHTML = `<p style="color:red; text-align:center;">Erro: ${error.message}</p>`; }
}

// Busca Global (Admin)
async function performAdminGlobalSearch(term) {
    searchResultsModal.style.display = "flex";
    searchResultsContainer.innerHTML = '<div style="text-align:center; padding:20px;"><i class="fa-solid fa-spinner fa-spin fa-2x"></i><p>Varrendo matriz global...</p></div>';
    searchTitle.innerHTML = `<i class="fa-solid fa-globe"></i> Resultados Globais: "${term}"`;

    try {
        const promises = [];
        promises.push(db.collectionGroup('pedidosMultiDocumento').where('romaneio', '==', term).get());
        promises.push(db.collectionGroup('pedidosMultiDocumento').where('loja', '==', term).get());

        const results = await Promise.all(promises);
        let foundOrders = [];

        results.forEach(snapshot => {
            snapshot.forEach(doc => {
                if (!foundOrders.find(o => o.id === doc.id)) { foundOrders.push({ id: doc.id, ...doc.data() }); }
            });
        });

        if (foundOrders.length === 0) {
            searchResultsContainer.innerHTML = `<p style="text-align:center; color:#999; padding:20px;">Nada encontrado na matriz para "<strong>${term}</strong>".</p>`;
            return;
        }

        let html = '';
        foundOrders.forEach((order, index) => {
            let dateStr = "Data desconhecida";
            if (order.createdAt) {
                const d = order.createdAt.toDate();
                dateStr = d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'});
            }
            const userShort = order.criadorEmail ? order.criadorEmail.split('@')[0] : '---';

            html += `
                <div class="search-result-item">
                    <div class="res-info">
                        <h4><i class="fa-solid fa-box"></i> ${order.romaneio}</h4>
                        <p><strong>Loja:</strong> ${order.loja} | <strong>Criador:</strong> ${userShort}</p>
                        <p><i class="fa-regular fa-clock"></i> ${dateStr}</p>
                    </div>
                    <div class="res-action">
                        <button id="btn-go-${index}">Ver Detalhes ADM</button>
                    </div>
                </div>`;
        });
        searchResultsContainer.innerHTML = html;

        foundOrders.forEach((order, index) => {
            document.getElementById(`btn-go-${index}`).addEventListener('click', () => openGlobalDetails(order));
        });
    } catch (error) { searchResultsContainer.innerHTML = `<p style="color: #dc3545; text-align:center;">Erro: ${error.message}</p>`; }
}

// Modal de Detalhes da Busca Global
function openGlobalDetails(orderData) {
    const docs = orderData.documentos || [];
    const todasAsCaixas = docs.reduce((acc, doc) => acc.concat(doc.caixas || []), []);
    const resumoHtml = calcularResumoCaixasGlobal(todasAsCaixas);

    modalTitle.innerHTML = `<i class="fa-solid fa-circle-info"></i> ${orderData.romaneio} - ${orderData.loja}`;
    searchResultsModal.style.display = "none";
    detailsModal.style.display = "flex";

    let html = `
        <div class="detail-section">
            <h3>Visão Geral (ADM)</h3>
            <p><strong>Usuário Criador:</strong> ${orderData.criadorEmail}</p>
            <p><strong>Local/UF:</strong> ${orderData.local || ''} - ${orderData.uf || ''}</p>
            <p><strong>Observações:</strong> ${orderData.observacoes || "Nenhuma"}</p>
        </div>
        <div class="detail-section">
            <h3>Documentos Integrados (${docs.length})</h3>
            <table class="modal-table">
                <thead><tr><th>Tipo</th><th>Responsável</th><th>Arquivo CSV</th></tr></thead>
                <tbody>`;
    docs.forEach(d => {
        html += `<tr><td><span class="tag-doc">${d.tipo}</span></td><td>${d.responsavel}</td><td>${d.arquivoCsv ? `<span class="tag-csv">${d.arquivoCsv}</span>` : '<span style="color:#aaa">Pendente</span>'}</td></tr>`;
    });
    html += `</tbody></table></div>`;
    
    html += `<div class="detail-section"><h3>Resumo de Volumes</h3><div style="background: rgba(242, 101, 34, 0.05); padding: 15px; border-radius: 8px; border: 1px solid rgba(242, 101, 34, 0.3); color: var(--text-main);">${resumoHtml}</div></div>`;
    html += `<div class="detail-section"><h3>Caixas Detalhadas</h3><table class="modal-table"><thead><tr><th>Doc</th><th>Caixa</th><th>Peso</th><th>Qtd Prod.</th><th>Bônus?</th></tr></thead><tbody>`;

    let boxCount = 0;
    docs.forEach(d => {
        if(d.caixas && d.caixas.length > 0) {
            d.caixas.forEach(cx => {
                boxCount++;
                html += `<tr><td>${d.tipo}</td><td><strong>${cx.num || 'S/N'}</strong></td><td>${cx.peso} kg</td><td>${cx.produtos ? cx.produtos.length : 0} itens</td><td>${cx.isBonificacao ? '⭐ Sim' : '-'}</td></tr>`;
            });
        }
    });
    if (boxCount === 0) html += `<tr><td colspan="5" style="text-align:center; padding:15px;">Nenhuma caixa registrada.</td></tr>`;
    html += `</tbody></table></div>`;

    modalBody.innerHTML = html;
}

window.closeDetails = function() { detailsModal.style.display = "none"; }

function calcularResumoCaixasGlobal(caixas) {
    if (!Array.isArray(caixas) || caixas.length === 0) return "Sem caixas registradas.";
    const caixasPadrao = caixas.filter(cx => !cx.isBonificacao);
    const caixasBonificacao = caixas.filter(cx => cx.isBonificacao);
    const agrupar = (lista) => {
        const agrupado = {};
        lista.forEach(cx => {
            const num = String(cx.num ?? "").trim();
            const peso = parseFloat(String(cx.peso).replace(',', '.')) || 0;
            if (!num) return;
            if (!agrupado[num]) agrupado[num] = { qtd: 0, pesoTotal: 0 };
            agrupado[num].qtd++;
            agrupado[num].pesoTotal += peso;
        });
        return agrupado;
    };
    const formatar = (agrupado, sufixo = "") => {
        return Object.entries(agrupado).map(([num, info]) => {
            const stl = sufixo ? 'color: var(--secondary);' : 'color: var(--primary);';
            return `<div style="margin-bottom:6px;"><strong style="font-size:14px; ${stl}">${num}${sufixo}</strong> <span style="color:var(--text-muted); font-size: 12px;">(Peso Total: ${info.pesoTotal.toFixed(2)} kg)</span> : <strong>${info.qtd} caixa(s)</strong></div>`;
        });
    };
    const linhasPadrao = formatar(agrupar(caixasPadrao));
    const linhasBonificacao = formatar(agrupar(caixasBonificacao), " (BÔNUS)");
    if (linhasPadrao.length === 0 && linhasBonificacao.length === 0) return "Sem caixas válidas para resumo.";
    return [...linhasPadrao, ...linhasBonificacao].join("");
}

// ==========================================
// GLOBALS & EVENTOS
// ==========================================
logoBtn.addEventListener("click", () => window.location.reload());

cancelLogoutBtn.addEventListener('click', () => logoutConfirmModal.style.display = "none");
confirmLogoutBtn.addEventListener('click', () => {
    logoutConfirmModal.style.display = "none";
    if(appContent) appContent.classList.remove('content-visible');
    setTimeout(() => { firebase.auth().signOut().then(() => window.location.href="index.html"); }, 400);
});

// Correção automatica do contador de arquivos na visao pessoal
async function verifyRealCount(uid, elementId, currentStoredCount) {
    try {
        const elementRef = db.collection("usuarios").doc(uid).collection("elementos").doc(elementId);
        const elementDoc = await elementRef.get();
        if (!elementDoc.exists) return;
        const elementTitle = elementDoc.data().titulo;
        const userEmail = firebase.auth().currentUser.email.trim().toLowerCase();

        const [pedidosSnap, multiSnap, producoesSnap, sharedSnap] = await Promise.all([
            elementRef.collection('pedidos').get(),
            elementRef.collection('pedidosMultiDocumento').get(),
            elementRef.collection('producoes').get(),
            db.collection("usuarios").doc(uid).collection("pedidosCompartilhadosComigo").where("elementoTitulo", "==", elementTitle).get()
        ]);

        let totalCount = pedidosSnap.size + producoesSnap.size;

        multiSnap.forEach(doc => {
            const data = doc.data();
            if (data.documentos && Array.isArray(data.documentos)) {
                const meusDocs = data.documentos.filter(d => {
                    const isResp = d.responsavel && d.responsavel.trim().toLowerCase() === userEmail;
                    const isFin = d.tipo === 'Nota Fiscal' || d.tipo === 'Minuta';
                    return isResp && isFin;
                });
                totalCount += meusDocs.length;
            } else { totalCount += 1; }
        });

        const sharedPromises = sharedSnap.docs.map(async (shareDoc) => {
            const info = shareDoc.data(); 
            try {
                const originDoc = await db.collection("usuarios").doc(info.criadorUid)
                    .collection("elementos").doc(info.elementoId).collection("pedidosMultiDocumento").doc(info.pedidoId).get();
                if (originDoc.exists) {
                    const data = originDoc.data();
                    if (data.documentos && Array.isArray(data.documentos)) {
                        return data.documentos.filter(d => (d.responsavel && d.responsavel.trim().toLowerCase() === userEmail) && (d.tipo === 'Nota Fiscal' || d.tipo === 'Minuta')).length;
                    }
                }
            } catch (err) {}
            return 0;
        });

        const countsShared = await Promise.all(sharedPromises);
        totalCount += countsShared.reduce((a, b) => a + b, 0);

        if (totalCount !== currentStoredCount) await elementRef.update({ contagemDocumentos: totalCount });
    } catch (error) { console.error("Erro verificação:", error); }
}

// ==========================================
// CORREÇÃO DOS BOTÕES DE LOGOUT / MODAIS
// ==========================================
if(logoutBtn) {
    logoutBtn.addEventListener('click', () => {
        document.getElementById('logoutConfirmModal').style.display = 'flex';
    });
}
const btnCloseLogout = document.getElementById('closeLogoutModal') || document.querySelector('#logoutConfirmModal .close-modal-btn');
if(btnCloseLogout) {
    btnCloseLogout.addEventListener('click', () => {
        document.getElementById('logoutConfirmModal').style.display = 'none';
    });
}