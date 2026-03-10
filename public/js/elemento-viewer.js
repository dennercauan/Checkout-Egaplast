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

// Variáveis Globais
let currentUser = null;
const urlParams = new URLSearchParams(window.location.search);
const dateParam = urlParams.get('date');   

let cachePedidosGlobais = [];

// Elementos de UI
const userEmail = document.getElementById('user-email');
const pageLoader = document.getElementById('page-loader');
const appContent = document.getElementById('app-content');
const tituloElemento = document.getElementById('tituloElemento');
const voltarBtn = document.getElementById('voltarBtn');
const logoBtn = document.getElementById('logoBtn');
const logoutBtn = document.getElementById('logoutBtn');

window.transitionToPage = function(url) {
    appContent.classList.remove('content-visible');
    setTimeout(() => { window.location.href = url; }, 400);
}

voltarBtn.addEventListener('click', () => transitionToPage('dashboard-viewer.html'));
logoBtn.addEventListener('click', () => transitionToPage('dashboard-viewer.html'));

// ---------------- INICIALIZAÇÃO ----------------
firebase.auth().onAuthStateChanged(async function(user) {
    if (user) {
        currentUser = user;
        userEmail.textContent = user.email;

        if (!dateParam) {
            window.location.href = "dashboard-viewer.html";
            return;
        }

        const [ano, mes, dia] = dateParam.split('-');
        tituloElemento.textContent = `Data: ${dia}/${mes}/${ano}`;
        
        iniciarMonitoramentoVisualizador();
    } else {
        window.location.href = "index.html";
    }
});

// =========================================================================
// 1. BUSCA DE DADOS (READ-ONLY)
// =========================================================================
function iniciarMonitoramentoVisualizador() {
    const startDate = new Date(`${dateParam}T00:00:00`);
    const endDate = new Date(`${dateParam}T23:59:59`);
    const startTs = firebase.firestore.Timestamp.fromDate(startDate);
    const endTs = firebase.firestore.Timestamp.fromDate(endDate);

    db.collectionGroup('pedidosMultiDocumento')
        .where('createdAt', '>=', startTs).where('createdAt', '<=', endTs)
        .onSnapshot(snap => {
            cachePedidosGlobais = [];
            snap.forEach(doc => {
                cachePedidosGlobais.push({ id: doc.id, ...doc.data() });
            }); 
            
            renderizarPainelTV();
            ocultarLoader();
        });
}

// Utilitário para puxar o nome da equipe (Igual ao da TV)
function getEquipe(p) {
    let resps = new Set();
    (p.documentos || []).forEach(d => {
        const arr = d.responsaveis && d.responsaveis.length > 0 ? d.responsaveis : (d.responsavel ? [d.responsavel] : []);
        arr.forEach(r => resps.add(r.split('@')[0].toUpperCase()));
    });
    const criador = p.criadorEmail ? p.criadorEmail.split('@')[0].toUpperCase() : 'SISTEMA';
    return Array.from(resps).join(', ') || criador;
}

// Funções de Tempo
function calcularTempoDecorrido(startTs, endTs) {
    const diff = Math.max(0, endTs - startTs);
    const hh = Math.floor(diff / 3600000).toString().padStart(2, '0');
    const mm = Math.floor((diff % 3600000) / 60000).toString().padStart(2, '0');
    const ss = Math.floor((diff % 60000) / 1000).toString().padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
}

// Cronômetro Atualizador
setInterval(() => {
    const now = Date.now();
    document.querySelectorAll('.live-timer').forEach(el => {
        const start = parseInt(el.getAttribute('data-start'));
        el.textContent = calcularTempoDecorrido(start, now);
    });
}, 1000);

// =========================================================================
// 2. RENDERIZAÇÃO DOS PAINEIS (COM ANIMAÇÕES PREMIUM)
// =========================================================================

// Função Odômetro: Anima o número de 0 até o valor final
function animarNumero(id, novoValor) {
    const el = document.getElementById(id);
    if (!el) return;
    const valorAtual = parseInt(el.textContent) || 0;
    
    if (valorAtual !== novoValor) {
        el.classList.add('val-pop'); // Dá o "pulinho" visual
        
        let startTimestamp = null;
        const duration = 800; // 0.8 segundos girando o número

        const step = (timestamp) => {
            if (!startTimestamp) startTimestamp = timestamp;
            const progress = Math.min((timestamp - startTimestamp) / duration, 1);
            const easeOut = 1 - Math.pow(1 - progress, 3); // Deixa o giro suave no final
            
            el.textContent = Math.floor(easeOut * (novoValor - valorAtual) + valorAtual);
            
            if (progress < 1) {
                window.requestAnimationFrame(step);
            } else {
                el.textContent = novoValor;
                setTimeout(() => el.classList.remove('val-pop'), 150); // Remove o pulinho
            }
        };
        window.requestAnimationFrame(step);
    }
}

