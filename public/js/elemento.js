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

// ---------------- VARIÁVEIS GLOBAIS E ROTEAMENTO ----------------
let currentUser = null;
let isAdmin = false;
let isGlobalAdminMode = false;

const urlParams = new URLSearchParams(window.location.search);
const elementoId = urlParams.get('id');    
const dateParam = urlParams.get('date');   

let unsubscribers = [];

// Contexto de Edição
let editingId = null;
let pedidoAtualId = null;
let pedidoAtualTipo = 'simples'; 
let pedidoAtualCriadorUid = null;
let pedidoAtualElementoId = null;
let caixaDocIndexAtual = null;

// Cache e Listas temporárias
let documentosTemporarios = []
let emailToUidMap = {};
let elementoAtualTitulo = null;
let dataReferenciaRanking = new Date(); // NOVO: Guarda a data exata da pasta
let cachePedidosGlobais = [];

// Elementos de UI Base
const userEmail = document.getElementById('user-email');
const pageLoader = document.getElementById('page-loader');
const appContent = document.getElementById('app-content');
const tituloElemento = document.getElementById('tituloElemento');
const voltarBtn = document.getElementById('voltarBtn');
const logoBtn = document.getElementById('logoBtn');
const logoutBtn = document.getElementById('logoutBtn');
const multiOrdersTableBody = document.getElementById('multiOrdersTableBody');

// WIDGETS ADM
const adminWidgets = document.getElementById('admin-widgets');
const ordensContainer = document.getElementById('ordensContainer');
const notifBtnWrapper = document.getElementById('notifBtnWrapper');
const notifBadge = document.getElementById('notifBadge');
const logsSidebar = document.getElementById('logsSidebar');
const logsList = document.getElementById('logsList');
let unreadLogs = 0;

// MODAIS E BOTOES
const multiPopupOverlay = document.getElementById('multiPopupOverlay');
const adminAssignGroup = document.getElementById('adminAssignGroup');
const caixasPopup = document.getElementById('caixasPopup');
const addCaixaModal = document.getElementById('addCaixaModal');
const popupOrdens = document.getElementById('popupOrdens');
const logoutConfirmModal = document.getElementById('logoutConfirmModal');

// Inputs Principais
const multiRomaneio = document.getElementById('multiRomaneio');
const multiLoja = document.getElementById('multiLoja');
const multiLocal = document.getElementById('multiLocal');
const multiUf = document.getElementById('multiUf');
const multiObservacoes = document.getElementById('multiObservacoes');
const multiDocTipo = document.getElementById('multiDocTipo');
const documentosContainer = document.getElementById('documentosAdicionadosContainer');

window.transitionToPage = function(url) {
    appContent.classList.remove('content-visible');
    setTimeout(() => { window.location.href = url; }, 400);
}

voltarBtn.addEventListener('click', () => transitionToPage('dashboard.html'));
logoBtn.addEventListener('click', () => transitionToPage('dashboard.html'));

// ---------------- INICIALIZAÇÃO E AUTH ----------------
firebase.auth().onAuthStateChanged(async function(user) {
    if (user) {
        currentUser = user;
        userEmail.textContent = user.email;

        try {
            const userDoc = await db.collection("usuarios").doc(user.uid).get();
            if (userDoc.exists && userDoc.data().isAdmin === true) isAdmin = true;
        } catch (e) { console.error("Erro permissões:", e); }

        await carregarUsuarios(); // Preenche HTML na memória

        // ROTEAMENTO
        if (dateParam && isAdmin) {
            isGlobalAdminMode = true;
            if(adminWidgets) adminWidgets.style.display = 'block';
            if(notifBtnWrapper) notifBtnWrapper.style.display = 'block';
            
            const [ano, mes, dia] = dateParam.split('-');
            dataReferenciaRanking = new Date(ano, mes - 1, dia); // NOVO: Grava a data do Admin
            tituloElemento.innerHTML = `<i class="fa-solid fa-globe"></i> Visão Global: ${dia}/${mes}/${ano}`;
            
            iniciarMonitoramentoAdminGlobal();
        } else if (elementoId) {
            isGlobalAdminMode = false;
            await carregarTituloElemento(); // <--- FUNÇÃO CORRIGIDA AQUI
            configurarListenersPessoais();
            carregarOrdensPessoais();
        } else {
            window.location.href = "dashboard.html";
        }

    } else {
        window.location.href = "index.html";
    }
});


// =========================================================================
// 1. LÓGICA DE DADOS - MODO ADMIN GLOBAL (DATA)
// =========================================================================
function iniciarMonitoramentoAdminGlobal() {
    desativarListeners();
    const startDate = new Date(`${dateParam}T00:00:00`);
    const endDate = new Date(`${dateParam}T23:59:59`);
    const startTs = firebase.firestore.Timestamp.fromDate(startDate);
    const endTs = firebase.firestore.Timestamp.fromDate(endDate);

    const unsubPedidos = db.collectionGroup('pedidosMultiDocumento')
        .where('createdAt', '>=', startTs).where('createdAt', '<=', endTs)
        .onSnapshot(snap => {
            cachePedidosGlobais = [];
            let detalhes = initDetalhes();
            snap.forEach(doc => {
                const data = doc.data();
                const pathSegments = doc.ref.path.split('/');
                const elemIdOriginal = pathSegments[3]; 
                
                const pedidoFormatado = { id: doc.id, ...data, elementoIdOriginal: elemIdOriginal };
                cachePedidosGlobais.push(pedidoFormatado);
                contabilizarDetalhesGlobal(pedidoFormatado, detalhes); 
            }); // fim do snap.forEach
            cachePedidosGlobais.sort((a, b) => getSafeTimestamp(b) - getSafeTimestamp(a));

            renderizarTabela(cachePedidosGlobais);
            atualizarTotais(detalhes, initDetalhes());
            renderOngoingAdmin();
        });

    const unsubOrdens = db.collectionGroup('ordens')
        .where('createdAt', '>=', startTs).where('createdAt', '<=', endTs)
        .onSnapshot(snap => {
            cacheOrdensGlobais = [];
            snap.forEach(doc => {
                const pathSegments = doc.ref.path.split('/');
                cacheOrdensGlobais.push({ 
                    id: doc.id, 
                    criadorUid: pathSegments[1], 
                    elementoId: pathSegments[3], // <--- AGORA ELE SABE DE QUAL PASTA VEIO
                    ...doc.data() 
                });
            });
            renderOrdensAdmin(); // <--- CORRIGIDO AQUI!
            processarRankingHibridoAdmin(); 
        });

    let isFirstLogLoad = true;
    const unsubLogs = db.collection('logs_globais').where('dataString', '==', dateParam)
        .onSnapshot(snap => {
            let logs = [];
            snap.forEach(doc => logs.push({ id: doc.id, ...doc.data() }));
            logs.sort((a,b) => (b.createdAt?.toMillis()||0) - (a.createdAt?.toMillis()||0));
            
            if(!isFirstLogLoad) {
                snap.docChanges().forEach(change => { if(change.type === 'added') unreadLogs++; });
                updateBadge();
            } else { isFirstLogLoad = false; }
            
            renderLogsAdmin(logs);
            ocultarLoader();
        });

    unsubscribers.push(unsubPedidos, unsubOrdens, unsubLogs);
}

function contabilizarDetalhesGlobal(pedido, det) {
    (pedido.documentos || []).forEach(doc => {
        if (doc.tipo === 'Nota Fiscal' || doc.tipo === 'Minuta') det.total++;
        if(doc.tipo === 'Nota Fiscal') det.nf++;
        if(doc.tipo === 'Bonificação' || doc.tipo === 'Troca') det.bonif++;
        if(doc.tipo === 'Minuta') det.minuta++;

        (doc.caixas || []).forEach(cx => {
            let num = `CAIXA ${String(cx.num || "").replace(/\D/g,'').trim()}`;
            if(cx.isBonificacao) {
                det.caixasBonus++;
                det.agrupado[`${num} (Bônus)`] = (det.agrupado[`${num} (Bônus)`] || 0) + 1;
            } else {
                det.caixas++;
                det.agrupado[num] = (det.agrupado[num] || 0) + 1;
            }
        });
    });
}

function processarRankingHibridoAdmin() {
    const rankingMap = {};
    
    // Fracionamento Pedidos/SKUs
    cachePedidosGlobais.forEach(p => {
        (p.documentos || []).forEach(doc => {
            if (doc.tipo === 'Nota Fiscal' || doc.tipo === 'Minuta') {
                const arrayResps = doc.responsaveis && doc.responsaveis.length > 0 ? doc.responsaveis : (doc.responsavel ? [doc.responsavel] : []);
                const divisoes = arrayResps.length || 1;
                
                let totalSkus = 0;
                (doc.caixas || []).forEach(cx => {
                    (cx.produtos || []).forEach(prod => totalSkus += (parseInt(prod.quantidade) || 0));
                });

                const docFracao = 1 / divisoes;
                const skuFracao = totalSkus / divisoes;

                arrayResps.forEach(r => {
                    const emailKey = r.trim().toLowerCase();
                    if(!rankingMap[emailKey]) rankingMap[emailKey] = { docs: 0, skus: 0, nome: emailKey.split('@')[0] };
                    rankingMap[emailKey].docs += docFracao;
                    rankingMap[emailKey].skus += skuFracao;
                });
            }
        });
    });

    // Ordens
    cacheOrdensGlobais.forEach(o => {
        // uidToEmailMapReverso foi preenchido no carregarUsuarios()
        const userEmail = Object.keys(emailToUidMap).find(k => emailToUidMap[k] === o.criadorUid);
        if (userEmail) {
            const emailKey = userEmail.trim().toLowerCase();
            if(!rankingMap[emailKey]) rankingMap[emailKey] = { docs: 0, skus: 0, nome: emailKey.split('@')[0] };
            rankingMap[emailKey].docs += 1;
        }
    });

    renderWidgetRanking(rankingMap);
}

