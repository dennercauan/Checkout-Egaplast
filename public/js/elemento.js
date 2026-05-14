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
    
    // NOVO: Carrega as caixas master em background para o cálculo do WMS
    const unsubMaster = db.collection('caixasMaster').onSnapshot(snap => {
        dadosCaixasMaster = [];
        snap.forEach(doc => dadosCaixasMaster.push({ id: doc.id, ...doc.data() }));
    });

    unsubscribers.push(unsubSimples, unsubMulti, unsubShared, unsubMaster);
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
            isCaixaMaster: document.getElementById('multiIsCaixaMaster')?.checked || false, // NOVO CAMPO
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
    if(document.getElementById('multiIsCaixaMaster')) document.getElementById('multiIsCaixaMaster').checked = d.isCaixaMaster || false; // NOVO
    
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

        if(!caixasHtml) caixasHtml = '<p style="text-align:center; color:#ccc; font-style:italic; padding:20px 0;">Nenhuma caixa efetivada ainda.</p>';
        const respText = doc.responsaveis ? doc.responsaveis.join(', ') : doc.responsavel;

        let acoesHtml = '';
        if (temPermissao) {
            if (dados.isCaixaMaster) {
                acoesHtml = `
                <div class="import-area" style="background:#fffbea; border-color:#ffeeba;">
                    <label class="import-label" for="wmsCsvFile-${index}" style="color:#856404; font-size:13px;"><i class="fa-solid fa-wand-magic-sparkles"></i> Abrir Planejamento de Caixas Master (CSV)</label>
                    <input type="file" id="wmsCsvFile-${index}" accept=".csv,.tsv,.txt" style="display:none;" onchange="processarWmsCSV(this, ${index})">
                    <div class="file-status" style="color:#856404;">Faça upload do CSV de SKUs do WMS para iniciar o painel.</div>
                </div>`;
            } else {
                acoesHtml = `
                <div class="import-area">
                    <label class="import-label" for="csvFile-${index}"><i class="fa-solid fa-file-csv"></i> Importar CSV de Caixas (Substituir)</label>
                    <input type="file" id="csvFile-${index}" accept=".csv" style="display:none;" onchange="processarCSV(this, ${index})">
                    <div id="fileName-${index}" class="file-status">${doc.arquivoCsv ? 'Arquivo: ' + doc.arquivoCsv : ''}</div>
                </div>
                <button class="btn-add-manual" onclick="abrirModalAddCaixa(${index})">+ Caixa Manual</button>`;
            }
        }

        // --- A ESTRUTURA MAGNÍFICA DAS DUAS CAIXAS ---
        section.innerHTML = `
            <div class="doc-header">
                <h4>${doc.tipo} <small style="color:#999;">(${respText})</small></h4>
            </div>
            ${acoesHtml}
            
            <div id="wms-panel-container-${index}" style="display:none; margin-bottom: 25px;"></div>
            
            <div id="caixas-list-container-${index}" style="border: 1px solid #ddd; border-radius: 12px; padding: 20px; background: #fdfdfd; box-shadow: 0 4px 10px rgba(0,0,0,0.03);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 15px; border-bottom: 2px solid #eee; padding-bottom: 10px;">
                    <h3 style="margin:0; color:var(--primary); font-size:18px;"><i class="fa-solid fa-cubes-stacked"></i> Caixas Efetivadas (Salvas no Banco)</h3>
                    <span style="background:var(--primary); color:#fff; padding:4px 10px; border-radius:20px; font-size:12px; font-weight:bold;">${doc.caixas ? doc.caixas.length : 0} Volume(s)</span>
                </div>
                <div style="max-height:40vh; overflow-y:auto; padding-right:5px;">
                    ${caixasHtml}
                </div>
            </div>
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
    if(document.getElementById('multiIsCaixaMaster')) document.getElementById('multiIsCaixaMaster').checked = false; // NOVO
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

// --- VARIÁVEIS GLOBAIS CAIXAS MASTER ---
let dadosCaixasMaster = [];
let produtoEditandoId = null; // Guarda o ID se for editar

// --- REFERÊNCIAS DO DOM ---
const modalMasterOverlay = document.getElementById('modalCaixasMasterOverlay');
const modalListaMaster = document.getElementById('modalListaMaster');
const modalVariacoesMaster = document.getElementById('modalVariacoesMaster');
const buscaRefMaster = document.getElementById('buscaRefMaster');
const adminMasterActions = document.getElementById('adminMasterActions');
const colunasAdmMaster = document.querySelectorAll('.coluna-adm-master');

// APAGUE A LINHA ANTIGA DO btnAbrirCaixasMaster SE ELA ESTIVER AQUI!

// --- CSS DAS ANIMAÇÕES (ATUALIZADO) ---
const styleAnimMaster = document.createElement('style');
styleAnimMaster.innerHTML = `
    @keyframes fadeInMaster { from { opacity: 0; } to { opacity: 1; } }
    @keyframes fadeOutMaster { from { opacity: 1; } to { opacity: 0; } }
    @keyframes popInMaster { 
        0% { opacity: 0; transform: scale(0.95) translateY(15px); } 
        100% { opacity: 1; transform: scale(1) translateY(0); } 
    }
    @keyframes popOutMaster { 
        0% { opacity: 1; transform: scale(1) translateY(0); } 
        100% { opacity: 0; transform: scale(0.95) translateY(15px); } 
    }
    .master-overlay-anim-in { animation: fadeInMaster 0.4s ease-out forwards; }
    .master-overlay-anim-out { animation: fadeOutMaster 0.4s ease-in forwards; }
    .master-box-anim-in { animation: popInMaster 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards; }
    .master-box-anim-out { animation: popOutMaster 0.4s ease-in forwards; }
    
    /* Efeito para a linha clicável */
    .tr-master-hover:hover { background-color: #f0f4f8 !important; transition: background 0.2s; }
`;
document.head.appendChild(styleAnimMaster);

// --- CRIAÇÃO AUTOMÁTICA DO BOTÃO E EVENT LISTENERS ---

// 1. Cria o botão dinamicamente (Agora sim, declarando apenas uma vez)
const btnAbrirCaixasMaster = document.createElement('button');
btnAbrirCaixasMaster.id = 'btnAbrirCaixasMaster';
btnAbrirCaixasMaster.title = 'Consultar Caixas Master';
btnAbrirCaixasMaster.style.cssText = 'background: var(--primary, #0d3269); color: white; border: none; padding: 8px 15px; border-radius: 6px; cursor: pointer; margin-right: 10px; font-weight: bold; font-size: 13px; display: inline-flex; align-items: center; gap: 8px; transition: 0.2s;';
btnAbrirCaixasMaster.innerHTML = '<i class="fa-solid fa-box-open"></i> Caixas Master';

// Efeito de hover básico
btnAbrirCaixasMaster.onmouseover = () => btnAbrirCaixasMaster.style.transform = 'scale(1.05)';
btnAbrirCaixasMaster.onmouseout = () => btnAbrirCaixasMaster.style.transform = 'scale(1)';

// 2. Tenta inserir do lado do botão "Ordens"
const btnOrdens = document.getElementById('abrirOrdensBtn');
if (btnOrdens && btnOrdens.parentElement) {
    btnOrdens.parentElement.insertBefore(btnAbrirCaixasMaster, btnOrdens);
} else {
    // Se não achar o botão "Ordens", insere do lado do botão "Voltar"
    const btnVoltar = document.getElementById('voltarBtn');
    if (btnVoltar && btnVoltar.parentElement) {
        btnVoltar.parentElement.insertBefore(btnAbrirCaixasMaster, btnVoltar);
    }
}


// Ação de busca
buscaRefMaster.addEventListener('keyup', (e) => {
    const termo = e.target.value.toLowerCase();
    const filtrados = dadosCaixasMaster.filter(p => p.ref.toLowerCase().includes(termo));
    renderizarTabelaMaster(filtrados);
});

buscaRefMaster.addEventListener('keyup', (e) => {
    const termo = e.target.value.toLowerCase();
    const filtrados = dadosCaixasMaster.filter(p => p.ref.toLowerCase().includes(termo));
    renderizarTabelaMaster(filtrados);
});

// =========================================================================
// SISTEMA MASTER: CORREÇÃO DE RENDERIZAÇÃO E TRANSIÇÕES RÁPIDAS
// =========================================================================

let masterTimer1 = null;

// Motor de Animação com Renderização Segura (10ms delay para o navegador respirar)
window.playAnimMaster = function(elemento, classeAnimacao) {
    elemento.classList.remove('master-overlay-anim-in', 'master-overlay-anim-out', 'master-box-anim-in', 'master-box-anim-out');
    setTimeout(() => {
        elemento.classList.add(classeAnimacao);
    }, 10);
}

// Botão do Header
const btnAbrirCaixasMasterRef = document.getElementById('btnAbrirCaixasMaster');
if(btnAbrirCaixasMasterRef) {
    const cloneBtn = btnAbrirCaixasMasterRef.cloneNode(true);
    btnAbrirCaixasMasterRef.parentNode.replaceChild(cloneBtn, btnAbrirCaixasMasterRef);
    
    cloneBtn.addEventListener('click', () => {
        clearTimeout(masterTimer1);
        
        modalMasterOverlay.style.display = 'flex';
        modalListaMaster.style.display = 'block';
        modalVariacoesMaster.style.display = 'none';

        playAnimMaster(modalMasterOverlay, 'master-overlay-anim-in');
        playAnimMaster(modalListaMaster, 'master-box-anim-in');
        
        if(isAdmin) {
            adminMasterActions.style.display = 'block';
            colunasAdmMaster.forEach(col => col.style.display = 'table-cell');
        }
        
        carregarDadosMaster();
        buscaRefMaster.focus();
    });
}

window.fecharModalMaster = function() {
    clearTimeout(masterTimer1);
    
    playAnimMaster(modalMasterOverlay, 'master-overlay-anim-out');
    
    if (modalListaMaster.style.display !== 'none') {
        playAnimMaster(modalListaMaster, 'master-box-anim-out');
    } else if (modalVariacoesMaster.style.display !== 'none') {
        playAnimMaster(modalVariacoesMaster, 'master-box-anim-out');
    }

    // Só tem delay para FECHAR o modal principal
    masterTimer1 = setTimeout(() => {
        modalMasterOverlay.style.display = 'none';
        buscaRefMaster.value = '';
    }, 380); 
}

// ==========================================
// NAVEGAÇÃO INTERNA RÁPIDA (O FIM DO BUG)
// ==========================================
window.abrirVariacoesMaster = function(produto) {
    document.getElementById('varProdNome').textContent = produto.nome;
    document.getElementById('varProdRef').textContent = produto.ref;
    
    const container = document.getElementById('cardsVariacoesContainer');
    container.innerHTML = '';
    
    if(!produto.variacoes || produto.variacoes.length === 0) {
        container.innerHTML = '<p style="color:#999;">Nenhuma variação cadastrada para este produto.</p>';
    } else {
        produto.variacoes.forEach(vr => {
            const card = document.createElement('div');
            card.style.cssText = "background:#fff; border-radius:12px; padding:20px; width:220px; text-align:center; box-shadow:0 4px 10px rgba(0,0,0,0.05); border:1px solid #eee;";
            card.innerHTML = `
                <h3 style="margin:0 0 5px 0; font-size:16px; color:#333;">${vr.caixa} (${vr.quantidade})</h3>
                <p style="margin:0 0 15px 0; font-size:14px; color:#666; font-weight:bold;">Peso: ${vr.peso}</p>
                <div style="font-size:12px; color:#888; margin-bottom:8px;">CÓDIGO: ${vr.codigoBarras}</div>
                <button onclick="copiarCodigoBarras('${vr.codigoBarras}', this)" style="background:transparent; border:none; color:#17a2b8; font-size:20px; cursor:pointer; transition:0.2s;" title="Copiar">
                    <i class="fa-regular fa-copy"></i>
                </button>
            `;
            container.appendChild(card);
        });
    }

    // Tira a lista e coloca as variações NA HORA, sem timer!
    modalListaMaster.style.display = 'none';
    modalVariacoesMaster.style.display = 'block';
    
    // Anima apenas a entrada
    playAnimMaster(modalVariacoesMaster, 'master-box-anim-in');
}

window.voltarParaListaMaster = function() {
    clearTimeout(masterTimer1); // Corta qualquer cronômetro fantasma
    
    // 1. Inicia a animação de saída das variações
    playAnimMaster(modalVariacoesMaster, 'master-box-anim-out');
    
    // 2. Espera 250ms e traz a lista de volta com a animação de entrada
    masterTimer1 = setTimeout(() => {
        modalVariacoesMaster.style.display = 'none';
        modalListaMaster.style.display = 'block';
        playAnimMaster(modalListaMaster, 'master-box-anim-in');
    }, 250);
}
// ==========================================

window.abrirFormularioMaster = function() {
    clearTimeout(masterTimer1);
    
    produtoEditandoId = null;
    document.getElementById('formMasterTitle').innerHTML = '<i class="fa-solid fa-box-open"></i> Novo Produto Master';
    document.getElementById('inputMasterRef').value = '';
    document.getElementById('inputMasterNome').value = '';
    containerVariacoesMaster.innerHTML = ''; 
    adicionarLinhaVariacao(); 
    
    const boxForm = modalFormMasterOverlay.firstElementChild;
    modalFormMasterOverlay.style.display = 'flex';
    
    playAnimMaster(modalFormMasterOverlay, 'master-overlay-anim-in');
    playAnimMaster(boxForm, 'master-box-anim-in');
}

window.fecharFormMaster = function() {
    clearTimeout(masterTimer1);
    
    const boxForm = modalFormMasterOverlay.firstElementChild;
    
    playAnimMaster(modalFormMasterOverlay, 'master-overlay-anim-out');
    playAnimMaster(boxForm, 'master-box-anim-out');
    
    masterTimer1 = setTimeout(() => {
        modalFormMasterOverlay.style.display = 'none';
    }, 380);
}

window.editarProdutoMaster = function(id) {
    clearTimeout(masterTimer1);
    
    const produto = dadosCaixasMaster.find(p => p.id === id);
    if(!produto) return;

    produtoEditandoId = id;
    document.getElementById('formMasterTitle').innerHTML = '<i class="fa-solid fa-pen"></i> Editar Produto Master';
    document.getElementById('inputMasterRef').value = produto.ref;
    document.getElementById('inputMasterNome').value = produto.nome;
    
    containerVariacoesMaster.innerHTML = '';
    
    if(produto.variacoes && produto.variacoes.length > 0) {
        produto.variacoes.forEach(varData => adicionarLinhaVariacao(varData));
    } else {
        adicionarLinhaVariacao(); 
    }
    
    const boxForm = modalFormMasterOverlay.firstElementChild;
    modalFormMasterOverlay.style.display = 'flex';

    playAnimMaster(modalFormMasterOverlay, 'master-overlay-anim-in');
    playAnimMaster(boxForm, 'master-box-anim-in');
}




async function carregarDadosMaster() {
    const tbody = document.getElementById('listaCaixasMasterBody');
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px;">Carregando...</td></tr>';
    
    // Conecta no Firestore em tempo real
    db.collection('caixasMaster').orderBy('ref').onSnapshot(snap => {
        dadosCaixasMaster = [];
        snap.forEach(doc => {
            dadosCaixasMaster.push({ id: doc.id, ...doc.data() });
        });
        // Aplica o filtro atual se houver
        const termo = buscaRefMaster.value.toLowerCase();
        const filtrados = dadosCaixasMaster.filter(p => p.ref.toLowerCase().includes(termo));
        renderizarTabelaMaster(filtrados);
    });
}

function renderizarTabelaMaster(lista) {
    const tbody = document.getElementById('listaCaixasMasterBody');
    tbody.innerHTML = '';
    
    if(lista.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${isAdmin ? 4 : 3}" style="text-align:center; padding:20px; color:#999;">Nenhum produto encontrado.</td></tr>`;
        return;
    }

    lista.forEach(prod => {
        const tr = document.createElement('tr');
        tr.className = 'tr-master-hover'; 
        tr.style.borderBottom = '1px solid #eee';
        tr.style.cursor = 'pointer'; 
        
        // Clique na linha
        tr.onclick = () => { abrirVariacoesMaster(prod); };

        // Botões ADM AGORA COM stopPropagation()
        const acoesAdm = isAdmin ? `
            <td style="padding:12px; text-align:center;">
                <button title="Editar" style="border:none; background:transparent; color:#f39c12; cursor:pointer; margin-right:10px; font-size:16px;" onclick="event.stopPropagation(); editarProdutoMaster('${prod.id}')"><i class="fa-solid fa-pen"></i></button>
                <button title="Excluir" style="border:none; background:transparent; color:#e74c3c; cursor:pointer; font-size:16px;" onclick="event.stopPropagation(); excluirProdutoMaster('${prod.id}')"><i class="fa-solid fa-trash"></i></button>
            </td>
        ` : '';

        tr.innerHTML = `
            <td style="padding:12px; color:#555;">${prod.ref}</td>
            <td style="padding:12px; color:#555;">${prod.nome}</td>
            <td style="padding:12px; text-align:center;">
                <i class="fa-solid fa-layer-group" style="font-size:16px; color:#17a2b8;"></i>
            </td>
            ${acoesAdm}
        `;
        tbody.appendChild(tr);
    });
}

