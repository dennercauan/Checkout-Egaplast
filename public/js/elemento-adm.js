// Configuração Firebase
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

// --- FUNÇÕES UTILITÁRIAS (Definidas no topo para evitar erros) ---
function truncate(str, n) {
    if (!str) return "";
    return (str.length > n) ? str.slice(0, n-1) + '...' : str; 
}

// --- ELEMENTOS DOM ---
const urlParams = new URLSearchParams(window.location.search);
const dateParam = urlParams.get('date'); 

const pageTitle = document.getElementById('pageTitle');
const cardsContainer = document.getElementById('cardsContainer');
const performanceContainer = document.getElementById('performanceContainer');
const productionListContainer = document.getElementById('productionListContainer'); 
const searchInput = document.getElementById('searchAdm');
const pageLoader = document.getElementById('page-loader');
const appContent = document.getElementById('app-content');

// Logs Elements
const logsSidebar = document.getElementById('logsSidebar');
const logsList = document.getElementById('logsList');
const notifBadge = document.getElementById('notifBadge');
let unreadLogs = 0;

// Modal Elements
const detailsModal = document.getElementById('detailsModal');
const modalTitle = document.getElementById('modalTitle');
const modalBody = document.getElementById('modalBody');

// Logout Elements
const logoutBtn = document.getElementById('logoutBtn');
const logoutConfirmModal = document.getElementById('logoutConfirmModal');
const cancelLogoutBtn = document.getElementById('cancelLogoutBtn');
const confirmLogoutBtn = document.getElementById('confirmLogoutBtn');

// Métricas Elements
const elTotalDocs = document.getElementById('totalDocs');
const elTotalPedidos = document.getElementById('totalPedidos');
const elUsers = document.getElementById('totalUsuarios');
const elMonday = document.getElementById('totalMonday');

// Caches e Variáveis de Controle
let cachePedidos = [];
let cacheOrdens = [];
let activeUserFilter = null;
let listeners = []; 
let uidToEmailMap = {}; 
let editingRef = null; // Guarda a referência do Firestore do pedido sendo editado
let tempDocs = []; // Array temporário para documentos na edição
let tempCaixasDocIndex = null; // Índice do doc que está recebendo caixas

// --- TRANSIÇÃO SUAVE ---
window.transitionToPage = function(url) {
    if(appContent) appContent.classList.remove('content-visible');
    setTimeout(() => { window.location.href = url; }, 500);
}

// --- CONTROLE SIDEBAR LOGS ---
window.toggleLogsSidebar = function() {
    // Tenta pedir permissão ao clicar no sino (User Gesture)
    solicitarPermissaoNotificacao();

    const isOpen = logsSidebar.classList.contains('open');
    if(isOpen) {
        logsSidebar.classList.remove('open');
    } else {
        logsSidebar.classList.add('open');
        unreadLogs = 0;
        updateBadge();
    }
}

function updateBadge() {
    if(!notifBadge) return;
    notifBadge.textContent = unreadLogs;
    if(unreadLogs > 0) notifBadge.classList.add('badge-visible');
    else notifBadge.classList.remove('badge-visible');
}

// --- INICIALIZAÇÃO ---
firebase.auth().onAuthStateChanged(user => {
    if (user) {
        if (!dateParam) {
            alert("Data não especificada.");
            window.location.href = "dashboard-adm.html";
            return;
        }
        iniciarMonitoramento();
    } else {
        window.location.href = "index.html";
    }
});

function iniciarMonitoramento() {
    solicitarPermissaoNotificacao();
    const [ano, mes, dia] = dateParam.split('-');
    pageTitle.textContent = `Relatório: ${dia}/${mes}/${ano}`;

    // Configura Range do Dia (00:00:00 até 23:59:59)
    const startDate = new Date(`${dateParam}T00:00:00`);
    const endDate = new Date(`${dateParam}T23:59:59`);
    
    const startTs = firebase.firestore.Timestamp.fromDate(startDate);
    const endTs = firebase.firestore.Timestamp.fromDate(endDate);

    listeners.forEach(unsub => unsub());
    listeners = [];

    // 1. LISTENER DE PEDIDOS
    const unsubPedidos = db.collectionGroup('pedidosMultiDocumento')
        .where('createdAt', '>=', startTs)
        .where('createdAt', '<=', endTs)
        .onSnapshot((snapshot) => {
            cachePedidos = [];
            snapshot.forEach(doc => {
                const data = doc.data();
                if (data.criadorUid && data.criadorEmail) {
                    uidToEmailMap[data.criadorUid] = data.criadorEmail;
                }
                cachePedidos.push({
                    id: doc.id,
                    ref: doc.ref,
                    ...data,
                    documentos: data.documentos || []
                });
            });
            processarDadosUnificados();
        }, (error) => {
            console.error("Erro ao buscar Pedidos:", error);
            if(error.message.includes("index")) alert("Falta índice no Firestore (pedidosMultiDocumento). Clique no link no console.");
        });

    // 2. LISTENER DE ORDENS (CORRIGIDO PARA PEGAR ELEMENTO ID)
    const unsubOrdens = db.collectionGroup('ordens')
        .where('createdAt', '>=', startTs)
        .where('createdAt', '<=', endTs)
        .onSnapshot((snapshot) => {
            cacheOrdens = [];
            snapshot.forEach(doc => {
                const data = doc.data();
                // O caminho é: usuarios/{uid}/elementos/{elementoId}/ordens/{docId}
                // Indices:      0      1       2           3          4       5
                const pathSegments = doc.ref.path.split('/');
                
                cacheOrdens.push({
                    id: doc.id,
                    ref: doc.ref, // <--- SALVAMOS A REFERÊNCIA DIRETA (IMPORTANTE)
                    romaneio: data.romaneio,
                    criadorUid: pathSegments[1],   // UID do usuário
                    elementoId: pathSegments[3],   // ID do Projeto (Elemento)
                    createdAt: data.createdAt
                });
            });
            processarDadosUnificados();
        });

    
    // Variável de controle local para ignorar apenas o carregamento inicial da página
    let isFirstLogLoad = true; 

    const unsubLogs = db.collection('logs_globais')
        .where('dataString', '==', dateParam) 
        .onSnapshot((snapshot) => {
            
            // Converte para Array JS
            let logsTemp = [];
            snapshot.forEach(doc => {
                logsTemp.push({ id: doc.id, ...doc.data() });
            });

            // Ordena manualmente (Mais recente primeiro)
            logsTemp.sort((a, b) => {
                const timeA = a.createdAt ? a.createdAt.toMillis() : 0;
                const timeB = b.createdAt ? b.createdAt.toMillis() : 0;
                return timeB - timeA;
            });

            // --- LÓGICA DE NOTIFICAÇÃO ---
            if (!isFirstLogLoad) {
                // Se NÃO é o carregamento inicial da página, processa as novidades
                snapshot.docChanges().forEach(change => {
                    if (change.type === 'added') {
                        const novoLog = change.doc.data();
                        
                        unreadLogs++;
                        
                        // Agora notifica SEMPRE (mesmo se foi você que criou)
                        enviarNotificacaoNavegador(novoLog);
                    }
                });
                updateBadge();
            } else {
                // Marca que a primeira carga (histórico do dia) já foi feita
                isFirstLogLoad = false;
            }

            // Renderiza a lista na sidebar
            logsList.innerHTML = "";
            if (logsTemp.length === 0) {
                logsList.innerHTML = "<div style='padding:20px; text-align:center; color:#777;'>Nenhuma atividade registrada hoje.</div>";
            } else {
                logsTemp.forEach(log => renderLogItem(log, false)); 
            }
            
        }, (error) => {
            console.error("Erro nos Logs:", error);
        });

    listeners.push(unsubPedidos, unsubOrdens, unsubLogs);
}

