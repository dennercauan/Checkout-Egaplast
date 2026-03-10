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

// Globais
let currentUser = null;

// DOM Elements Principais
const userEmail = document.getElementById('user-email');
const pageLoader = document.getElementById('page-loader');
const appContent = document.getElementById('app-content');
const datesContainer = document.getElementById('dates-container');
const logoBtn = document.getElementById("logoBtn");

// Search & Detalhes
const searchInput = document.getElementById('searchInput');
const searchResultsModal = document.getElementById('searchResultsModal');
const searchResultsContainer = document.getElementById('searchResultsContainer');
const searchTitle = document.getElementById('searchTitle');
const detailsModal = document.getElementById('detailsModal');
const modalTitle = document.getElementById('modalTitle');
const modalBody = document.getElementById('modalBody');

// Logout Modal
const logoutBtn = document.getElementById('logoutBtn');
const logoutConfirmModal = document.getElementById('logoutConfirmModal');
const cancelLogoutBtn = document.getElementById('cancelLogoutBtn');
const confirmLogoutBtn = document.getElementById('confirmLogoutBtn');

// Transição
window.transitionToPage = function(url) {
    if(appContent) appContent.classList.remove('content-visible');
    setTimeout(() => { window.location.href = url; }, 400);
}

// Auth
firebase.auth().onAuthStateChanged(async user => {
    if(user){
        currentUser = user;
        userEmail.textContent = user.email;
        loadDatesGrouped(); // Joga direto pro carregamento de datas!
    } else {
        window.location.href = "index.html";
    }
});

// Carregamento de Datas (Visão Global)
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
                        <span>Usuários aTIVOS</span>
                        <strong><i class="fa-solid fa-users-rectangle icon-users"></i> ${uniqueUsers}</strong>
                    </div>
                    <div class="stat-item">
                        <span>Pedidos</span>
                        <strong><i class="fa-solid fa-file-invoice icon-docs"></i> ${info.count}</strong>
                    </div>
                </div>
            </div>
            <div class="card-overlay" style="background: rgba(13, 50, 105, 0.95);">
                <div class="overlay-stat" style="color:#fff;">${uniqueUsers > 0 ? (info.count / uniqueUsers).toFixed(1) : 0}</div>
                <div class="overlay-label" style="color:#a6cbf3;">Média Docs / Usuário</div>
                <button class="overlay-btn">Acessar Tabela <i class="fa-solid fa-arrow-right"></i></button>
            </div>
        `;
        
        // REDIRECIONA PARA A TABELA VISUALIZADORA
        card.addEventListener('click', () => transitionToPage(`elemento-viewer.html?date=${info.rawDate}`));
        datesContainer.appendChild(card);
    });
}

// Busca Global
searchInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
        const searchTerm = searchInput.value.trim();
        if (searchTerm.length < 2) { alert("Digite pelo menos 2 caracteres."); return; }
        performAdminGlobalSearch(searchTerm);
    }
});

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
                        <button id="btn-go-${index}">Ver Detalhes</button>
                    </div>
                </div>`;
        });
        searchResultsContainer.innerHTML = html;

        foundOrders.forEach((order, index) => {
            document.getElementById(`btn-go-${index}`).addEventListener('click', () => openGlobalDetails(order));
        });
    } catch (error) { searchResultsContainer.innerHTML = `<p style="color: #dc3545; text-align:center;">Erro: ${error.message}</p>`; }
}

function openGlobalDetails(orderData) {
    const docs = orderData.documentos || [];
    const todasAsCaixas = docs.reduce((acc, doc) => acc.concat(doc.caixas || []), []);
    const resumoHtml = calcularResumoCaixasGlobal(todasAsCaixas);

    modalTitle.innerHTML = `<i class="fa-solid fa-circle-info"></i> ${orderData.romaneio} - ${orderData.loja}`;
    searchResultsModal.style.display = "none";
    detailsModal.style.display = "flex";

    let html = `
        <div class="detail-section">
            <h3>Visão Geral</h3>
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

// Eventos Extras
logoBtn.addEventListener("click", () => window.location.reload());
if(logoutBtn) logoutBtn.addEventListener('click', () => { logoutConfirmModal.style.display = 'flex'; });
cancelLogoutBtn.addEventListener('click', () => { logoutConfirmModal.style.display = 'none'; });
confirmLogoutBtn.addEventListener('click', () => {
    logoutConfirmModal.style.display = "none";
    if(appContent) appContent.classList.remove('content-visible');
    setTimeout(() => { firebase.auth().signOut().then(() => window.location.href="index.html"); }, 400);
});