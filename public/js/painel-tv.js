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

// --- ESTADOS GLOBAIS ---
let currentPedidos = [];
let prevPedidosMap = new Map();
let currentOrdens = [];
let prevOrdensMap = new Map();
let uidToEmailMap = {};

// CONFIG CARROSSEL
const SLIDE_DURATION = 10000; // Aumentei um pouco para dar tempo de ler listas maiores
const SLIDES = ['RANKING', 'BIGGEST', 'PRODUCTION', 'FINISHED'];
let currentSlideIndex = 0;
let slideInterval = null;

let firstLoadPedidos = true;
let firstLoadOrdens = true;

// Inicialização
firebase.auth().onAuthStateChanged(user => {
    if (user) initDashboard();
    else window.location.href = "index.html";
});

async function initDashboard() {
    // --- BUSCA USUÁRIOS PARA MAPEAR OS EMAILS CORRETAMENTE ---
    try {
        const snap = await db.collection("usuarios").get();
        snap.forEach(doc => {
            if(doc.data().email) uidToEmailMap[doc.id] = doc.data().email;
        });
    } catch(e) { console.error("Erro ao carregar usuários", e); }

    updateClock();
    setInterval(() => { updateClock(); updateTimers(); }, 1000);

    startCarousel();

    const today = new Date();
    const startTs = firebase.firestore.Timestamp.fromDate(new Date(today.setHours(0,0,0,0)));
    const endTs = firebase.firestore.Timestamp.fromDate(new Date(today.setHours(23,59,59,999)));

    // Listener Pedidos
    db.collectionGroup('pedidosMultiDocumento')
        .where('createdAt', '>=', startTs).where('createdAt', '<=', endTs)
        .onSnapshot(async snap => {
            let tempPedidos = [];
            snap.forEach(doc => {
                const d = doc.data();
                if(d.criadorUid) uidToEmailMap[d.criadorUid] = d.criadorEmail;
                tempPedidos.push({ id: doc.id, ...d });
            });
            if (!firstLoadPedidos) await checkPedidosChanges(tempPedidos);
            currentPedidos = tempPedidos;
            prevPedidosMap.clear();
            currentPedidos.forEach(p => prevPedidosMap.set(p.id, p));
            renderFixedElements();
            // Se estiver no slide afetado, atualiza em tempo real sem esperar o carrossel rodar
            if(!firstLoadPedidos) {
                const currentType = SLIDES[currentSlideIndex];
                if(['RANKING', 'BIGGEST', 'FINISHED'].includes(currentType)) renderCurrentSlide(false);
            }
            firstLoadPedidos = false;
        });

    // Listener Ordens
    db.collectionGroup('ordens')
        .where('createdAt', '>=', startTs).where('createdAt', '<=', endTs)
        .onSnapshot(async snap => {
            let tempOrdens = [];
            snap.forEach(doc => {
                tempOrdens.push({ id: doc.id, criadorUid: doc.ref.path.split('/')[1], ...doc.data() });
            });
            if (!firstLoadOrdens) await checkOrdensChanges(tempOrdens);
            currentOrdens = tempOrdens;
            prevOrdensMap.clear();
            currentOrdens.forEach(o => prevOrdensMap.set(o.id, o));
            renderFixedElements();
            
            if(!firstLoadOrdens) {
                const currentType = SLIDES[currentSlideIndex];
                if(currentType === 'PRODUCTION') renderCurrentSlide(false);
            }
            firstLoadOrdens = false;
        });
}

function startCarousel() {
    renderCurrentSlide(true);
    runProgressBar();

    slideInterval = setInterval(() => {
        const contentDiv = document.getElementById('slideContent');
        contentDiv.classList.add('fade-out');

        setTimeout(() => {
            currentSlideIndex = (currentSlideIndex + 1) % SLIDES.length;
            renderCurrentSlide(true); 
            contentDiv.classList.remove('fade-out'); 
            runProgressBar();
        }, 350); 

    }, SLIDE_DURATION);
}

function runProgressBar() {
    const bar = document.getElementById('slideProgress');
    // Reset forçado para reiniciar animação CSS
    bar.style.transition = 'none';
    bar.style.width = '0%';
    setTimeout(() => {
        bar.style.transition = `width ${SLIDE_DURATION}ms linear`;
        bar.style.width = '100%';
    }, 50);
}