window.abrirVariacoesMaster = function(produto) {
    clearTimeout(masterTimer1); // Corta qualquer cronômetro fantasma

    document.getElementById('varProdNome').textContent = produto.nome;
    document.getElementById('varProdRef').textContent = produto.ref;
    
    const container = document.getElementById('cardsVariacoesContainer');
    container.innerHTML = '';
    
    if(!produto.variacoes || produto.variacoes.length === 0) {
        container.innerHTML = '<p style="color:#999;">Nenhuma variação cadastrada para este produto.</p>';
    } else {
        produto.variacoes.forEach(vr => {
            const card = document.createElement('div');
            card.style.cssText = "background:#fff; border-radius:12px; padding:20px; width:220px; text-align:center; box-shadow:0 4px 10px rgba(0,0,0,0.05); border:1px solid #eee;";
            card.innerHTML = `
                <h3 style="margin:0 0 5px 0; font-size:16px; color:#333;">${vr.caixa} (${vr.quantidade})</h3>
                <p style="margin:0 0 15px 0; font-size:14px; color:#666; font-weight:bold;">Peso: ${vr.peso}</p>
                <div style="font-size:12px; color:#888; margin-bottom:8px;">CÓDIGO: ${vr.codigoBarras}</div>
                <button onclick="copiarCodigoBarras('${vr.codigoBarras}', this)" style="background:transparent; border:none; color:#17a2b8; font-size:20px; cursor:pointer; transition:0.2s;" title="Copiar">
                    <i class="fa-regular fa-copy"></i>
                </button>
            `;
            container.appendChild(card);
        });
    }

    // 1. Inicia a animação de saída da lista
    playAnimMaster(modalListaMaster, 'master-box-anim-out');
    
    // 2. Espera os 250ms da animação acontecerem antes de trocar a tela
    masterTimer1 = setTimeout(() => {
        modalListaMaster.style.display = 'none';
        modalVariacoesMaster.style.display = 'block';
        playAnimMaster(modalVariacoesMaster, 'master-box-anim-in');
    }, 250); 
}

