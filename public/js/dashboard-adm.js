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

const datesContainer = document.getElementById('dates-container');
const logoutBtn = document.getElementById('logoutBtn');
const pageLoader = document.getElementById('page-loader');
const appContent = document.getElementById('app-content');

const globalSearchInput = document.getElementById('globalSearchInput');
const searchModal = document.getElementById('searchModal');
const searchResults = document.getElementById('searchResults');
const searchTitle = document.getElementById('searchTitle');

const detailsModal = document.getElementById('detailsModal');
const modalTitle = document.getElementById('modalTitle');
const modalBody = document.getElementById('modalBody');

// --- TRANSIÇÃO SUAVE ---
window.transitionToPage = function(url) {
    if(appContent) appContent.classList.remove('content-visible');
    setTimeout(() => { window.location.href = url; }, 500);
}

firebase.auth().onAuthStateChanged(async user => {
    if (user) {
        loadDatesGrouped();
    } else {
        window.location.href = "index.html";
    }
});

logoutBtn.addEventListener('click', () => {
    if(appContent) appContent.classList.remove('content-visible');
    setTimeout(() => {
        firebase.auth().signOut().then(() => window.location.href = "index.html");
    }, 500);
});

async function loadDatesGrouped() {
    try {
        await new Promise(resolve => setTimeout(resolve, 1500));

        const snapshot = await db.collectionGroup('pedidosMultiDocumento').orderBy('createdAt', 'desc').get();
        
        const datesMap = {};

        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.createdAt) {
                const dateObj = data.createdAt.toDate();
                
                // --- CORREÇÃO DE FUSO HORÁRIO ---
                const ano = dateObj.getFullYear();
                const mes = String(dateObj.getMonth() + 1).padStart(2, '0');
                const dia = String(dateObj.getDate()).padStart(2, '0');
                
                const dateStr = `${dia}/${mes}/${ano}`; // Para exibição visual
                const rawDate = `${ano}-${mes}-${dia}`; // Para o link (parametro URL)
                // -------------------------------

                if (!datesMap[dateStr]) {
                    datesMap[dateStr] = { 
                        rawDate: rawDate, 
                        count: 0, 
                        usersSet: new Set() 
                    };
                }

                let qtdDocsNoPedido = 0;
if (data.documentos && Array.isArray(data.documentos)) {
    // Conta apenas se for Nota Fiscal ou Minuta
    qtdDocsNoPedido = data.documentos.filter(d => 
        d.tipo === 'Nota Fiscal' || d.tipo === 'Minuta'
    ).length;
}
                datesMap[dateStr].count += qtdDocsNoPedido;
                
                if (data.criadorEmail) {
                    datesMap[dateStr].usersSet.add(data.criadorEmail);
                }
            }
        });

        renderDates(datesMap);
        
        pageLoader.classList.add('loader-hidden');
        appContent.classList.add('content-visible');
        document.body.classList.remove('loading-active');

    } catch (error) {
        console.error("Erro ao carregar datas:", error);
        pageLoader.classList.add('loader-hidden');
        appContent.classList.add('content-visible');
        document.body.classList.remove('loading-active');
        datesContainer.innerHTML = `<p style="color: #ff6b6b; grid-column: 1/-1; text-align: center;">Erro: ${error.message}</p>`;
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
        datesContainer.innerHTML = "<p style='color: #aaa; grid-column: 1/-1; text-align: center;'>Nenhum registro encontrado.</p>";
        return;
    }

    sortedKeys.forEach((dateStr, index) => {
        const info = datesMap[dateStr];
        const uniqueUsers = info.usersSet.size;
        
        // --- FORMATANDO A DATA PARA DD/MM ---
        // Pega a string "19/11/2025", separa por "/", pega os 2 primeiros e junta de novo.
        const displayDate = dateStr.split('/').slice(0, 2).join('/');

        const card = document.createElement('div');
        card.className = 'adm-card';
        card.style.animationDelay = `${index * 0.05}s`;

        card.innerHTML = `
            <div class="card-normal-content">
                <div class="adm-date">
                    <i class="fa-regular fa-calendar-days"></i> 
                    ${displayDate} </div>
                
                <div class="card-footer-row">
                    <div class="stat-item">
                        <span>Usuários Ativos</span>
                        <strong><i class="fa-solid fa-users-rectangle icon-users"></i> ${uniqueUsers}</strong>
                    </div>
                    <div class="stat-item">
                        <span>Pedidos</span>
                        <strong><i class="fa-solid fa-file-invoice icon-docs"></i> ${info.count}</strong>
                    </div>
                </div>
            </div>

            <div class="card-preview-overlay">
                <div class="preview-stat">
                    <div class="preview-value">${uniqueUsers > 0 ? (info.count / uniqueUsers).toFixed(1) : 0}</div>
                    <div class="preview-label">Média Docs / Usuário</div>
                </div>
                
                <button class="preview-btn">
                    Acessar Relatório <i class="fa-solid fa-arrow-right"></i>
                </button>
            </div>
        `;
        
        card.addEventListener('click', () => {
            transitionToPage(`elemento-adm.html?date=${info.rawDate}`);
        });

        datesContainer.appendChild(card);
    });
}

globalSearchInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
        const term = globalSearchInput.value.trim();
        if (term.length < 2) { alert("Digite 2+ caracteres."); return; }
        performGlobalSearch(term);
    }
});

async function performGlobalSearch(term) {
    searchModal.style.display = "flex";
    searchResults.innerHTML = '<div style="text-align:center; padding:40px; color:#fff;"><i class="fa-solid fa-spinner fa-spin fa-2x"></i><p>Pesquisando...</p></div>';
    searchTitle.textContent = `Resultados: "${term}"`;

    try {
        const promises = [];
        promises.push(db.collectionGroup('pedidosMultiDocumento').where('romaneio', '==', term).get());
        promises.push(db.collectionGroup('pedidosMultiDocumento').where('loja', '==', term).get());

        const results = await Promise.all(promises);
        let foundOrders = [];

        results.forEach(snapshot => {
            snapshot.forEach(doc => {
                if (!foundOrders.find(o => o.id === doc.id)) {
                    foundOrders.push({ id: doc.id, ...doc.data() });
                }
            });
        });
        displaySearchResults(foundOrders, term);
    } catch (error) {
        searchResults.innerHTML = `<p style="color: #ff6b6b; text-align:center;">Erro: ${error.message}</p>`;
    }
}

function displaySearchResults(orders, term) {
    if (orders.length === 0) {
        searchResults.innerHTML = `<p style="text-align:center; color:#aaa; padding:20px;">Nada encontrado para "<strong>${term}</strong>".</p>`;
        return;
    }

    let html = '';
    orders.forEach((order, index) => {
        let dateStr = "Data desconhecida";
        if (order.createdAt) {
            const d = order.createdAt.toDate();
            dateStr = d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'});
        }
        const userShort = order.criadorEmail ? order.criadorEmail.split('@')[0] : '---';

        html += `
            <div class="search-result-card">
                <div class="res-info">
                    <h4><i class="fa-solid fa-box"></i> ${order.romaneio}</h4>
                    <p><strong>Loja:</strong> ${order.loja} | <strong>Por:</strong> ${userShort}</p>
                    <p><i class="fa-regular fa-clock"></i> ${dateStr}</p>
                </div>
                <div class="res-action">
                    <button id="btn-go-${index}">Ver Detalhes</button>
                </div>
            </div>
        `;
    });
    searchResults.innerHTML = html;

    orders.forEach((order, index) => {
        document.getElementById(`btn-go-${index}`).addEventListener('click', () => {
            openDetails(order);
        });
    });
}