function renderCurrentSlide(animate) {
    const type = SLIDES[currentSlideIndex];
    const container = document.getElementById('slideContent');
    const title = document.getElementById('slideTitle');
    const icon = document.getElementById('slideIcon');

    // Limpa conteúdo anterior
    container.innerHTML = "";

    switch(type) {
        case 'RANKING':
            title.textContent = "Ranking de Produtividade";
            icon.className = "fa-solid fa-trophy slide-icon";
            icon.style.color = "var(--gold)";
            renderSlideRanking(container);
            break;
        case 'BIGGEST':
            title.textContent = "Maiores Pedidos Hoje";
            icon.className = "fa-solid fa-cubes-stacked slide-icon";
            icon.style.color = "var(--purple)";
            renderSlideBiggest(container);
            break;
        case 'PRODUCTION':
            title.textContent = "Ordens de Produção";
            icon.className = "fa-solid fa-industry slide-icon";
            icon.style.color = "var(--orange)";
            renderSlideProduction(container);
            break;
        case 'FINISHED':
            title.textContent = "Últimos Finalizados";
            icon.className = "fa-solid fa-truck-fast slide-icon";
            icon.style.color = "var(--green)";
            renderSlideFinished(container);
            break;
    }
}

// --- RENDERIZADORES ---

function renderSlideRanking(el) {
    const rankingMap = {};
    function gerarChave(txt) { return txt ? txt.split('@')[0].toLowerCase().trim() : 'desc'; }
    
    // Processa Pedidos (Fracionamento SKUs)
    currentPedidos.forEach(p => {
        (p.documentos||[]).forEach(d => {
            if(['Nota Fiscal','Minuta'].includes(d.tipo)) {
                const arrResps = d.responsaveis && d.responsaveis.length > 0 ? d.responsaveis : (d.responsavel ? [d.responsavel] : []);
                const divisoes = arrResps.length || 1;
                
                let totalSkus = 0;
                (d.caixas||[]).forEach(c => { 
                    (c.produtos||[]).forEach(prod => totalSkus += (parseInt(prod.quantidade)||0)); 
                });

                const fracao = totalSkus / divisoes;

                arrResps.forEach(r => {
                    const chave = gerarChave(r);
                    const nome = r.split('@')[0].toUpperCase();
                    if(!rankingMap[chave]) rankingMap[chave] = {pontos:0, nome};
                    rankingMap[chave].pontos += fracao;
                });
            }
        });
    });

    // Adiciona pontos das ordens de produção ao ranking (100 pts cada)
    currentOrdens.forEach(o => {
        const email = uidToEmailMap[o.criadorUid] || o.criadorEmail;
        if(email) {
            const chave = gerarChave(email);
            const nome = email.split('@')[0].toUpperCase();
            if(!rankingMap[chave]) rankingMap[chave] = {pontos:0, nome};
            rankingMap[chave].pontos += 100;
        }
    });

    // Mantive top 5 no ranking pois ele precisa de espaço para as barras de progresso
    const sorted = Object.values(rankingMap).sort((a,b) => b.pontos - a.pontos).slice(0, 5);
    
    if(sorted.length === 0) { el.innerHTML = "<div style='text-align:center; margin-top:10%; color:#94a3b8; font-size: 1.5rem;'>Sem dados de produtividade hoje.</div>"; return; }
    
    const max = sorted[0].pontos > 0 ? sorted[0].pontos : 1;
    let html = '<div class="rank-list-container">';
    
    sorted.forEach((u, i) => {
        const pct = (u.pontos / max) * 100;
        let cls = "rank-norm";
        let iconHtml = "";
        
        if(i===0) { 
            cls="rank-1"; 
            iconHtml = '<i class="fa-solid fa-trophy fa-bounce trophy-icon"></i>';
        } else if(i===1) cls="rank-2"; else if(i===2) cls="rank-3";
        
        // Formatando com 1 casa decimal e removendo .0
        const ptsFormatado = u.pontos.toFixed(1).replace('.0', '');

        html += `
            <div class="rank-row ${cls}">
                <div class="rank-pos">${i+1}º</div>
                <div class="rank-data">
                    <div class="rank-info">
                        <span>${u.nome}</span> 
                        <span class="rank-score">${ptsFormatado} pts</span>
                    </div>
                    <div class="rank-bar-bg">
                        <div class="rank-bar-fill" style="width:${pct}%"></div>
                    </div>
                </div>
                ${iconHtml}
            </div>
        `;
    });
    html += '</div>';
    el.innerHTML = html;
}

// Puxa o nome de todo mundo que está ajudando no pedido
function getEquipe(p) {
    let resps = new Set();
    (p.documentos || []).forEach(d => {
        const arr = d.responsaveis && d.responsaveis.length > 0 ? d.responsaveis : (d.responsavel ? [d.responsavel] : []);
        arr.forEach(r => resps.add(r.split('@')[0].toUpperCase()));
    });
    const criador = p.criadorEmail ? p.criadorEmail.split('@')[0].toUpperCase() : '---';
    return Array.from(resps).join(', ') || criador;
}