// Função de Copiar o Código de Barras
window.copiarCodigoBarras = function(codigo, btnElement) {
    navigator.clipboard.writeText(codigo).then(() => {
        const iconeOriginal = btnElement.innerHTML;
        btnElement.innerHTML = '<i class="fa-solid fa-check" style="color:#28a745;"></i>';
        setTimeout(() => { btnElement.innerHTML = iconeOriginal; }, 1500);
    }).catch(err => {
        console.error('Erro ao copiar: ', err);
    });
}

// --- FUNÇÕES ADMIN (CRUD COMPLETO PELA INTERFACE) ---
const modalFormMasterOverlay = document.getElementById('modalFormMasterOverlay');
const containerVariacoesMaster = document.getElementById('containerVariacoesMaster');




window.adicionarLinhaVariacao = function(dados = null) {
    const div = document.createElement('div');
    div.className = 'linha-variacao-master';
    div.style.cssText = "display:flex; gap:10px; align-items:flex-end; background:#fff; padding:15px; border:1px solid #ddd; border-radius:8px;";
    
    // Valores padrão ou dados vindos da edição
    const caixa = dados ? dados.caixa : '';
    const qtd = dados ? dados.quantidade : '';
    const peso = dados ? dados.peso : '';
    const codigo = dados ? dados.codigoBarras : '';

    div.innerHTML = `
        <div style="flex:1;">
            <label style="font-size:11px; color:#666; font-weight:bold;">CAIXA</label>
            <input type="text" class="var-caixa" placeholder="Ex: CAIXA 1" value="${caixa}" style="width:100%; padding:8px; border:1px solid #ccc; border-radius:4px; font-size:13px;">
        </div>
        <div style="flex:1;">
            <label style="font-size:11px; color:#666; font-weight:bold;">QUANTIDADE</label>
            <input type="text" class="var-qtd" placeholder="Ex: CX60" value="${qtd}" style="width:100%; padding:8px; border:1px solid #ccc; border-radius:4px; font-size:13px;">
        </div>
        <div style="flex:1;">
            <label style="font-size:11px; color:#666; font-weight:bold;">PESO (kg)</label>
            <input type="text" class="var-peso" placeholder="Ex: 2,86" value="${peso}" style="width:100%; padding:8px; border:1px solid #ccc; border-radius:4px; font-size:13px;">
        </div>
        <div style="flex:1.5;">
            <label style="font-size:11px; color:#666; font-weight:bold;">CÓDIGO DE BARRAS</label>
            <input type="text" class="var-codigo" placeholder="EAN" value="${codigo}" style="width:100%; padding:8px; border:1px solid #ccc; border-radius:4px; font-size:13px;">
        </div>
        <div>
            <button type="button" onclick="this.parentElement.parentElement.remove()" style="background:#dc3545; color:#fff; border:none; padding:8px 12px; border-radius:4px; cursor:pointer;" title="Remover Linha">
                <i class="fa-solid fa-trash"></i>
            </button>
        </div>
    `;
    containerVariacoesMaster.appendChild(div);
}