function renderLogItem(log, prepend) {
    const time = log.createdAt ? log.createdAt.toDate().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '--:--';
    
    let cssClass = "";
    let icon = "fa-info-circle";
    
    if(log.acao && log.acao.includes("Criação")) { cssClass = "log-creation log-high-priority"; icon = "fa-plus-circle"; }
    else if(log.acao && log.acao.includes("Finalização")) { cssClass = "log-success log-high-priority"; icon = "fa-check-circle"; }
    else if(log.acao && log.acao.includes("Caixa")) { icon = "fa-box"; }
    else if(log.acao && log.acao.includes("Importação")) { icon = "fa-file-csv"; }

    const item = document.createElement('div');
    item.className = `log-item ${cssClass}`;
    
    const userShort = log.usuario ? log.usuario.split('@')[0] : 'Sistema';
    const btnDelete = `<button class="btn-delete-log" title="Excluir notificação" onclick="deleteLog('${log.id}')"><i class="fa-solid fa-xmark"></i></button>`;

    item.innerHTML = `
        <div class="log-header">
            <span>${time}</span>
            <div style="display:flex; gap:10px; align-items:center;">
                <span>${userShort}</span>
                ${btnDelete}
            </div>
        </div>
        <div class="log-title"><i class="fa-solid ${icon}"></i> ${log.acao || 'Atividade'}</div>
        <div class="log-detail">${log.detalhe || ''}</div>
    `;
    
    if(prepend) logsList.prepend(item);
    else logsList.appendChild(item);
}

// --- FUNÇÃO PARA EXCLUIR LOG ---
window.deleteLog = async function(logId) {
    if(!confirm("Remover esta notificação do registro?")) return;
    try {
        await db.collection('logs_globais').doc(logId).delete();
    } catch (e) {
        alert("Erro ao excluir: " + e.message);
    }
}

// --- FUNÇÃO CENTRAL DE PROCESSAMENTO ---
function processarDadosUnificados() {
    const ranking = {};

    // A) Pontos por Documentos (FILTRO NF/MINUTA)
    cachePedidos.forEach(pedido => {
        if(pedido.documentos && Array.isArray(pedido.documentos)) {
            pedido.documentos.forEach(doc => {
                if (doc.responsavel && (doc.tipo === 'Nota Fiscal' || doc.tipo === 'Minuta')) {
                    const userEmail = doc.responsavel.trim().toLowerCase();
                    if (!ranking[userEmail]) ranking[userEmail] = 0;
                    ranking[userEmail] += 1; 
                }
            });
        }
    });

    // B) Pontos por Ordens
    cacheOrdens.forEach(ordem => {
        let userKey = uidToEmailMap[ordem.criadorUid] || ordem.criadorUid;
        if(userKey) {
            userKey = userKey.toLowerCase();
            if (!ranking[userKey]) ranking[userKey] = 0;
            ranking[userKey] += 1; 
        }
    });

    renderCards(cachePedidos);
    renderProductionList(cacheOrdens);
    renderPerformancePoints(ranking);
    updateMetrics(ranking); 

    pageLoader.classList.add('loader-hidden');
    appContent.classList.add('content-visible');
    document.body.classList.remove('loading-active');
}

function updateMetrics(rankingMap) {
    const totalDocs = cachePedidos.reduce((acc, p) => {
        const validos = p.documentos ? p.documentos.filter(d => d.tipo === 'Nota Fiscal' || d.tipo === 'Minuta').length : 0;
        return acc + validos;
    }, 0);
    
    elTotalDocs.textContent = totalDocs;
    elTotalPedidos.textContent = cachePedidos.length;
    elUsers.textContent = Object.keys(rankingMap).length;
    const mondayCount = cachePedidos.filter(p => p.mondayVerified).length;
    elMonday.textContent = mondayCount;
}

function renderPerformancePoints(rankingMap) {
    performanceContainer.innerHTML = "";
    const sortedUsers = Object.entries(rankingMap).sort((a, b) => b[1] - a[1]);
    
    if(sortedUsers.length === 0) { 
        performanceContainer.innerHTML = "<p style='color:#aaa'>Sem atividades hoje.</p>"; 
        return; 
    }

    const maxVal = sortedUsers[0][1]; 

    sortedUsers.forEach(([user, points], index) => {
        const percent = (points / maxVal) * 100;
        const semiCircle = 169.65;
        const targetOffset = semiCircle - ((percent / 100) * semiCircle);
        
        let strokeClass = 'stroke-blue', medal = '', specialClass = '';
        if (index === 0) { strokeClass = 'stroke-gold'; medal = '👑'; specialClass = 'first-place'; }
        else if (index === 1) { strokeClass = 'stroke-silver'; medal = '🥈'; }
        else if (index === 2) { strokeClass = 'stroke-bronze'; medal = '🥉'; }

        let displayName = user;
        if(user.includes('@')) displayName = user.split('@')[0];
        else displayName = user.substring(0, 5) + '...';

        const itemDiv = document.createElement('div');
        itemDiv.className = `rank-item ${specialClass}`;
        itemDiv.onclick = () => toggleUserFilter(user, itemDiv);
        const uniqueId = `gauge-${index}`;
        
        itemDiv.innerHTML = `
            ${medal ? `<div class="rank-badge-floating">${medal}</div>` : '<div style="height:24px"></div>'}
            <div class="gauge-wrapper">
                <svg class="gauge-svg" viewBox="0 0 120 120">
                    <circle class="circle-bg" cx="60" cy="60" r="54"></circle>
                    <circle id="${uniqueId}" class="circle-progress ${strokeClass}" cx="60" cy="60" r="54"></circle>
                </svg>
                <div class="gauge-info">
                    <div class="gauge-value">${points}</div>
                    <div class="gauge-label">Pontos</div>
                </div>
            </div>
            <div class="user-name-display" title="${user}">${displayName.toUpperCase()}</div>
        `;
        performanceContainer.appendChild(itemDiv);
        
        setTimeout(() => {
            const circle = document.getElementById(uniqueId);
            if(circle) circle.style.strokeDashoffset = targetOffset;
        }, 200 + (index * 100));
    });
}