function openDetails(orderData) {
    const docs = orderData.documentos || [];
    const todasAsCaixas = docs.reduce((acc, doc) => acc.concat(doc.caixas || []), []);
    const resumoHtml = calcularResumoCaixas(todasAsCaixas);

    modalTitle.textContent = `Detalhes: ${orderData.romaneio} - ${orderData.loja}`;
    searchModal.style.display = "none";
    detailsModal.style.display = "flex";

    let html = `
        <div class="detail-section">
            <h3>Informações Gerais</h3>
            <p><strong>Usuário Criador:</strong> ${orderData.criadorEmail}</p>
            <p><strong>Local/UF:</strong> ${orderData.local || ''} - ${orderData.uf || ''}</p>
            <p><strong>Observações:</strong> ${orderData.observacoes || "Nenhuma"}</p>
        </div>
        <div class="detail-section">
            <h3>Documentos Importados (${docs.length})</h3>
            <table class="modal-table">
                <thead><tr><th>Tipo</th><th>Responsável</th><th>Arquivo CSV</th></tr></thead>
                <tbody>`;
    
    docs.forEach(d => {
        html += `<tr><td><span class="tag-doc">${d.tipo}</span></td><td>${d.responsavel}</td><td>${d.arquivoCsv ? `<span class="tag-csv">${d.arquivoCsv}</span>` : '<span style="color:#666">---</span>'}</td></tr>`;
    });
    html += `</tbody></table></div>`;
    
    html += `<div class="detail-section"><h3>Resumo de Volumes</h3><div style="background: rgba(242, 101, 34, 0.1); padding: 15px; border-radius: 8px; border: 1px solid #f26522; color: #ddd;">${resumoHtml}</div></div>`;

    html += `<div class="detail-section"><h3>Caixas do Pedido</h3><table class="modal-table"><thead><tr><th>Doc</th><th>Caixa</th><th>Peso</th><th>Qtd Prod.</th><th>Bônus?</th></tr></thead><tbody>`;

    let boxCount = 0;
    docs.forEach(d => {
        if(d.caixas && d.caixas.length > 0) {
            d.caixas.forEach(cx => {
                boxCount++;
                html += `<tr><td>${d.tipo}</td><td><strong>${cx.num || 'S/N'}</strong></td><td>${cx.peso} kg</td><td>${cx.produtos ? cx.produtos.length : 0} itens</td><td>${cx.isBonificacao ? '⭐ Sim' : '-'}</td></tr>`;
            });
        }
    });
    if (boxCount === 0) html += `<tr><td colspan="5" style="text-align:center; padding:20px;">Nenhuma caixa registrada.</td></tr>`;
    html += `</tbody></table></div>`;

    modalBody.innerHTML = html;
}

function calcularResumoCaixas(caixas) {
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
            return `<div style="margin-bottom:4px;"><strong style="color:white; font-size:15px;">${num}${sufixo}</strong> <span style="color:#aaa;">(Peso Total: ${info.pesoTotal.toFixed(2)} kg)</span> : <strong style="color:#fff;">${info.qtd} caixa(s)</strong></div>`;
        });
    };
    const linhasPadrao = formatar(agrupar(caixasPadrao));
    const linhasBonificacao = formatar(agrupar(caixasBonificacao), " (BÔNUS)");
    if (linhasPadrao.length === 0 && linhasBonificacao.length === 0) return "Sem caixas válidas para resumo.";
    return [...linhasPadrao, ...linhasBonificacao].join("");
}

// --- FECHAR MODAIS ---
window.closeSearch = function() {
    searchModal.classList.add('closing');
    setTimeout(() => { searchModal.style.display = "none"; searchModal.classList.remove('closing'); }, 300);
}
window.closeDetails = function() {
    detailsModal.classList.add('closing');
    setTimeout(() => { detailsModal.style.display = "none"; detailsModal.classList.remove('closing'); }, 300);
}
window.onclick = function(event) {
    if (event.target == searchModal) closeSearch();
    if (event.target == detailsModal) closeDetails();
}