window.salvarProdutoMaster = async function() {
    const btnSalvar = document.getElementById('btnSalvarMaster');
    const ref = document.getElementById('inputMasterRef').value.trim();
    const nome = document.getElementById('inputMasterNome').value.trim();

    if(!ref || !nome) return alert("Por favor, preencha a Referência e o Nome do Produto.");

    // Varre todas as linhas de variação para montar o array
    const linhas = document.querySelectorAll('.linha-variacao-master');
    const arrayVariacoes = [];
    
    linhas.forEach(linha => {
        const caixa = linha.querySelector('.var-caixa').value.trim();
        const qtd = linha.querySelector('.var-qtd').value.trim();
        const pesoRaw = linha.querySelector('.var-peso').value.trim();
        const codigo = linha.querySelector('.var-codigo').value.trim();
        
        // Se a linha estiver parcialmente preenchida, ignora ou alerta
        if(caixa || qtd || codigo) {
            arrayVariacoes.push({
                caixa: caixa,
                quantidade: qtd,
                peso: parseFloat(pesoRaw.replace(',', '.')) || 0, // Trata vírgula para ponto e converte pra número
                codigoBarras: codigo
            });
        }
    });

    const dadosProduto = {
        ref: ref,
        nome: nome,
        variacoes: arrayVariacoes
    };

    try {
        btnSalvar.textContent = "Salvando...";
        btnSalvar.disabled = true;

        if (produtoEditandoId) {
            // Edição
            await db.collection('caixasMaster').doc(produtoEditandoId).update(dadosProduto);
        } else {
            // Criação Nova
            await db.collection('caixasMaster').add(dadosProduto);
        }

        fecharFormMaster();
    } catch (error) {
        alert("Erro ao salvar produto: " + error.message);
    } finally {
        btnSalvar.textContent = "Salvar Produto";
        btnSalvar.disabled = false;
    }
}


window.excluirProdutoMaster = async function(id) {
    if(confirm("Tem certeza que deseja excluir este produto da lista master de forma permanente?")) {
        try {
            await db.collection('caixasMaster').doc(id).delete();
        } catch (error) {
            alert("Erro ao excluir: " + error.message);
        }
    }
}