function renderProductionList(ordens) {
    if (!productionListContainer) return;
    productionListContainer.innerHTML = "";

    if (ordens.length === 0) {
        productionListContainer.innerHTML = '<p style="color:#666; grid-column:1/-1; text-align:center;">Nenhuma Ordem de Produção hoje.</p>';
        return;
    }

    const sorted = [...ordens].sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));

    sorted.forEach(ordem => {
        // Tenta recuperar o email completo pelo mapa
        const fullEmail = uidToEmailMap[ordem.criadorUid] || "";
        
        // Define a chave para comparação (Email completo ou UID se não tiver email)
        const comparisonKey = fullEmail ? fullEmail.toLowerCase() : ordem.criadorUid;

        // --- LÓGICA DE FILTRO CORRIGIDA ---
        if (activeUserFilter) {
            // O activeUserFilter vem do Ranking (Email Completo ou UID)
            // Verificamos se a chave desta ordem bate exatamente com o filtro ativo
            if (comparisonKey !== activeUserFilter) {
                return; // Oculta se não for do usuário filtrado
            }
        }

        // Prepara o nome para exibição (Aqui sim podemos cortar o @dominio para ficar bonito)
        let displayName = fullEmail ? fullEmail.split('@')[0] : "ID: " + ordem.criadorUid.substring(0,4);

        // Renderização do Card (Clicável para editar)
        const card = document.createElement('div');
        card.style.cssText = "background:#252525; border:1px solid #333; padding:15px; border-radius:8px; display:flex; justify-content:space-between; align-items:center; border-left: 4px solid #f26522; cursor:pointer; transition: all 0.2s;";
        
        // Efeitos visuais
        card.onmouseover = () => { card.style.background = '#2a2a2a'; card.style.transform = 'translateY(-2px)'; };
        card.onmouseout = () => { card.style.background = '#252525'; card.style.transform = 'translateY(0)'; };
        
        // Ação de Clique (Editar)
        card.onclick = () => editarOrdemAdm(ordem.id);

        card.innerHTML = `
            <div>
                <div style="color:#fff; font-weight:bold; font-size:16px;">${ordem.romaneio || 'S/N'}</div>
                <div style="color:#888; font-size:11px; margin-top:4px;">
                    <i class="fa-regular fa-user"></i> ${displayName.toUpperCase()}
                </div>
            </div>
            <div>
                <i class="fa-solid fa-chevron-right" style="color:#444; font-size:12px;"></i>
            </div>
        `;
        productionListContainer.appendChild(card);
    });
}
function renderCards(lista) {
    cardsContainer.innerHTML = "";
    const term = searchInput.value.toLowerCase();
    
    let filtrados = lista.filter(item => {
        if (activeUserFilter) {
            const temDocDoUsuario = item.documentos.some(d => d.responsavel && d.responsavel.toLowerCase() === activeUserFilter);
            const criouPedido = item.criadorEmail && item.criadorEmail.toLowerCase() === activeUserFilter;
            if (!temDocDoUsuario && !criouPedido) return false;
        }

        if (term) {
            return (item.romaneio && item.romaneio.toLowerCase().includes(term)) ||
                   (item.loja && item.loja.toLowerCase().includes(term)) ||
                   (item.criadorEmail && item.criadorEmail.toLowerCase().includes(term));
        }
        return true;
    });

    filtrados.sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));

    if (filtrados.length === 0) { 
        cardsContainer.innerHTML = '<p style="color: #aaa; grid-column: 1/-1; text-align: center;">Nenhum pedido encontrado.</p>'; 
        return; 
    }

    filtrados.forEach((item, index) => {
        let csvMain = item.arquivoCsv || "";
        if (!csvMain && item.documentos && item.documentos.length > 0) {
             const docComCsv = item.documentos.find(d => d.arquivoCsv);
             if (docComCsv) csvMain = docComCsv.arquivoCsv;
        }

        const card = document.createElement('div');
        card.className = `order-card ${item.mondayVerified ? 'verified' : ''}`;
        card.id = `card-${item.id}`;
        card.style.animationDelay = `${Math.min(index * 0.05, 0.5)}s`; 
        
        card.onclick = (e) => { 
            if (e.target.closest('.monday-wrapper-overlay')) return; 
            openDetails(item.id); 
        };

        const csvHtml = csvMain ? 
            `<div class="csv-pill has-file" title="${csvMain}"><i class="fa-solid fa-file-csv"></i> ${truncate(csvMain, 20)}</div>` : 
            `<div class="csv-pill no-file"><i class="fa-solid fa-circle-xmark"></i> Pendente</div>`;

        const qtdDocs = item.documentos ? item.documentos.length : 0;
        const nomeCriador = item.criadorEmail ? item.criadorEmail.split('@')[0] : 'Desconhecido';

        // --- CÁLCULO DE TIMER E STATUS ---
        let timerHtml = "";
        let isFinalizado = false;
        
        if (item.completedAt && item.efetivado) {
            isFinalizado = true;
            const start = item.createdAt ? item.createdAt.toDate() : new Date();
            const end = item.completedAt.toDate();
            const diffMs = end - start;
            
            // Formatador de Tempo
            const formatDuration = (ms) => {
                const h = Math.floor(ms / 3600000).toString().padStart(2, '0');
                const m = Math.floor((ms % 3600000) / 60000).toString().padStart(2, '0');
                const s = Math.floor((ms % 60000) / 1000).toString().padStart(2, '0');
                return `${h}:${m}:${s}`;
            };
            
            timerHtml = `<div class="card-timer-badge timer-done" title="Tempo Total">
                            <i class="fa-solid fa-flag-checkered"></i> ${formatDuration(diffMs)}
                         </div>`;
        } else {
            // Em andamento
            const startTs = item.createdAt ? item.createdAt.toDate().getTime() : Date.now();
            
            timerHtml = `<div class="card-timer-badge timer-running live-timer" data-start="${startTs}">
                            <i class="fa-solid fa-stopwatch"></i> 00:00:00
                         </div>`;
        }
        
        const statusIcon = isFinalizado ? '<i class="fa-solid fa-circle-check status-icon-ok" title="Pedido Finalizado"></i>' : '';

        card.innerHTML = `
            ${statusIcon}
            <div class="card-normal-content">
                <div class="card-header">
                    <div class="romaneio-title">${item.romaneio || 'S/N'}</div>
                    <div class="doc-count-badge">${qtdDocs} doc(s)</div>
                </div>
                <div class="card-body">
                    <p><i class="fa-solid fa-store"></i> ${item.loja || '---'}</p>
                    <p><i class="fa-solid fa-location-dot"></i> ${item.local || '---'} / ${item.uf || ''}</p>
                    ${timerHtml}
                </div>
                <div class="user-mini-badge">
                    <i class="fa-regular fa-user"></i> Criado por: ${nomeCriador}
                </div>
            </div>
            <div class="card-preview-overlay">
                <div class="preview-csv-status">${csvHtml}</div>
                <label class="monday-wrapper-overlay" title="Marcar como Verificado no Monday">
                    <input type="checkbox" class="monday-check" ${item.mondayVerified ? 'checked' : ''} onchange="toggleMonday('${item.ref.path}', this, '${item.id}')">
                    <span class="monday-label">Monday OK</span>
                </label>
                <div class="click-hint">Clique para detalhes completos</div>
            </div>
        `;
        cardsContainer.appendChild(card);
    });
}

function toggleUserFilter(user, element) {
    const allGauges = document.querySelectorAll('.rank-item');
    if (activeUserFilter === user) {
        activeUserFilter = null; 
        allGauges.forEach(el => el.classList.remove('active-filter', 'inactive-filter'));
    } else {
        activeUserFilter = user; 
        allGauges.forEach(el => {
            if(el === element) { el.classList.add('active-filter'); el.classList.remove('inactive-filter'); }
            else { el.classList.add('inactive-filter'); el.classList.remove('active-filter'); }
        });
    }
    renderCards(cachePedidos);
    renderProductionList(cacheOrdens);
}

searchInput.addEventListener('input', () => {
    renderCards(cachePedidos);
});