function renderWidgetRanking(rankingMap) {
    const skusContainer = document.getElementById('rankingSkusContainer');
    const docsContainer = document.getElementById('contadorDocsContainer');

    if(!skusContainer || !docsContainer) return;

    skusContainer.innerHTML = "";
    docsContainer.innerHTML = "";

    const arrUsuarios = Object.values(rankingMap);

    // 1. Gráfico de SKUs
    const sortedBySku = [...arrUsuarios].sort((a,b) => b.skus - a.skus);
    if(sortedBySku.length === 0 || sortedBySku[0].skus === 0) {
        skusContainer.innerHTML = "<p style='color:#999; font-size:12px;'>Nenhum SKU contabilizado hoje.</p>";
    } else {
        const maxSku = sortedBySku[0].skus; 
        sortedBySku.slice(0, 5).forEach((u) => {
            if (u.skus > 0) {
                let pct = Math.max((u.skus / maxSku) * 100, 10); 
                skusContainer.innerHTML += `
                    <div style="margin-bottom: 5px;">
                        <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:4px;">
                            <strong>${u.nome.toUpperCase()}</strong>
                            <span style="color:var(--secondary); font-weight:bold;">${u.skus.toFixed(1).replace('.0','')}</span>
                        </div>
                        <div style="background:#f0f0f0; height:8px; border-radius:4px; overflow:hidden;">
                            <div style="background:var(--secondary); height:100%; width:${pct}%; transition: width 1s ease-out;"></div>
                        </div>
                    </div>
                `;
            }
        });
    }

    // 2. Lista de Docs
    const sortedByDocs = [...arrUsuarios].sort((a,b) => b.docs - a.docs);
    if(sortedByDocs.length === 0 || sortedByDocs[0].docs === 0) {
        docsContainer.innerHTML = "<p style='color:#999; font-size:12px;'>Nenhum pedido registrado.</p>";
    } else {
        sortedByDocs.forEach(u => {
            if (u.docs > 0) {
                docsContainer.innerHTML += `
                    <div class="ordem-item" style="padding: 8px 12px; background:#f8f9fa; border:1px solid #eee; border-radius:8px; margin-bottom:8px; display:flex; justify-content:space-between; font-size:13px;">
                        <span><i class="fa-regular fa-user" style="color:#aaa;"></i> <strong style="color:var(--primary)">${u.nome.toUpperCase()}</strong></span>
                        <span><strong>${u.docs.toFixed(1).replace('.0','')}</strong> <small style="color:#888;">Pontos</small></span>
                    </div>
                `;
            }
        });
    }
}