function renderizarPainelTV() {
    const containerFin = document.getElementById('finishedListContainer');
    const containerOg = document.getElementById('ongoingListContainer');
    
    if(!containerFin || !containerOg) return;

    let kpiTotal = 0, kpiDone = 0, kpiPending = 0;
    const finalizados = [];
    const pendentes = [];

    cachePedidosGlobais.forEach(p => {
        const count = (p.documentos || []).filter(d => ['Nota Fiscal','Minuta'].includes(d.tipo)).length;
        const pesoKpi = count > 0 ? count : 1; 
        kpiTotal += pesoKpi;

        if (p.efetivado) {
            kpiDone += pesoKpi;
            finalizados.push(p);
        } else {
            kpiPending += pesoKpi;
            pendentes.push(p);
        }
    });

    // Chamando a animação do Odômetro nos KPIs
    if (typeof animarNumero === 'function') {
        animarNumero('kpiTotal', kpiTotal);
        animarNumero('kpiDone', kpiDone);
        animarNumero('kpiPending', kpiPending);
    }

    // --- RENDERIZA FINALIZADOS ---
    finalizados.sort((a,b) => (b.completedAt?.toMillis() || 0) - (a.completedAt?.toMillis() || 0));
    
    if (finalizados.length === 0) {
        containerFin.innerHTML = `<div class="empty-msg"><i class="fa-solid fa-box-archive"></i> Nenhum pedido finalizado ainda.</div>`;
    } else {
        let htmlFin = '';
        finalizados.forEach((p, index) => {
            const timeStr = p.completedAt ? p.completedAt.toDate().toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'}) : '--:--';
            const loja = p.loja || "Não informada";
            const equipe = getEquipe(p);

            // TUDO VERDE: Ignoramos a cor azul do Monday para esta visão
            htmlFin += `
                <div class="tv-card fin-row" style="--i: ${index + 1}"> 
                    <div>
                        <span class="fin-rom">${p.romaneio || 'S/N'}</span>
                        <span class="fin-store">
                            <i class="fa-solid fa-shop"></i> ${loja} &nbsp;&bull;&nbsp; 
                            <i class="fa-solid fa-user-check"></i> ${equipe}
                        </span>
                    </div>
                    <div class="fin-time-box">
                         <i class="fa-solid fa-check"></i> ${timeStr}
                    </div>
                </div>
            `;
        });
        containerFin.innerHTML = htmlFin;
    }

    // --- RENDERIZA EM ANDAMENTO ---
    pendentes.sort((a,b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));

    if (pendentes.length === 0) {
        containerOg.innerHTML = `<div class="empty-msg"><i class="fa-solid fa-mug-hot"></i> Nenhum pedido em andamento.</div>`;
    } else {
        let htmlOg = '';
        pendentes.forEach((p, index) => {
            const startTs = p.createdAt ? p.createdAt.toMillis() : Date.now();
            const loja = p.loja || "Não informada";
            const equipe = getEquipe(p);

            // ADICIONADO A DIV DA BARRA DE PROGRESSO NO FINAL DO CARD
            htmlOg += `
                <div class="tv-card og-card" style="--i: ${index + 1}">
                    <div class="og-top">
                        <div class="og-rom">${p.romaneio || 'S/N'}</div>
                        <div class="og-timer live-timer" data-start="${startTs}">00:00:00</div>
                    </div>
                    <div class="og-details">
                        <span><i class="fa-solid fa-location-dot"></i> ${loja}</span>
                        <span><i class="fa-solid fa-user-clock"></i> ${equipe}</span>
                    </div>
                </div>
            `;
        });
        containerOg.innerHTML = htmlOg;
    }

    if (typeof aplicarFiltroPainel === 'function') aplicarFiltroPainel();
}


// =========================================================================
// FILTRO DE PESQUISA (PARA OS CARDS)
// =========================================================================
window.aplicarFiltroPainel = function() {
    const input = document.getElementById('tableSearchInput');
    if(!input) return;
    
    const term = input.value.toLowerCase().trim();
    const cards = document.querySelectorAll('.tv-card');
    
    cards.forEach(card => {
        const text = card.innerText.toLowerCase();
        if (text.includes(term)) {
            card.style.display = '';
        } else {
            card.style.display = 'none';
        }
    });
}

const tableSearchInput = document.getElementById('tableSearchInput');
if(tableSearchInput) {
    tableSearchInput.addEventListener('input', aplicarFiltroPainel);
}

// Utilitários de Navegação
function ocultarLoader() { setTimeout(() => { pageLoader.classList.add('loader-hidden'); appContent.classList.add('content-visible'); document.body.classList.remove('loading-active'); }, 500); }

if(logoutBtn) logoutBtn.addEventListener('click', () => { firebase.auth().signOut().then(() => window.location.href="index.html"); });