window.openDetails = function(orderId) {
    const order = cachePedidos.find(o => o.id === orderId);
    if (!order) return;

    editingRef = order.ref; // Salva a referência para as edições

    const docs = order.documentos || [];
    const todasAsCaixas = docs.reduce((acc, doc) => acc.concat(doc.caixas || []), []);
    const resumoHtml = calcularResumoCaixas(todasAsCaixas);

    modalTitle.textContent = `Detalhes: ${order.romaneio} - ${order.loja}`;
    detailsModal.style.display = "flex";

    // --- LÓGICA DO BOTÃO EFETIVAR (COR E TEXTO DINÂMICOS) ---
    const isEfetivado = order.efetivado === true;
    const btnEfetivarLabel = isEfetivado ? 'Reabrir Pedido' : 'Efetivar Pedido';
    const btnEfetivarColor = isEfetivado ? '#ffc107' : '#00c853'; // Amarelo para desfazer, Verde para fazer
    const btnEfetivarIcon = isEfetivado ? 'fa-rotate-left' : 'fa-check';
    const btnEfetivarTextoColor = isEfetivado ? '#000' : '#fff';

    let html = `
        <div style="margin-bottom: 20px; display: flex; gap: 10px; flex-wrap: wrap;">
            <button onclick="iniciarEdicaoAdm('${order.id}')" class="modal-btn-action" style="background:#0d6efd; flex:1;"><i class="fa-solid fa-pen"></i> Editar Info</button>
            <button onclick="gerenciarCaixasAdm('${order.id}')" class="modal-btn-action" style="background:#f26522; flex:1;"><i class="fa-solid fa-boxes-stacked"></i> Caixas</button>
            
            <button onclick="admToggleEfetivado('${order.id}')" class="modal-btn-action" style="background:${btnEfetivarColor}; color:${btnEfetivarTextoColor}; flex:1;">
                <i class="fa-solid ${btnEfetivarIcon}"></i> ${btnEfetivarLabel}
            </button>
            
            <button onclick="admExcluirPedido('${order.id}')" class="modal-btn-action" style="background:#dc3545; flex:0 0 auto;" title="Excluir Permanentemente">
                <i class="fa-solid fa-trash"></i>
            </button>
        </div>
    `;

    html += `<div class="detail-section">
        <h3>Informações Gerais</h3>
        <p><strong>Criado por:</strong> ${order.criadorEmail || 'Desconhecido'}</p>
        <p><strong>Local/UF:</strong> ${order.local || ''} - ${order.uf || ''}</p>
        <p><strong>Observações:</strong> ${order.observacoes || "Nenhuma"}</p>
    </div>`;
    
    html += `<div class="detail-section">
        <h3>Documentos (${docs.length})</h3>
        <table class="modal-table">
            <thead><tr><th>Tipo</th><th>Responsável</th><th>Arquivo CSV</th></tr></thead>
            <tbody>`;
    
    docs.forEach(d => { 
        html += `<tr>
            <td><span class="tag-doc">${d.tipo}</span></td>
            <td><strong>${d.responsavel}</strong></td>
            <td>${d.arquivoCsv ? `<span class="tag-csv">${d.arquivoCsv}</span>` : '<span style="color:#666">---</span>'}</td>
        </tr>`; 
    });
    
    html += `</tbody></table></div>`;
    
    html += `<div class="detail-section">
        <h3>Resumo de Volumes</h3>
        <div style="background: rgba(242, 101, 34, 0.1); padding: 15px; border-radius: 8px; border: 1px solid #f26522; color: #ddd;">${resumoHtml}</div>
    </div>`;

    modalBody.innerHTML = html;
}

window.closeDetails = function() { 
    detailsModal.classList.add('closing'); 
    setTimeout(() => { 
        detailsModal.style.display = "none"; 
        detailsModal.classList.remove('closing'); 
    }, 300); 
}

logoutBtn.addEventListener('click', () => logoutConfirmModal.style.display = "flex");
cancelLogoutBtn.addEventListener('click', () => logoutConfirmModal.style.display = "none");
confirmLogoutBtn.addEventListener('click', () => {
    logoutConfirmModal.style.display = "none";
    if(appContent) appContent.classList.remove('content-visible');
    setTimeout(() => {
        firebase.auth().signOut().then(() => window.location.href="index.html");
    }, 400);
});

window.onclick = function(event) { 
    if (event.target == detailsModal) closeDetails(); 
    if (event.target == logoutConfirmModal) logoutConfirmModal.style.display = "none";
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
        return Object.entries(agrupado).map(([num, info]) => 
            `<div style="margin-bottom:4px;">
                <strong style="color:white; font-size:15px;">${num}${sufixo}</strong> 
                <span style="color:#aaa;">(Peso Total: ${info.pesoTotal.toFixed(2)} kg)</span> : 
                <strong style="color:#fff;">${info.qtd} caixa(s)</strong>
            </div>`
        ); 
    };
    const linhasPadrao = formatar(agrupar(caixasPadrao));
    const linhasBonificacao = formatar(agrupar(caixasBonificacao), " (BÔNUS)");
    if (linhasPadrao.length === 0 && linhasBonificacao.length === 0) return "Sem caixas válidas para resumo.";
    return [...linhasPadrao, ...linhasBonificacao].join("");
}

window.toggleMonday = async function(docPath, checkbox, cardId) {
    const newState = checkbox.checked; 
    const cardElement = document.getElementById(`card-${cardId}`);
    if (newState) cardElement.classList.add('verified'); 
    else cardElement.classList.remove('verified'); 
    try { 
        await db.doc(docPath).update({ mondayVerified: newState }); 
    } catch (error) { 
        console.error("Erro Monday:", error); 
        alert("Erro ao salvar status."); 
        checkbox.checked = !newState; 
        if (!newState) cardElement.classList.add('verified'); 
        else cardElement.classList.remove('verified'); 
    }
};