// --- FUNÇÃO DE IMPORTAÇÃO EM MASSA (INTELIGENTE) ---
window.importarPlanilhaMaster = function(input) {
    const file = input.files[0];
    if(!file) return;

    // Muda o cursor para indicar que está processando
    document.body.style.cursor = 'wait';

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const text = e.target.result;
            
            // 1. Divide por qualquer tipo de quebra de linha (Windows, Mac, Linux)
            const linhasBrutas = text.split(/\r\n|\n|\r/); 
            
            // 2. Limpa linhas totalmente vazias pro final do arquivo não dar erro
            const linhas = linhasBrutas.filter(l => l.trim() !== '');

            if(linhas.length < 2) return alert("Arquivo vazio ou sem dados suficientes.");

            // 3. Descobre qual o separador (\t para TSV, ; ou , para CSV)
            let separador = '\t';
            if(linhas[0].includes(';') && !linhas[0].includes('\t')) separador = ';';
            if(linhas[0].includes(',') && !linhas[0].includes('\t') && !linhas[0].includes(';')) separador = ',';

            // 4. Procura a linha do cabeçalho de forma inteligente (ignora a linha 1 de título se houver)
            let headerIndex = -1;
            let cabecalho = [];
            for(let i = 0; i < Math.min(linhas.length, 5); i++) {
                // Separa as colunas e remove aspas que o excel/sheets coloca
                const cols = linhas[i].split(separador).map(c => c.trim().toUpperCase().replace(/"/g, ''));
                if(cols.includes("PRODUTO") && cols.includes("REF")) {
                    headerIndex = i;
                    cabecalho = cols;
                    break;
                }
            }

            if(headerIndex === -1) {
                alert("Erro: Não encontrei as colunas 'PRODUTO' e 'REF' no topo do arquivo. Verifique se o nome das colunas está exato.");
                return;
            }

            const idxProduto = cabecalho.indexOf("PRODUTO");
            const idxRef = cabecalho.indexOf("REF");
            const idxQtd = cabecalho.indexOf("QUANTIDADE");
            const idxCaixa = cabecalho.indexOf("CAIXA");
            const idxPeso = cabecalho.indexOf("PESO");
            // Busca a coluna de código de barras independente de como você escreveu
            const idxCodigo = cabecalho.findIndex(c => c.includes("CÓDIGO DE BARRAS") || c.includes("CODIGO") || c.includes("BARRAS"));

            const mapProdutos = {};
            let caixasLidas = 0;

            // 5. Começa a ler a partir da linha logo A BAIXO do cabeçalho
            for(let i = headerIndex + 1; i < linhas.length; i++) {
                const colunas = linhas[i].split(separador).map(c => c.trim().replace(/^"|"$/g, ''));
                if(colunas.length < 2) continue; // Pula linhas bugadas

                const ref = colunas[idxRef];
                const nome = colunas[idxProduto];
                
                // Se não tem Ref ou Nome, não tem como salvar
                if(!ref || !nome || ref === "" || nome === "") continue;

                // Pega o resto dos dados (se a coluna não existir na planilha, fica vazio)
                const qtd = idxQtd !== -1 ? (colunas[idxQtd] || '') : '';
                const caixa = idxCaixa !== -1 ? (colunas[idxCaixa] || '') : '';
                const pesoStr = idxPeso !== -1 ? (colunas[idxPeso] || '0') : '0';
                const codigo = idxCodigo !== -1 ? (colunas[idxCodigo] || '') : '';

                // Converte peso (troca vírgula por ponto para o banco aceitar)
                const peso = parseFloat(pesoStr.replace(',', '.')) || 0;

                // Se o produto não existe ainda no agrupamento, cria a base dele
                if(!mapProdutos[ref]) {
                    mapProdutos[ref] = { ref: ref, nome: nome, variacoes: [] };
                }

                // Adiciona a caixa (variação) dentro do produto
                if(caixa || qtd || codigo) {
                    mapProdutos[ref].variacoes.push({
                        caixa: caixa,
                        quantidade: qtd,
                        peso: peso,
                        codigoBarras: codigo
                    });
                    caixasLidas++;
                }
            }

            const produtosArray = Object.values(mapProdutos);
            
            if(produtosArray.length === 0) {
                alert("Nenhum produto válido encontrado. Verifique se as linhas possuem dados nas colunas REF e PRODUTO.");
                return;
            }
            
            if(confirm(`Show! Encontrei ${produtosArray.length} produtos base e ${caixasLidas} variações (caixas). Deseja importar tudo para o banco agora?`)) {
                
                // Usa batch para mandar tudo de uma vez e não sobrecarregar o firebase
                const batch = db.batch();
                produtosArray.forEach(prod => {
                    const docRef = db.collection('caixasMaster').doc(); 
                    batch.set(docRef, prod);
                });

                await batch.commit();
                alert("Importação concluída com sucesso! Feche e abra a janela para ver.");
            }
        } catch (error) {
            alert("Erro durante a importação: " + error.message);
            console.error(error);
        } finally {
            document.body.style.cursor = 'default';
            input.value = ''; // Reseta o botão para permitir importar o mesmo arquivo de novo se errar
        }
    };
    
    // Lê o arquivo suportando acentuação BR
    reader.readAsText(file, 'ISO-8859-1'); 
}

// =========================================================================
// COMANDO GLOBAL: ENTER PARA CONFIRMAR
// =========================================================================
document.addEventListener('keydown', function(e) {
    // Verifica se a tecla pressionada foi o Enter
    if (e.key === 'Enter') {
        
        // Regra 1: Ignora se estiver digitando em um campo de texto longo (textarea) para permitir pular linha
        if (e.target.tagName === 'TEXTAREA') return;

        let acaoRealizada = false;

        // Regra 2: Verifica qual modal está aberto no momento e clica no botão principal correspondente
        if (document.getElementById('addCaixaModal') && document.getElementById('addCaixaModal').style.display === 'flex') {
            document.getElementById('addCaixaBtn')?.click();
            acaoRealizada = true;
            
        } else if (document.getElementById('popupOrdens') && document.getElementById('popupOrdens').style.display === 'flex') {
            document.getElementById('salvarOrdemBtn')?.click();
            acaoRealizada = true;
            
        } else if (document.getElementById('modalFormMasterOverlay') && document.getElementById('modalFormMasterOverlay').style.display === 'flex') {
            document.getElementById('btnSalvarMaster')?.click();
            acaoRealizada = true;
            
        } else if (document.getElementById('confirmCsvModal') && document.getElementById('confirmCsvModal').style.display === 'flex') {
            document.getElementById('confirmCsvBtn')?.click();
            acaoRealizada = true;
            
        } else if (document.getElementById('logoutConfirmModal') && document.getElementById('logoutConfirmModal').style.display === 'flex') {
            document.getElementById('confirmLogoutBtn')?.click();
            acaoRealizada = true;
            
        } else if (document.getElementById('multiPopupOverlay') && document.getElementById('multiPopupOverlay').style.display === 'flex') {
            // Inteligência extra pro modal de Novo Pedido:
            // Se o foco estiver no Tipo de Doc ou no Responsável, o Enter adiciona o documento à lista.
            // Se estiver em qualquer outro campo (Romaneio, Loja), o Enter salva o pedido todo.
            const isDocField = e.target.closest('#responsaveisContainer') || e.target.id === 'multiDocTipo';
            if (isDocField) {
                document.getElementById('addDocumentoBtn')?.click();
            } else {
                document.getElementById('multiSaveBtn')?.click();
            }
            acaoRealizada = true;
        }

        // Regra 3: Se o script detectou um modal e clicou no botão, previne o comportamento padrão do navegador (evita "piscar" a tela)
        if (acaoRealizada) {
            e.preventDefault();
        }
    }
});