function renderSlideBiggest(el) {
    let orderCounts = [];
    currentPedidos.forEach(p => {
        let boxCount = 0;
        (p.documentos||[]).forEach(d => {
             if(['Nota Fiscal', 'Minuta'].includes(d.tipo) && d.caixas && Array.isArray(d.caixas)) {
                 boxCount += d.caixas.length;
             }
        });
        if(boxCount > 0) orderCounts.push({ pedido: p, count: boxCount });
    });

    orderCounts.sort((a, b) => b.count - a.count);
    // Aumentei para 10 para preencher telas maiores se houver espaço
    const topOrders = orderCounts.slice(0, 10);

    if(topOrders.length === 0) {
        el.innerHTML = "<div style='text-align:center; margin-top:10%; color:#94a3b8; font-size: 1.5rem;'>Nenhum volume registrado hoje.</div>";
        return;
    }

    let html = '<div class="big-list-container">';
    topOrders.forEach((item) => {
        const p = item.pedido;
        const name = getEquipe(p);
        const loja = p.loja || "N/A";
        
        html += `
            <div class="big-item-row">
                <div class="big-left">
                    <div class="big-rom">${p.romaneio}</div>
                    <div class="big-details">
                        <span><i class="fa-solid fa-store"></i> ${loja}</span> &bull; 
                        <span><i class="fa-solid fa-user-gear"></i> ${name}</span>
                    </div>
                </div>
                <div class="big-right">
                    <div class="big-stat-box">
                        <i class="fa-solid fa-boxes-stacked" style="font-size:1.5rem; margin-bottom:5px;"></i>
                        <span class="big-stat-num">${item.count}</span>
                        <span class="big-stat-label">Caixas</span>
                    </div>
                </div>
            </div>
        `;
    });
    html += '</div>';
    el.innerHTML = html;
}

function renderSlideProduction(el) {
    if(currentOrdens.length === 0) {
        el.innerHTML = "<div style='text-align:center; margin-top:10%; color:#94a3b8; font-size: 1.5rem;'>Nenhuma ordem de produção aberta.</div>";
        return;
    }
    
    let html = '<div class="prod-grid">';
    // AQUI ESTÁ A MUDANÇA: Aumentei o slice de 8 para 50.
    // O CSS grid (auto-fill) vai cuidar de arrumar eles na tela.
    const recentOrdens = [...currentOrdens]
        .sort((a,b) => b.createdAt?.toMillis() - a.createdAt?.toMillis())
        .slice(0, 50); 

    recentOrdens.forEach(o => {
        const email = uidToEmailMap[o.criadorUid] || o.criadorEmail || "User";
        const name = email.split('@')[0].toUpperCase();

        html += `
            <div class="prod-item">
                <i class="fa-solid fa-industry" style="font-size:2rem; margin-bottom:10px; display:block; opacity:0.8"></i>
                <div class="prod-rom">${o.romaneio}</div>
                <div class="prod-who">${name}</div>
            </div>
        `;
    });
    html += '</div>';
    el.innerHTML = html;
}

function renderSlideFinished(el) {
    const finalizados = currentPedidos.filter(p => p.efetivado)
        .sort((a,b) => b.completedAt?.toMillis() - a.completedAt?.toMillis());
    
    // AQUI ESTÁ A MUDANÇA: Aumentei o slice de 5 para 50.
    // O CSS flex e overflow:hidden vai mostrar o que der.
    const displayList = finalizados.slice(0, 50);

    if(displayList.length === 0) {
        el.innerHTML = "<div style='text-align:center; margin-top:10%; color:#94a3b8; font-size: 1.5rem;'>Nenhuma entrega hoje.</div>";
        return;
    }

    let html = '<div class="finished-list">';
    displayList.forEach((p, index) => {
        const time = p.completedAt ? p.completedAt.toDate().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '--:--';
        const loja = p.loja || "---";
        const name = getEquipe(p);

        html += `
            <div class="fin-row" style="--i: ${index + 1}"> 
                <div class="fin-info">
                    <span class="fin-rom">${p.romaneio}</span>
                    <span class="fin-store">
                        <i class="fa-solid fa-shop"></i> ${loja} &nbsp;&bull;&nbsp; 
                        <i class="fa-solid fa-user-check"></i> ${name}
                    </span>
                </div>
                <div class="fin-time-box">
                     <i class="fa-solid fa-check" style="margin-right:8px;"></i>
                     ${time}
                </div>
            </div>
        `;
    });
    html += '</div>';
    el.innerHTML = html;
}

function renderFixedElements() {
    let total = 0, done = 0, pending = 0;
    currentPedidos.forEach(p => {
        const count = (p.documentos || []).filter(d => ['Nota Fiscal','Minuta'].includes(d.tipo)).length;
        total += count;
        if(p.efetivado) done += count; else pending += count;
    });
    animateValue('kpiTotal', total);
    animateValue('kpiDone', done);
    animateValue('kpiPending', pending);

    renderOngoingSidebar();
}