// --- SISTEMA DE TIMER REAL-TIME (HH:MM:SS) ---
// Roda a cada segundo para atualizar o texto visual
setInterval(() => {
    const activeTimers = document.querySelectorAll('.live-timer');
    if (activeTimers.length === 0) return;

    const now = Date.now();

    activeTimers.forEach(el => {
        const start = parseInt(el.getAttribute('data-start')) || now;
        const diff = now - start;

        // Evita tempo negativo se o relógio do cliente estiver errado
        if (diff < 0) return;

        const h = Math.floor(diff / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        const s = Math.floor((diff % 60000) / 1000);

        const hh = h.toString().padStart(2, '0');
        const mm = m.toString().padStart(2, '0');
        const ss = s.toString().padStart(2, '0');

        el.innerHTML = `<i class="fa-solid fa-stopwatch"></i> ${hh}:${mm}:${ss}`;
    });
}, 1000);

// --- FUNÇÕES DE EDIÇÃO ADM ---

window.fecharModalAdm = function(id) {
    document.getElementById(id).style.display = 'none';
}

window.iniciarEdicaoAdm = function(orderId) {
    const order = cachePedidos.find(o => o.id === orderId);
    if (!order) return;
    
    closeDetails(); // Fecha o modal de detalhes
    
    // Popula campos
    document.getElementById('admRomaneio').value = order.romaneio || '';
    document.getElementById('admLoja').value = order.loja || '';
    document.getElementById('admLocal').value = order.local || '';
    document.getElementById('admUf').value = order.uf || '';
    document.getElementById('admObs').value = order.observacoes || '';
    
    // Clona documentos para edição temporária
    tempDocs = JSON.parse(JSON.stringify(order.documentos || []));
    renderAdmDocsList();

    document.getElementById('admEditModal').style.display = 'flex';
}

window.renderAdmDocsList = function() {
    const container = document.getElementById('admDocsList');
    container.innerHTML = '';
    
    tempDocs.forEach((doc, index) => {
        const div = document.createElement('div');
        div.className = 'adm-doc-item';
        div.innerHTML = `
            <span style="color:#ccc"><strong style="color:#f26522">${doc.tipo}</strong> - ${doc.responsavel}</span>
            <button onclick="admRemoveDoc(${index})" style="background:none; border:none; color:#dc3545; cursor:pointer;"><i class="fa-solid fa-trash"></i></button>
        `;
        container.appendChild(div);
    });
}

window.admAddDoc = function() {
    const tipo = document.getElementById('admNewDocTipo').value;
    const resp = document.getElementById('admNewDocResp').value;
    
    if(!resp) return alert("Informe o email do responsável");
    
    tempDocs.push({
        tipo: tipo,
        responsavel: resp,
        caixas: [], // Começa sem caixas
        arquivoCsv: null
    });
    
    document.getElementById('admNewDocResp').value = '';
    renderAdmDocsList();
}

window.admRemoveDoc = function(index) {
    if(confirm('Remover este documento e todas as suas caixas?')) {
        tempDocs.splice(index, 1);
        renderAdmDocsList();
    }
}

document.getElementById('btnSalvarEdicaoAdm').addEventListener('click', async () => {
    if(!editingRef) return;
    
    const updateData = {
        romaneio: document.getElementById('admRomaneio').value,
        loja: document.getElementById('admLoja').value,
        local: document.getElementById('admLocal').value,
        uf: document.getElementById('admUf').value,
        observacoes: document.getElementById('admObs').value,
        documentos: tempDocs
    };

    try {
        await editingRef.update(updateData);
        registrarLog("Edição ADM", "alerta", `Pedido ${updateData.romaneio} editado por ADM.`);
        alert("Alterações salvas com sucesso!");
        fecharModalAdm('admEditModal');
    } catch(e) {
        alert("Erro ao salvar: " + e.message);
    }
});

// --- FUNÇÕES DE CAIXAS ADM ---

window.gerenciarCaixasAdm = function(orderId) {
    const order = cachePedidos.find(o => o.id === orderId);
    if (!order) return;
    
    closeDetails();
    editingRef = order.ref; // Garante referência atualizada
    
    renderAdmCaixasModal(order);
    document.getElementById('admCaixasModal').style.display = 'flex';
}

async function renderAdmCaixasModal(orderData) {
    // Busca dados atualizados do banco para não usar cache velho
    const snap = await orderData.ref.get();
    const data = snap.data();
    const docs = data.documentos || [];
    
    const container = document.getElementById('admCaixasContainer');
    container.innerHTML = '';
    
    docs.forEach((doc, docIndex) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'adm-section-box';
        
        let caixasHtml = '';
        (doc.caixas || []).forEach((cx, cxIndex) => {
            const isBonus = cx.isBonificacao;
            const styleBonus = isBonus ? 'color:#f26522' : 'color:#ccc';
            const produtosList = (cx.produtos || []).map(p => `<div>${p.referencia} - ${p.quantidade} un</div>`).join('');
            
            caixasHtml += `
            <div class="adm-caixa-card">
                <div class="adm-caixa-header" onclick="this.parentElement.classList.toggle('open')">
                    <div style="display:flex; align-items:center; gap:10px;">
                        <i class="fa-solid fa-star" style="${styleBonus}; cursor:pointer;" onclick="event.stopPropagation(); admToggleBonus(${docIndex}, ${cxIndex})"></i>
                        <strong>${cx.num || 'S/N'}</strong>
                        <span>(${cx.peso} kg)</span>
                    </div>
                    <i class="fa-solid fa-trash" style="color:#dc3545" onclick="event.stopPropagation(); admDeleteCaixa(${docIndex}, ${cxIndex})"></i>
                </div>
                <div class="adm-caixa-body">
                    ${produtosList || 'Caixa Manual / Sem produtos detalhados'}
                </div>
            </div>`;
        });
        
        if(!caixasHtml) caixasHtml = '<p style="color:#666; font-style:italic">Nenhuma caixa.</p>';

        wrapper.innerHTML = `
            <div style="display:flex; justify-content:space-between; margin-bottom:10px; border-bottom:1px solid #444; padding-bottom:5px;">
                <h4 style="margin:0; color:#fff;">${doc.tipo} (${doc.responsavel})</h4>
                <div style="font-size:11px; color:#aaa;">${doc.arquivoCsv || 'Sem CSV'}</div>
            </div>
            
            <div style="display:flex; gap:10px; margin-bottom:15px;">
                <label class="btn-delete-log" style="border:1px solid #444; padding:5px 10px; border-radius:4px; cursor:pointer; color:#4fc3f7;">
                    <i class="fa-solid fa-file-csv"></i> Importar CSV
                    <input type="file" accept=".csv" style="display:none" onchange="admProcessarCSV(this, ${docIndex})">
                </label>
                <button class="btn-delete-log" style="border:1px solid #444; padding:5px 10px; border-radius:4px; color:#00c853;" onclick="admAbrirAddCaixa(${docIndex})">
                    <i class="fa-solid fa-plus"></i> Manual
                </button>
            </div>

            <div style="max-height: 250px; overflow-y: auto;">${caixasHtml}</div>
        `;
        container.appendChild(wrapper);
    });
}

// --- AÇÕES DENTRO DAS CAIXAS ---

window.admToggleBonus = async function(docIndex, cxIndex) {
    if(!editingRef) return;
    try {
        const snap = await editingRef.get();
        const docs = snap.data().documentos;
        docs[docIndex].caixas[cxIndex].isBonificacao = !docs[docIndex].caixas[cxIndex].isBonificacao;
        await editingRef.update({ documentos: docs });
        renderAdmCaixasModal({ ref: editingRef }); // Re-renderiza
    } catch(e) { alert("Erro: " + e.message); }
}

window.admDeleteCaixa = async function(docIndex, cxIndex) {
    if(!confirm("Excluir esta caixa?")) return;
    try {
        const snap = await editingRef.get();
        const docs = snap.data().documentos;
        docs[docIndex].caixas.splice(cxIndex, 1);
        await editingRef.update({ documentos: docs });
        renderAdmCaixasModal({ ref: editingRef });
    } catch(e) { alert("Erro: " + e.message); }
}

window.admProcessarCSV = function(input, docIndex) {
    const file = input.files[0];
    if(!file || !editingRef) return;
    
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            // Importar a função parseCsvParaCaixas do elemento.js se não estiver disponível, 
            // mas como é código duplicado, vou incluir a função helper aqui embaixo.
            const caixas = parseCsvParaCaixasAdm(e.target.result);
            if(caixas.length > 0) {
                 const snap = await editingRef.get();
                 const docs = snap.data().documentos;
                 
                 // Substitui as caixas deste documento
                 docs[docIndex].caixas = caixas;
                 docs[docIndex].arquivoCsv = file.name;
                 
                 await editingRef.update({ documentos: docs });
                 registrarLog("Importação CSV (ADM)", "alerta", `CSV ${file.name} importado pelo Admin.`);
                 alert("CSV Importado com sucesso!");
                 renderAdmCaixasModal({ ref: editingRef });
            }
        } catch(err) { alert("Erro CSV: " + err.message); }
    };
    reader.readAsText(file, 'ISO-8859-1');
}

// --- CAIXA MANUAL ADM ---

window.admAbrirAddCaixa = function(docIndex) {
    tempCaixasDocIndex = docIndex;
    document.getElementById('admCxNum').value = '';
    document.getElementById('admCxPeso').value = '';
    document.getElementById('admCxQtd').value = '1';
    document.getElementById('admAddCaixaModal').style.display = 'flex';
}

document.getElementById('btnConfirmarAddCaixa').addEventListener('click', async () => {
    const num = document.getElementById('admCxNum').value;
    const peso = parseFloat(document.getElementById('admCxPeso').value.replace(',','.')) || 0;
    const qtd = parseInt(document.getElementById('admCxQtd').value) || 1;
    
    if(!num) return alert("Preencha o número");
    
    const novasCaixas = Array(qtd).fill().map(() => ({
        num: num, peso: peso, isBonificacao: false, produtos: []
    }));

    try {
        const snap = await editingRef.get();
        const docs = snap.data().documentos;
        docs[tempCaixasDocIndex].caixas = [...(docs[tempCaixasDocIndex].caixas || []), ...novasCaixas];
        
        await editingRef.update({ documentos: docs });
        fecharModalAdm('admAddCaixaModal');
        renderAdmCaixasModal({ ref: editingRef });
    } catch(e) { alert("Erro: " + e.message); }
});