// =========================================================================
// SISTEMA MASTER: PAINEL DE PLANEJAMENTO DEFINITIVO V6
// =========================================================================

window.wmsSessions = {}; 

window.processarWmsCSV = async function(input, docIndex) {
    const file = input.files[0]; if(!file) return;
    document.body.style.cursor = 'wait';
    
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const text = e.target.result;
            const linhas = text.trim().split(/\r\n|\n|\r/);
            let separador = linhas[0].includes('\t') ? '\t' : (linhas[0].includes(';') ? ';' : ',');
            const cabecalho = linhas[0].split(separador).map(c => c.trim().toUpperCase().replace(/"/g, ''));
            
            let idxRef = cabecalho.findIndex(c => c.includes("CÓDIGO") || c === "PRODUTO" || c === "REF");
            let idxQtd = cabecalho.findIndex(c => c.includes("QTDE CONFERIDA") || c.includes("QUANTIDADE"));
            let idxDesc = cabecalho.findIndex(c => c.includes("DESCRIÇÃO") || c.includes("DESCRICAO"));

            if(idxRef === -1 || idxQtd === -1) {
                alert("Colunas de Código ou Quantidade não encontradas no CSV.");
                return;
            }

            const snapMaster = await db.collection('caixasMaster').get();
            const baseMaster = [];
            snapMaster.forEach(d => baseMaster.push(d.data()));

            let skusProcessados = [];
            for(let i=1; i<linhas.length; i++) {
                const cols = linhas[i].split(separador).map(c => c.trim().replace(/^"|"$/g, ''));
                if(cols.length <= idxRef) continue;
                
                const ref = cols[idxRef];
                const qtd = parseInt(cols[idxQtd] || "0");
                if(!ref || qtd <= 0) continue;

                const masterRef = baseMaster.find(m => String(m.ref).trim() === String(ref).trim() || String(m.ref).trim().replace(/^0+/, '') === String(ref).trim().replace(/^0+/, ''));
                
                const variacoesValidas = masterRef ? masterRef.variacoes.filter(v => {
                    const qp = parseInt(v.quantidade.replace(/\D/g, '')) || 1;
                    return qtd % qp === 0;
                }) : [];

                const isMissing = variacoesValidas.length === 0;

                skusProcessados.push({
                    ref, 
                    desc: idxDesc !== -1 ? cols[idxDesc] : "Produto",
                    qtdTotal: qtd,
                    variacoesDisponiveis: variacoesValidas,
                    selectedVar: 0,
                    caixaNome: !isMissing ? variacoesValidas[0].caixa : "",
                    qtdPadrao: !isMissing ? parseInt(variacoesValidas[0].quantidade.replace(/\D/g, '')) : 0,
                    pesoPadrao: !isMissing ? variacoesValidas[0].peso : 0,
                    isMissing: isMissing,
                    isExpanded: false
                });
            }

            window.wmsSessions[docIndex] = {
                skus: skusProcessados,
                sortCol: 'ref',
                sortDir: 'asc',
                fileName: file.name
            };

            window.recalcWmsBoxes(docIndex);
            window.renderWmsPanel(docIndex);

        } catch(err) { alert("Erro: " + err.message); }
        finally { document.body.style.cursor = 'default'; input.value = ''; }
    };
    reader.readAsText(file, 'ISO-8859-1');
}