function animateValue(id, newValue) {
    const el = document.getElementById(id);
    const current = parseInt(el.textContent || 0);
    if (current !== newValue) {
        el.style.transform = "scale(1.1)"; // Reduzido o scale para performance
        setTimeout(() => {
             el.textContent = newValue;
             el.style.transform = "scale(1)";
        }, 200);
    }
}

function renderOngoingSidebar() {
    const el = document.getElementById('ongoingList');
    const pendentes = currentPedidos.filter(p => !p.efetivado)
        .sort((a,b) => b.createdAt?.toMillis() - a.createdAt?.toMillis());

    if(pendentes.length === 0) {
        el.innerHTML = "<div style='text-align:center; color:#94a3b8; margin-top:20px; font-size: 1.2rem;'><i class='fa-solid fa-mug-hot' style='font-size:2rem; margin-bottom:10px;'></i><br>Nenhum pedido em andamento</div>";
        return;
    }
    
    el.innerHTML = "";
    pendentes.forEach(p => {
        const start = p.createdAt ? p.createdAt.toDate().getTime() : Date.now();
        const name = getEquipe(p);
        const loja = p.loja || "Loja";

        const div = document.createElement('div');
        div.className = 'og-card';
        div.innerHTML = `
            <div class="og-top">
                <div class="og-rom">${p.romaneio}</div>
                <div class="og-timer live-timer" data-start="${start}">00:00:00</div>
            </div>
            <div class="og-details">
                <span class="og-store"><i class="fa-solid fa-location-dot"></i> ${loja}</span>
                <span class="og-user"><i class="fa-solid fa-user-clock"></i> ${name}</span>
            </div>
        `;
        el.appendChild(div);
    });
    updateTimers();
}

function updateClock() {
    const now = new Date();
    document.getElementById('clockTime').textContent = now.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit', second:'2-digit'});
    const opts = { weekday:'long', day:'numeric', month:'short'};
    let s = now.toLocaleDateString('pt-BR', opts);
    document.getElementById('clockDate').textContent = s.charAt(0).toUpperCase() + s.slice(1);
}

function updateTimers() {
    const now = Date.now();
    document.querySelectorAll('.live-timer').forEach(el => {
        const start = parseInt(el.dataset.start);
        let diff = now - start;
        if(diff < 0) diff = 0;
        const h = Math.floor(diff/3600000).toString().padStart(2,'0');
        const m = Math.floor((diff%3600000)/60000).toString().padStart(2,'0');
        const s = Math.floor((diff%60000)/1000).toString().padStart(2,'0');
        el.textContent = `${h}:${m}:${s}`;
    });
}

async function checkPedidosChanges(newPedidosList) {
    for (const newP of newPedidosList) {
        const oldP = prevPedidosMap.get(newP.id);
        if (oldP && !oldP.efetivado && newP.efetivado) {
            await showOverlay("done", newP.romaneio);
        } else if (!oldP) {
            if (newP.createdAt && (Date.now() - newP.createdAt.toMillis()) < 300000) {
                 await showOverlay("new", newP.romaneio);
            }
        }
    }
}
async function checkOrdensChanges(newOrdensList) {
    for (const newO of newOrdensList) {
        const oldO = prevOrdensMap.get(newO.id);
        if (!oldO && newO.createdAt && (Date.now() - newO.createdAt.toMillis()) < 300000) {
             await showOverlay("prod", newO.romaneio);
        }
    }
}

// Overlay simplificado para performance (sem blur, sem pulse complexo)
function showOverlay(type, romaneio) {
    return new Promise(resolve => {
        const overlay = document.getElementById('overlay-alert');
        const icon = document.getElementById('overlay-icon');
        const title = document.getElementById('overlay-title');
        const romText = document.getElementById('overlay-romaneio');
        
        // Reseta classes
        overlay.className = ''; 
        void overlay.offsetWidth; // Força reflow

        if (type === 'done') {
            overlay.className = 'overlay-done active';
            icon.innerHTML = '<i class="fa-solid fa-circle-check"></i>';
            title.textContent = "PEDIDO FINALIZADO!";
        } else if (type === 'new') {
            overlay.className = 'overlay-new active';
            icon.innerHTML = '<i class="fa-solid fa-box-open"></i>';
            title.textContent = "NOVO PEDIDO";
        } else if (type === 'prod') {
            overlay.className = 'overlay-prod active';
            icon.innerHTML = '<i class="fa-solid fa-industry"></i>';
            title.textContent = "NOVA ORDEM";
        }
        romText.textContent = romaneio || "---";
        setTimeout(() => {
            overlay.classList.remove('active');
            setTimeout(resolve, 500); 
        }, 4000);
    });
}