// Helper de CSV (Cópia simplificada da versão do elemento.js)
function parseCsvParaCaixasAdm(csvContent) {
    const linhas = csvContent.trim().split('\n');
    if(linhas.length < 2) return [];
    const cabecalho = linhas.shift().split(';').map(c => c.trim().replace(/"/g, ''));
    
    const idxId = cabecalho.indexOf("ID Embalagem Expedição");
    const idxNum = cabecalho.indexOf("Descrição Tipo Embalagem Expedição");
    const idxPeso = cabecalho.indexOf("Peso Embalagem");
    const idxStatus = cabecalho.indexOf("Estado Conferência");
    // Adicione os outros índices se precisar dos produtos (Ref/Desc/Qtd)
    // Para simplificar no ADM, focamos na estrutura da caixa, mas se quiser produtos:
    const idxRef = cabecalho.indexOf("Produto");
    const idxDesc = cabecalho.indexOf("Descrição Produto");
    const idxQtd = cabecalho.indexOf("Quantidade");

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
            ref: cols[idxRef] || '',
            desc: cols[idxDesc] || '',
            qtd: cols[idxQtd] || 1
        });
    });

    return Object.keys(map).map(id => {
        const prods = map[id];
        return {
            num: prods[0].num,
            peso: prods[0].peso,
            isBonificacao: false,
            produtos: prods.map(p => ({ referencia: p.ref, descricao: p.desc, quantidade: p.qtd }))
        };
    });
}

async function registrarLog(acao, tipo, detalhe = "") {
    try {
        // Gera data YYYY-MM-DD baseada no horário atual para indexar
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const dataLocal = `${year}-${month}-${day}`;

        const user = firebase.auth().currentUser;
        const userEmail = user ? user.email : "Admin";

        const logData = {
            acao: acao,
            tipo: tipo, // ex: 'sucesso', 'alerta', 'erro'
            detalhe: detalhe,
            usuario: userEmail + " (ADM)", // Identifica que foi ação administrativa
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            timestamp: Date.now(),
            dataString: dataLocal 
        };

        await db.collection("logs_globais").add(logData);
        
    } catch (e) {
        console.error("Erro interno ao gravar log:", e);
        // Não alertamos o usuário aqui para não travar o fluxo principal se o log falhar
    }
}

// --- AÇÕES DE CONTROLE ADM (EFETIVAR / EXCLUIR) ---

window.admToggleEfetivado = async function(orderId) {
    const order = cachePedidos.find(o => o.id === orderId);
    if (!order) return;

    // Confirmação se estiver "Desefetivando" (opcional, mas bom para evitar cliques acidentais)
    if (order.efetivado && !confirm("Deseja reabrir este pedido? O tempo de finalização será resetado.")) {
        return;
    }

    try {
        // Pegamos o estado mais recente direto do banco para evitar conflitos
        const snap = await order.ref.get();
        if (!snap.exists) return alert("Pedido não encontrado.");
        
        const currentData = snap.data();
        const novoStatus = !currentData.efetivado;
        
        const updateData = { efetivado: novoStatus };
        
        if (novoStatus) {
            // Se está efetivando, marca a hora
            updateData.completedAt = firebase.firestore.FieldValue.serverTimestamp();
            registrarLog("Finalização ADM", "sucesso", `Pedido ${currentData.romaneio} finalizado por ADM.`);
        } else {
            // Se está reabrindo, remove a hora de finalização
            updateData.completedAt = firebase.firestore.FieldValue.delete();
            registrarLog("Reabertura ADM", "alerta", `Pedido ${currentData.romaneio} reaberto por ADM.`);
        }

        await order.ref.update(updateData);
        
        // Fecha o modal e avisa
        alert(`Sucesso! Pedido ${novoStatus ? 'FINALIZADO' : 'REABERTO'}.`);
        closeDetails(); // Fecha para forçar atualização visual na lista
        
    } catch (e) {
        alert("Erro ao alterar status: " + e.message);
    }
}

window.admExcluirPedido = async function(orderId) {
    // Dupla verificação de segurança
    if(!confirm("ATENÇÃO ADM:\n\nVocê está prestes a EXCLUIR PERMANENTEMENTE este pedido de outro usuário.\nIsso não pode ser desfeito.\n\nTem certeza absoluta?")) return;

    const order = cachePedidos.find(o => o.id === orderId);
    if (!order) return;

    try {
        const romaneio = order.romaneio || "S/N";
        
        // Deleta o documento usando a referência direta
        await order.ref.delete();
        
        registrarLog("Exclusão ADM", "perigo", `Pedido ${romaneio} excluído definitivamente por ADM.`);
        
        alert("Pedido excluído do banco de dados.");
        closeDetails();
        
    } catch (e) {
        alert("Erro fatal ao excluir: " + e.message);
        console.error(e);
    }
}

// --- UTILITÁRIOS DE USUÁRIO ---
async function popularSelectUsuarios(selectId) {
    const select = document.getElementById(selectId);
    select.innerHTML = '<option value="">Carregando...</option>';
    
    try {
        const snap = await db.collection('usuarios').get();
        select.innerHTML = '';
        
        let users = [];
        snap.forEach(doc => {
            const d = doc.data();
            if(d.email) users.push({ uid: doc.id, email: d.email });
        });
        
        // Ordena por email
        users.sort((a, b) => a.email.localeCompare(b.email));

        users.forEach(u => {
            const opt = document.createElement('option');
            opt.value = u.uid; // O valor é o UID
            opt.textContent = u.email; // O texto é o Email
            opt.dataset.email = u.email; // Guarda email para uso fácil
            select.appendChild(opt);
        });
        
        return users;
    } catch (e) {
        console.error("Erro ao listar users:", e);
        select.innerHTML = '<option value="">Erro ao carregar</option>';
    }
}

// Função crítica: Acha o elementoID (Projeto) do usuário
async function getUsuarioElementoId(uid) {
    // Tenta pegar o primeiro elemento (projeto) que o usuário tem.
    // O sistema parece usar 1 elemento principal por usuário.
    const snap = await db.collection('usuarios').doc(uid).collection('elementos').limit(1).get();
    if (snap.empty) return null;
    return snap.docs[0].id;
}

// --- CRIAR PEDIDO (ADM) ---

window.abrirModalCriarPedidoAdm = async function() {
    // Limpa campos
    document.getElementById('admNewRomaneio').value = '';
    document.getElementById('admNewLoja').value = '';
    document.getElementById('admNewUf').value = '';
    document.getElementById('admNewObs').value = '';
    document.getElementById('admNewDocEmail').value = ''; 
    
    // Reseta selects
    document.getElementById('admElementSelect').innerHTML = '<option value="">Selecione um usuário...</option>';
    document.getElementById('admElementSelect').disabled = true;

    await popularSelectUsuarios('admOwnerSelect');
    document.getElementById('admCreateModal').style.display = 'flex';
}

document.getElementById('btnSalvarNovoPedidoAdm').addEventListener('click', async () => {
    const ownerUid = document.getElementById('admOwnerSelect').value;
    const elementoId = document.getElementById('admElementSelect').value; // <--- NOVO
    const romaneio = document.getElementById('admNewRomaneio').value;
    const loja = document.getElementById('admNewLoja').value;
    
    if(!ownerUid) return alert("Selecione um Usuário.");
    if(!elementoId) return alert("Selecione o Projeto (Elemento) de destino.");
    if(!romaneio) return alert("Preencha o Romaneio.");

    const ownerEmail = document.getElementById('admOwnerSelect').selectedOptions[0].dataset.email;
    const docTipo = document.getElementById('admNewDocType').value;
    const docEmail = document.getElementById('admNewDocEmail').value.trim() || ownerEmail;

    const novoPedido = {
        romaneio: romaneio,
        loja: loja,
        local: document.getElementById('admNewLocal').value,
        uf: document.getElementById('admNewUf').value,
        observacoes: document.getElementById('admNewObs').value,
        criadorUid: ownerUid,
        criadorEmail: ownerEmail,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        efetivado: false,
        documentos: [{
            tipo: docTipo,
            responsavel: docEmail,
            caixas: [],
            arquivoCsv: null
        }],
        uidsVinculados: [ownerUid] 
    };

    try {
        // Usa o elementoId selecionado explicitamente
        await db.collection('usuarios').doc(ownerUid)
                .collection('elementos').doc(elementoId)
                .collection('pedidosMultiDocumento').add(novoPedido);
        
        registrarLog("Criação ADM", "sucesso", `Pedido ${romaneio} criado para ${ownerEmail}`);
        alert("Pedido criado com sucesso!");
        fecharModalAdm('admCreateModal');
    } catch(e) {
        alert("Erro ao criar: " + e.message);
    }
});