window.renderOrdensAdmin = function() {
    // Agora o sistema desenha a lista dentro da tag <ul> do Modal
    const ul = document.getElementById('listaOrdens');
    if(!ul) return;
    ul.innerHTML = "";
    
    if(cacheOrdensGlobais.length === 0) { 
        ul.innerHTML = "<li style='text-align:center; color:#999; padding: 10px;'>Nenhuma ordem aberta neste dia.</li>"; 
        return; 
    }
    
    // Organiza da mais recente para a mais antiga
    const sorted = [...cacheOrdensGlobais].sort((a,b) => getSafeTimestamp(b) - getSafeTimestamp(a));
    
    sorted.forEach(o => {
        const userEmail = uidToEmailMapReverso[o.criadorUid] || "User";
        const nome = userEmail.split('@')[0].toUpperCase();
        
        const li = document.createElement('li');
        li.style.cssText = "display:flex; justify-content:space-between; align-items:center; padding:10px; border-bottom:1px solid #eee; background:#f8f9fa; margin-bottom:5px; border-radius:6px;";
        li.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:4px;">
                <span><strong style="color:var(--primary)"><i class="fa-solid fa-clipboard-list"></i> ${o.romaneio}</strong></span>
                <span style="color:#666; font-size:11px;"><i class="fa-solid fa-user"></i> ${nome}</span>
            </div>
            <i class="fa-solid fa-trash" style="color:#dc3545; cursor:pointer; padding:5px; font-size:14px; transition:0.2s;" title="Excluir Ordem" onmouseover="this.style.transform='scale(1.2)'" onmouseout="this.style.transform='scale(1)'" onclick="excluirOrdemAdmin('${o.id}', '${o.criadorUid}', '${o.elementoId}')"></i>
        `;
        ul.appendChild(li);
    });
}

window.toggleLogsSidebar = function() { 
    const sidebar = document.getElementById('logsSidebar');
    if (sidebar) {
        if (sidebar.classList.contains('open')) {
            sidebar.classList.remove('open'); // Fecha se estiver aberta
        } else {
            sidebar.classList.add('open'); // Abre se estiver fechada
        }
    }
    
    // Zera o contador visual do sino com segurança
    unreadLogs = 0; 
    const badge = document.getElementById('notifBadge');
    if (badge) badge.classList.remove('badge-visible');
}

function renderLogsAdmin(logs) {
    logsList.innerHTML = "";
    if(logs.length === 0) { logsList.innerHTML = "<div style='padding:20px; text-align:center; color:#aaa;'>Nenhuma atividade registrada.</div>"; return; }
    logs.forEach(log => {
        const time = log.createdAt ? log.createdAt.toDate().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '--:--';
        let cls = "", icon = "fa-info-circle";
        if(log.acao?.includes("Criação")) { cls = "log-creation log-high-priority"; icon = "fa-plus-circle"; }
        else if(log.acao?.includes("Finalização")) { cls = "log-success log-high-priority"; icon = "fa-check-circle"; }
        
        const userShort = log.usuario ? log.usuario.split('@')[0] : 'Sistema';
        logsList.innerHTML += `
            <div class="log-item ${cls}">
                <div class="log-header"><span>${time}</span> <span>${userShort}</span></div>
                <div class="log-title"><i class="fa-solid ${icon}"></i> ${log.acao}</div>
                <div class="log-detail">${log.detalhe || ''}</div>
            </div>`;
    });
}

async function registrarLog(acao, tipo, detalhe = "") {
    try {
        const now = new Date();
        const dataLocal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        await db.collection("logs_globais").add({
            acao: acao, tipo: tipo, detalhe: detalhe,
            usuario: currentUser.email,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            timestamp: Date.now(), dataString: dataLocal 
        });
    } catch (e) {}
}


// =========================================================================
// 2. LÓGICA DE DADOS - MODO PESSOAL (ID DA PASTA)
// =========================================================================

async function carregarTituloElemento() {
    try {
        const doc = await db.collection("usuarios").doc(currentUser.uid).collection("elementos").doc(elementoId).get();
        if (doc.exists) {
            const data = doc.data();
            elementoAtualTitulo = data.titulo || "Pedidos";
            document.getElementById('tituloElemento').innerHTML = `<i class="fa-regular fa-folder-open"></i> ${elementoAtualTitulo}`;
            document.title = `${elementoAtualTitulo} - Egaplast`;
            
            // NOVO: Puxa a data exata em que a pasta foi criada para usar no Ranking
            if (data.createdAt) {
                dataReferenciaRanking = data.createdAt.toDate();
            }
        } else {
            document.getElementById('tituloElemento').innerHTML = `<i class="fa-regular fa-folder-open"></i> Pasta Desconhecida`;
        }
    } catch (error) {
        console.error("Erro ao carregar o título:", error);
    }
}
function configurarListenersPessoais() {
    desativarListeners();
    const unsubSimples = db.collection("usuarios").doc(currentUser.uid).collection("elementos").doc(elementoId).collection("pedidos").onSnapshot(() => atualizarPaginaInteiraPessoal());
    const unsubMulti = db.collection("usuarios").doc(currentUser.uid).collection("elementos").doc(elementoId).collection("pedidosMultiDocumento").onSnapshot(() => atualizarPaginaInteiraPessoal());
    const unsubShared = db.collection("usuarios").doc(currentUser.uid).collection("pedidosCompartilhadosComigo").onSnapshot(() => atualizarPaginaInteiraPessoal());
    unsubscribers.push(unsubSimples, unsubMulti, unsubShared);
}

async function atualizarPaginaInteiraPessoal() {
    const [resSimples, resMulti] = await Promise.all([ carregarPedidosSimples(), carregarPedidosMulti() ]);
    let todos = [...resSimples.lista, ...resMulti.lista];
    
    // ORDENAÇÃO CORRIGIDA
    todos.sort((a, b) => getSafeTimestamp(b) - getSafeTimestamp(a));

    renderizarTabela(todos);
    atualizarTotais(resSimples.detalhes, resMulti.detalhes);
    ocultarLoader();
}

async function carregarPedidosSimples() {
    const snap = await db.collection("usuarios").doc(currentUser.uid).collection("elementos").doc(elementoId).collection("pedidos").get();
    let lista = []; let detalhes = initDetalhes();
    snap.forEach(doc => { const p = transformarSimplesEmMulti(doc); lista.push(p); contabilizarDetalhesPessoal(p, detalhes); });
    return { lista, detalhes };
}

async function carregarPedidosMulti() {
    const propriosSnap = await db.collection("usuarios").doc(currentUser.uid).collection("elementos").doc(elementoId).collection("pedidosMultiDocumento").get();
    const atalhosSnap = await db.collection("usuarios").doc(currentUser.uid).collection("pedidosCompartilhadosComigo").get();
    let listaBruta = [];
    propriosSnap.forEach(doc => listaBruta.push({ id: doc.id, ...doc.data(), elementoIdOriginal: elementoId }));
    
    const promises = [];
    atalhosSnap.forEach(docAtalho => {
        const at = docAtalho.data();
        if(at.elementoTitulo === elementoAtualTitulo) {
            promises.push(db.collection("usuarios").doc(at.criadorUid).collection("elementos").doc(at.elementoId).collection("pedidosMultiDocumento").doc(at.pedidoId).get().then(d => d.exists ? { id: d.id, ...d.data(), compartilhado: true, elementoIdOriginal: at.elementoId } : null));
        }
    });
    const compartilhados = await Promise.all(promises);
    compartilhados.forEach(p => { if(p) listaBruta.push(p); });
    
    let detalhes = initDetalhes();
    listaBruta.forEach(p => contabilizarDetalhesPessoal(p, detalhes));
    return { lista: listaBruta, detalhes };
}

function contabilizarDetalhesPessoal(pedido, det) {
    const userEmail = currentUser.email.trim().toLowerCase();
    (pedido.documentos || []).forEach(doc => {
        const resps = doc.responsaveis || [doc.responsavel || ""];
        const ehResponsavel = resps.some(r => r.trim().toLowerCase() === userEmail);
        
        if (!ehResponsavel) return; 

        if (doc.tipo === 'Nota Fiscal' || doc.tipo === 'Minuta') det.total++;
        if(doc.tipo === 'Nota Fiscal') det.nf++;
        if(doc.tipo === 'Bonificação' || doc.tipo === 'Troca') det.bonif++;
        if(doc.tipo === 'Minuta') det.minuta++;

        (doc.caixas || []).forEach(cx => {
            let idCaixa = String(cx.num || "").replace(/^(cx|caixa)\s*/i, '').trim();
            if(!idCaixa) return;
            const num = `CAIXA ${idCaixa}`;
            if(cx.isBonificacao) { det.caixasBonus++; det.agrupado[`${num} (Bônus)`] = (det.agrupado[`${num} (Bônus)`] || 0) + 1; } 
            else { det.caixas++; det.agrupado[num] = (det.agrupado[num] || 0) + 1; }
        });
    });
}

function atualizarTotais(det1, det2) {
    const final = { total: det1.total + det2.total, nf: det1.nf + det2.nf, bonif: det1.bonif + det2.bonif, minuta: det1.minuta + det2.minuta, caixas: det1.caixas + det2.caixas, caixasBonus: det1.caixasBonus + det2.caixasBonus };
    
    document.getElementById('totalPedidosVisor').textContent = final.total;
    const cxVisor = document.getElementById('totalCaixasVisor');
    if (cxVisor) cxVisor.textContent = final.caixas + final.caixasBonus;
    
    document.getElementById('ttNf').textContent = final.nf;
    document.getElementById('ttBonif').textContent = final.bonif;
    document.getElementById('ttMinuta').textContent = final.minuta;
    document.getElementById('ttCx').textContent = final.caixas;
    document.getElementById('ttCxB').textContent = final.caixasBonus;

    const agrupadoFinal = { ...det1.agrupado };
    Object.entries(det2.agrupado).forEach(([k, v]) => agrupadoFinal[k] = (agrupadoFinal[k] || 0) + v);
    const sorted = Object.keys(agrupadoFinal).sort((a, b) => (parseInt(a.replace(/\D/g, '')) || 0) - (parseInt(b.replace(/\D/g, '')) || 0));
    
    document.getElementById('caixasDetalhadasList').innerHTML = sorted.map(k => {
        const style = k.includes('Bônus') ? 'color:var(--secondary); font-weight:bold;' : '';
        return `<span style="display:inline-block; margin-right:5px; ${style}">${k}: ${agrupadoFinal[k]}</span>`;
    }).join(' | ');
}

// --- FUNÇÕES DE TEMPO E CRONÔMETRO ---
function calcularTempoDecorrido(startTs, endTs) {
    const diff = Math.max(0, endTs - startTs);
    const hh = Math.floor(diff / 3600000).toString().padStart(2, '0');
    const mm = Math.floor((diff % 3600000) / 60000).toString().padStart(2, '0');
    const ss = Math.floor((diff % 60000) / 1000).toString().padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
}

// Cronômetro Global: Bate a cada 1 segundo e atualiza todos os relógios da tela
setInterval(() => {
    const now = Date.now();
    // 1. Atualiza a tabela geral
    document.querySelectorAll('.live-timer').forEach(el => {
        const start = parseInt(el.getAttribute('data-start'));
        el.querySelector('span').textContent = calcularTempoDecorrido(start, now);
    });
    // 2. Atualiza os cards de andamento do Admin
    document.querySelectorAll('.ongoing-timer').forEach(el => {
        const start = parseInt(el.getAttribute('data-start'));
        el.textContent = calcularTempoDecorrido(start, now);
    });
}, 1000);

// --- RENDERIZAÇÃO DOS CARDS (VISÃO ADM) ---
function renderOngoingAdmin() {
    const container = document.getElementById('ongoingOrdersContainer');
    if (!container) return;

    // Pega só os que ainda não foram finalizados (efetivados)
    const ongoing = cachePedidosGlobais.filter(p => !p.efetivado);

    if (ongoing.length === 0) {
        container.innerHTML = "<p style='color:#999; font-size:13px; grid-column: 1/-1; text-align: center; padding: 20px;'>Nenhum pedido em andamento no momento.</p>";
        return;
    }

    let html = '';
    ongoing.forEach(p => {
        const criador = (p.criadorEmail || 'Usuário').split('@')[0].toUpperCase();
        
        let resps = new Set();
        (p.documentos || []).forEach(d => {
            const arr = d.responsaveis && d.responsaveis.length > 0 ? d.responsaveis : (d.responsavel ? [d.responsavel] : []);
            arr.forEach(r => resps.add(r.split('@')[0].toUpperCase()));
        });
        const equipe = Array.from(resps).join(', ') || criador;
        const startTs = p.createdAt ? p.createdAt.toMillis() : Date.now();

        html += `
            <div class="ongoing-card">
                <div class="ongoing-header">
                    <strong style="color: var(--primary); font-size: 15px;"><i class="fa-solid fa-box-open"></i> ${p.romaneio || 'S/N'}</strong>
                    <div class="ongoing-time">
                        <div class="pulse-dot"></div>
                        <span class="ongoing-timer" data-start="${startTs}">00:00:00</span>
                    </div>
                </div>
                <div class="ongoing-body">
                    <div><strong>Loja:</strong> ${p.loja || '---'}</div>
                    <div><strong>Conferência:</strong> <i class="fa-regular fa-user"></i> ${equipe}</div>
                </div>
            </div>
        `;
    });
    container.innerHTML = html;
}

// =========================================================================
// 3. RENDERIZAÇÃO DA TABELA UNIFICADA
// =========================================================================

window.renderizarTabela = function(pedidos) {
    if(!multiOrdersTableBody) return;
    multiOrdersTableBody.innerHTML = "";
    
    if(pedidos.length === 0) {
        multiOrdersTableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#999; padding:30px;">Nenhum pedido encontrado.</td></tr>`;
        return;
    }

    pedidos.forEach((p, index) => {
        const tr = document.createElement('tr');
        tr.style.animationDelay = `${index * 0.05}s`;
        if(p.efetivado) tr.classList.add('efetivado');
        
        // NOVO: Verifica se marcou o Monday, tira o verde (efetivado) e coloca o azul chamativo
        if(p.mondayVerified) {
            tr.classList.remove('efetivado'); 
            tr.classList.add('monday-verified');
        }

        const criadorUid = p.criadorUid || currentUser.uid;
        const temPermissao = isAdmin || (p.uidsVinculados && p.uidsVinculados.includes(currentUser.uid)) || (criadorUid === currentUser.uid);
        const isLegacy = p._isLegacy === true;

        tr.onclick = (e) => {
            if (!e.target.closest('.action-btn') && !e.target.closest('.monday-check-label')) {
                abrirCaixas(p.id, isLegacy ? 'simples' : 'multi', criadorUid, p.elementoIdOriginal, p.romaneio);
            }
        };

        const docsHtml = (p.documentos || []).map(d => {
            const arrResp = d.responsaveis && d.responsaveis.length > 0 ? d.responsaveis : (d.responsavel ? [d.responsavel] : ['---']);
            const shortNames = arrResp.map(r => r.split('@')[0]).join(', ');
            return `<span class="doc-pill">${d.tipo}<small>(${shortNames})</small></span>`;
        }).join('');

        const allCaixas = (p.documentos || []).flatMap(d => d.caixas || []);
        const resumoCaixas = calcularResumoCaixasStr(allCaixas);

        // --- CÁLCULO DE SKUs PARA EXIBIR NA TABELA ---
        let totalSkusPedido = 0;
        allCaixas.forEach(cx => {
            (cx.produtos || []).forEach(prod => { totalSkusPedido += (parseInt(prod.quantidade) || 0); });
        });
        
        const badgeSkus = totalSkusPedido > 0 
            ? `<div style="margin-bottom: 6px;"><span style="background: #fff3cd; color: #856404; padding: 4px 8px; border-radius: 6px; font-size: 11px; font-weight: bold; border: 1px solid #ffeeba;"><i class="fa-solid fa-cubes"></i> ${totalSkusPedido} SKUs</span></div>` 
            : `<div style="margin-bottom: 6px;"><span style="background: #eef2f8; color: #666; padding: 4px 8px; border-radius: 6px; font-size: 11px; font-weight: bold; border: 1px solid #dde5f0;">0 SKUs</span></div>`;
        // ---------------------------------------------
        

        const btnCopy = `<button class="action-btn btn-copy" title="Copiar" onclick="copiarResumo(event, this)"><i class="fa-regular fa-copy"></i></button>`;
        const btnEdit = temPermissao ? `<button class="action-btn btn-edit" title="Editar" onclick="abrirEdicao('${p.id}', '${criadorUid}', '${p.elementoIdOriginal}', ${isLegacy})"><i class="fa-solid fa-pen"></i></button>` : '';
        const btnCaixas = `<button class="action-btn btn-caixas" title="Caixas" onclick="abrirCaixas('${p.id}', '${isLegacy ? 'simples' : 'multi'}', '${criadorUid}', '${p.elementoIdOriginal}', '${p.romaneio || ''}')"><i class="fa-solid fa-boxes-stacked"></i></button>`;
        const btnDel = temPermissao ? `<button class="action-btn btn-del" title="Excluir" onclick="excluirPedido('${p.id}', '${isLegacy ? 'pedidos' : 'pedidosMultiDocumento'}', '${criadorUid}', '${p.elementoIdOriginal}')"><i class="fa-solid fa-trash"></i></button>` : '';
        const btnCheck = temPermissao ? `<button class="action-btn btn-check" title="${p.efetivado ? 'Desfazer' : 'Efetivar'}" onclick="toggleEfetivado('${p.id}', '${criadorUid}', '${p.elementoIdOriginal}', ${isLegacy})"><i class="fa-solid fa-check"></i></button>` : '';

        const mondayHtml = (isGlobalAdminMode) ? `
            <label class="monday-check-label" onclick="event.stopPropagation()" title="Verificação Monday">
                <input type="checkbox" ${p.mondayVerified ? 'checked' : ''} onchange="toggleMonday('${p.id}', '${criadorUid}', '${p.elementoIdOriginal}', this)"> 
                <i class="fa-solid fa-clipboard-check" style="font-size: 13px;"></i>
            </label>` : '';

        const criadorBadge = isGlobalAdminMode ? `<div style="font-size:10px; color:#888;"><i class="fa-regular fa-user"></i> ${(p.criadorEmail||'').split('@')[0]}</div>` : '';

        // --- CÁLCULO DA ETIQUETA DE TEMPO ---
        let tempoHtml = "";
        if (p.createdAt) {
            if (p.efetivado) {
                if (p.completedAt) {
                    const tempoTotal = calcularTempoDecorrido(p.createdAt.toMillis(), p.completedAt.toMillis());
                    tempoHtml = `<div style="font-size: 10px; color: #155724; margin-top: 6px; background: #d4edda; display: inline-block; padding: 3px 6px; border-radius: 4px; font-weight: bold;"><i class="fa-solid fa-stopwatch"></i> ${tempoTotal}</div>`;
                } else {
                    tempoHtml = `<div style="font-size: 10px; color: #666; margin-top: 6px; background: #eee; display: inline-block; padding: 3px 6px; border-radius: 4px; font-weight: bold;"><i class="fa-solid fa-check"></i> Finalizado</div>`;
                }
            } else {
                tempoHtml = `<div style="font-size: 10px; color: var(--secondary); margin-top: 6px; background: #fff3cd; display: inline-block; padding: 3px 6px; border-radius: 4px; font-weight: bold;" class="live-timer" data-start="${p.createdAt.toMillis()}"><i class="fa-solid fa-clock fa-spin"></i> <span>Calculando...</span></div>`;
            }
        }

        tr.innerHTML = `
            <td>
                <strong>${p.romaneio || '---'}</strong> ${criadorBadge}
                <div>${tempoHtml}</div>
            </td>
            <td>${p.loja || '---'}</td>
            <td>${p.local || 'DF'}</td>
            <td>${docsHtml}</td>
            <td style="font-size:12px; color:#666; max-width:200px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${p.observacoes || ''}</td>
            <td style="font-size:11px;">
                ${badgeSkus}
                <div class="texto-resumo-caixas">${resumoCaixas}</div>
            </td>
            <td style="text-align:right; white-space:nowrap;">
                ${mondayHtml}
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

function calcularResumoCaixasStr(caixas) {
    if (!caixas || caixas.length === 0) return '<span style="color:#ccc;">Sem caixas</span>';
    const grupos = {};
    caixas.forEach(cx => {
        let nomeRaw = (cx.num || "S/N").toString().trim();
        let nForm = /^\d+$/.test(nomeRaw) ? `CAIXA ${nomeRaw}` : (/^cx/i.test(nomeRaw) ? nomeRaw.replace(/^cx\s*/i, 'CAIXA ').toUpperCase() : nomeRaw.toUpperCase());
        const key = `${nForm}|${!!cx.isBonificacao}`;
        if (!grupos[key]) grupos[key] = { nome: nForm, isBonus: !!cx.isBonificacao, pesoTotal: 0, qtdVolumes: 0 };
        grupos[key].pesoTotal += parseFloat(cx.peso || 0);
        grupos[key].qtdVolumes += 1;
    });

    return Object.values(grupos).sort((a, b) => a.isBonus - b.isBonus || (parseInt(a.nome.replace(/\D/g, ''))||0) - (parseInt(b.nome.replace(/\D/g, ''))||0)).map(item => {
        const sty = item.isBonus ? `color:var(--secondary);` : '';
        return `<div style="margin-bottom:2px; ${sty}"><strong>${item.nome}${item.isBonus?' (Bonificação)':''}</strong> (${item.pesoTotal.toFixed(2)} kg): ${item.qtdVolumes} Un</div>`;
    }).join('');
}


// =========================================================================
// 4. AÇÕES DE FORMULÁRIO E MÚLTIPLOS RESPONSÁVEIS
// =========================================================================
let uidToEmailMapReverso = {};
window.usersOptionsHtml = ""; 

const addMultiRowBtn = document.getElementById('addMultiRowBtn');
if(addMultiRowBtn) {
    addMultiRowBtn.addEventListener('click', async () => {
        editingId = null;
        documentosTemporarios = [];
        limparFormMulti();
        renderizarDocsTemp();
        document.getElementById('multiPopupTitle').innerHTML = '<i class="fa-solid fa-file-invoice"></i> Novo Pedido';
        
        resetarResponsaveis();

        if(isGlobalAdminMode) {
            if(adminAssignGroup) adminAssignGroup.style.display = 'block';
            await popularSelectUsuarios('admTargetUser');
        } else {
            if(adminAssignGroup) adminAssignGroup.style.display = 'none';
        }

        if(multiPopupOverlay) multiPopupOverlay.style.display = 'flex';
        if(multiRomaneio) multiRomaneio.focus();
    });
}

function resetarResponsaveis() {
    const container = document.getElementById('responsaveisContainer');
    if(!container) return;
    container.innerHTML = `
        <div class="responsavel-row" style="display: flex; gap: 5px; align-items: center;">
            <select class="multiDocResponsavel" style="flex: 1; padding: 10px; font-size: 13px; border-radius: 8px;">
                ${window.usersOptionsHtml}
            </select>
            <button type="button" title="Adicionar outro responsável" onclick="addResponsavelRow()" style="background: #fff; border: 1px solid #ddd; border-radius: 8px; width: 35px; height: 35px; cursor: pointer; color: var(--secondary); display: flex; align-items: center; justify-content: center; transition: 0.2s;">
                <i class="fa-solid fa-plus"></i>
            </button>
        </div>
    `;
    const sel = document.querySelector('.multiDocResponsavel');
    if(sel && currentUser && currentUser.email) sel.value = currentUser.email.trim().toLowerCase();
}

window.addResponsavelRow = function() {
    const row = document.createElement('div');
    row.className = 'responsavel-row';
    row.style.cssText = "display: flex; gap: 5px; align-items: center;";
    row.innerHTML = `
        <select class="multiDocResponsavel" style="flex: 1; padding: 10px; font-size: 13px; border-radius: 8px;">
            <option value="">Selecione...</option>
            ${window.usersOptionsHtml}
        </select>
        <button type="button" title="Remover" onclick="this.parentElement.remove()" style="background: #fff; border: 1px solid #ddd; border-radius: 8px; width: 35px; height: 35px; cursor: pointer; color: #dc3545; display: flex; align-items: center; justify-content: center; transition: 0.2s;">
            <i class="fa-solid fa-minus"></i>
        </button>
    `;
    document.getElementById('responsaveisContainer').appendChild(row);
}

const admTargetUserSelect = document.getElementById('admTargetUser');
if(admTargetUserSelect) {
    admTargetUserSelect.addEventListener('change', function() {
        if(this.value) {
            carregarElementosParaSelect(this.value, 'admTargetElement');
            const emailDoDono = uidToEmailMapReverso[this.value];
            if(emailDoDono) {
                const mainSelect = document.querySelector('.multiDocResponsavel');
                if(mainSelect) mainSelect.value = emailDoDono;
            }
        }
    });
}

const addDocumentoBtn = document.getElementById('addDocumentoBtn');
if(addDocumentoBtn) {
    addDocumentoBtn.addEventListener('click', () => {
        const selects = document.querySelectorAll('.multiDocResponsavel');
        let respArray = [];
        
        selects.forEach(s => {
            const val = s.value.trim();
            if(val && !respArray.includes(val)) respArray.push(val);
        });
        
        if(respArray.length === 0) return alert("Erro: Selecione ao menos um responsável.");
        
        documentosTemporarios.push({
            idTemp: Date.now(),
            tipo: document.getElementById('multiDocTipo').value,
            responsaveis: respArray, 
            responsavel: respArray[0], 
            caixas: []
        });
        
        renderizarDocsTemp();
        resetarResponsaveis(); 
    });
}

function renderizarDocsTemp() {
    if(!documentosContainer) return;
    documentosContainer.innerHTML = "";
    documentosTemporarios.forEach(doc => {
        const div = document.createElement('div');
        div.style.cssText = "display:flex; justify-content:space-between; background:#fff; padding:8px; border:1px solid #eee; border-radius:6px; margin-bottom:5px; align-items:center; font-size:13px;";
        const respText = doc.responsaveis ? doc.responsaveis.join(', ') : doc.responsavel;
        div.innerHTML = `<span><strong style="color:var(--primary);">${doc.tipo}</strong> - ${respText}</span><i class="fa-solid fa-trash" style="color:#dc3545; cursor:pointer;" onclick="removerDocTemp(${doc.idTemp})"></i>`;
        documentosContainer.appendChild(div);
    });
}

window.removerDocTemp = function(id) {
    documentosTemporarios = documentosTemporarios.filter(d => d.idTemp !== id);
    renderizarDocsTemp();
}

async function carregarUsuarios() {
    emailToUidMap = {};
    uidToEmailMapReverso = {}; 
    window.usersOptionsHtml = ""; 
    
    const snap = await db.collection("usuarios").get();
    let userList = [];
    snap.forEach(doc => { if(doc.data().email) userList.push({ uid: doc.id, email: doc.data().email }); });
    userList.sort((a,b) => a.email.localeCompare(b.email));
    
    userList.forEach(u => {
        const emailL = u.email.trim().toLowerCase();
        emailToUidMap[emailL] = u.uid;
        uidToEmailMapReverso[u.uid] = emailL;
        window.usersOptionsHtml += `<option value="${emailL}">${emailL.split('@')[0]}</option>`;
    });
}

const multiSaveBtn = document.getElementById('multiSaveBtn');
if(multiSaveBtn) {
    multiSaveBtn.addEventListener('click', async () => {
        if(!multiRomaneio.value) return alert("Informe o Romaneio");
        if(documentosTemporarios.length === 0) return alert("Adicione pelo menos um documento");

        let ownerUid = currentUser.uid;
        let targetElementId = elementoId;
        let criadorEmail = currentUser.email;
        let targetElementTitle = elementoAtualTitulo; // Pega o nome real da pasta

        // Lógica de Atribuição do ADM
        if(isGlobalAdminMode && !editingId) {
            ownerUid = document.getElementById('admTargetUser').value;
            targetElementId = document.getElementById('admTargetElement').value;
            criadorEmail = uidToEmailMapReverso[ownerUid] || ownerUid;
            
            // Pega o nome da pasta selecionada no dropdown do ADM
            const selElem = document.getElementById('admTargetElement');
            if(selElem.selectedIndex >= 0) {
                targetElementTitle = selElem.options[selElem.selectedIndex].text;
            }
            
            if(!ownerUid || !targetElementId) return alert("Selecione para qual usuário/projeto este pedido vai!");
        }

        // Junta todos os emails de responsáveis
        let todosResponsaveis = [];
        documentosTemporarios.forEach(d => {
            if(d.responsaveis) todosResponsaveis.push(...d.responsaveis);
            else if(d.responsavel) todosResponsaveis.push(d.responsavel);
        });
        
        const responsaveisUnicos = [...new Set(todosResponsaveis)];
        if(!responsaveisUnicos.includes(criadorEmail)) responsaveisUnicos.push(criadorEmail); 
        const uidsVinculados = responsaveisUnicos.map(email => emailToUidMap[email.trim().toLowerCase()]).filter(Boolean);

        const data = {
            romaneio: multiRomaneio.value,
            loja: multiLoja?.value || '',
            local: multiLocal?.value || 'DF',
            uf: multiUf?.value || '',
            observacoes: multiObservacoes?.value || '',
            documentos: documentosTemporarios.map(({idTemp, ...rest}) => rest),
            uidsVinculados: uidsVinculados
        };

        try {
            multiSaveBtn.textContent = "Salvando...";
            
            if(editingId) {
                // EDIÇÃO DE PEDIDO EXISTENTE
                const actualOwnerUid = pedidoAtualCriadorUid;
                const actualElementId = pedidoAtualElementoId;
                
                let editElementTitle = targetElementTitle;
                if (isGlobalAdminMode) {
                    const snapEl = await db.collection("usuarios").doc(actualOwnerUid).collection("elementos").doc(actualElementId).get();
                    if (snapEl.exists) editElementTitle = snapEl.data().titulo || "Desconhecido";
                }

                const ref = db.collection("usuarios").doc(actualOwnerUid).collection("elementos").doc(actualElementId).collection("pedidosMultiDocumento").doc(editingId);
                await ref.update(data);
                registrarLog("Edição de Pedido", "alerta", `Romaneio ${data.romaneio} editado.`);

                // Cria/Atualiza atalhos para todos os responsáveis (Mesmo se adicionados depois)
                const batch = db.batch();
                uidsVinculados.forEach(uid => {
                    if(uid === actualOwnerUid) return;
                    const shareRef = db.collection("usuarios").doc(uid).collection("pedidosCompartilhadosComigo").doc(editingId);
                    batch.set(shareRef, { 
                        criadorUid: actualOwnerUid, 
                        pedidoId: editingId, 
                        elementoId: actualElementId, 
                        elementoTitulo: editElementTitle 
                    }, { merge: true });
                });
                await batch.commit();

            } else {
                // CRIAÇÃO DE UM NOVO PEDIDO
                data.criadorUid = ownerUid;
                data.criadorEmail = criadorEmail;
                data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                data.efetivado = false;
                
                const ref = db.collection("usuarios").doc(ownerUid).collection("elementos").doc(targetElementId).collection("pedidosMultiDocumento");
                const docRef = await ref.add(data);
                
                registrarLog("Criação de Pedido", "sucesso", `Romaneio ${data.romaneio} criado.`);

                // Cria atalhos para os responsáveis adicionais
                const batch = db.batch();
                uidsVinculados.forEach(uid => {
                    if(uid === ownerUid) return;
                    const shareRef = db.collection("usuarios").doc(uid).collection("pedidosCompartilhadosComigo").doc(docRef.id);
                    batch.set(shareRef, { 
                        criadorUid: ownerUid, 
                        pedidoId: docRef.id, 
                        elementoId: targetElementId, 
                        elementoTitulo: targetElementTitle // AGORA SALVA O NOME REAL DA PASTA!
                    });
                });
                await batch.commit();
            }
            fecharModal(multiPopupOverlay);
        } catch(e) { alert("Erro: " + e.message); } 
        finally { multiSaveBtn.textContent = "Salvar Pedido"; }
    });
}


window.abrirEdicao = async function(id, criadorUid, elemIdOriginal, isLegacy) {
    if(isLegacy) return alert("Pedidos legados não podem ser editados. Recrie no novo formato."); 
    
    const docSnap = await db.collection("usuarios").doc(criadorUid).collection("elementos").doc(elemIdOriginal).collection("pedidosMultiDocumento").doc(id).get();
    if(!docSnap.exists) return;

    const d = docSnap.data();
    editingId = id;
    pedidoAtualCriadorUid = criadorUid;
    pedidoAtualElementoId = elemIdOriginal;

    if(adminAssignGroup) adminAssignGroup.style.display = 'none'; 

    if(multiRomaneio) multiRomaneio.value = d.romaneio || '';
    if(multiLoja) multiLoja.value = d.loja || '';
    if(multiLocal) multiLocal.value = d.local || 'DF';
    if(multiUf) multiUf.value = d.uf || '';
    if(multiObservacoes) multiObservacoes.value = d.observacoes || '';
    
    documentosTemporarios = (d.documentos || []).map((doc, i) => ({ ...doc, idTemp: i }));
    renderizarDocsTemp();

    document.getElementById('multiPopupTitle').innerHTML = '<i class="fa-solid fa-pen-to-square"></i> Editar Pedido';
    if(multiPopupOverlay) multiPopupOverlay.style.display = 'flex';
}

window.toggleEfetivado = async function(id, criadorUid, elemIdOriginal, isLegacy) {
    const coll = isLegacy ? 'pedidos' : 'pedidosMultiDocumento';
    const ref = db.collection("usuarios").doc(criadorUid).collection("elementos").doc(elemIdOriginal).collection(coll).doc(id);
    
    const snap = await ref.get();
    if(snap.exists) {
        const novoStatus = !snap.data().efetivado;
        const updateData = { efetivado: novoStatus };
        if(novoStatus) {
            updateData.completedAt = firebase.firestore.FieldValue.serverTimestamp();
            registrarLog("Finalização", "sucesso", `Pedido efetivado.`);
        } else {
             updateData.completedAt = firebase.firestore.FieldValue.delete();
             registrarLog("Reabertura", "alerta", `Pedido reaberto.`);
        }
        await ref.update(updateData);
    }
}

window.toggleMonday = async function(id, criadorUid, elemIdOriginal, checkbox) {
    const ref = db.collection("usuarios").doc(criadorUid).collection("elementos").doc(elemIdOriginal).collection("pedidosMultiDocumento").doc(id);
    try { await ref.update({ mondayVerified: checkbox.checked }); } 
    catch(e) { alert("Erro Monday"); checkbox.checked = !checkbox.checked; }
}

window.excluirPedido = async function(id, coll, criadorUid, elemIdOriginal) {
    if(!confirm("Tem certeza que deseja excluir este pedido de forma permanente?")) return;
    await db.collection("usuarios").doc(criadorUid).collection("elementos").doc(elemIdOriginal).collection(coll).doc(id).delete();
    registrarLog("Exclusão", "perigo", `Pedido removido.`);
}


// =========================================================================
// 5. CAIXAS E IMPORTAÇÃO
// =========================================================================

window.abrirCaixas = async function(id, tipo, criadorUid, elemIdOriginal, romaneioNum) {
    pedidoAtualId = id; pedidoAtualTipo = tipo;
    pedidoAtualCriadorUid = criadorUid; pedidoAtualElementoId = elemIdOriginal;
    const title = document.getElementById('caixasPopupTitle');
    if(title) title.innerHTML = `<i class="fa-solid fa-boxes-stacked"></i> Caixas do Pedido <span style="font-weight:300; color:#999; margin-left:10px;">${romaneioNum || ''}</span>`;
    if(caixasPopup) caixasPopup.style.display = 'flex';
    await renderizarGridCaixas();
}

async function renderizarGridCaixas() {
    const container = document.getElementById('listaCaixasContainer');
    if(!container) return;
    container.innerHTML = '<div style="text-align:center; width:100%;"><i class="fa-solid fa-spinner fa-spin"></i> Carregando...</div>';

    const coll = pedidoAtualTipo === 'simples' ? 'pedidos' : 'pedidosMultiDocumento';
    const docSnap = await db.collection("usuarios").doc(pedidoAtualCriadorUid).collection("elementos").doc(pedidoAtualElementoId).collection(coll).doc(pedidoAtualId).get();
    
    if(!docSnap.exists) return;
    let dados = pedidoAtualTipo === 'simples' ? transformarSimplesEmMulti(docSnap) : docSnap.data();
    
    const temPermissao = isAdmin || (dados.uidsVinculados && dados.uidsVinculados.includes(currentUser.uid)) || (dados.criadorUid === currentUser.uid);
    container.innerHTML = "";

    (dados.documentos || []).forEach((doc, index) => {
        const section = document.createElement('div');
        section.className = 'doc-section';

        let caixasHtml = '';
        (doc.caixas || []).forEach((cx, cxIndex) => {
            const icon = cx.isBonificacao ? '<i class="fa-solid fa-star" style="color:var(--secondary)"></i>' : '<i class="fa-regular fa-star"></i>';
            const temProdutos = cx.produtos && cx.produtos.length > 0;
            const produtosList = temProdutos ? cx.produtos.map(p => `<tr><td>${p.referencia}</td><td>${p.descricao}</td><td style="text-align:right;">${p.quantidade || 1}</td></tr>`).join('') : '<tr><td colspan="3" style="text-align:center; color:#999;">Caixa Manual</td></tr>';

            caixasHtml += `
                <div class="caixa-item ${temProdutos ? '' : 'manual'}">
                    <div class="caixa-header" onclick="this.parentElement.classList.toggle('open')">
                        <div style="display:flex; align-items:center; gap:10px;">
                            <span class="bonificacao-star" onclick="event.stopPropagation(); toggleBonus(${index}, ${cxIndex})">${icon}</span>
                            <strong>${cx.num || 'CX ?'}</strong> 
                            <span style="color:#666; font-weight:400;">(${cx.peso} kg)</span>
                        </div>
                        ${temPermissao ? `<i class="fa-solid fa-trash" style="color:#dc3545;" onclick="event.stopPropagation(); excluirCaixa(${index}, ${cxIndex})"></i>` : ''}
                    </div>
                    <div class="caixa-body"><table style="width:100%; font-size:11px;"><thead style="background:#eee;"><tr><th>Ref</th><th>Desc</th><th style="text-align:right;">Qtd</th></tr></thead><tbody>${produtosList}</tbody></table></div>
                </div>`;
        });

        if(!caixasHtml) caixasHtml = '<p style="text-align:center; color:#ccc; font-style:italic;">Nenhuma caixa.</p>';
        const respText = doc.responsaveis ? doc.responsaveis.join(', ') : doc.responsavel;

        const acoesHtml = temPermissao ? `
            <div class="import-area">
                <label class="import-label" for="csvFile-${index}"><i class="fa-solid fa-file-csv"></i> Importar CSV (Substituir)</label>
                <input type="file" id="csvFile-${index}" accept=".csv" style="display:none;" onchange="processarCSV(this, ${index})">
                <div id="fileName-${index}" class="file-status">${doc.arquivoCsv ? 'Arquivo: ' + doc.arquivoCsv : ''}</div>
            </div>
            <button class="btn-add-manual" onclick="abrirModalAddCaixa(${index})">+ Caixa Manual</button>
        ` : '';

        section.innerHTML = `
            <div class="doc-header">
                <h4>${doc.tipo} <small style="color:#999;">(${respText})</small></h4>
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
    if(addCaixaModal) addCaixaModal.style.display = 'flex'; 
    document.getElementById('numCaixa').focus(); 
}

const addCaixaBtn = document.getElementById('addCaixaBtn');
if(addCaixaBtn) {
    addCaixaBtn.addEventListener('click', async () => {
        const num = document.getElementById('numCaixa').value;
        const peso = document.getElementById('pesoCaixa').value;
        const qtd = parseInt(document.getElementById('quantidadeCaixa').value) || 1;
        if(!num || !peso) return alert("Preencha número e peso");
        const novas = Array(qtd).fill().map(() => ({ num: num, peso: parseFloat(peso.replace(',','.')) || 0, produtos: [], isBonificacao: false }));
        await salvarNovasCaixas(novas, caixaDocIndexAtual);
        registrarLog("Adição de Caixa", "info", `Caixa ${num} adicionada.`);
        fecharModal(addCaixaModal);
    });
}

async function salvarNovasCaixas(novasCaixas, docIndex, arquivoNome = null) {
    const coll = pedidoAtualTipo === 'simples' ? 'pedidos' : 'pedidosMultiDocumento';
    const ref = db.collection("usuarios").doc(pedidoAtualCriadorUid).collection("elementos").doc(pedidoAtualElementoId).collection(coll).doc(pedidoAtualId);
    try {
        const docSnap = await ref.get();
        let data = docSnap.data();
        let updateData = {}; let documentosAtualizados = [];

        if (pedidoAtualTipo === 'simples') {
            if (arquivoNome) updateData = { caixas: novasCaixas, arquivoCsv: arquivoNome };
            else updateData = { caixas: [...(data.caixas || []), ...novasCaixas] };
        } else {
            let documentos = data.documentos || [];
            if (arquivoNome) { documentos[docIndex].caixas = novasCaixas; documentos[docIndex].arquivoCsv = arquivoNome; } 
            else { documentos[docIndex].caixas = [...(documentos[docIndex].caixas || []), ...novasCaixas]; }
            updateData = { documentos: documentos };
            documentosAtualizados = documentos;
        }

        if(pedidoAtualTipo !== 'simples' && documentosAtualizados.length > 0) {
            const todosComCsv = documentosAtualizados.every(d => d.arquivoCsv && d.arquivoCsv.length > 0);
            if(todosComCsv && !data.efetivado) { updateData.efetivado = true; updateData.completedAt = firebase.firestore.FieldValue.serverTimestamp(); registrarLog("Auto-Finalização", "sucesso", "Todos docs possuem CSV."); }
        }
        await ref.update(updateData);
        await renderizarGridCaixas(); 
    } catch (error) { alert("Erro ao salvar caixa."); }
}

window.excluirCaixa = async function(docIndex, cxIndex) {
    if(!confirm("Excluir caixa?")) return;
    const ref = db.collection("usuarios").doc(pedidoAtualCriadorUid).collection("elementos").doc(pedidoAtualElementoId).collection(pedidoAtualTipo==='simples'?'pedidos':'pedidosMultiDocumento').doc(pedidoAtualId);
    const doc = await ref.get(); let data = doc.data();
    if(pedidoAtualTipo === 'simples') { data.caixas.splice(cxIndex, 1); await ref.update({ caixas: data.caixas }); } 
    else { data.documentos[docIndex].caixas.splice(cxIndex, 1); await ref.update({ documentos: data.documentos }); }
    await renderizarGridCaixas();
}
window.toggleBonus = async function(docIndex, cxIndex) {
    const ref = db.collection("usuarios").doc(pedidoAtualCriadorUid).collection("elementos").doc(pedidoAtualElementoId).collection(pedidoAtualTipo==='simples'?'pedidos':'pedidosMultiDocumento').doc(pedidoAtualId);
    const doc = await ref.get(); let data = doc.data();
    if(pedidoAtualTipo === 'simples') { data.caixas[cxIndex].isBonificacao = !data.caixas[cxIndex].isBonificacao; await ref.update({ caixas: data.caixas }); } 
    else { data.documentos[docIndex].caixas[cxIndex].isBonificacao = !data.documentos[docIndex].caixas[cxIndex].isBonificacao; await ref.update({ documentos: data.documentos }); }
    await renderizarGridCaixas();
}

// Variáveis temporárias para segurar os dados do CSV até a confirmação
let pendingCsvCaixas = [];
let pendingCsvDocIndex = null;
let pendingCsvFileName = "";

window.processarCSV = function(input, docIndex) {
    const file = input.files[0]; if (!file) return;
    document.body.style.cursor = 'wait';
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const text = e.target.result;
            const caixas = await parseCsvParaCaixas(text);
            
            if (caixas.length > 0) {
                // Conta os SKUs extraídos
                let totalSkus = 0;
                caixas.forEach(cx => {
                    (cx.produtos || []).forEach(p => totalSkus += (parseInt(p.quantidade) || 0));
                });

                // Guarda os dados na memória
                pendingCsvCaixas = caixas;
                pendingCsvDocIndex = docIndex;
                pendingCsvFileName = file.name;

                // Preenche o Modal de Confirmação
                document.getElementById('csvFileNameDisplay').textContent = file.name;
                document.getElementById('csvTotalCaixasDisplay').textContent = caixas.length;
                document.getElementById('csvTotalSkusDisplay').textContent = totalSkus;

                // Mostra o Modal
                const confirmModal = document.getElementById('confirmCsvModal');
                if (confirmModal) confirmModal.style.display = 'flex';

            } else alert("Nenhuma caixa válida encontrada no arquivo.");
        } catch (err) { alert("Erro no CSV: " + err.message); } 
        finally { document.body.style.cursor = 'default'; input.value = ''; }
    };
    reader.readAsText(file, 'ISO-8859-1');
}

// Botões do Modal de Confirmação de CSV
const cancelCsvBtn = document.getElementById('cancelCsvBtn');
if (cancelCsvBtn) {
    cancelCsvBtn.addEventListener('click', () => {
        fecharModal(document.getElementById('confirmCsvModal'));
        pendingCsvCaixas = []; // Limpa a memória
    });
}

const confirmCsvBtn = document.getElementById('confirmCsvBtn');
if (confirmCsvBtn) {
    confirmCsvBtn.addEventListener('click', async () => {
        if (pendingCsvCaixas.length > 0) {
            confirmCsvBtn.textContent = "Importando...";
            await salvarNovasCaixas(pendingCsvCaixas, pendingCsvDocIndex, pendingCsvFileName);
            registrarLog("Importação CSV", "info", `CSV importado.`);
            
            confirmCsvBtn.textContent = "Sim, Importar";
            fecharModal(document.getElementById('confirmCsvModal'));
            pendingCsvCaixas = [];
        }
    });
}

async function parseCsvParaCaixas(csvContent) {
    const linhas = csvContent.trim().split('\n');
    if(linhas.length < 2) return [];
    const cabecalho = linhas.shift().split(';').map(c => c.trim().replace(/"/g, ''));
    const map = {};
    linhas.forEach(l => {
        const cols = l.split(';');
        if(cols[cabecalho.indexOf("Estado Conferência")]?.trim() !== "EFETIVADO") return;
        const id = cols[cabecalho.indexOf("ID Embalagem Expedição")];
        if(!map[id]) map[id] = [];
        map[id].push({
            num: cols[cabecalho.indexOf("Descrição Tipo Embalagem Expedição")],
            peso: parseFloat(cols[cabecalho.indexOf("Peso Embalagem")]?.replace(',','.')) || 0,
            ref: cols[cabecalho.indexOf("Produto")],
            desc: cols[cabecalho.indexOf("Descrição Produto")],
            qtd: cols[cabecalho.indexOf("Quantidade")]
        });
    });
    return Object.keys(map).map(id => {
        const prods = map[id];
        return { num: prods[0].num, peso: prods[0].peso, isBonificacao: false, produtos: prods.map(p => ({ referencia: p.ref, descricao: p.desc, quantidade: p.qtd })) };
    });
}

// =========================================================================
// 6. UTILITÁRIOS: ORDENS, SELECTS, COPIAR
// =========================================================================

const abrirOrdensBtn = document.getElementById('abrirOrdensBtn');
if(abrirOrdensBtn) {
    abrirOrdensBtn.addEventListener('click', async () => { 
        if(popupOrdens) popupOrdens.style.display = 'flex'; 
        document.getElementById('inputOrdem').focus(); 
        
        // Se for Admin Global, abre as atribuições E MOSTRA a lista global
        if(isGlobalAdminMode) {
            document.getElementById('adminAssignOrdemGroup').style.display = 'block';
            document.getElementById('listaOrdens').style.display = 'block'; // <--- Agora fica visível!
            await popularSelectUsuarios('admOrdemUser');
            renderOrdensAdmin(); // Chama a função para preencher a lista
        } else {
            document.getElementById('adminAssignOrdemGroup').style.display = 'none';
            document.getElementById('listaOrdens').style.display = 'block';
            carregarOrdensPessoais();
        }
    });
}

// Quando o Admin mudar de usuário na Ordem, carrega as pastas correspondentes
const admOrdemUserSelect = document.getElementById('admOrdemUser');
if(admOrdemUserSelect) {
    admOrdemUserSelect.addEventListener('change', function() {
        if(this.value) carregarElementosParaSelect(this.value, 'admOrdemElement');
    });
}

const salvarOrdemBtn = document.getElementById('salvarOrdemBtn');
if(salvarOrdemBtn) {
    salvarOrdemBtn.addEventListener('click', async () => {
        const val = document.getElementById('inputOrdem').value; if(!val) return;
        
        let targetUid = currentUser.uid;
        let targetElementId = elementoId;

        if(isGlobalAdminMode) {
            targetUid = document.getElementById('admOrdemUser').value;
            targetElementId = document.getElementById('admOrdemElement').value;
            if(!targetUid || !targetElementId) return alert("Selecione usuário e projeto!");
        }
        
        try {
            salvarOrdemBtn.textContent = "...";
            await db.collection("usuarios").doc(targetUid).collection("elementos").doc(targetElementId).collection("ordens").add({ 
                romaneio: val, 
                createdAt: firebase.firestore.FieldValue.serverTimestamp() 
            });
            
            registrarLog("Criação Ordem", "sucesso", `Ordem ${val} criada.`);
            document.getElementById('inputOrdem').value = ""; 
            
            if(isGlobalAdminMode) {
                alert("Ordem atribuída com sucesso!");
            } else {
                carregarOrdensPessoais();
            }
        } catch (e) {
            alert("Erro ao salvar: " + e.message);
        } finally {
            salvarOrdemBtn.textContent = "Add";
        }
    });
}

async function carregarOrdensPessoais() {
    const ul = document.getElementById('listaOrdens'); 
    if(!ul) return;
    ul.innerHTML = "Carregando...";
    const snap = await db.collection("usuarios").doc(currentUser.uid).collection("elementos").doc(elementoId).collection("ordens").orderBy("createdAt", "desc").get();
    ul.innerHTML = "";
    snap.forEach(doc => {
        const li = document.createElement('li');
        li.style.cssText = "display:flex; justify-content:space-between; align-items:center; padding:10px; border-bottom:1px solid #eee; background:#f8f9fa; margin-bottom:5px; border-radius:6px;";
        li.innerHTML = `
            <span><strong style="color:var(--primary)"><i class="fa-solid fa-clipboard-list"></i> ${doc.data().romaneio}</strong></span>
            <i class="fa-solid fa-trash" style="color:#dc3545; cursor:pointer; padding:5px; font-size:14px; transition:0.2s;" title="Excluir Ordem" onmouseover="this.style.transform='scale(1.2)'" onmouseout="this.style.transform='scale(1)'" onclick="excluirOrdem('${doc.id}')"></i>
        `;
        ul.appendChild(li);
    });
}

window.excluirOrdem = async function(id) {
    if(confirm("Excluir ordem?")) {
        await db.collection("usuarios").doc(currentUser.uid).collection("elementos").doc(elementoId).collection("ordens").doc(id).delete();
        registrarLog("Exclusão Ordem", "alerta", "Ordem removida.");
        carregarOrdensPessoais();
    }
}

window.excluirOrdemAdmin = async function(id, criadorUid, elemId) {
    if(confirm("Tem certeza que deseja excluir esta ordem?")) {
        try {
            await db.collection("usuarios").doc(criadorUid).collection("elementos").doc(elemId).collection("ordens").doc(id).delete();
            registrarLog("Exclusão Ordem", "alerta", `Ordem excluída pelo Admin.`);
        } catch (error) {
            alert("Erro ao excluir ordem: " + error.message);
        }
    }
}

window.copiarResumo = function(event, btn) {
    event.stopPropagation();
    
    // Busca a linha inteira onde o botão foi clicado
    const row = btn.closest('tr');
    
    // Procura apenas o texto das caixas, ignorando a div dos SKUs
    const containerCaixas = row.querySelector('.texto-resumo-caixas');
    const textoParaCopiar = containerCaixas ? containerCaixas.innerText : '';

    navigator.clipboard.writeText(textoParaCopiar).then(() => {
        const iconeOriginal = btn.innerHTML; 
        btn.innerHTML = '<i class="fa-solid fa-check"></i>'; 
        btn.style.background = '#d4edda'; 
        btn.style.color = '#155724';
        
        setTimeout(() => { 
            btn.innerHTML = iconeOriginal; 
            btn.style.background = ''; 
            btn.style.color = ''; 
        }, 1500);
    });
}

function limparFormMulti() { 
    if(multiRomaneio) multiRomaneio.value = ""; 
    if(multiLoja) multiLoja.value = ""; 
    if(multiLocal) multiLocal.value = "DF"; 
    if(multiUf) multiUf.value = ""; 
    if(multiObservacoes) multiObservacoes.value = ""; 
}

function ocultarLoader() { setTimeout(() => { pageLoader.classList.add('loader-hidden'); appContent.classList.add('content-visible'); document.body.classList.remove('loading-active'); }, 500); }

async function popularSelectUsuarios(selectId) {
    const select = document.getElementById(selectId);
    if(!select) return;
    select.innerHTML = '<option value="">Carregando...</option>';
    const snap = await db.collection('usuarios').get();
    select.innerHTML = '<option value="">Selecione o dono do pedido...</option>';
    let uList = [];
    snap.forEach(doc => { if(doc.data().email) uList.push({ uid: doc.id, email: doc.data().email }); });
    uList.sort((a,b) => a.email.localeCompare(b.email));
    uList.forEach(u => { const opt = document.createElement('option'); opt.value = u.uid; opt.textContent = u.email; select.appendChild(opt); });
}

async function carregarElementosParaSelect(uid, selectId) {
    const select = document.getElementById(selectId);
    if(!select) return;
    select.innerHTML = '<option value="">Carregando projetos...</option>'; select.disabled = true;
    const snap = await db.collection('usuarios').doc(uid).collection('elementos').get();
    select.innerHTML = '';
    if (snap.empty) { select.innerHTML = '<option value="">Sem projetos criados</option>'; return; }
    let lista = [];
    snap.forEach(doc => { lista.push({ id: doc.id, ...doc.data() }); });
    lista.sort((a, b) => (b.createdAt?.toMillis()||0) - (a.createdAt?.toMillis()||0));
    lista.forEach(e => { const opt = document.createElement('option'); opt.value = e.id; opt.textContent = e.titulo || e.id; select.appendChild(opt); });
    select.disabled = false;
    if (select.options.length > 0) select.selectedIndex = 0;
}

// ==========================================
// 7. CORREÇÃO DOS BOTÕES E MODAIS
// ==========================================
window.fecharModal = function(modalElement) {
    if(modalElement) modalElement.style.display = 'none';
}

if(logoutBtn) {
    logoutBtn.addEventListener('click', () => {
        if(logoutConfirmModal) logoutConfirmModal.style.display = 'flex';
    });
}

document.getElementById('cancelLogoutBtn')?.addEventListener('click', () => fecharModal(logoutConfirmModal));
document.getElementById('closeLogoutModal')?.addEventListener('click', () => fecharModal(logoutConfirmModal));
document.getElementById('fecharMultiBtn')?.addEventListener('click', () => fecharModal(multiPopupOverlay));
document.getElementById('fecharCaixasBtn')?.addEventListener('click', () => fecharModal(caixasPopup));
document.getElementById('fecharPopupOrdens')?.addEventListener('click', () => fecharModal(popupOrdens));
document.getElementById('multiCancelBtn')?.addEventListener('click', () => fecharModal(multiPopupOverlay));
document.getElementById('cancelAddCaixaBtn')?.addEventListener('click', () => fecharModal(addCaixaModal));

// Ação real de Logout
const confirmLogoutBtn = document.getElementById('confirmLogoutBtn');
if (confirmLogoutBtn) {
    confirmLogoutBtn.addEventListener('click', () => {
        fecharModal(logoutConfirmModal);
        
        // Efeito de transição na saída (opcional, deixa mais fluido)
        if(appContent) appContent.classList.remove('content-visible');
        
        setTimeout(() => {
            firebase.auth().signOut().then(() => {
                window.location.href = "index.html";
            }).catch((error) => {
                console.error("Erro ao sair: ", error);
            });
        }, 400);
    });
}
// Função para desligar ouvintes antigos do Firebase e evitar duplicação
function desativarListeners() {
    if (unsubscribers && unsubscribers.length > 0) {
        unsubscribers.forEach(unsub => unsub());
    }
    unsubscribers = [];
}

// Função para inicializar os contadores de tela com zero
function initDetalhes() { 
    return { 
        total: 0, 
        nf: 0, 
        bonif: 0, 
        minuta: 0, 
        caixas: 0, 
        caixasBonus: 0, 
        agrupado: {} 
    }; 
}

// ==========================================
// 8. DROPDOWN DE RANKING DIÁRIO (USUÁRIO)
// ==========================================

window.toggleRankingDropdown = function(e) {
    if(e) e.stopPropagation();
    const panel = document.getElementById('rankingDropdownPanel');
    if(!panel) return;
    
    panel.classList.toggle('show');
    
    if(panel.classList.contains('show')) {
        carregarRankingDiario();
    }
}

// Fechar painel se clicar fora dele
document.addEventListener('click', (e) => {
    const panel = document.getElementById('rankingDropdownPanel');
    const wrapper = document.querySelector('.ranking-dropdown-wrapper');
    if(panel && panel.classList.contains('show') && wrapper && !wrapper.contains(e.target)) {
        panel.classList.remove('show');
    }
});

async function carregarRankingDiario() {
    const skusContainer = document.getElementById('userSideSkus');
    const docsContainer = document.getElementById('userSideDocs');
    
    skusContainer.innerHTML = '<div style="text-align: center; color: #999; font-size: 12px; padding: 20px;"><i class="fa-solid fa-spinner fa-spin"></i> Calculando pontuações...</div>';
    docsContainer.innerHTML = '';

    // NOVO: Usa a máquina do tempo! Pega a data da pasta aberta.
    const targetDate = dataReferenciaRanking;
    const startOfDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 0, 0, 0);
    const endOfDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 23, 59, 59);
    
    // Atualiza o título do painel para mostrar que não é "Hoje" e sim a data da pasta
    const dataFormatada = `${String(targetDate.getDate()).padStart(2, '0')}/${String(targetDate.getMonth() + 1).padStart(2, '0')}/${targetDate.getFullYear()}`;
    const headerTitle = document.querySelector('.ranking-panel-header h3');
    if (headerTitle) headerTitle.innerHTML = `<i class="fa-solid fa-trophy"></i> Desempenho Geral: ${dataFormatada}`;

    const startTs = firebase.firestore.Timestamp.fromDate(startOfDay);
    const endTs = firebase.firestore.Timestamp.fromDate(endOfDay);

    try {
        const [pedidosSnap, ordensSnap] = await Promise.all([
            db.collectionGroup('pedidosMultiDocumento').where('createdAt', '>=', startTs).where('createdAt', '<=', endTs).get(),
            db.collectionGroup('ordens').where('createdAt', '>=', startTs).where('createdAt', '<=', endTs).get()
        ]);

        const rankingMap = {};

        // Processa e Fraciona Pedidos
        pedidosSnap.forEach(doc => {
            const p = doc.data();
            (p.documentos || []).forEach(d => {
                if (d.tipo === 'Nota Fiscal' || d.tipo === 'Minuta') {
                    const arrResps = d.responsaveis && d.responsaveis.length > 0 ? d.responsaveis : (d.responsavel ? [d.responsavel] : []);
                    const divisoes = arrResps.length || 1;
                    
                    let totalSkus = 0;
                    (d.caixas || []).forEach(cx => {
                        (cx.produtos || []).forEach(prod => totalSkus += (parseInt(prod.quantidade) || 0));
                    });

                    arrResps.forEach(r => {
                        const emailKey = r.trim().toLowerCase();
                        if(!rankingMap[emailKey]) rankingMap[emailKey] = { docs: 0, skus: 0, nome: emailKey.split('@')[0] };
                        rankingMap[emailKey].docs += (1 / divisoes);
                        rankingMap[emailKey].skus += (totalSkus / divisoes);
                    });
                }
            });
        });

        // Processa Ordens
        ordensSnap.forEach(doc => {
            const criadorUid = doc.ref.path.split('/')[1];
            const userEmail = uidToEmailMapReverso[criadorUid]; 
            if (userEmail) {
                const emailKey = userEmail.trim().toLowerCase();
                if(!rankingMap[emailKey]) rankingMap[emailKey] = { docs: 0, skus: 0, nome: emailKey.split('@')[0] };
                rankingMap[emailKey].docs += 1;
                rankingMap[emailKey].skus += 100; // <--- AGORA CADA ORDEM VALE 100 PONTOS DE SKU
            }
        });

        const arrUsuarios = Object.values(rankingMap);

        // RENDERIZA SKUs (GRÁFICO)
        const sortedBySku = [...arrUsuarios].sort((a,b) => b.skus - a.skus);
        skusContainer.innerHTML = "";
        
        if(sortedBySku.length === 0 || sortedBySku[0].skus === 0) {
            skusContainer.innerHTML = "<p style='color:#999; font-size:12px; text-align:center;'>Nenhum SKU pontuado hoje.</p>";
        } else {
            const maxSku = sortedBySku[0].skus;
            sortedBySku.forEach((u) => {
                if (u.skus > 0) {
                    let pct = Math.max((u.skus / maxSku) * 100, 10);
                    const isMe = u.nome === currentUser.email.split('@')[0].toLowerCase();
                    const nomeStr = isMe ? `<strong style="color:var(--primary);">${u.nome.toUpperCase()} (Você)</strong>` : u.nome.toUpperCase();
                    
                    skusContainer.innerHTML += `
                        <div style="margin-bottom: 5px;">
                            <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:4px; color: #555;">
                                <span>${nomeStr}</span>
                                <span style="color:var(--secondary); font-weight:bold;">${u.skus.toFixed(1).replace('.0','')}</span>
                            </div>
                            <div style="background:#f0f0f0; height:10px; border-radius:5px; overflow:hidden;">
                                <div style="background:var(--secondary); height:100%; width:${pct}%; transition: width 1s ease-out;"></div>
                            </div>
                        </div>
                    `;
                }
            });
        }

        // RENDERIZA DOCS (LISTA RÁPIDA)
        const sortedByDocs = [...arrUsuarios].sort((a,b) => b.docs - a.docs);
        docsContainer.innerHTML = "";
        
        if(sortedByDocs.length === 0 || sortedByDocs[0].docs === 0) {
            docsContainer.innerHTML = "<p style='color:#999; font-size:12px; text-align:center;'>Nenhum documento processado.</p>";
        } else {
            sortedByDocs.forEach((u, index) => {
                if (u.docs > 0) {
                    let medal = '<i class="fa-solid fa-user" style="color: #ccc;"></i>';
                    if(index === 0) medal = '<i class="fa-solid fa-medal" style="color: #FFD700;"></i>';
                    else if(index === 1) medal = '<i class="fa-solid fa-medal" style="color: #C0C0C0;"></i>';
                    else if(index === 2) medal = '<i class="fa-solid fa-medal" style="color: #CD7F32;"></i>';

                    const isMe = u.nome === currentUser.email.split('@')[0].toLowerCase();
                    const bgClass = isMe ? 'background: #eef2f8; border-color: #dde5f0;' : 'background: #fff; border-color: #eee;';

                    docsContainer.innerHTML += `
                        <div style="padding: 10px 12px; ${bgClass} border-width: 1px; border-style: solid; border-radius:8px; display:flex; justify-content:space-between; align-items:center; font-size:13px;">
                            <span style="display:flex; align-items:center; gap:10px;">${medal} <span style="color: ${isMe ? 'var(--primary)' : '#555'}; font-weight: ${isMe ? 'bold' : 'normal'};">${u.nome.toUpperCase()}</span></span>
                            <span><strong>${u.docs.toFixed(1).replace('.0','')}</strong> <small style="color:#888;">Pontos</small></span>
                        </div>
                    `;
                }
            });
        }

    } catch (error) {
        skusContainer.innerHTML = `<div style="color: red; font-size: 11px;">Erro ao carregar ranking: ${error.message}</div>`;
    }
}

// Função à prova de falhas para pegar a data do pedido
function getSafeTimestamp(obj) {
    if (!obj || !obj.createdAt) return Date.now(); // Se for novo, ganha a data de AGORA (vai pro topo)
    if (typeof obj.createdAt.toMillis === 'function') return obj.createdAt.toMillis();
    if (obj.createdAt instanceof Date) return obj.createdAt.getTime();
    return obj.createdAt;
}