window.renderWmsPanel = function(docIndex) {
    const session = window.wmsSessions[docIndex];
    const container = document.getElementById(`wms-panel-container-${docIndex}`);
    const listNormal = document.getElementById(`caixas-list-container-${docIndex}`);
    
    // --- O SEGREDO 1: NÃO ESCONDER MAIS A LISTA DE CAIXAS ---
    if(listNormal) listNormal.style.display = 'block'; 
    container.style.display = 'block';

    const importArea = container.parentElement.querySelector('.import-area');
    if (importArea) importArea.style.display = 'none';

    const modalContent = container.closest('.modal-content');
    if(modalContent) {
        modalContent.classList.remove('modal-lg');
        modalContent.classList.add('modal-xl');
    }
    
    // Libera a grade pro tamanho máximo
    const caixasContainer = document.getElementById('listaCaixasContainer');
    if(caixasContainer) {
        caixasContainer.classList.remove('caixas-grid');
        caixasContainer.style.display = 'block';
    }

    const docSection = container.closest('.doc-section');
    if(docSection) {
        docSection.style.padding = '0';
        docSection.style.border = 'none';
        docSection.style.boxShadow = 'none';
        docSection.style.background = 'transparent';
    }

    let trs = session.skus.map((sku, i) => {
        const numCaixas = sku.qtdPadrao > 0 ? Math.ceil(sku.qtdTotal / sku.qtdPadrao) : 0;
        
        let varSelectorHtml = '';
        if (sku.variacoesDisponiveis.length > 1) {
            let opts = sku.variacoesDisponiveis.map((v, vIdx) => {
                return `<option value="${vIdx}" ${sku.selectedVar === vIdx ? 'selected' : ''}>${v.caixa} / ${v.quantidade} / ${v.peso}kg</option>`;
            }).join('');
            varSelectorHtml = `<select onclick="event.stopPropagation()" onchange="window.updateSkuRow(${docIndex}, ${i}, 'variacao', this.value)" style="width:100%; padding:6px; font-size:11px; border-radius:6px; border:1px solid #ccc; cursor:pointer;">${opts}</select>`;
        } else if (sku.variacoesDisponiveis.length === 1) {
            varSelectorHtml = `<span style="font-size:11px; font-weight:bold; color:#666; background:#eee; padding:4px 8px; border-radius:4px;">Padrão Único</span>`;
        } else {
            varSelectorHtml = `<span style="color:#dc3545; font-size:10px; font-weight:bold;"><i class="fa-solid fa-triangle-exclamation"></i> FALTA DADOS</span>`;
        }

        const unCxCell = sku.isMissing 
            ? `<input type="number" onclick="event.stopPropagation()" style="width:100%; padding:6px; text-align:center; border:1px solid #dc3545; border-radius:4px;" value="${sku.qtdPadrao || ''}" placeholder="0" onchange="window.updateSkuRow(${docIndex}, ${i}, 'qtdPadrao', this.value)">`
            : `<strong style="font-size:15px; color:#333;">${sku.qtdPadrao}</strong>`;
            
        const tipoCxCell = sku.isMissing
            ? `<input type="text" onclick="event.stopPropagation()" style="width:100%; padding:6px; text-align:center; border:1px solid #dc3545; border-radius:4px;" value="${sku.caixaNome || ''}" placeholder="Nome (Ex: CX 4)" onchange="window.updateSkuRow(${docIndex}, ${i}, 'caixaNome', this.value)">`
            : `<strong style="font-size:14px; color:#555;">${sku.caixaNome}</strong>`;

        const pesoCell = sku.isMissing
            ? `<input type="number" step="0.1" onclick="event.stopPropagation()" style="width:100%; padding:6px; text-align:center; border:1px solid #dc3545; border-radius:4px;" value="${sku.pesoPadrao || ''}" placeholder="0.0" onchange="window.updateSkuRow(${docIndex}, ${i}, 'pesoPadrao', this.value)">`
            : `<strong style="font-size:14px; color:#555;">${sku.pesoPadrao}kg</strong>`;

        let detalhesHtml = '';
        if (sku.isExpanded && sku.caixasGeradasDesteSku) {
            const listaPills = sku.caixasGeradasDesteSku.map((c, idx) => `
                <div style="display:flex; justify-content:space-between; align-items:center; background:#fff; border:1px solid #e0e0e0; padding:10px 15px; border-radius:8px; font-size:12px; box-shadow:0 2px 4px rgba(0,0,0,0.02);">
                    <span><i class="fa-solid fa-box-open" style="color:#aaa; margin-right:8px;"></i> Volume ${idx + 1}</span>
                    <strong style="color:var(--primary);">${c.num} <span style="font-weight:normal; color:#666;">(${c.peso}kg)</span></strong>
                </div>
            `).join('');
            
            detalhesHtml = `
                <tr style="background:#fafafa; border-left:5px solid var(--secondary);">
                    <td colspan="7" style="padding:20px; border-bottom:2px solid #ddd;">
                        <h4 style="margin:0 0 10px 0; font-size:13px; color:#555;"><i class="fa-solid fa-layer-group"></i> Caixas Planejadas para este Produto:</h4>
                        <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap:12px;">
                            ${listaPills}
                        </div>
                    </td>
                </tr>`;
        }

        return `
            <tr onclick="window.toggleSkuExpand(${docIndex}, ${i})" style="cursor:pointer; border-bottom:1px solid #eee; background:${sku.isMissing ? '#fff5f5' : '#fff'}; transition:0.2s;" onmouseover="this.style.background='#f1f4f8'" onmouseout="this.style.background='${sku.isMissing ? '#fff5f5' : '#fff'}'">
                <td style="padding:15px;">
                    <i class="fa-solid ${sku.isExpanded ? 'fa-chevron-up' : 'fa-chevron-down'}" style="font-size:14px; margin-right:10px; color:var(--primary);"></i>
                    <strong style="font-size:14px;">${sku.ref}</strong><br><small style="color:#777;">${sku.desc}</small>
                </td>
                <td style="padding:15px; text-align:center; font-size:16px; font-weight:900;">${sku.qtdTotal}</td>
                <td style="padding:15px; text-align:center;">${unCxCell}</td>
                <td style="padding:15px; text-align:center;">${tipoCxCell}</td>
                <td style="padding:15px; text-align:center;">${pesoCell}</td>
                <td style="padding:15px;">${varSelectorHtml}</td>
                <td style="padding:15px; text-align:center; background:rgba(13, 50, 105, 0.04); border-left:1px solid #eee;">
                    <div style="font-size:22px; font-weight:900; color:var(--primary);">${numCaixas}</div>
                </td>
            </tr>
            ${detalhesHtml}
        `;
    }).join('');

    container.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:15px; border:1px solid #ddd; border-radius:12px; overflow:hidden;">
            
            <div style="display:flex; justify-content:space-between; align-items:center; padding:20px; background:#f8f9fa; border-bottom:1px solid #eee;">
                <div>
                    <h3 style="margin:0; font-size:20px; color:var(--primary);"><i class="fa-solid fa-microchip"></i> Planejamento de Volumes</h3>
                    <small style="color:#666;">Arquivo base: <strong>${session.fileName}</strong></small>
                </div>
                <div style="display:flex; gap:12px;">
                    <label style="background:#fff; border:1px solid #ccc; padding:10px 15px; border-radius:6px; font-size:13px; cursor:pointer; font-weight:bold; color:#444; transition:0.2s;" onmouseover="this.style.background='#eee'" onmouseout="this.style.background='#fff'">
                        <i class="fa-solid fa-rotate"></i> Re-importar
                        <input type="file" style="display:none;" onchange="window.processarWmsCSV(this, ${docIndex})">
                    </label>
                    <label style="background:#fff3cd; color:#856404; border:1px solid #ffeeba; padding:10px 15px; border-radius:6px; font-size:13px; cursor:pointer; font-weight:bold; transition:0.2s;" onmouseover="this.style.opacity='0.8'" onmouseout="this.style.opacity='1'">
                        <i class="fa-solid fa-magnifying-glass-chart"></i> Auditar Saída WMS (CSV)
                        <input type="file" accept=".csv" style="display:none;" onchange="window.compararWmsAuditoria(this, ${docIndex})">
                    </label>
                    <button style="background:var(--success); color:#fff; border:none; padding:10px 20px; border-radius:6px; font-size:13px; cursor:pointer; font-weight:bold; transition:0.2s;" onclick="window.salvarWmsFinal(${docIndex})" onmouseover="this.style.opacity='0.8'" onmouseout="this.style.opacity='1'">
                        <i class="fa-solid fa-floppy-disk"></i> Confirmar e Salvar
                    </button>
                </div>
            </div>

            <div id="area-comparacao-${docIndex}" style="display:none; margin: 0 20px;"></div>

            <div style="width:100%; max-height:40vh; overflow-y:auto; background:#fff;">
                <table style="width:100%; border-collapse:collapse; min-width:900px; font-size:13px;">
                    <thead style="background:#e9ecef; position:sticky; top:0; z-index:20; box-shadow:0 2px 5px rgba(0,0,0,0.05);">
                        <tr>
                            <th style="padding:15px; text-align:left; cursor:pointer;" onclick="window.sortWms(${docIndex}, 'ref')">PRODUTO <i class="fa-solid fa-sort" style="color:#999; margin-left:5px;"></i></th>
                            <th style="padding:15px; text-align:center; cursor:pointer;" onclick="window.sortWms(${docIndex}, 'qtdTotal')">QTD PEDIDO <i class="fa-solid fa-sort" style="color:#999; margin-left:5px;"></i></th>
                            <th style="padding:15px; text-align:center;">UN/CX</th>
                            <th style="padding:15px; text-align:center;">TIPO CAIXA</th>
                            <th style="padding:15px; text-align:center;">PESO</th>
                            <th style="padding:15px; text-align:left;">SELECIONAR VARIAÇÃO</th>
                            <th style="padding:15px; text-align:center; background:#dee2e6;">TOTAL CX</th>
                        </tr>
                    </thead>
                    <tbody>${trs}</tbody>
                </table>
            </div>
        </div>
    `;
};

window.updateSkuRow = function(docIndex, skuIdx, campo, valor) {
    const sku = window.wmsSessions[docIndex].skus[skuIdx];
    
    if (campo === 'variacao') {
        const v = sku.variacoesDisponiveis[parseInt(valor)];
        sku.selectedVar = parseInt(valor);
        sku.caixaNome = v.caixa;
        sku.qtdPadrao = parseInt(v.quantidade.replace(/\D/g, ''));
        sku.pesoPadrao = v.peso;
    } else if (campo === 'qtdPadrao') {
        sku.qtdPadrao = parseInt(valor) || 0;
    } else if (campo === 'pesoPadrao') {
        sku.pesoPadrao = parseFloat(String(valor).replace(',', '.')) || 0;
    } else {
        sku[campo] = String(valor).toUpperCase();
    }
    
    if (sku.qtdPadrao > 0 && sku.caixaNome !== "" && sku.pesoPadrao > 0) {
        sku.isMissing = false; 
    }
    
    window.recalcWmsBoxes(docIndex);
    window.renderWmsPanel(docIndex);
};

window.toggleSkuExpand = function(docIndex, skuIdx) {
    const sku = window.wmsSessions[docIndex].skus[skuIdx];
    sku.isExpanded = !sku.isExpanded;
    window.renderWmsPanel(docIndex);
};

window.sortWms = function(docIndex, col) {
    const session = window.wmsSessions[docIndex];
    session.sortDir = (session.sortCol === col && session.sortDir === 'asc') ? 'desc' : 'asc';
    session.sortCol = col;
    
    session.skus.sort((a, b) => {
        let valA = a[col], valB = b[col];
        if (typeof valA === 'string') return session.sortDir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        return session.sortDir === 'asc' ? valA - valB : valB - valA;
    });
    
    window.renderWmsPanel(docIndex);
};

window.recalcWmsBoxes = function(docIndex) {
    const session = window.wmsSessions[docIndex];
    session.caixasGeradas = [];

    session.skus.forEach(sku => {
        sku.caixasGeradasDesteSku = [];
        if (sku.qtdPadrao <= 0) return;

        let qtdRestante = sku.qtdTotal;
        while(qtdRestante > 0) {
            const qtdNestaCaixa = Math.min(qtdRestante, sku.qtdPadrao);
            const cx = {
                num: sku.caixaNome || "CX ?",
                peso: sku.pesoPadrao,
                isBonificacao: false,
                produtos: [{ referencia: sku.ref, descricao: sku.desc, quantidade: qtdNestaCaixa }]
            };
            session.caixasGeradas.push(cx);
            sku.caixasGeradasDesteSku.push(cx);
            qtdRestante -= qtdNestaCaixa;
        }
    });
};

window.compararWmsAuditoria = function(input, docIndex) {
    const file = input.files[0];
    if(!file) return;
    
    const reader = new FileReader();
    reader.onload = async (ev) => {
        try {
            const caixasReais = await parseCsvParaCaixas(ev.target.result);
            const totalReais = caixasReais.length; 
            const session = window.wmsSessions[docIndex];
            
            let planejado = 0;
            session.skus.forEach(s => {
                if (s.qtdPadrao > 0) {
                    planejado += Math.ceil(s.qtdTotal / s.qtdPadrao);
                }
            });

            const area = document.getElementById(`area-comparacao-${docIndex}`);
            area.style.display = 'block';
            
            const diff = planejado - totalReais;
            const isPerfect = (planejado === totalReais);
            const cor = isPerfect ? '#155724' : '#721c24';
            const bg = isPerfect ? '#d4edda' : '#f8d7da';

            area.innerHTML = `
                <div style="display:flex; justify-content:space-around; align-items:center; background:${bg}; color:${cor}; padding:20px; border-radius:10px; border: 1px solid ${isPerfect ? '#c3e6cb' : '#f5c6cb'};">
                    <div style="text-align:center;">
                        <small style="font-weight:bold;">PLANEJADO (SISTEMA)</small>
                        <div style="font-size:32px; font-weight:900;">${planejado} <span style="font-size:14px; font-weight:normal;">CXs</span></div>
                    </div>
                    <div style="font-size:30px; opacity:0.3;"><i class="fa-solid fa-arrows-left-right"></i></div>
                    <div style="text-align:center;">
                        <small style="font-weight:bold;">EFETIVADO (WMS)</small>
                        <div style="font-size:32px; font-weight:900;">${totalReais} <span style="font-size:14px; font-weight:normal;">CXs</span></div>
                    </div>
                </div>
                ${!isPerfect ? `<p style="text-align:center; color:#721c24; margin-top:10px; font-weight:bold; font-size:14px;"><i class="fa-solid fa-triangle-exclamation"></i> Discrepância de ${Math.abs(diff)} caixa(s) detectada! Revise as caixas manuais ou frações do WMS.</p>` : ''}
            `;
        } catch(err) {
            alert("Erro na auditoria: Certifique-se de estar importando o CSV correto de caixas efetivadas. \n\n" + err.message);
        } finally { input.value = ''; }
    };
    reader.readAsText(file, 'ISO-8859-1');
};

window.salvarWmsFinal = async function(docIndex) {
    const s = window.wmsSessions[docIndex];
    
    // Validação se tem algum pendente
    const pendentes = s.skus.filter(sku => sku.isMissing);
    if (pendentes.length > 0) {
        return alert(`Existem ${pendentes.length} produto(s) com informações de caixa faltando. Preencha os campos em vermelho antes de salvar.`);
    }

    if(confirm(`Deseja efetivar a gravação de ${s.caixasGeradas.length} caixas para este documento?`)) {
        document.body.style.cursor = 'wait';
        await salvarNovasCaixas(s.caixasGeradas, docIndex, s.fileName);
        registrarLog("Planejamento Master WMS", "sucesso", `Salvas ${s.caixasGeradas.length} caixas.`);
        document.body.style.cursor = 'default';
        alert("Planejamento Efetivado com Sucesso!");
    }
};