// ATUALIZE A ABERTURA DO MODAL DE ORDEM TAMBÉM
window.abrirModalOrdemAdm = async function() {
    ordemEditingId = null;
    ordemEditingUid = null;
    
    document.getElementById('admOrdemTitle').innerHTML = '<i class="fa-solid fa-plus"></i> Nova Ordem';
    document.getElementById('admOrdemRomaneio').value = '';
    document.getElementById('admOrdemElement').innerHTML = '<option value="">Selecione um usuário...</option>';
    document.getElementById('admOrdemElement').disabled = true;
    
    const select = document.getElementById('admOrdemUser');
    select.disabled = false; 
    await popularSelectUsuarios('admOrdemUser');
    
    document.getElementById('admOrdemModal').style.display = 'flex';
}

// ATUALIZE O BOTÃO SALVAR ORDEM
document.getElementById('btnSalvarOrdemAdm').addEventListener('click', async () => {
    const uid = document.getElementById('admOrdemUser').value;
    const elementoId = document.getElementById('admOrdemElement').value; // <--- NOVO
    const romaneio = document.getElementById('admOrdemRomaneio').value;
    
    if(!uid || !romaneio) return alert("Preencha todos os campos.");
    
    // Se estiver editando, já temos o caminho, senão usa o select
    let targetElementId = elementoId;
    
    // Caso especial: na edição, talvez precisemos buscar o elementoID de outra forma se o select estiver travado ou vazio
    // Mas para simplificar, vamos assumir criação ou que o select foi preenchido na edição
    if(ordemEditingId && !targetElementId) {
        // Fallback para edição se necessário, mas o ideal é popular o select ao abrir edição também
        targetElementId = await getUsuarioElementoId(uid); 
    }
    
    if(!targetElementId) return alert("Selecione o Projeto (Elemento).");
    
    const collectionRef = db.collection('usuarios').doc(uid)
                            .collection('elementos').doc(targetElementId)
                            .collection('ordens');

    try {
        if(ordemEditingId) {
            await collectionRef.doc(ordemEditingId).update({ romaneio: romaneio });
            registrarLog("Edição Ordem", "info", `Ordem ${romaneio} editada por ADM.`);
        } else {
            await collectionRef.add({
                romaneio: romaneio,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            registrarLog("Criação Ordem", "sucesso", `Ordem ${romaneio} criada para usuário.`);
        }
        
        fecharModalAdm('admOrdemModal');
    } catch(e) {
        alert("Erro ao salvar ordem: " + e.message);
    }
});

window.excluirOrdemAdm = async function(id, uid) {
    if(!confirm("Excluir esta ordem de produção?")) return;
    
    const elementoId = await getUsuarioElementoId(uid);
    if(!elementoId) return alert("Erro ao localizar projeto do usuário.");
    
    try {
        await db.collection('usuarios').doc(uid)
                .collection('elementos').doc(elementoId)
                .collection('ordens').doc(id).delete();
        
        registrarLog("Exclusão Ordem", "alerta", "Ordem excluída por ADM.");
    } catch(e) {
        alert("Erro ao excluir: " + e.message);
    }
}

// --- UTILITÁRIO: CARREGAR ELEMENTOS DO USUÁRIO ---
async function carregarElementosUsuario(uid, targetSelectId) {
    const select = document.getElementById(targetSelectId);
    select.innerHTML = '<option value="">Carregando...</option>';
    select.disabled = true;

    try {
        const snap = await db.collection('usuarios').doc(uid).collection('elementos').get();
        
        select.innerHTML = '';
        if (snap.empty) {
            select.innerHTML = '<option value="">Nenhum projeto encontrado</option>';
            return;
        }

        // 1. Converter o snapshot para um Array JavaScript para podermos ordenar
        let listaElementos = [];
        snap.forEach(doc => {
            listaElementos.push({ id: doc.id, ...doc.data() });
        });

        // 2. Ordenar do Mais Recente para o Mais Antigo
        listaElementos.sort((a, b) => {
            // Tenta usar o campo createdAt (timestamp do Firestore)
            const timeA = a.createdAt ? a.createdAt.toMillis() : 0;
            const timeB = b.createdAt ? b.createdAt.toMillis() : 0;
            
            // Se as datas forem iguais ou não existirem, tenta ordenar pelo Título (alfabético reverso)
            if (timeA === timeB) {
                const tituloA = a.titulo || "";
                const tituloB = b.titulo || "";
                return tituloB.localeCompare(tituloA);
            }

            return timeB - timeA; // Ordem Decrescente (Maior timestamp primeiro)
        });

        // 3. Preencher o Select com a lista ordenada
        listaElementos.forEach(elem => {
            const opt = document.createElement('option');
            opt.value = elem.id;
            // Mostra o Título (ex: "Relatório 10/12") ou o ID se não tiver título
            opt.textContent = elem.titulo || `Projeto: ${elem.id}`; 
            select.appendChild(opt);
        });

        select.disabled = false;
        
        // Seleciona automaticamente o primeiro (que agora é o mais recente)
        if (select.options.length > 0) select.selectedIndex = 0;

    } catch (e) {
        console.error("Erro ao carregar elementos:", e);
        select.innerHTML = '<option value="">Erro ao carregar</option>';
    }
}

// --- LISTENER PARA MUDANÇA DE USUÁRIO (PEDIDOS) ---
document.getElementById('admOwnerSelect').addEventListener('change', function() {
    const uid = this.value;
    if(uid) carregarElementosUsuario(uid, 'admElementSelect');
    else {
        document.getElementById('admElementSelect').innerHTML = '<option value="">Selecione um usuário...</option>';
        document.getElementById('admElementSelect').disabled = true;
    }
});

// --- LISTENER PARA MUDANÇA DE USUÁRIO (ORDENS) ---
document.getElementById('admOrdemUser').addEventListener('change', function() {
    const uid = this.value;
    if(uid) carregarElementosUsuario(uid, 'admOrdemElement');
    else {
        document.getElementById('admOrdemElement').innerHTML = '<option value="">Selecione um usuário...</option>';
        document.getElementById('admOrdemElement').disabled = true;
    }
});



// MODO CRIAR (Botão Excluir SOME)
window.abrirModalOrdemAdm = async function() {
    // Note que aqui NÃO usamos 'let', apenas atribuímos o valor
    ordemEditingId = null;
    ordemEditingUid = null;
    
    document.getElementById('admOrdemTitle').innerHTML = '<i class="fa-solid fa-plus"></i> Nova Ordem';
    document.getElementById('admOrdemRomaneio').value = '';
    
    // Esconde o botão de excluir na criação
    const btnDel = document.getElementById('btnExcluirOrdemModal');
    if(btnDel) btnDel.style.display = 'none';

    // Reseta selects
    document.getElementById('admOrdemElement').innerHTML = '<option value="">Selecione um usuário...</option>';
    document.getElementById('admOrdemElement').disabled = true;
    
    const select = document.getElementById('admOrdemUser');
    select.disabled = false; 
    await popularSelectUsuarios('admOrdemUser');
    
    document.getElementById('admOrdemModal').style.display = 'flex';
}

// MODO EDITAR (Botão Excluir APARECE)
window.editarOrdemAdm = async function(id, uid, romaneioAtual) {
    ordemEditingId = id;
    ordemEditingUid = uid;
    
    document.getElementById('admOrdemTitle').innerHTML = '<i class="fa-solid fa-pen"></i> Editar Ordem';
    document.getElementById('admOrdemRomaneio').value = romaneioAtual;
    
    // Mostra o botão de excluir na edição
    const btnDel = document.getElementById('btnExcluirOrdemModal');
    if(btnDel) btnDel.style.display = 'block';

    const select = document.getElementById('admOrdemUser');
    await popularSelectUsuarios('admOrdemUser');
    select.value = uid;
    select.disabled = true; // Trava o usuário na edição
    
    // Carrega os elementos
    await carregarElementosUsuario(uid, 'admOrdemElement');
    
    // Tenta selecionar o elemento (pode precisar de ajuste fino se o usuário tiver múltiplos projetos ativos)
    // Aqui ele vai selecionar o primeiro (mais recente) automaticamente pelo script carregarElementosUsuario
    
    document.getElementById('admOrdemModal').style.display = 'flex';
}
// LISTENER DO BOTÃO DE EXCLUIR DENTRO DO MODAL
document.getElementById('btnExcluirOrdemModal').addEventListener('click', async () => {
    if(!ordemEditingId || !ordemEditingUid) return;
    
    if(!confirm("Tem certeza que deseja EXCLUIR esta ordem?")) return;
    
    // Precisamos do elementoID. Pegamos do select que foi carregado ao abrir a edição
    const elementoId = document.getElementById('admOrdemElement').value;
    
    if(!elementoId) {
        // Fallback de segurança se o select falhou
        const fallbackId = await getUsuarioElementoId(ordemEditingUid);
        if(!fallbackId) return alert("Erro ao identificar o projeto do usuário.");
    }

    try {
        // Usa o valor do select se disponível, senão tenta buscar novamente
        const targetElemId = document.getElementById('admOrdemElement').value || await getUsuarioElementoId(ordemEditingUid);

        await db.collection('usuarios').doc(ordemEditingUid)
                .collection('elementos').doc(targetElemId)
                .collection('ordens').doc(ordemEditingId).delete();
        
        registrarLog("Exclusão Ordem", "perigo", `Ordem ${ordemEditingId} excluída via Modal ADM.`);
        
        fecharModalAdm('admOrdemModal');
        // A lista atualiza sozinha via listener
    } catch(e) {
        alert("Erro ao excluir: " + e.message);
    }
});

// ==========================================================
// MÓDULO DE ORDENS DE PRODUÇÃO (ADM) - CORRIGIDO
// ==========================================================

// Variáveis Globais de Controle de Ordem
let ordemEditingId = null;
let ordemEditingRef = null; // Guardamos a referência direta do Firestore

// --- 1. MODO CRIAR (LIMPO) ---
window.abrirModalOrdemAdm = async function() {
    ordemEditingId = null;
    ordemEditingRef = null;
    
    document.getElementById('admOrdemTitle').innerHTML = '<i class="fa-solid fa-plus"></i> Nova Ordem';
    document.getElementById('admOrdemRomaneio').value = '';
    
    // Esconde botão de excluir
    const btnDel = document.getElementById('btnExcluirOrdemModal');
    if(btnDel) btnDel.style.display = 'none';

    // Reseta selects
    const elSelect = document.getElementById('admOrdemElement');
    elSelect.innerHTML = '<option value="">Selecione um usuário...</option>';
    elSelect.disabled = true;
    
    const userSelect = document.getElementById('admOrdemUser');
    userSelect.disabled = false; 
    await popularSelectUsuarios('admOrdemUser');
    
    document.getElementById('admOrdemModal').style.display = 'flex';
}

// --- 2. MODO EDITAR (CARREGA DADOS) ---
window.editarOrdemAdm = async function(id) {
    const ordem = cacheOrdens.find(o => o.id === id);
    if (!ordem) return alert("Erro: Ordem não encontrada no cache local.");

    ordemEditingId = id;
    ordemEditingRef = ordem.ref; // Referência direta (Salva vidas!)
    
    document.getElementById('admOrdemTitle').innerHTML = '<i class="fa-solid fa-pen"></i> Editar Ordem';
    document.getElementById('admOrdemRomaneio').value = ordem.romaneio || '';
    
    // Mostra botão de excluir
    const btnDel = document.getElementById('btnExcluirOrdemModal');
    if(btnDel) btnDel.style.display = 'block';

    // Popula usuário e trava
    const userSelect = document.getElementById('admOrdemUser');
    await popularSelectUsuarios('admOrdemUser');
    userSelect.value = ordem.criadorUid;
    userSelect.disabled = true; 
    
    // Popula projetos e seleciona o correto
    const elSelect = document.getElementById('admOrdemElement');
    await carregarElementosUsuario(ordem.criadorUid, 'admOrdemElement');
    elSelect.value = ordem.elementoId; // Seleciona o projeto original da ordem
    elSelect.disabled = true; // Trava projeto também para evitar mover documento
    
    document.getElementById('admOrdemModal').style.display = 'flex';
}


// --- 4. EXCLUIR (USANDO REFERÊNCIA DIRETA) ---
// Certifique-se de não ter outro EventListener duplicado para este ID no código
const btnExcluir = document.getElementById('btnExcluirOrdemModal');
// Removemos listener antigo clonando o nó (truque rápido) ou apenas garantimos que este seja o único
// Como você está editando o arquivo, basta garantir que este bloco abaixo seja o único listener para este botão.

btnExcluir.onclick = async function() {
    if(!ordemEditingId || !ordemEditingRef) return;
    
    if(!confirm("Tem certeza que deseja EXCLUIR esta ordem permanentemente?")) return;

    try {
        await ordemEditingRef.delete();
        registrarLog("Exclusão Ordem", "perigo", `Ordem ${ordemEditingId} excluída por ADM.`);
        fecharModalAdm('admOrdemModal');
    } catch(e) {
        alert("Erro ao excluir: " + e.message);
    }
};

// --- SISTEMA DE NOTIFICAÇÕES DO NAVEGADOR ---

function solicitarPermissaoNotificacao() {
    if (!("Notification" in window)) return;
    
    // Só pede se estiver como "default" (ainda não respondeu)
    if (Notification.permission === "default") {
        Notification.requestPermission().then(permission => {
            if (permission === "granted") {
                new Notification("Notificações Ativadas!", { 
                    body: "Agora você receberá alertas de novos pedidos.",
                    icon: 'img/favicon.png'
                });
            }
        });
    }
}

function enviarNotificacaoNavegador(log) {
    // Debug no Console (Aperte F12 para ver se aparece isso)
    console.log("Tentando notificar:", log); 

    if (!("Notification" in window)) return;

    if (Notification.permission === "granted") {
        try {
            const usuarioNome = log.usuario ? log.usuario.split('@')[0].toUpperCase() : 'SISTEMA';
            
            // Cria a notificação
            const notification = new Notification(`🔔 Nova Atividade: ${usuarioNome}`, {
                body: `${log.acao}\n${log.detalhe || 'Verifique o painel.'}`,
                // Removi o ícone temporariamente para evitar erros de carregamento 404
                // icon: 'img/favicon.png', 
                requireInteraction: false, // Fecha sozinha após alguns segundos
                silent: false // Tenta forçar som se o navegador permitir
            });

            notification.onclick = function() {
                window.focus();
                const sidebar = document.getElementById('logsSidebar');
                if(sidebar && !sidebar.classList.contains('open')) toggleLogsSidebar();
            };
            
        } catch (e) {
            console.error("Erro ao disparar notificação:", e);
        }
    } else {
        console.warn("Permissão de notificação não concedida. Status:", Notification.permission);
    }
}