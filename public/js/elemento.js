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
        // Validações Iniciais (Se der erro aqui, a animação nem começa)
        if(!multiRomaneio.value) return alert("Informe o Romaneio");
        if(documentosTemporarios.length === 0) return alert("Adicione pelo menos um documento");

        // Coleta de Variáveis
        let ownerUid = currentUser.uid;
        let targetElementId = elementoId;
        let criadorEmail = currentUser.email;
        let targetElementTitle = elementoAtualTitulo; 

        if(isGlobalAdminMode && !editingId) {
            ownerUid = document.getElementById('admTargetUser').value;
            targetElementId = document.getElementById('admTargetElement').value;
            criadorEmail = uidToEmailMapReverso[ownerUid] || ownerUid;
            
            const selElem = document.getElementById('admTargetElement');
            if(selElem.selectedIndex >= 0) {
                targetElementTitle = selElem.options[selElem.selectedIndex].text;
            }
            if(!ownerUid || !targetElementId) return alert("Selecione para qual usuário/projeto este pedido vai!");
        }

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
            isCaixaMaster: document.getElementById('multiIsCaixaMaster')?.checked || false, 
            documentos: documentosTemporarios.map(({idTemp, ...rest}) => rest),
            uidsVinculados: uidsVinculados
        };

        // =========================================================================
        // CHAMADA DA NOVA ANIMAÇÃO DE LOADING
        // =========================================================================
        const tituloAnime = editingId ? "Atualizando Pedido" : "Criando Pedido";
        const textoSucesso = editingId ? "Pedido Atualizado!" : "Pedido Criado com Sucesso!";

        // Trava o botão para evitar duplo clique
        multiSaveBtn.disabled = true;

        window.executarLoadingAvancado(
            tituloAnime, 
            "Sincronizando informações com a base de dados...", 
            textoSucesso, 
            async () => {
                // TODO O SEU CÓDIGO DO FIREBASE ENTRA AQUI DENTRO!
                if(editingId) {
                    // EDIÇÃO
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

                    const batch = db.batch();
                    uidsVinculados.forEach(uid => {
                        if(uid === actualOwnerUid) return;
                        const shareRef = db.collection("usuarios").doc(uid).collection("pedidosCompartilhadosComigo").doc(editingId);
                        batch.set(shareRef, { criadorUid: actualOwnerUid, pedidoId: editingId, elementoId: actualElementId, elementoTitulo: editElementTitle }, { merge: true });
                    });
                    await batch.commit();

                } else {
                    // CRIAÇÃO NOVA
                    data.criadorUid = ownerUid;
                    data.criadorEmail = criadorEmail;
                    data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                    data.efetivado = false;
                    
                    const ref = db.collection("usuarios").doc(ownerUid).collection("elementos").doc(targetElementId).collection("pedidosMultiDocumento");
                    const docRef = await ref.add(data);
                    registrarLog("Criação de Pedido", "sucesso", `Romaneio ${data.romaneio} criado.`);

                    const batch = db.batch();
                    uidsVinculados.forEach(uid => {
                        if(uid === ownerUid) return;
                        const shareRef = db.collection("usuarios").doc(uid).collection("pedidosCompartilhadosComigo").doc(docRef.id);
                        batch.set(shareRef, { criadorUid: ownerUid, pedidoId: docRef.id, elementoId: targetElementId, elementoTitulo: targetElementTitle });
                    });
                    await batch.commit();
                }
            }
        ).then(() => {
            // A animação brilhou, o check verde sumiu... AGORA fecha o modal!
            fecharModal(multiPopupOverlay);
        }).finally(() => {
            // Destrava o botão para usos futuros
            multiSaveBtn.disabled = false;
            multiSaveBtn.textContent = "Salvar Pedido";
        });
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

// =========================================================================
// CORREÇÃO: PERSISTÊNCIA DO PAINEL MASTER (F5 BLINDADO)
// =========================================================================

window.currentActivePedidoId = null;

// =========================================================================
// RENDERIZAÇÃO DO GRID DE CAIXAS (CARDS COM TAMANHO FIXO E PADRONIZADO)
// =========================================================================

window.renderizarGridCaixas = async function() {
    const container = document.getElementById('listaCaixasContainer');
    if(!container) return;

    // Força o modal a ser grande para aproveitar o grid
    const modalDialog = container.closest('.modal-dialog');
    if (modalDialog) {
        modalDialog.className = 'modal-dialog modal-xl modal-dialog-centered';
        modalDialog.style.maxWidth = '1400px'; 
        modalDialog.style.width = '96%';
    }
    const modalContent = container.closest('.modal-content');
    if(modalContent) {
        modalContent.className = 'modal-content modal-xl';
    }
    
    container.className = ''; 
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '20px';
    container.style.width = '100%';

    container.innerHTML = '<div style="text-align:center; width:100%; padding:40px;"><i class="fa-solid fa-spinner fa-spin" style="font-size:30px; color:var(--primary);"></i><br><br>Carregando layout...</div>';

    const coll = pedidoAtualTipo === 'simples' ? 'pedidos' : 'pedidosMultiDocumento';
    const docSnap = await db.collection("usuarios").doc(pedidoAtualCriadorUid).collection("elementos").doc(pedidoAtualElementoId).collection(coll).doc(pedidoAtualId).get();
    
    if(!docSnap.exists) return;
    let dados = pedidoAtualTipo === 'simples' ? transformarSimplesEmMulti(docSnap) : docSnap.data();
    
    const temPermissao = isAdmin || (dados.uidsVinculados && dados.uidsVinculados.includes(currentUser.uid)) || (dados.criadorUid === currentUser.uid);
    
    if (window.currentActivePedidoId !== pedidoAtualId) {
        window.wmsSessions = {};
        window.currentActivePedidoId = pedidoAtualId;
    }

    container.innerHTML = "";

    (dados.documentos || []).forEach((doc, index) => {
        const section = document.createElement('div');
        section.className = 'doc-section';
        section.style.width = '100%';
        section.style.maxWidth = '100%';
        section.style.background = '#fff';
        section.style.border = '1px solid #eaeaea';
        section.style.borderRadius = '12px';
        section.style.padding = '25px';
        section.style.boxShadow = '0 4px 15px rgba(0,0,0,0.03)';

        let caixasHtml = '';
        (doc.caixas || []).forEach((cx, cxIndex) => {
            const icon = cx.isBonificacao ? '<i class="fa-solid fa-star" style="color:var(--secondary)"></i>' : '<i class="fa-regular fa-star"></i>';
            const temProdutos = cx.produtos && cx.produtos.length > 0;
            
            // CSS BLINDADO NA TABELA: Impede que SKUs longos estiquem o card
            const produtosList = temProdutos ? cx.produtos.map(p => `<tr><td style="padding:6px 4px; word-break: break-all; max-width:80px; color:#555;">${p.referencia}</td><td style="padding:6px 4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:130px; color:#777;">${p.descricao}</td><td style="text-align:right; font-weight:bold; padding:6px 4px; color:var(--primary);">${p.quantidade || 1}</td></tr>`).join('') : '<tr><td colspan="3" style="text-align:center; color:#999; padding:15px;">Caixa Manual</td></tr>';

            caixasHtml += `
                <div class="caixa-item ${temProdutos ? '' : 'manual'}" style="background:#fff; border:1px solid #e0e0e0; border-left:4px solid var(--primary); border-radius:8px; overflow:hidden; display:flex; flex-direction:column;">
                    <div class="caixa-header" onclick="this.parentElement.classList.toggle('open')" style="background:var(--bg-base); padding:12px 15px; display:flex; justify-content:space-between; align-items:center; cursor:pointer;">
                        <div style="display:flex; align-items:center; gap:10px;">
                            <span class="bonificacao-star" onclick="event.stopPropagation(); window.toggleBonus(${index}, ${cxIndex})">${icon}</span>
                            <strong style="color:var(--primary); font-size:15px;"><i class="fa-solid fa-box" style="color:#aaa;"></i> ${cx.num || 'CX ?'}</strong> 
                        </div>
                        <div style="display:flex; align-items:center; gap:15px;">
                            <span style="color:#444; font-weight:bold; font-size:13px;">${cx.peso} kg</span>
                            ${temPermissao ? `<i class="fa-solid fa-trash" style="color:#dc3545;" onclick="event.stopPropagation(); excluirCaixa(${index}, ${cxIndex})"></i>` : ''}
                        </div>
                    </div>
                    <div class="caixa-body" style="padding:0 10px 10px 10px;"><table style="width:100%; font-size:11px; table-layout:fixed; border-collapse: collapse;"><thead style="background:#f9f9f9; border-bottom:1px solid #eee;"><tr><th style="padding:6px 4px; text-align:left; width:30%;">Ref</th><th style="padding:6px 4px; text-align:left; width:55%;">Desc</th><th style="text-align:right; padding:6px 4px; width:15%;">Qtd</th></tr></thead><tbody>${produtosList}</tbody></table></div>
                </div>`;
        });

        if(!caixasHtml) caixasHtml = '<div style="grid-column: 1 / -1; text-align:center; color:#ccc; font-style:italic; padding:30px 0;"><i class="fa-solid fa-box-open" style="font-size:30px; margin-bottom:10px;"></i><br>Nenhuma caixa efetivada ainda.</div>';
        
        const respText = doc.responsaveis ? doc.responsaveis.join(', ') : doc.responsavel;

        let acoesHtml = '';
        if (temPermissao) {
            if (dados.isCaixaMaster) {
                acoesHtml = `
                <div class="import-area" style="text-align:center; padding:80px 20px; background:#f8f9fa; border:2px dashed #ccd7e6; border-radius:12px; margin-top:15px; width: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center;">
                    <i class="fa-solid fa-file-csv" style="font-size:55px; color:#aab8c9; margin-bottom:20px;"></i>
                    <h3 style="color:var(--primary); margin:0 0 10px 0; font-size:24px;">Planejamento de Caixas Master</h3>
                    <p style="color:#666; font-size:15px; margin-bottom:30px; max-width:600px;">Faça o upload do arquivo CSV do WMS com a listagem do pedido para gerar a tela de volumes de forma instantânea.</p>
                    <label class="import-label" for="wmsCsvFile-${index}" style="background:var(--primary); color:#fff; padding:15px 40px; border-radius:8px; font-size:16px; font-weight:bold; cursor:pointer; display:inline-flex; align-items:center; gap:10px; transition:0.2s; box-shadow: 0 4px 10px rgba(0,0,0,0.1);" onmouseover="this.style.opacity='0.8'" onmouseout="this.style.opacity='1'">
                        <i class="fa-solid fa-upload"></i> Selecionar Arquivo CSV
                    </label>
                    <input type="file" id="wmsCsvFile-${index}" accept=".csv,.tsv,.txt" style="display:none;" onchange="window.processarWmsCSV(this, ${index})">
                </div>`;
            } else {
                acoesHtml = `
                <div style="display:flex; gap:15px; margin-bottom:20px; flex-wrap:wrap;">
                    <label class="import-label" for="csvFile-${index}" style="background:#eef2f8; color:var(--primary); border:1px solid #ccd7e6; padding:12px 20px; border-radius:8px; font-size:14px; font-weight:bold; cursor:pointer; display:inline-flex; align-items:center; gap:8px; transition:0.2s; flex:1; max-width:280px; justify-content:center;" onmouseover="this.style.background='#dce5f2'" onmouseout="this.style.background='#eef2f8'">
                        <i class="fa-solid fa-file-csv"></i> Importar CSV Efetivado
                    </label>
                    <input type="file" id="csvFile-${index}" accept=".csv" style="display:none;" onchange="window.processarCSV(this, ${index})">
                    
                    <button class="btn-add-manual" onclick="window.abrirModalAddCaixa(${index})" style="background:#fff; color:var(--primary); border:1px dashed var(--primary); padding:12px 20px; border-radius:8px; font-size:14px; font-weight:bold; cursor:pointer; display:inline-flex; align-items:center; gap:8px; transition:0.2s; flex:1; max-width:250px; justify-content:center;" onmouseover="this.style.background='#f8f9fa'" onmouseout="this.style.background='#fff'">
                        <i class="fa-solid fa-plus"></i> Nova Caixa Manual
                    </button>
                </div>
                <div id="fileName-${index}" class="file-status" style="font-size:13px; color:#666; margin-top:-10px; margin-bottom:15px;">${doc.arquivoCsv ? 'Arquivo base: <strong>' + doc.arquivoCsv + '</strong>' : ''}</div>`;
            }
        }

        if (dados.isCaixaMaster) {
            section.innerHTML = `
                <div class="doc-header" style="border-bottom: 2px solid #eee; padding-bottom: 15px; margin-bottom:15px;">
                    <h4 style="color:var(--primary); font-size:20px; margin:0;"><i class="fa-solid fa-layer-group"></i> ${doc.tipo} <span style="color:#999; font-weight:normal; font-size:14px; margin-left:10px;">(${respText})</span></h4>
                </div>
                ${acoesHtml}
                <div id="caixas-list-container-${index}" style="display:none;">${caixasHtml}</div>
                <div id="wms-panel-container-${index}" style="display:none;"></div>
            `;
        } else {
            section.innerHTML = `
                <div class="doc-header" style="border-bottom: 2px solid #eee; padding-bottom: 15px; margin-bottom:20px;">
                    <h4 style="color:var(--primary); font-size:20px; margin:0;"><i class="fa-solid fa-layer-group"></i> ${doc.tipo} <span style="color:#999; font-weight:normal; font-size:14px; margin-left:10px;">(${respText})</span></h4>
                </div>
                ${acoesHtml}
                
                <div id="caixas-list-container-${index}" style="border: 1px solid #e0e0e0; border-radius: 12px; padding: 25px; background: #fafafa; margin-top:20px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 20px; border-bottom: 2px solid #eaeaea; padding-bottom: 15px; flex-wrap:wrap; gap:15px;">
                        <h3 style="margin:0; color:var(--primary); font-size:18px;"><i class="fa-solid fa-cubes-stacked"></i> Caixas Efetivadas</h3>
                        <span style="background:var(--primary); color:#fff; padding:6px 15px; border-radius:20px; font-size:13px; font-weight:bold; box-shadow:0 2px 5px rgba(0,0,0,0.1);">${doc.caixas ? doc.caixas.length : 0} Volume(s)</span>
                    </div>
                    
                    <div style="position:relative; margin-bottom:20px;">
                        <i class="fa-solid fa-magnifying-glass" style="position:absolute; left:15px; top:13px; color:#aaa; font-size:15px;"></i>
                        <input type="text" onkeyup="window.filtrarCaixasComuns(this.value, ${index})" placeholder="Buscar volume por SKU ou Tipo de Caixa..." style="width:100%; padding:12px 15px 12px 40px; border:1px solid #ccd7e6; border-radius:8px; font-size:14px; outline:none; transition:0.2s; box-shadow:inset 0 1px 3px rgba(0,0,0,0.02);">
                    </div>

                    <div id="lista-volumes-comuns-${index}" style="max-height:50vh; overflow-y:auto; padding-right:10px; display:grid; grid-template-columns: repeat(auto-fill, 330px); gap:15px; justify-content:start; align-items:start;">
                        ${caixasHtml}
                    </div>
                </div>
                <div id="wms-panel-container-${index}" style="display:none;"></div>
            `;
        }

        container.appendChild(section);

        let planejamentoSalvo = pedidoAtualTipo === 'simples' ? dados.planejamentoWms : doc.planejamentoWms;
        if (!window.wmsSessions[index] && planejamentoSalvo) {
            window.wmsSessions[index] = {
                skus: planejamentoSalvo.skus,
                fileName: planejamentoSalvo.fileName,
                loja: planejamentoSalvo.loja,
                romaneio: planejamentoSalvo.romaneio,
                sortCol: 'ref',
                sortDir: 'asc'
            };
        }
    });

    Object.keys(window.wmsSessions).forEach(idx => {
        if(window.wmsSessions[idx]) {
            window.recalcWmsBoxes(idx);
            window.renderWmsPanel(idx);
        }
    });
};

// 2. A Função que salva no banco (Agora aceita gravar o Planejamento)
window.salvarNovasCaixas = async function(novasCaixas, docIndex, arquivoNome = null, planejamentoWms = null) {
    const coll = pedidoAtualTipo === 'simples' ? 'pedidos' : 'pedidosMultiDocumento';
    const ref = db.collection("usuarios").doc(pedidoAtualCriadorUid).collection("elementos").doc(pedidoAtualElementoId).collection(coll).doc(pedidoAtualId);
    
    try {
        const docSnap = await ref.get();
        let data = docSnap.data();
        let updateData = {}; 
        let documentosAtualizados = [];

        if (pedidoAtualTipo === 'simples') {
            if (arquivoNome) {
                updateData = { caixas: novasCaixas, arquivoCsv: arquivoNome };
                if (planejamentoWms) updateData.planejamentoWms = planejamentoWms; // Grava no banco
            } else {
                updateData = { caixas: [...(data.caixas || []), ...novasCaixas] };
            }
        } else {
            let documentos = data.documentos || [];
            if (arquivoNome) {
                documentos[docIndex].caixas = novasCaixas;
                documentos[docIndex].arquivoCsv = arquivoNome;
                if (planejamentoWms) documentos[docIndex].planejamentoWms = planejamentoWms; // Grava no banco
            } else {
                documentos[docIndex].caixas = [...(documentos[docIndex].caixas || []), ...novasCaixas];
            }
            updateData = { documentos: documentos };
            documentosAtualizados = documentos;
        }

        if(pedidoAtualTipo !== 'simples' && documentosAtualizados.length > 0) {
            const todosComCsv = documentosAtualizados.every(d => d.arquivoCsv && d.arquivoCsv.length > 0);
            if(todosComCsv && !data.efetivado) { 
                updateData.efetivado = true; 
                updateData.completedAt = firebase.firestore.FieldValue.serverTimestamp(); 
            }
        }
        await ref.update(updateData);
        await window.renderizarGridCaixas(); 
    } catch (error) { alert("Erro ao salvar caixa: " + error.message); }
};

// 3. O Botão Confirmar (Agora empacota o planejamento e manda salvar)
window.salvarWmsFinal = async function(docIndex) {
    const s = window.wmsSessions[docIndex];
    
    // Validação de Segurança
    const pendentes = s.skus.filter(sku => sku.isMissing);
    if (pendentes.length > 0) {
        return alert(`Existem ${pendentes.length} produto(s) com informações de caixa faltando. Preencha os campos em vermelho antes de salvar.`);
    }

    if(confirm(`Deseja efetivar a gravação de ${s.caixasGeradas.length} caixas para este documento?`)) {
        document.body.style.cursor = 'wait';
        
        // O SEGREDO 3: EMPACOTA O PAINEL PARA O FIREBASE
        const sessionToSave = {
            fileName: s.fileName,
            skus: s.skus.map(sku => {
                const clone = { ...sku };
                delete clone.caixasGeradasDesteSku; // Tira dados pesados
                return clone;
            })
        };

        // Salva as caixas reais + o painel num tiro só
        await window.salvarNovasCaixas(s.caixasGeradas, docIndex, s.fileName, sessionToSave);
        
        if (typeof registrarLog === 'function') registrarLog("Planejamento Master WMS", "sucesso", `Salvas ${s.caixasGeradas.length} caixas e painel gravado.`);
        document.body.style.cursor = 'default';
        alert("Planejamento Efetivado e Salvo com Sucesso!");
    }
};
window.excluirCaixa = async function(docIndex, cxIndex) {
    if(!confirm("Excluir caixa?")) return;
    const ref = db.collection("usuarios").doc(pedidoAtualCriadorUid).collection("elementos").doc(pedidoAtualElementoId).collection(pedidoAtualTipo==='simples'?'pedidos':'pedidosMultiDocumento').doc(pedidoAtualId);
    const doc = await ref.get(); let data = doc.data();
    if(pedidoAtualTipo === 'simples') { data.caixas.splice(cxIndex, 1); await ref.update({ caixas: data.caixas }); } 
    else { data.documentos[docIndex].caixas.splice(cxIndex, 1); await ref.update({ documentos: data.documentos }); }
    await renderizarGridCaixas();
}
// =========================================================================
// MOTOR DE BONIFICAÇÃO (MANTÉM ROLAGEM E ATUALIZA MODAL EM TEMPO REAL)
// =========================================================================
window.toggleBonus = async function(docIndex, cxIndex) {
    // 1. Tira uma "foto" de como a tela está agora (Rolagem e Modal)
    const containerNormal = document.getElementById(`lista-volumes-comuns-${docIndex}`);
    const scrollNormal = containerNormal ? containerNormal.scrollTop : 0;
    
    const modalContent = document.getElementById('modalCaixasEfetivadasContent');
    const scrollModal = modalContent ? modalContent.scrollTop : 0;
    const modalIsVisible = document.getElementById('modalCaixasEfetivadasWms') && document.getElementById('modalCaixasEfetivadasWms').style.display === 'flex';

    document.body.style.cursor = 'wait';

    try {
        // 2. Muda a estrela no Banco de Dados
        const coll = pedidoAtualTipo === 'simples' ? 'pedidos' : 'pedidosMultiDocumento';
        const docRef = db.collection("usuarios").doc(pedidoAtualCriadorUid).collection("elementos").doc(pedidoAtualElementoId).collection(coll).doc(pedidoAtualId);
        const docSnap = await docRef.get();
        
        if (docSnap.exists) {
            let data = docSnap.data();
            if (pedidoAtualTipo === 'simples') {
                data.caixas[cxIndex].isBonificacao = !data.caixas[cxIndex].isBonificacao;
                await docRef.update({ caixas: data.caixas });
            } else {
                data.documentos[docIndex].caixas[cxIndex].isBonificacao = !data.documentos[docIndex].caixas[cxIndex].isBonificacao;
                await docRef.update({ documentos: data.documentos });
            }
        }

        // 3. Atualiza os resumos da tela base (isso destrói e recria o HTML)
        await window.renderizarGridCaixas();

        // 4. A Mágica: Devolve a tela pra exata mesma posição de antes!
        setTimeout(() => {
            const novoContainerNormal = document.getElementById(`lista-volumes-comuns-${docIndex}`);
            if (novoContainerNormal) novoContainerNormal.scrollTop = scrollNormal;

            // Se você clicou na estrela DENTRO do Modal do Caixa Master:
            if (modalIsVisible) {
                window.abrirCaixasEfetivadas(docIndex); // Copia o HTML fresquinho (com a estrela preenchida) pro Modal
                const novoModalContent = document.getElementById('modalCaixasEfetivadasContent');
                if (novoModalContent) novoModalContent.scrollTop = scrollModal; // Devolve a rolagem do modal
            }
        }, 50);

    } catch (error) {
        console.error("Erro ao alternar bonificação:", error);
    } finally {
        document.body.style.cursor = 'default';
    }
};

// Variáveis temporárias para segurar os dados do CSV até a confirmação
let pendingCsvCaixas = [];
let pendingCsvDocIndex = null;
let pendingCsvFileName = "";

window.processarCSV = function(input, indexDocumento) {
    const file = input.files[0]; 
    input.value = '';
    if(!file) return;

    window.iniciarLeituraCSV(file, "Caixas Efetivadas", "Volumes Identificados", () => {
        
        window.executarLoadingAvancado(
            "Lendo Caixas Efetivadas", 
            "Extraindo volumes e atualizando o banco de dados...", 
            "Volumes Importados!", 
            () => new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = async (ev) => {
                    try {
                        const texto = ev.target.result;
                        const novasCaixas = await parseCsvParaCaixas(texto); 
                        await window.salvarNovasCaixas(novasCaixas, indexDocumento, file.name);
                        resolve();
                    } catch (e) { reject(e); }
                };
                reader.readAsText(file, 'ISO-8859-1');
            })
        );
    });
};

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
// RESTAURAÇÃO: FUNÇÕES DE CAIXA MANUAL PARA PEDIDOS NORMAIS
// =========================================================================

window.caixaDocIndexAtual = null;

window.abrirModalAddCaixa = function(index) {
    window.caixaDocIndexAtual = index;
    const modal = document.getElementById('addCaixaModal'); // Nome padrão do seu modal original
    if (modal) {
        modal.style.display = 'flex';
    } else {
        console.error("Modal de adicionar caixa não encontrado no HTML!");
    }
};

window.fecharModalAddCaixa = function() {
    const modal = document.getElementById('addCaixaModal');
    if (modal) modal.style.display = 'none';
};

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

// =========================================================================
// MODAIS DE CONFIRMAÇÃO DINÂMICOS (GERADOS VIA JS) E VARIÁVEIS DE ESPERA
// =========================================================================

window.pendingWmsPlanData = null;
window.pendingWmsAuditData = null;

// =========================================================================
// MOTOR AVANÇADO DE ANIMAÇÃO (PROGRESSO + SUCESSO)
// =========================================================================

if (!document.getElementById('wmsProgressLoader')) {
    document.body.insertAdjacentHTML('beforeend', `
    <div id="wmsProgressLoader" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(255,255,255,0.9); backdrop-filter:blur(8px); z-index:9999999; align-items:center; justify-content:center; flex-direction:column; transition: opacity 0.3s ease; opacity:0;">
        
        <div id="loader-state-progress" style="width: 100%; max-width: 400px; text-align: center;">
            <h3 id="wmsLoaderTitle" style="color:var(--primary); margin:0 0 10px 0; font-size:24px; font-weight:900;">Processando...</h3>
            <p id="wmsLoaderSubtitle" style="color:#666; font-size:14px; font-weight:bold; margin-bottom: 25px;">Aguarde um momento</p>
            <div style="background:#e2e8f0; border-radius:20px; width:100%; height:14px; overflow:hidden; box-shadow: inset 0 2px 4px rgba(0,0,0,0.05);">
                <div id="wmsLoaderBar" style="background:var(--success); width:0%; height:100%; transition: width 0.15s linear; border-radius:20px; position:relative; overflow:hidden;">
                    <div style="position:absolute; top:0; left:0; right:0; bottom:0; background: linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.3) 50%, rgba(255,255,255,0) 100%); animation: shimmer 1.5s infinite;"></div>
                </div>
            </div>
            <div id="wmsLoaderPct" style="margin-top:12px; font-weight:900; color:var(--success); font-size:18px;">0%</div>
        </div>

        <div id="loader-state-success" style="display:none; text-align:center; animation: popInMaster 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);">
            <div style="width:90px; height:90px; background:var(--success); border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto 20px auto; box-shadow: 0 10px 25px rgba(40, 167, 69, 0.4);">
                <i class="fa-solid fa-check" style="font-size:45px; color:#fff;"></i>
            </div>
            <h3 id="wmsLoaderSuccessText" style="color:var(--success); margin:0; font-size:28px; font-weight:900;">Concluído!</h3>
        </div>
        
        <style>
            @keyframes shimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
        </style>
    </div>
    `);
}

// =========================================================================
// MOTOR DE PRÉ-LEITURA DE ARQUIVOS E MODAL DE RESUMO
// =========================================================================

if (!document.getElementById('wmsFastSpinner')) {
    document.body.insertAdjacentHTML('beforeend', `
    <div id="wmsFastSpinner" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(255,255,255,0.85); backdrop-filter:blur(4px); z-index:9999999; align-items:center; justify-content:center; flex-direction:column; transition: opacity 0.2s ease; opacity:0;">
        <i class="fa-solid fa-file-csv fa-bounce" style="font-size:55px; color:var(--primary); margin-bottom:20px;"></i>
        <h3 style="color:var(--primary); margin:0; font-size:22px; font-weight:900;">Lendo Arquivo...</h3>
        <p style="color:#666; font-size:14px; font-weight:bold; margin-top:5px;">Mapeando colunas e registros</p>
    </div>

    <div id="wmsConfirmCsvModal" style="display:none; align-items:center; justify-content:center; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:9999998;">
        <div style="background:#fff; padding:35px; border-radius:15px; width:450px; text-align:center; box-shadow:0 20px 40px rgba(0,0,0,0.25); animation: popInMaster 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);">
            
            <div style="font-size:45px; color:var(--secondary); margin-bottom:15px;"><i class="fa-solid fa-magnifying-glass-chart"></i></div>
            <h3 id="wmsConfirmCsvTitle" style="color:var(--primary); margin:0 0 5px 0; font-size:24px; font-weight:900;">Resumo do Arquivo</h3>
            <p style="color:#666; font-size:13px; margin-bottom:25px; word-break: break-all;">Arquivo: <strong id="wmsConfirmCsvName" style="color:#333;"></strong></p>

            <div style="background:#f8f9fa; border:1px solid #e2e8f0; padding:25px; border-radius:12px; margin-bottom:30px; box-shadow: inset 0 2px 4px rgba(0,0,0,0.02);">
                <div style="font-size:48px; font-weight:900; color:var(--primary); line-height:1;" id="wmsConfirmCsvCount">0</div>
                <div style="font-size:12px; color:#888; font-weight:bold; text-transform:uppercase; letter-spacing:1.5px; margin-top:5px;" id="wmsConfirmCsvLabel">Registros Encontrados</div>
            </div>

            <div style="display:flex; gap:12px;">
                <button onclick="document.getElementById('wmsConfirmCsvModal').style.display='none'" style="flex:1; padding:14px; background:#eef2f8; color:var(--primary); border:none; border-radius:8px; cursor:pointer; font-weight:bold; transition:0.2s;" onmouseover="this.style.background='#dce5f2'">Cancelar</button>
                <button id="wmsConfirmCsvBtn" style="flex:1; padding:14px; background:var(--success); color:#fff; border:none; border-radius:8px; cursor:pointer; font-weight:bold; transition:0.2s; display:flex; align-items:center; justify-content:center; gap:8px;" onmouseover="this.style.opacity='0.9', this.style.transform='translateY(-1px)'"><i class="fa-solid fa-cloud-arrow-up"></i> Confirmar e Importar</button>
            </div>

        </div>
    </div>
    `);
}

window.iniciarLeituraCSV = function(file, titulo, labelContagem, onConfirm) {
    const spinner = document.getElementById('wmsFastSpinner');
    spinner.style.display = 'flex';
    setTimeout(() => spinner.style.opacity = '1', 10);

    // Oculta a tela de leitura após 900ms para causar efeito de processamento
    setTimeout(() => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const text = e.target.result;
            // Lê rapidamente apenas para contar as linhas
            const linhas = text.trim().split(/\r\n|\n|\r/);
            const count = Math.max(0, linhas.length - 1); 

            // Alimenta os dados no Popup de Resumo
            document.getElementById('wmsConfirmCsvTitle').textContent = titulo;
            document.getElementById('wmsConfirmCsvName').textContent = file.name;
            document.getElementById('wmsConfirmCsvCount').textContent = count;
            document.getElementById('wmsConfirmCsvLabel').textContent = labelContagem;

            const btnConfirm = document.getElementById('wmsConfirmCsvBtn');
            btnConfirm.onclick = () => {
                document.getElementById('wmsConfirmCsvModal').style.display = 'none';
                onConfirm(); // Inicia o processamento real no banco de dados!
            };

            // Esconde a animação de leitura e abre o Popup
            spinner.style.opacity = '0';
            setTimeout(() => {
                spinner.style.display = 'none';
                document.getElementById('wmsConfirmCsvModal').style.display = 'flex';
            }, 200);
        };
        reader.readAsText(file, 'ISO-8859-1');
    }, 900);
};

// =========================================================================
// MOTOR AVANÇADO DE ANIMAÇÃO (COM ATRASO ARTIFICIAL)
// =========================================================================

window.executarLoadingAvancado = async function(titulo, subtitulo, textoSucesso, acaoAssincrona) {
    const loader = document.getElementById('wmsProgressLoader');
    const stateProgress = document.getElementById('loader-state-progress');
    const stateSuccess = document.getElementById('loader-state-success');
    const bar = document.getElementById('wmsLoaderBar');
    const pct = document.getElementById('wmsLoaderPct');

    document.getElementById('wmsLoaderTitle').textContent = titulo;
    document.getElementById('wmsLoaderSubtitle').textContent = subtitulo;
    document.getElementById('wmsLoaderSuccessText').textContent = textoSucesso;

    stateProgress.style.display = 'block';
    stateSuccess.style.display = 'none';
    bar.style.width = '0%';
    pct.textContent = '0%';

    loader.style.display = 'flex';
    setTimeout(() => loader.style.opacity = '1', 10);

    // Barra enchendo mais devagar (cresce de 2% a 8% a cada 200ms)
    let progresso = 0;
    let intervalo = setInterval(() => {
        progresso += Math.floor(Math.random() * 7) + 2; 
        if (progresso > 85) progresso = 85; // Trava no 85% criando aquele "suspense"
        bar.style.width = progresso + '%';
        pct.textContent = progresso + '%';
    }, 200);

    try {
        // O TRUQUE DO ATRASO: Executa a ação no Firebase e obriga a tela a esperar NO MÍNIMO 2 segundos (2000ms)
        await Promise.all([
            acaoAssincrona(),
            new Promise(r => setTimeout(r, 2000)) // <-- Você pode alterar esse "2000" para 3000 (3 segs) se quiser mais demorado
        ]);
        
        // Finaliza o suspense e pula pro 100%
        clearInterval(intervalo);
        bar.style.width = '100%';
        pct.textContent = '100%';
        
        // Deixa a barra cheia por meio segundo antes de mostrar o certinho verde
        await new Promise(r => setTimeout(r, 500));

        // Troca para o checkmark de sucesso
        stateProgress.style.display = 'none';
        stateSuccess.style.display = 'block';

        // Segura o checkmark de sucesso na tela por mais tempo (1.5 segundos) para o usuário ler tranquilo
        await new Promise(r => setTimeout(r, 1500));

    } catch (e) {
        clearInterval(intervalo);
        alert("Erro no processo: " + e.message);
    } finally {
        loader.style.opacity = '0';
        setTimeout(() => loader.style.display = 'none', 300);
    }
};

// =========================================================================
// TELA DE CARREGAMENTO GLOBAL (SMOOTH UX)
// =========================================================================
if (!document.getElementById('wmsGlobalLoader')) {
    document.body.insertAdjacentHTML('beforeend', `
    <div id="wmsGlobalLoader" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(255,255,255,0.85); backdrop-filter:blur(5px); z-index:9999999; align-items:center; justify-content:center; flex-direction:column; transition: opacity 0.3s ease; opacity:0;">
        <i class="fa-solid fa-circle-notch fa-spin" style="font-size:50px; color:var(--primary); margin-bottom:20px; text-shadow: 0 4px 10px rgba(0,0,0,0.1);"></i>
        <h3 id="wmsLoaderText" style="color:var(--primary); margin:0; font-size:20px; font-weight:900; letter-spacing:-0.5px;">Processando...</h3>
        <p style="color:#666; font-size:14px; margin-top:8px; font-weight:bold;">Por favor, aguarde enquanto organizamos os dados.</p>
    </div>
    `);
}

window.showWmsLoader = function(text) {
    document.getElementById('wmsLoaderText').textContent = text || 'Processando...';
    const loader = document.getElementById('wmsGlobalLoader');
    loader.style.display = 'flex';
    // O pequeno atraso garante que a transição do CSS funcione
    setTimeout(() => loader.style.opacity = '1', 10); 
};

window.hideWmsLoader = function() {
    const loader = document.getElementById('wmsGlobalLoader');
    loader.style.opacity = '0';
    setTimeout(() => loader.style.display = 'none', 300); // Aguarda o fade out
};

// Injeta o HTML dos Modais na página automaticamente
if (!document.getElementById('confirmWmsPlanModal')) {
    document.body.insertAdjacentHTML('beforeend', `
    <div id="confirmWmsPlanModal" style="display:none; align-items:center; justify-content:center; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:99999;">
        <div style="background:#fff; padding:25px; border-radius:12px; width:400px; text-align:center; box-shadow:0 10px 25px rgba(0,0,0,0.2); animation: popInMaster 0.3s ease-out;">
            <h3 style="color:var(--primary); margin-top:0; font-size:20px;"><i class="fa-solid fa-file-csv"></i> Confirmar Planejamento</h3>
            <p style="color:#555; font-size:14px; margin-bottom:10px;">Arquivo Selecionado:<br><strong id="planFileName"></strong></p>
            <div style="background:#f8f9fa; padding:15px; border-radius:8px; margin-bottom:20px; border:1px solid #eee;">
                <span style="font-size:32px; font-weight:900; color:var(--primary);" id="planTotalSkus">0</span><br>
                <span style="font-size:12px; color:#666; font-weight:bold;">SKUs IDENTIFICADOS</span>
            </div>
            <div style="display:flex; justify-content:center; gap:10px;">
                <button onclick="document.getElementById('confirmWmsPlanModal').style.display='none'" style="flex:1; padding:12px; background:#e0e0e0; color:#333; border:none; border-radius:6px; cursor:pointer; font-weight:bold; transition:0.2s;" onmouseover="this.style.background='#d0d0d0'" onmouseout="this.style.background='#e0e0e0'">Cancelar</button>
                <button onclick="window.efetivarImportacaoPlan()" style="flex:1; padding:12px; background:var(--primary); color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:bold; transition:0.2s;" onmouseover="this.style.opacity='0.8'" onmouseout="this.style.opacity='1'">Importar</button>
            </div>
        </div>
    </div>
    `);
}

if (!document.getElementById('confirmWmsAuditModal')) {
    document.body.insertAdjacentHTML('beforeend', `
    <div id="confirmWmsAuditModal" style="display:none; align-items:center; justify-content:center; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:99999;">
        <div style="background:#fff; padding:25px; border-radius:12px; width:400px; text-align:center; box-shadow:0 10px 25px rgba(0,0,0,0.2); animation: popInMaster 0.3s ease-out;">
            <h3 style="color:#856404; margin-top:0; font-size:20px;"><i class="fa-solid fa-magnifying-glass-chart"></i> Confirmar Auditoria</h3>
            <p style="color:#555; font-size:14px; margin-bottom:10px;">Arquivo do WMS:<br><strong id="auditFileName"></strong></p>
            <div style="background:#fff3cd; padding:15px; border-radius:8px; margin-bottom:20px; border:1px solid #ffeeba;">
                <span style="font-size:32px; font-weight:900; color:#856404;" id="auditTotalBoxes">0</span><br>
                <span style="font-size:12px; color:#856404; font-weight:bold;">VOLUMES LIDOS NO ARQUIVO</span>
            </div>
            <div style="display:flex; justify-content:center; gap:10px;">
                <button onclick="document.getElementById('confirmWmsAuditModal').style.display='none'" style="flex:1; padding:12px; background:#e0e0e0; color:#333; border:none; border-radius:6px; cursor:pointer; font-weight:bold; transition:0.2s;" onmouseover="this.style.background='#d0d0d0'" onmouseout="this.style.background='#e0e0e0'">Cancelar</button>
                <button onclick="window.efetivarAuditoriaWms()" style="flex:1; padding:12px; background:#856404; color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:bold; transition:0.2s;" onmouseover="this.style.opacity='0.8'" onmouseout="this.style.opacity='1'">Auditar Saída</button>
            </div>
        </div>
    </div>
    `);
}

// =========================================================================
// MODAL DE IMPORTAÇÃO RÁPIDA DE SKU (CADASTRO EXPRESSO) E FUNÇÕES
// =========================================================================

if (!document.getElementById('importarSkuModal')) {
    document.body.insertAdjacentHTML('beforeend', `
    <div id="importarSkuModal" style="display:none; align-items:center; justify-content:center; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:99999;">
        <div style="background:#fff; padding:25px; border-radius:12px; width:450px; text-align:center; box-shadow:0 10px 25px rgba(0,0,0,0.2); animation: popInMaster 0.3s ease-out;">
            <h3 style="color:var(--success); margin-top:0; font-size:20px;"><i class="fa-solid fa-cloud-arrow-up"></i> Salvar no Banco de Dados</h3>
            <p id="importSkuTitle" style="color:var(--primary); font-size:15px; font-weight:900; margin-bottom:15px;"></p>
            
            <div id="importSkuDetails" style="background:#f8f9fa; padding:15px; border-radius:8px; margin-bottom:20px; border:1px dashed #ccc; font-size:14px; color:#555;">
                </div>
            
            <div style="margin-bottom:20px; text-align:left;">
                <label style="font-size:12px; font-weight:bold; color:#666; margin-bottom:5px; display:block;">Código de Barras (DUN-14):</label>
                <input type="text" id="importSkuBarcode" style="width:100%; padding:10px; border:1px solid #ccc; border-radius:6px; font-size:14px; text-align:center;" placeholder="Digite ou bipe o código aqui" autocomplete="off">
            </div>
            
            <div style="display:flex; justify-content:center; gap:10px;">
                <button onclick="window.fecharModalImportarSku()" style="flex:1; padding:12px; background:#e0e0e0; color:#333; border:none; border-radius:6px; cursor:pointer; font-weight:bold; transition:0.2s;" onmouseover="this.style.background='#d0d0d0'" onmouseout="this.style.background='#e0e0e0'">Cancelar</button>
                <button onclick="window.salvarNovoSkuMaster()" style="flex:1; padding:12px; background:var(--success); color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:bold; transition:0.2s;" onmouseover="this.style.opacity='0.8'" onmouseout="this.style.opacity='1'">Importar</button>
            </div>
        </div>
    </div>
    `);
}

window.pendingImportSku = null;

window.abrirModalImportarSku = function(docIndex, skuIdx) {
    const sku = window.wmsSessions[docIndex].skus[skuIdx];
    window.pendingImportSku = { docIndex, skuIdx, sku };

    document.getElementById('importSkuTitle').textContent = `${sku.ref} - ${sku.desc}`;
    document.getElementById('importSkuDetails').innerHTML = `<strong style="color:var(--primary)">CX ${sku.qtdPadrao}</strong> &nbsp;&nbsp;!&nbsp;&nbsp; <strong>${sku.caixaNome}</strong> &nbsp;&nbsp;!&nbsp;&nbsp; <strong>PESO ${sku.pesoPadrao}kg</strong>`;
    document.getElementById('importSkuBarcode').value = '';

    document.getElementById('importarSkuModal').style.display = 'flex';
    setTimeout(() => document.getElementById('importSkuBarcode').focus(), 100);
};

window.fecharModalImportarSku = function() {
    document.getElementById('importarSkuModal').style.display = 'none';
    window.pendingImportSku = null;
};

window.salvarNovoSkuMaster = async function() {
    if(!window.pendingImportSku) return;
    const barcode = document.getElementById('importSkuBarcode').value.trim();
    if(!barcode) return alert('Por favor, informe o código de barras!');

    const { docIndex, skuIdx, sku } = window.pendingImportSku;
    
    // Formata do jeito que o seu banco de dados gosta
    const novaVariacao = {
        caixa: sku.caixaNome,
        quantidade: `CX ${sku.qtdPadrao}`,
        peso: sku.pesoPadrao,
        codigoBarras: barcode
    };

    document.body.style.cursor = 'wait';
    try {
        // Verifica se o SKU já tem alguma outra variação cadastrada antes
        const snapshot = await db.collection('caixasMaster').where('ref', '==', sku.ref).get();
        let docId = null;
        let variacoesAtuais = [];

        if (!snapshot.empty) {
            const doc = snapshot.docs[0];
            docId = doc.id;
            variacoesAtuais = doc.data().variacoes || [];
            variacoesAtuais.push(novaVariacao);
            await db.collection('caixasMaster').doc(docId).update({ variacoes: variacoesAtuais });
        } else {
            variacoesAtuais = [novaVariacao];
            const novoDoc = await db.collection('caixasMaster').add({
                ref: sku.ref,
                nome: sku.desc,
                variacoes: variacoesAtuais
            });
            docId = novoDoc.id;
        }

        // MÁGICA: Transforma a linha provisória em uma linha oficial cadastrada!
        sku.isOriginalMissing = false;
        sku.isMissing = false;
        sku.variacoesDisponiveis = variacoesAtuais;
        sku.selectedVar = variacoesAtuais.length - 1; // Seleciona automaticamente a que acabou de criar

        window.recalcWmsBoxes(docIndex);
        window.renderWmsPanel(docIndex);
        await window.autoSavePlanejamento(docIndex);

        window.fecharModalImportarSku();
        
        // Notificação discreta pra não travar a tela
        const btnRow = document.getElementById(`wms-panel-container-${docIndex}`);
        if(btnRow) alert("✅ SKU salvo e integrado ao Banco de Dados com sucesso!");

    } catch(e) {
        alert('Erro ao salvar no banco: ' + e.message);
    } finally {
        document.body.style.cursor = 'default';
    }
};

// =========================================================================
// INJEÇÃO DO MODAL DE RESULTADO DA AUDITORIA (SEPARADO)
// =========================================================================
if (!document.getElementById('wmsAuditoriaResultModal')) {
    document.body.insertAdjacentHTML('beforeend', `
    <div id="wmsAuditoriaResultModal" style="display:none; align-items:center; justify-content:center; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:999999;">
        <div style="background:#fff; padding:25px; border-radius:12px; width:700px; max-width:92%; max-height:85vh; overflow-y:auto; box-shadow:0 12px 35px rgba(0,0,0,0.25); animation: popInMaster 0.3s ease-out; position:relative;">
            <span onclick="document.getElementById('wmsAuditoriaResultModal').style.display='none'" style="position:absolute; top:15px; right:20px; font-size:24px; cursor:pointer; color:#999; font-weight:bold;" onmouseover="this.style.color='#333'" onmouseout="this.style.color='#999'">&times;</span>
            <div id="wmsAuditoriaResultContent"></div>
            <div style="text-align:right; margin-top:20px; border-top:1px solid #eee; padding-top:15px;">
                <button onclick="document.getElementById('wmsAuditoriaResultModal').style.display='none'" style="padding:10px 20px; background:var(--primary); color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:bold; transition:0.2s;" onmouseover="this.style.opacity='0.9'">Fechar Relatório</button>
            </div>
        </div>
    </div>
    `);
}

// Estilo CSS injetado dinamicamente para o comportamento do Pop-over expansível
if (!document.getElementById('wmsHoverResumeStyle')) {
    document.body.insertAdjacentHTML('beforeend', `
    <style id="wmsHoverResumeStyle">
        .wms-hover-container { position: relative; display: inline-block; }
        .wms-hover-card { 
            display: none; position: absolute; top: 100%; right: 0; width: 340px; 
            background: #fff; border: 1px solid #ddd; border-radius: 10px; 
            box-shadow: 0 8px 25px rgba(0,0,0,0.15); padding: 15px; z-index: 1000; 
            animation: fadeInMaster 0.2s ease-out;
        }
        .wms-hover-container:hover .wms-hover-card { display: block !important; }
    </style>
    `);
}

window.processarWmsCSV = function(input, docIndex) {
    const file = input.files[0]; 
    input.value = ''; // Reseta o botão instantaneamente para caso o usuário cancele
    if(!file) return;

    window.iniciarLeituraCSV(file, "Planejamento Master", "SKUs Encontrados", () => {
        
        window.executarLoadingAvancado(
            "Analisando Planejamento", 
            "Lendo estrutura de SKUs e extraindo dados...", 
            "Planejamento Importado!", 
            () => new Promise((resolve, reject) => {
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

                        if(idxRef === -1 || idxQtd === -1) throw new Error("Colunas de Código ou Quantidade não encontradas no CSV.");

                        const coll = pedidoAtualTipo === 'simples' ? 'pedidos' : 'pedidosMultiDocumento';
                        const docSnap = await db.collection("usuarios").doc(pedidoAtualCriadorUid).collection("elementos").doc(pedidoAtualElementoId).collection(coll).doc(pedidoAtualId).get();
                        let lojaNome = "Geral"; let romaneioNum = "---";
                        if(docSnap.exists) {
                            const d = docSnap.data();
                            lojaNome = d.loja || "Geral"; romaneioNum = d.romaneio || "---";
                        }

                        const snapMaster = await db.collection('caixasMaster').get();
                        const baseMaster = []; snapMaster.forEach(d => baseMaster.push(d.data()));

                        let skusProcessados = [];
                        for(let i=1; i<linhas.length; i++) {
                            const cols = linhas[i].split(separador).map(c => c.trim().replace(/^"|"$/g, ''));
                            if(cols.length <= idxRef) continue;
                            
                            const ref = cols[idxRef]; const qtd = parseInt(cols[idxQtd] || "0");
                            if(!ref || qtd <= 0) continue;

                            const masterRef = baseMaster.find(m => String(m.ref).trim() === String(ref).trim() || String(m.ref).trim().replace(/^0+/, '') === String(ref).trim().replace(/^0+/, ''));
                            const variacoesValidas = masterRef ? masterRef.variacoes.filter(v => parseInt(v.quantidade.replace(/\D/g, '')) > 0 && qtd % parseInt(v.quantidade.replace(/\D/g, '')) === 0) : [];
                            const isMissing = variacoesValidas.length === 0;

                            skusProcessados.push({
                                ref, desc: idxDesc !== -1 ? cols[idxDesc] : "Produto", qtdTotal: qtd, variacoesDisponiveis: variacoesValidas, selectedVar: 0,
                                caixaNome: !isMissing ? variacoesValidas[0].caixa : "", qtdPadrao: !isMissing ? parseInt(variacoesValidas[0].quantidade.replace(/\D/g, '')) : 0, pesoPadrao: !isMissing ? variacoesValidas[0].peso : 0,
                                isMissing: isMissing, isOriginalMissing: isMissing, isExpanded: false
                            });
                        }

                        window.wmsSessions[docIndex] = { skus: skusProcessados, sortCol: 'ref', sortDir: 'asc', fileName: file.name, loja: lojaNome, romaneio: romaneioNum };
                        
                        window.recalcWmsBoxes(docIndex);
                        window.renderWmsPanel(docIndex);
                        await window.autoSavePlanejamento(docIndex);
                        resolve();
                    } catch(err) { reject(err); }
                };
                reader.readAsText(file, 'ISO-8859-1');
            })
        );
    });
};

// Ação de Confirmar o Planejamento
window.efetivarImportacaoPlan = function() {
    if(window.pendingWmsPlanData) {
        const { docIndex, sessionData } = window.pendingWmsPlanData;
        window.wmsSessions[docIndex] = sessionData; 
        window.recalcWmsBoxes(docIndex);
        window.renderWmsPanel(docIndex);
        document.getElementById('confirmWmsPlanModal').style.display = 'none';
        window.pendingWmsPlanData = null; // Limpa a memória
    }
};

// =========================================================================
// FUNÇÃO DE CÓPIA DO CÓDIGO DE BARRAS DA PLATAFORMA
// =========================================================================
window.copiarCodigoBarraWms = function(codigo, btnElement) {
    if (!codigo) return alert("Este tipo de caixa não possui código de barras cadastrado!");
    
    navigator.clipboard.writeText(codigo).then(() => {
        const icon = btnElement.querySelector('i');
        icon.className = 'fa-solid fa-check';
        btnElement.style.color = '#28a745'; // Fica verde
        
        setTimeout(() => {
            icon.className = 'fa-regular fa-copy';
            btnElement.style.color = 'var(--secondary)'; // Volta ao original
        }, 1500);
    }).catch(err => {
        alert('Erro ao copiar código: ' + err);
    });
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
    
    // Atualiza a flag para permitir salvar, mas NÃO altera isOriginalMissing (pra manter input aberto)
    if (sku.qtdPadrao > 0 && sku.caixaNome !== "" && sku.pesoPadrao > 0) {
        sku.isMissing = false; 
    } else {
        sku.isMissing = true;
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
            
            // GUARDA NA MEMÓRIA GLOBAL TEMPORÁRIA E ABRE O MODAL
            window.pendingWmsAuditData = {
                docIndex: docIndex,
                caixasReais: caixasReais,
                fileName: file.name
            };

            document.getElementById('auditFileName').textContent = file.name;
            document.getElementById('auditTotalBoxes').textContent = caixasReais.length;
            document.getElementById('confirmWmsAuditModal').style.display = 'flex';

        } catch(err) {
            alert("Erro na auditoria: Certifique-se de estar importando o CSV correto de caixas efetivadas. \n\n" + err.message);
        } finally { input.value = ''; }
    };
    reader.readAsText(file, 'ISO-8859-1');
};

window.efetivarAuditoriaWms = async function() {
    if(!window.pendingWmsAuditData) return;
    const { docIndex, caixasReais, fileName } = window.pendingWmsAuditData;
    const totalReais = caixasReais.length; 
    const session = window.wmsSessions[docIndex];
    
    document.body.style.cursor = 'wait';
    document.getElementById('confirmWmsAuditModal').style.display = 'none';

    try {
        // 1. Cálculos de Auditoria
        let planSummary = {};
        let planejado = 0;
        session.caixasGeradas.forEach(cx => {
            planejado++;
            let key = cx.num || "INDEFINIDA";
            if(!planSummary[key]) planSummary[key] = { qtd: 0, pesoTotal: 0 };
            planSummary[key].qtd++;
            planSummary[key].pesoTotal += parseFloat(cx.peso || 0);
        });

        let realSummary = {};
        caixasReais.forEach(cx => {
            let key = cx.num || "INDEFINIDA";
            if(!realSummary[key]) realSummary[key] = { qtd: 0, pesoTotal: 0 };
            realSummary[key].qtd++;
            realSummary[key].pesoTotal += parseFloat(cx.peso || 0);
        });

        const diff = planejado - totalReais;
        const isPerfect = (planejado === totalReais);
        const cor = isPerfect ? '#155724' : '#721c24';
        const bg = isPerfect ? '#d4edda' : '#f8d7da';

        let allTypes = new Set([...Object.keys(planSummary), ...Object.keys(realSummary)]);
        let summaryRows = Array.from(allTypes).sort().map(type => {
            const p = planSummary[type] || { qtd: 0, pesoTotal: 0 };
            const r = realSummary[type] || { qtd: 0, pesoTotal: 0 };
            const matchQtd = p.qtd === r.qtd;
            const matchPeso = Math.abs(p.pesoTotal - r.pesoTotal) < 0.02; 
            return `
                <tr style="border-bottom:1px solid #eee; background: ${matchQtd && matchPeso ? '#fff' : '#fff5f5'}; font-size:13px;">
                    <td style="padding:12px; text-align:left; font-weight:bold; color:var(--primary);">${type}</td>
                    <td style="padding:12px;">${p.qtd}</td>
                    <td style="padding:12px; color:${matchQtd ? 'inherit' : '#dc3545'}; font-weight:${matchQtd ? 'normal' : 'bold'};">${r.qtd}</td>
                    <td style="padding:12px;">${p.pesoTotal.toFixed(1).replace('.',',')} kg</td>
                    <td style="padding:12px; color:${matchPeso ? 'inherit' : '#dc3545'}; font-weight:${matchPeso ? 'normal' : 'bold'};">${r.pesoTotal.toFixed(1).replace('.',',')} kg</td>
                    <td style="padding:12px;">${matchQtd && matchPeso ? '<span style="color:#28a745; font-weight:bold;"><i class="fa-solid fa-check"></i> OK</span>' : '<span style="color:#dc3545; font-weight:bold;"><i class="fa-solid fa-xmark"></i> Erro</span>'}</td>
                </tr>`;
        }).join('');

        // 2. Monta o HTML Bonito das Caixas Finais que irão brilhar no final do relatório
        let caixasReaisHtml = `<div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap:15px; margin-top:15px;">` + 
        caixasReais.map((cx, idx) => {
            const produtosList = cx.produtos.map(p => `<tr><td style="padding:4px 0;">${p.referencia}</td><td style="padding:4px 0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:120px;">${p.descricao}</td><td style="text-align:right; font-weight:bold; padding:4px 0;">${p.quantidade}</td></tr>`).join('');
            return `
            <div style="background:#fff; border:1px solid #ddd; border-radius:10px; overflow:hidden; box-shadow:0 2px 5px rgba(0,0,0,0.03);">
                <div style="background:var(--bg-base); padding:10px 15px; border-bottom:1px solid #eee; display:flex; justify-content:space-between; align-items:center;">
                    <strong style="color:var(--primary); font-size:14px;"><i class="fa-solid fa-box" style="color:#aaa;"></i> ${cx.num || 'CX'} <span style="font-size:11px; color:#999; font-weight:normal;">(Vol ${idx+1})</span></strong>
                    <span style="font-size:12px; color:#666; font-weight:bold;">${parseFloat(cx.peso).toFixed(1).replace('.',',')} kg</span>
                </div>
                <div style="padding:10px 15px;">
                    <table style="width:100%; font-size:11px; table-layout:fixed;">
                        <tbody>${produtosList}</tbody>
                    </table>
                </div>
            </div>`;
        }).join('') + `</div>`;

        // 3. O SEGREDO: Salva tudo no Banco de Dados sem o usuário precisar clicar em mais nada!
        const sessionToSave = {
            fileName: session.fileName,
            loja: session.loja,
            romaneio: session.romaneio,
            skus: session.skus.map(sku => {
                const clone = { ...sku }; delete clone.caixasGeradasDesteSku; return clone;
            })
        };
        await window.salvarNovasCaixas(caixasReais, docIndex, fileName, sessionToSave);

        // 4. Constrói o Relatório Final com as caixas "Em Evidência" e abre na tela
        const contentArea = document.getElementById('wmsAuditoriaResultContent');
        contentArea.innerHTML = `
            <div style="text-align:center; margin-bottom:20px;">
                <h2 style="margin:0 0 5px 0; color:var(--primary); font-size:22px;"><i class="fa-solid fa-chart-pie"></i> Relatório de Auditoria e Fechamento</h2>
                <small style="color:#666;">Os dados foram comparados e salvos com sucesso no banco de dados.</small>
            </div>

            <div style="display:flex; justify-content:space-around; align-items:center; background:${bg}; color:${cor}; padding:18px; border-radius:10px; border: 1px solid ${isPerfect ? '#c3e6cb' : '#f5c6cb'}; margin-bottom:20px;">
                <div style="text-align:center;">
                    <small style="font-weight:bold; text-transform:uppercase; font-size:11px; opacity:0.8;">Planejado pela Plataforma</small>
                    <div style="font-size:28px; font-weight:900;">${planejado} <span style="font-size:13px; font-weight:normal;">volumes</span></div>
                </div>
                <div style="font-size:26px; opacity:0.2;"><i class="fa-solid fa-arrows-left-right"></i></div>
                <div style="text-align:center;">
                    <small style="font-weight:bold; text-transform:uppercase; font-size:11px; opacity:0.8;">Efetivado na Expedição</small>
                    <div style="font-size:28px; font-weight:900;">${totalReais} <span style="font-size:13px; font-weight:normal;">volumes</span></div>
                </div>
            </div>
            
            ${!isPerfect ? `<div style="background:#fff3cd; border:1px solid #ffeeba; color:#856404; padding:12px; border-radius:8px; font-size:13px; font-weight:bold; margin-bottom:20px; text-align:center;"><i class="fa-solid fa-triangle-exclamation"></i> Discrepância de ${Math.abs(diff)} caixa(s) detectada! Ajuste o fracionamento manual.</div>` : ''}

            <div style="border: 1px solid #ddd; border-radius: 8px; overflow: hidden; background:#fff; margin-bottom:30px;">
                <table style="width: 100%; border-collapse: collapse; text-align: center;">
                    <thead style="background: #e9ecef;">
                        <tr>
                            <th style="padding:12px; text-align: left; font-size:12px;">TIPO EMBALAGEM</th><th style="padding:12px; font-size:12px;">PLANEJADO</th>
                            <th style="padding:12px; font-size:12px;">REAL (WMS)</th><th style="padding:12px; font-size:12px;">PESO ESTIMADO</th>
                            <th style="padding:12px; font-size:12px;">PESO REAL</th><th style="padding:12px; font-size:12px;">CONFERÊNCIA</th>
                        </tr>
                    </thead>
                    <tbody>${summaryRows}</tbody>
                </table>
            </div>

            <div style="border-top:2px dashed #ddd; padding-top:20px;">
                <h3 style="margin:0; color:var(--primary); font-size:18px;"><i class="fa-solid fa-cubes-stacked"></i> Caixas Efetivadas (Salvas no Banco)</h3>
                <small style="color:#666;">Listagem completa dos volumes extraídos do arquivo e registrados no pedido.</small>
                ${caixasReaisHtml}
            </div>
        `;
        
        document.getElementById('wmsAuditoriaResultModal').style.display = 'flex';
        
    } catch(e) {
        alert("Erro ao efetivar e salvar o romaneio: " + e.message);
    } finally {
        document.body.style.cursor = 'default';
        window.pendingWmsAuditData = null; 
    }
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

window.autoSavePlanejamento = async function(docIndex) {
    const s = window.wmsSessions[docIndex];
    if(!s) return;
    
    // Empacota o painel retirando excessos e garantindo strings
    const sessionToSave = {
        fileName: s.fileName || "Planejamento",
        loja: s.loja || "Geral",
        romaneio: s.romaneio || "---",
        skus: s.skus.map(sku => {
            const clone = { ...sku };
            delete clone.caixasGeradasDesteSku; 
            return clone;
        })
    };

    // --- O FILTRO DE LIMPEZA MÁGICA ANTI-UNDEFINED ---
    const sessionLimpa = JSON.parse(JSON.stringify(sessionToSave));

    const coll = pedidoAtualTipo === 'simples' ? 'pedidos' : 'pedidosMultiDocumento';
    const ref = db.collection("usuarios").doc(pedidoAtualCriadorUid).collection("elementos").doc(pedidoAtualElementoId).collection(coll).doc(pedidoAtualId);
    
    try {
        const docSnap = await ref.get();
        let data = docSnap.data();
        let updateData = {};

        if (pedidoAtualTipo === 'simples') {
            updateData = { planejamentoWms: sessionLimpa };
        } else {
            let documentos = data.documentos || [];
            if(documentos[docIndex]) {
                documentos[docIndex].planejamentoWms = sessionLimpa;
            }
            updateData = { documentos: documentos };
        }

        // Atualiza no Firebase sem travar a tela
        await ref.update(updateData);
    } catch(e) {
        console.error("Erro ao auto-salvar planejamento:", e);
    }
};
// =========================================================================
// FUNÇÕES ATUALIZADAS (AGORA COM AUTO-SAVE EMBUTIDO)
// =========================================================================

window.efetivarImportacaoPlan = async function() {
    if(window.pendingWmsPlanData) {
        const { docIndex, sessionData } = window.pendingWmsPlanData;
        window.wmsSessions[docIndex] = sessionData; 
        window.recalcWmsBoxes(docIndex);
        window.renderWmsPanel(docIndex);
        document.getElementById('confirmWmsPlanModal').style.display = 'none';
        window.pendingWmsPlanData = null; 

        // NOVO: Salva imediatamente no banco de dados após confirmar o popup
        await window.autoSavePlanejamento(docIndex);
    }
};

window.updateSkuRow = async function(docIndex, skuIdx, campo, valor) {
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
    } else if (campo === 'caixaNomeNum') {
        // Pega apenas o número digitado e junta com "CAIXA " para salvar bonitinho no banco
        sku.caixaNome = valor ? `CAIXA ${valor}` : "";
    } else {
        sku[campo] = String(valor).toUpperCase();
    }
    
    if (sku.qtdPadrao > 0 && sku.caixaNome !== "" && sku.pesoPadrao > 0) {
        sku.isMissing = false; 
    } else {
        sku.isMissing = true;
    }
    
    window.recalcWmsBoxes(docIndex);
    window.renderWmsPanel(docIndex);

    await window.autoSavePlanejamento(docIndex);
};

window.sortWms = async function(docIndex, col) {
    const session = window.wmsSessions[docIndex];
    session.sortDir = (session.sortCol === col && session.sortDir === 'asc') ? 'desc' : 'asc';
    session.sortCol = col;
    
    session.skus.sort((a, b) => {
        let valA = a[col], valB = b[col];
        if (typeof valA === 'string') return session.sortDir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        return session.sortDir === 'asc' ? valA - valB : valB - valA;
    });
    
    window.renderWmsPanel(docIndex);

    // NOVO: Se você organizar a lista, ela fica salva organizada pro próximo que abrir
    await window.autoSavePlanejamento(docIndex);
};

window.toggleSkuExpand = async function(docIndex, skuIdx) {
    const sku = window.wmsSessions[docIndex].skus[skuIdx];
    sku.isExpanded = !sku.isExpanded;
    window.renderWmsPanel(docIndex);
    
    // NOVO: Se você deixar a linha aberta, no F5 ela continua aberta!
    await window.autoSavePlanejamento(docIndex);
};

// =========================================================================
// INJEÇÃO DOS MODAIS (AUDITORIA E CAIXAS EFETIVADAS) E ESTILOS
// =========================================================================

if (!document.getElementById('wmsAuditoriaResultModal')) {
    document.body.insertAdjacentHTML('beforeend', `
    <div id="wmsAuditoriaResultModal" style="display:none; align-items:center; justify-content:center; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:999999;">
        <div style="background:#fff; padding:25px; border-radius:12px; width:700px; max-width:92%; max-height:85vh; overflow-y:auto; box-shadow:0 12px 35px rgba(0,0,0,0.25); animation: popInMaster 0.3s ease-out; position:relative;">
            <span onclick="document.getElementById('wmsAuditoriaResultModal').style.display='none'" style="position:absolute; top:15px; right:20px; font-size:24px; cursor:pointer; color:#999; font-weight:bold;" onmouseover="this.style.color='#333'" onmouseout="this.style.color='#999'">&times;</span>
            <div id="wmsAuditoriaResultContent"></div>
            <div style="text-align:right; margin-top:20px; border-top:1px solid #eee; padding-top:15px;">
                <button onclick="document.getElementById('wmsAuditoriaResultModal').style.display='none'" style="padding:10px 20px; background:var(--primary); color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:bold; transition:0.2s;" onmouseover="this.style.opacity='0.9'">Fechar Relatório</button>
            </div>
        </div>
    </div>
    `);
}

if (!document.getElementById('modalCaixasEfetivadasWms')) {
    document.body.insertAdjacentHTML('beforeend', `
    <div id="modalCaixasEfetivadasWms" style="display:none; align-items:center; justify-content:center; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:999998;">
        <div style="background:#fdfdfd; padding:25px; border-radius:12px; width:800px; max-width:95%; max-height:85vh; display:flex; flex-direction:column; box-shadow:0 12px 35px rgba(0,0,0,0.25); animation: popInMaster 0.3s ease-out; position:relative;">
            <span onclick="document.getElementById('modalCaixasEfetivadasWms').style.display='none'" style="position:absolute; top:15px; right:20px; font-size:24px; cursor:pointer; color:#999; font-weight:bold;" onmouseover="this.style.color='#333'" onmouseout="this.style.color='#999'">&times;</span>
            
            <div style="margin-bottom: 15px;">
                <h3 style="margin:0 0 5px 0; color:var(--primary); font-size:20px;"><i class="fa-solid fa-cubes-stacked"></i> Caixas Efetivadas</h3>
                <small style="color:#666; display:block; margin-bottom:15px;">Listagem de todos os volumes registrados no WMS.</small>
                
                <div style="position:relative;">
                    <i class="fa-solid fa-magnifying-glass" style="position:absolute; left:12px; top:12px; color:#aaa; font-size:14px;"></i>
                    <input type="text" id="buscaCaixasEfetivadas" onkeyup="window.filtrarCaixasEfetivadas(this.value)" placeholder="Buscar por Tipo (ex: Caixa 4) ou por Produto (ex: 012200)..." style="width:100%; padding:10px 10px 10px 35px; border:1px solid #ccd7e6; border-radius:8px; font-size:14px; outline:none; transition:0.2s; box-shadow:inset 0 1px 3px rgba(0,0,0,0.03);">
                </div>
            </div>

            <div id="modalCaixasEfetivadasContent" style="overflow-y:auto; flex:1; padding-right:10px; border-top: 1px solid #eee; padding-top:15px;">
                </div>
            <div style="text-align:right; margin-top:20px; border-top:1px solid #eee; padding-top:15px;">
                <button onclick="document.getElementById('modalCaixasEfetivadasWms').style.display='none'" style="padding:10px 20px; background:var(--primary); color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:bold; transition:0.2s;" onmouseover="this.style.opacity='0.9'">Fechar</button>
            </div>
        </div>
    </div>
    `);
}

// Quando abrir o modal, limpar a barra de pesquisa antiga
window.abrirCaixasEfetivadas = function(docIndex) {
    const listNormal = document.getElementById(`caixas-list-container-${docIndex}`);
    const contentTarget = document.getElementById('modalCaixasEfetivadasContent');
    const inputBusca = document.getElementById('buscaCaixasEfetivadas');
    if (inputBusca) inputBusca.value = ''; // Limpa a busca ao abrir
    
    if (listNormal) {
        contentTarget.innerHTML = listNormal.innerHTML;
        const innerHeader = contentTarget.querySelector('div > h3');
        if (innerHeader && innerHeader.parentElement) innerHeader.parentElement.style.display = 'none';
    } else {
        contentTarget.innerHTML = '<p style="text-align:center; padding:20px; color:#999;">Nenhuma caixa encontrada.</p>';
    }
    document.getElementById('modalCaixasEfetivadasWms').style.display = 'flex';
};

if (!document.getElementById('wmsHoverResumeStyle')) {
    document.body.insertAdjacentHTML('beforeend', `
    <style id="wmsHoverResumeStyle">
        .wms-hover-container { position: relative; display: inline-block; }
        .wms-hover-card { 
            display: none; position: absolute; top: 100%; right: 0; width: 340px; 
            background: #fff; border: 1px solid #ddd; border-radius: 10px; 
            box-shadow: 0 8px 25px rgba(0,0,0,0.15); padding: 15px; z-index: 1000; 
            animation: fadeInMaster 0.2s ease-out;
        }
        .wms-hover-container:hover .wms-hover-card { display: block !important; }
    </style>
    `);
}

// Ação de abrir o novo modal de caixas salvas
window.abrirCaixasEfetivadas = function(docIndex) {
    const listNormal = document.getElementById(`caixas-list-container-${docIndex}`);
    const contentTarget = document.getElementById('modalCaixasEfetivadasContent');
    
    if (listNormal) {
        contentTarget.innerHTML = listNormal.innerHTML;
        // Oculta o título interno que veio clonado do HTML antigo
        const innerHeader = contentTarget.querySelector('div > h3');
        if (innerHeader && innerHeader.parentElement) {
            innerHeader.parentElement.style.display = 'none';
        }
    } else {
        contentTarget.innerHTML = '<p style="text-align:center; padding:20px; color:#999;">Nenhuma caixa encontrada.</p>';
    }
    document.getElementById('modalCaixasEfetivadasWms').style.display = 'flex';
};

// =========================================================================
// O NOVO MODAL DE AUDITORIA INTELIGENTE (ESTADO SALVO)
// =========================================================================

if (!document.getElementById('wmsAuditoriaModal')) {
    document.body.insertAdjacentHTML('beforeend', `
    <div id="wmsAuditoriaModal" style="display:none; align-items:center; justify-content:center; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:999999;">
        <div style="background:#fdfdfd; padding:25px; border-radius:12px; width:850px; max-width:95%; max-height:90vh; display:flex; flex-direction:column; box-shadow:0 12px 35px rgba(0,0,0,0.25); animation: popInMaster 0.3s ease-out; position:relative;">
            <span onclick="document.getElementById('wmsAuditoriaModal').style.display='none'" style="position:absolute; top:15px; right:20px; font-size:24px; cursor:pointer; color:#999; font-weight:bold;" onmouseover="this.style.color='#333'" onmouseout="this.style.color='#999'">&times;</span>
            <h2 style="margin:0 0 15px 0; color:var(--primary); font-size:22px; border-bottom:2px solid #eee; padding-bottom:10px;"><i class="fa-solid fa-chart-pie"></i> Importar Caixas </h2>
            
            <div id="wmsAuditoriaModalContent" style="overflow-y:auto; flex:1; padding-right:10px;"></div>
            
            <div style="text-align:right; margin-top:20px; border-top:1px solid #eee; padding-top:15px;">
                <button onclick="document.getElementById('wmsAuditoriaModal').style.display='none'" style="padding:10px 25px; background:var(--primary); color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:bold; transition:0.2s;" onmouseover="this.style.opacity='0.9'">Fechar</button>
            </div>
        </div>
    </div>
    `);
}

// 1. Ação do Botão Principal: Abre o modal e decide o que mostrar
window.abrirModalAuditoria = async function(docIndex) {
    const session = window.wmsSessions[docIndex];
    const content = document.getElementById('wmsAuditoriaModalContent');
    
    // Puxa as caixas do banco se a página foi atualizada (F5)
    if (!session.caixasReais) {
        const coll = pedidoAtualTipo === 'simples' ? 'pedidos' : 'pedidosMultiDocumento';
        const docSnap = await db.collection("usuarios").doc(pedidoAtualCriadorUid).collection("elementos").doc(pedidoAtualElementoId).collection(coll).doc(pedidoAtualId).get();
        if(docSnap.exists) {
            let dados = pedidoAtualTipo === 'simples' ? transformarSimplesEmMulti(docSnap) : docSnap.data();
            session.caixasReais = dados.documentos[docIndex].caixas || [];
        }
    }

    if (!session.caixasReais || session.caixasReais.length === 0) {
        // MODO 1: Pedir o Arquivo
        content.innerHTML = `
            <div style="text-align:center; padding:40px 20px;">
                <i class="fa-solid fa-cloud-arrow-up" style="font-size:48px; color:#ccc; margin-bottom:15px;"></i>
                <h3 style="color:#555; margin-bottom:10px;">Comparar Planejamento vs Dados do WMS</h3>
                <p style="color:#777; font-size:14px; margin-bottom:25px;">Importe o arquivo CSV de caixas efetivadas do WMS para realizar o cruzamento de dados com o planejamento e salvar o romaneio.</p>
                <label style="background:var(--success); color:#fff; padding:12px 25px; border-radius:6px; font-weight:bold; cursor:pointer; display:inline-block; transition:0.2s;" onmouseover="this.style.opacity='0.8'" onmouseout="this.style.opacity='1'">
                    <i class="fa-solid fa-file-csv"></i> Selecionar Arquivo CSV
                    <input type="file" accept=".csv" style="display:none;" onchange="window.processarAuditoriaWmsDentroModal(this, ${docIndex})">
                </label>
            </div>
        `;
    } else {
        // MODO 2: Mostrar Relatório Salvo
        window.renderizarRelatorioAuditoria(docIndex, content);
    }

    document.getElementById('wmsAuditoriaModal').style.display = 'flex';
};

window.processarAuditoriaWmsDentroModal = function(input, docIndex) {
    const file = input.files[0]; 
    input.value = '';
    if(!file) return;

    window.iniciarLeituraCSV(file, "Importação de CSV", "Volumes Identificados", () => {
        
        window.executarLoadingAvancado(
            "Importando Volumes", 
            "Cruzando as caixas físicas do WMS com o Planejamento...", 
            "Importação Concluída!", 
            () => new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = async (ev) => {
                    try {
                        const caixasReais = await parseCsvParaCaixas(ev.target.result);
                        const session = window.wmsSessions[docIndex];
                        session.caixasReais = caixasReais;
                        session.auditFileName = file.name;

                        const sessionToSave = { fileName: session.fileName || "Planejamento", loja: session.loja || "Geral", romaneio: session.romaneio || "---", skus: session.skus.map(sku => { const clone = { ...sku }; delete clone.caixasGeradasDesteSku; return clone; }) };
                        
                        const caixasLimpias = JSON.parse(JSON.stringify(caixasReais));
                        const sessionLimpa = JSON.parse(JSON.stringify(sessionToSave));

                        await window.salvarNovasCaixas(caixasLimpias, docIndex, file.name, sessionLimpa);
                        window.renderizarRelatorioAuditoria(docIndex, document.getElementById('wmsAuditoriaModalContent'));
                        resolve();
                    } catch(e) { reject(e); }
                };
                reader.readAsText(file, 'ISO-8859-1');
            })
        );
    });
};

// 3. O Desenho do Relatório e a Lista Vertical de Caixas
window.renderizarRelatorioAuditoria = function(docIndex, containerEl) {
    const session = window.wmsSessions[docIndex];
    const caixasReais = session.caixasReais || [];
    const totalReais = caixasReais.length;

    let planSummary = {};
    let planejado = 0;
    session.caixasGeradas.forEach(cx => {
        planejado++;
        let key = cx.num || "INDEFINIDA";
        if(!planSummary[key]) planSummary[key] = { qtd: 0, pesoTotal: 0 };
        planSummary[key].qtd++; planSummary[key].pesoTotal += parseFloat(cx.peso || 0);
    });

    let realSummary = {};
    caixasReais.forEach(cx => {
        let key = cx.num || "INDEFINIDA";
        if(!realSummary[key]) realSummary[key] = { qtd: 0, pesoTotal: 0 };
        realSummary[key].qtd++; realSummary[key].pesoTotal += parseFloat(cx.peso || 0);
    });

    const diff = planejado - totalReais;
    const isPerfect = (planejado === totalReais);
    const cor = isPerfect ? '#155724' : '#721c24';
    const bg = isPerfect ? '#d4edda' : '#f8d7da';

    let allTypes = new Set([...Object.keys(planSummary), ...Object.keys(realSummary)]);
    let summaryRows = Array.from(allTypes).sort().map(type => {
        const p = planSummary[type] || { qtd: 0, pesoTotal: 0 };
        const r = realSummary[type] || { qtd: 0, pesoTotal: 0 };
        const matchQtd = p.qtd === r.qtd;
        const matchPeso = Math.abs(p.pesoTotal - r.pesoTotal) < 0.02; 
        return `
            <tr style="border-bottom:1px solid #eee; background: ${matchQtd && matchPeso ? '#fff' : '#fff5f5'}; font-size:13px;">
                <td style="padding:12px; text-align:left; font-weight:bold; color:var(--primary);">${type}</td>
                <td style="padding:12px;">${p.qtd}</td>
                <td style="padding:12px; color:${matchQtd ? 'inherit' : '#dc3545'}; font-weight:${matchQtd ? 'normal' : 'bold'};">${r.qtd}</td>
                <td style="padding:12px;">${p.pesoTotal.toFixed(1).replace('.',',')} kg</td>
                <td style="padding:12px; color:${matchPeso ? 'inherit' : '#dc3545'}; font-weight:${matchPeso ? 'normal' : 'bold'};">${r.pesoTotal.toFixed(1).replace('.',',')} kg</td>
                <td style="padding:12px;">${matchQtd && matchPeso ? '<span style="color:#28a745; font-weight:bold;"><i class="fa-solid fa-check"></i> OK</span>' : '<span style="color:#dc3545; font-weight:bold;"><i class="fa-solid fa-xmark"></i> Erro</span>'}</td>
            </tr>`;
    }).join('');

    // --- A MÁGICA: LISTA VERTICAL DE CAIXAS ---
    let caixasReaisHtml = `<div style="display:flex; flex-direction:column; gap:12px; margin-top:15px;">` + 
    caixasReais.map((cx, idx) => {
        const produtosList = cx.produtos.map(p => `
            <div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px dashed #eee;">
                <span style="flex:1; color:#555;">${p.referencia}</span>
                <span style="flex:2; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin:0 15px; color:#777;">${p.descricao}</span>
                <span style="font-weight:bold; color:var(--primary);">${p.quantidade} un</span>
            </div>`).join('');
            
        return `
        <div style="background:#fff; border:1px solid #ddd; border-left:4px solid var(--primary); border-radius:8px; overflow:hidden;">
            <div style="background:var(--bg-base); padding:12px 15px; display:flex; justify-content:space-between; align-items:center;">
                <strong style="color:var(--primary); font-size:15px;"><i class="fa-solid fa-box"></i> ${cx.num || 'CX'} <span style="font-size:11px; color:#999; font-weight:normal;">(Volume ${idx+1})</span></strong>
                <span style="font-size:14px; color:#444; font-weight:bold;">${parseFloat(cx.peso).toFixed(1).replace('.',',')} kg</span>
            </div>
            <div style="padding:10px 20px; font-size:13px;">
                ${produtosList}
            </div>
        </div>`;
    }).join('') + `</div>`;

    containerEl.innerHTML = `
        <div style="display:flex; justify-content:space-around; align-items:center; background:${bg}; color:${cor}; padding:18px; border-radius:10px; border: 1px solid ${isPerfect ? '#c3e6cb' : '#f5c6cb'}; margin-bottom:20px;">
            <div style="text-align:center;">
                <small style="font-weight:bold; text-transform:uppercase; font-size:11px; opacity:0.8;">Planejado pela Plataforma</small>
                <div style="font-size:28px; font-weight:900;">${planejado} <span style="font-size:13px; font-weight:normal;">volumes</span></div>
            </div>
            <div style="font-size:26px; opacity:0.2;"><i class="fa-solid fa-arrows-left-right"></i></div>
            <div style="text-align:center;">
                <small style="font-weight:bold; text-transform:uppercase; font-size:11px; opacity:0.8;">Efetivado na Expedição</small>
                <div style="font-size:28px; font-weight:900;">${totalReais} <span style="font-size:13px; font-weight:normal;">volumes</span></div>
            </div>
        </div>
        
        ${!isPerfect ? `<div style="background:#fff3cd; border:1px solid #ffeeba; color:#856404; padding:12px; border-radius:8px; font-size:13px; font-weight:bold; margin-bottom:20px; text-align:center;"><i class="fa-solid fa-triangle-exclamation"></i> Discrepância de ${Math.abs(diff)} caixa(s) detectada! Ajuste o fracionamento manual.</div>` : ''}

        <div style="border: 1px solid #ddd; border-radius: 8px; overflow: hidden; background:#fff; margin-bottom:30px;">
            <table style="width: 100%; border-collapse: collapse; text-align: center;">
                <thead style="background: #e9ecef;">
                    <tr>
                        <th style="padding:12px; text-align: left; font-size:12px;">TIPO EMBALAGEM</th><th style="padding:12px; font-size:12px;">PLANEJADO</th>
                        <th style="padding:12px; font-size:12px;">REAL (WMS)</th><th style="padding:12px; font-size:12px;">PESO ESTIMADO</th>
                        <th style="padding:12px; font-size:12px;">PESO REAL</th><th style="padding:12px; font-size:12px;">CONFERÊNCIA</th>
                    </tr>
                </thead>
                <tbody>${summaryRows}</tbody>
            </table>
        </div>

        <div style="border-top:2px dashed #ddd; padding-top:20px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                <div>
                    <h3 style="margin:0; color:var(--primary); font-size:18px;"><i class="fa-solid fa-list-ul"></i> Caixas Efetivadas (Detalhamento)</h3>
                    <small style="color:#666;">Arquivo Importado: <strong>${session.auditFileName || 'Arquivo WMS'}</strong></small>
                </div>
                <label style="background:#eef2f8; color:var(--primary); border:1px solid #ccd7e6; padding:8px 15px; border-radius:6px; font-size:12px; cursor:pointer; font-weight:bold; transition:0.2s;" onmouseover="this.style.background='#dce5f2'" onmouseout="this.style.background='#eef2f8'">
                    <i class="fa-solid fa-rotate"></i> Substituir Arquivo
                    <input type="file" accept=".csv" style="display:none;" onchange="window.processarAuditoriaWmsDentroModal(this, ${docIndex})">
                </label>
            </div>
            ${caixasReaisHtml}
        </div>
    `;
};

// =========================================================================
// O LAYOUT DO PAINEL TOTAL (COM O BOTÃO ÚNICO UNIFICADO E SCROLL CORRIGIDO)
// =========================================================================
window.renderWmsPanel = function(docIndex) {
    const session = window.wmsSessions[docIndex];
    const container = document.getElementById(`wms-panel-container-${docIndex}`);
    const listNormal = document.getElementById(`caixas-list-container-${docIndex}`);
    
    // A MÁGICA DA ROLAGEM PROCURA PELA CLASSE 'wms-table-wrapper'
    const wrapperAntigo = container.querySelector('.wms-table-wrapper');
    const posicaoScroll = wrapperAntigo ? wrapperAntigo.scrollTop : 0;

    if(listNormal) listNormal.style.display = 'none'; 
    container.style.display = 'block';

    const importArea = container.parentElement.querySelector('.import-area');
    if (importArea) importArea.style.display = 'none';

    const modalContent = container.closest('.modal-content');
    if(modalContent) {
        modalContent.classList.remove('modal-lg');
        modalContent.classList.add('modal-xl');
    }
    
    const caixasContainer = document.getElementById('listaCaixasContainer');
    if(caixasContainer) {
        caixasContainer.classList.remove('caixas-grid');
        caixasContainer.style.display = 'block';
    }

    let totalVolumesGeral = 0;
    let resumoTiposCaixa = {};
    
    session.skus.forEach(sku => {
        if(sku.qtdPadrao > 0) {
            const cxsDesteSku = Math.ceil(sku.qtdTotal / sku.qtdPadrao);
            totalVolumesGeral += cxsDesteSku;
            
            let tKey = sku.caixaNome || "INDEFINIDO";
            if(!resumoTiposCaixa[tKey]) resumoTiposCaixa[tKey] = { qtd: 0, peso: 0 };
            let resSummary = resumoTiposCaixa[tKey];
            resSummary.qtd += cxsDesteSku;
            resSummary.peso += cxsDesteSku * parseFloat(sku.pesoPadrao || 0);
        }
    });

    let hoverRowsHtml = Object.keys(resumoTiposCaixa).map(t => `
        <div style="display:flex; justify-content:space-between; font-size:12px; border-bottom:1px solid #f1f1f1; padding:5px 0;">
            <span style="font-weight:bold; color:var(--primary);">${t}</span>
            <span>${resumoTiposCaixa[t].qtd} un &nbsp;|&nbsp; <strong>${resumoTiposCaixa[t].peso.toFixed(1).replace('.',',')}kg</strong></span>
        </div>
    `).join('');

    let trs = session.skus.map((sku, i) => {
        const numCaixas = sku.qtdPadrao > 0 ? Math.ceil(sku.qtdTotal / sku.qtdPadrao) : 0;
        let varSelectorHtml = '';
        let barcodeToCopy = ''; 
        
        if (sku.variacoesDisponiveis.length > 1) {
            let opts = sku.variacoesDisponiveis.map((v, vIdx) => {
                return `<option value="${vIdx}" ${sku.selectedVar === vIdx ? 'selected' : ''}>${v.caixa} / ${v.quantidade} / ${v.peso}kg</option>`;
            }).join('');
            varSelectorHtml = `<select onclick="event.stopPropagation()" onchange="window.updateSkuRow(${docIndex}, ${i}, 'variacao', this.value)" style="width:100%; padding:6px; font-size:11px; border-radius:6px; border:1px solid #ccc; cursor:pointer;">${opts}</select>`;
            barcodeToCopy = sku.variacoesDisponiveis[sku.selectedVar].codigoBarras || '';
        } else if (sku.variacoesDisponiveis.length === 1) {
            varSelectorHtml = `<span style="font-size:11px; font-weight:bold; color:#666; background:#eee; padding:4px 8px; border-radius:4px;">Padrão Único</span>`;
            barcodeToCopy = sku.variacoesDisponiveis[0].codigoBarras || '';
        } else {
            if (sku.qtdPadrao > 0 && sku.caixaNome !== "" && sku.pesoPadrao > 0) {
                varSelectorHtml = `<button onclick="event.stopPropagation(); window.abrirModalImportarSku(${docIndex}, ${i})" style="background:var(--success); color:#fff; border:none; padding:8px 10px; border-radius:6px; font-size:11px; font-weight:bold; cursor:pointer; width:100%; transition:0.2s;"><i class="fa-solid fa-cloud-arrow-up"></i> Importar SKU</button>`;
            } else {
                varSelectorHtml = `<span style="color:#dc3545; font-size:10px; font-weight:bold;"><i class="fa-solid fa-triangle-exclamation"></i> DIGITE OS DADOS</span>`;
            }
        }

        let copyBtnHtml = '';
        if (barcodeToCopy && !sku.isOriginalMissing) {
            copyBtnHtml = `<button onclick="event.stopPropagation(); window.copiarCodigoBarraWms('${barcodeToCopy}', this)" style="background:transparent; border:none; color:var(--secondary); font-size:14px; cursor:pointer; margin-left:8px;"><i class="fa-regular fa-copy"></i></button>`;
        }

        const unCxCell = sku.isOriginalMissing 
            ? `<div style="display:flex; align-items:center; background:#fff; border:1px solid ${sku.isMissing ? '#dc3545' : '#ccc'}; border-radius:4px;"><span style="padding:6px; background:${sku.isMissing ? '#f8d7da' : '#eee'}; color:${sku.isMissing ? '#dc3545' : '#555'}; font-weight:bold; font-size:11px; border-radius:3px 0 0 3px;">CX</span><input type="number" onclick="event.stopPropagation()" style="width:100%; padding:6px; text-align:center; border:none; outline:none; background:transparent;" value="${sku.qtdPadrao || ''}" placeholder="0" onchange="window.updateSkuRow(${docIndex}, ${i}, 'qtdPadrao', this.value)"></div>`
            : `<div style="display:flex; align-items:center; justify-content:center;"><strong style="font-size:15px; color:#333;">CX${sku.qtdPadrao}</strong>${copyBtnHtml}</div>`;
            
        let caixaNumOnly = sku.caixaNome ? sku.caixaNome.replace(/\D/g, '') : '';
        const tipoCxCell = sku.isOriginalMissing
            ? `<div style="display:flex; align-items:center; background:#fff; border:1px solid ${sku.isMissing ? '#dc3545' : '#ccc'}; border-radius:4px;"><span style="padding:6px; background:${sku.isMissing ? '#f8d7da' : '#eee'}; color:${sku.isMissing ? '#dc3545' : '#555'}; font-weight:bold; font-size:11px; border-radius:3px 0 0 3px;">CAIXA</span><input type="number" onclick="event.stopPropagation()" style="width:100%; padding:6px; text-align:center; border:none; outline:none; background:transparent;" value="${caixaNumOnly}" placeholder="4" onchange="window.updateSkuRow(${docIndex}, ${i}, 'caixaNomeNum', this.value)"></div>`
            : `<strong style="font-size:14px; color:#555;">${sku.caixaNome}</strong>`;

        const pesoCell = sku.isOriginalMissing
            ? `<input type="number" step="0.1" onclick="event.stopPropagation()" style="width:100%; padding:6px; text-align:center; border:1px solid ${sku.isMissing ? '#dc3545' : '#ccc'}; border-radius:4px;" value="${sku.pesoPadrao || ''}" placeholder="0.0" onchange="window.updateSkuRow(${docIndex}, ${i}, 'pesoPadrao', this.value)">`
            : `<strong style="font-size:14px; color:#555;">${sku.pesoPadrao}kg</strong>`;

        let detalhesHtml = '';
        if (sku.isExpanded && sku.caixasGeradasDesteSku) {
            const listaPills = sku.caixasGeradasDesteSku.map((c, idx) => `
                <div style="display:flex; justify-content:space-between; align-items:center; background:#fff; border:1px solid #e0e0e0; padding:10px 15px; border-radius:8px; font-size:12px; box-shadow:0 2px 4px rgba(0,0,0,0.02);">
                    <span><i class="fa-solid fa-box-open" style="color:#aaa; margin-right:8px;"></i> Volume ${idx + 1}</span>
                    <strong style="color:var(--primary);">${c.num} <span style="font-weight:normal; color:#666;">(${c.peso}kg)</span></strong>
                </div>
            `).join('');
            
            // ADICIONADO A CLASSE 'sku-detail-row' E O 'data-idx'
            detalhesHtml = `
                <tr class="sku-detail-row" data-idx="${i}" style="background:#fafafa; border-left:5px solid var(--secondary);">
                    <td colspan="7" style="padding:20px; border-bottom:2px solid #ddd;">
                        <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap:12px;">${listaPills}</div>
                    </td>
                </tr>`;
        }

        // ADICIONADO A CLASSE 'sku-main-row' E O 'data-idx'
        return `
            <tr class="sku-main-row" data-idx="${i}" onclick="window.toggleSkuExpand(${docIndex}, ${i})" style="cursor:pointer; border-bottom:1px solid #eee; background:${sku.isMissing ? '#fff5f5' : '#fff'}; transition:0.2s;">
                <td style="padding:15px;"><i class="fa-solid ${sku.isExpanded ? 'fa-chevron-up' : 'fa-chevron-down'}" style="font-size:14px; margin-right:10px; color:var(--primary);"></i><strong style="font-size:14px;">${sku.ref}</strong><br><small style="color:#777;">${sku.desc}</small></td>
                <td style="padding:15px; text-align:center; font-size:16px; font-weight:900;">${sku.qtdTotal}</td>
                <td style="padding:15px; text-align:center;">${unCxCell}</td>
                <td style="padding:15px; text-align:center;">${tipoCxCell}</td>
                <td style="padding:15px; text-align:center;">${pesoCell}</td>
                <td style="padding:15px;">${varSelectorHtml}</td>
                <td style="padding:15px; text-align:center; background:rgba(13, 50, 105, 0.04); border-left:1px solid #eee;"><div style="font-size:22px; font-weight:900; color:var(--primary);">${numCaixas}</div></td>
            </tr>
            ${detalhesHtml}
        `;
    }).join('');

    container.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:15px; border:1px solid #ddd; border-radius:12px; overflow:hidden; margin-bottom:25px; background:#fff;">
            
            <div style="display:flex; justify-content:space-between; align-items:center; padding:15px 20px; background:#f8f9fa; border-bottom:1px solid #eee; flex-wrap:wrap; gap:15px;">
                <div style="min-width:250px;">
                    <div style="font-size:22px; color:var(--primary); font-weight:900; letter-spacing:-0.5px;">
                        ${session.loja || 'LOJA NÃO DEFINIDA'}
                    </div>
                    <div style="font-size:13px; color:#555; margin-top:2px;">
                        Romaneio WMS: <strong style="color:var(--secondary); font-size:14px;">${session.romaneio || '---'}</strong>
                    </div>
                </div>
                
                <div style="display:flex; align-items:center; gap:12px; flex:1; justify-content:flex-end;">
                    
                    <div style="position:relative; width:100%; max-width:300px; margin-right:10px;">
                        <i class="fa-solid fa-magnifying-glass" style="position:absolute; left:12px; top:11px; color:#aaa; font-size:14px;"></i>
                        <input type="text" onkeyup="window.filtrarPlanejamentoWms(this.value, ${docIndex})" placeholder="Buscar Produto ou SKU..." style="width:100%; padding:9px 10px 9px 35px; border:1px solid #ccd7e6; border-radius:6px; font-size:13px; outline:none; transition:0.2s;">
                    </div>

                    <div class="wms-hover-container">
                        <button style="background:#eef2f8; color:var(--primary); border:1px solid #ccd7e6; padding:10px 16px; border-radius:6px; font-size:13px; cursor:pointer; font-weight:bold; display:flex; align-items:center; gap:8px;">
                            <i class="fa-solid fa-boxes-packing" style="color:var(--secondary)"></i> <span class="hide-mobile">Pré-Resumo</span>
                            <span style="background:var(--primary); color:#fff; font-size:11px; padding:2px 6px; border-radius:20px;">${totalVolumesGeral}</span>
                        </button>
                        <div class="wms-hover-card">
                            <h4 style="margin:0 0 10px 0; font-size:14px; border-bottom:2px solid var(--bg-base); padding-bottom:5px; color:var(--primary);"><i class="fa-solid fa-calculator"></i> Quantidade Estimada</h4>
                            <div style="max-height:180px; overflow-y:auto; padding-right:2px;">
                                ${hoverRowsHtml || '<p style="color:#999; font-size:11px; margin:5px 0;">Nenhum volume gerado.</p>'}
                            </div>
                        </div>
                    </div>

                    <label onclick="window.abrirCaixasEfetivadas(${docIndex})" style="background:#eef2f8; border:1px solid #ccd7e6; width:38px; height:38px; display:flex; align-items:center; justify-content:center; border-radius:6px; font-size:15px; cursor:pointer; color:var(--primary); transition:0.2s;" title="Ver Caixas Efetivadas (Salvas no Banco)" onmouseover="this.style.background='#dce5f2'" onmouseout="this.style.background='#eef2f8'">
                        <i class="fa-solid fa-cubes-stacked"></i>
                    </label>

                    <label style="background:#fff; border:1px solid #ccc; width:38px; height:38px; display:flex; align-items:center; justify-content:center; border-radius:6px; font-size:15px; cursor:pointer; color:#444; transition:0.2s;" title="Re-importar romaneio CSV" onmouseover="this.style.background='#eee'" onmouseout="this.style.background='#fff'">
                        <i class="fa-solid fa-rotate"></i>
                        <input type="file" style="display:none;" onchange="window.processarWmsCSV(this, ${docIndex})">
                    </label>

                    <button onclick="window.abrirModalAuditoria(${docIndex})" style="background:var(--success); color:#fff; border:none; padding:10px 18px; border-radius:6px; font-size:13px; cursor:pointer; font-weight:bold; height:38px; display:flex; align-items:center; gap:8px; transition:0.2s;" onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'">
                        <i class="fa-solid fa-chart-pie"></i> <span class="hide-mobile">Importar Caixas</span>
                    </button>
                </div>
            </div>

            <div class="wms-table-wrapper" style="width:100%; max-height:68vh; overflow-y:auto; background:#fff;">
                <table style="width:100%; border-collapse:collapse; min-width:900px; font-size:13px;">
                    <thead style="background:#e9ecef; position:sticky; top:0; z-index:20; box-shadow:0 2px 5px rgba(0,0,0,0.05);">
                        <tr>
                            <th style="padding:15px; text-align:left; cursor:pointer;" onclick="window.sortWms(${docIndex}, 'ref')">PRODUTO <i class="fa-solid fa-sort" style="color:#999; margin-left:5px;"></i></th>
                            <th style="padding:15px; text-align:center; cursor:pointer;" onclick="window.sortWms(${docIndex}, 'qtdTotal')">QTD PEDIDO <i class="fa-solid fa-sort" style="color:#999; margin-left:5px;"></i></th>
                            <th style="padding:15px; text-align:center;">TIPO UC</th>
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

    const novoWrapper = container.querySelector('.wms-table-wrapper');
    if (novoWrapper) novoWrapper.scrollTop = posicaoScroll;
};

// =========================================================================
// MOTORES DE BUSCA EM TEMPO REAL (FILTROS)
// =========================================================================

// 1. Filtro da Página Principal do Elemento (Romaneios)
window.filtrarRomaneiosGeral = function(termo) {
    termo = termo.toLowerCase();
    const sections = document.querySelectorAll('.doc-section');
    sections.forEach(sec => {
        if(sec.textContent.toLowerCase().includes(termo)) {
            sec.style.display = '';
        } else {
            sec.style.display = 'none';
        }
    });
};

// 2. Filtro de Caixas para Pedidos COMUNS (NOVO)
window.filtrarCaixasComuns = function(termo, index) {
    termo = termo.toLowerCase();
    const container = document.getElementById(`lista-volumes-comuns-${index}`);
    if(!container) return;
    const caixas = container.querySelectorAll('.caixa-item');
    caixas.forEach(cx => {
        if(cx.textContent.toLowerCase().includes(termo)) {
            cx.style.display = '';
        } else {
            cx.style.display = 'none';
        }
    });
};

// 3. Filtro do Planejamento WMS (Caixa Master)
window.filtrarPlanejamentoWms = function(termo, docIndex) {
    termo = termo.toLowerCase();
    const container = document.getElementById(`wms-panel-container-${docIndex}`);
    if(!container) return;
    
    const mainRows = container.querySelectorAll('.sku-main-row');
    mainRows.forEach(row => {
        const idx = row.getAttribute('data-idx');
        const detailRow = container.querySelector(`.sku-detail-row[data-idx="${idx}"]`);
        
        if(row.textContent.toLowerCase().includes(termo)) {
            row.style.display = '';
            if(detailRow && row.querySelector('.fa-chevron-up')) detailRow.style.display = '';
        } else {
            row.style.display = 'none';
            if(detailRow) detailRow.style.display = 'none';
        }
    });
};

// 4. Filtro das Caixas Efetivadas (Modal do Master)
window.filtrarCaixasEfetivadas = function(termo) {
    termo = termo.toLowerCase();
    const content = document.getElementById('modalCaixasEfetivadasContent');
    if(!content) return;
    
    const caixas = content.querySelectorAll('.caixa-item');
    caixas.forEach(cx => {
        if(cx.textContent.toLowerCase().includes(termo)) {
            cx.style.display = '';
        } else {
            cx.style.display = 'none';
        }
    });
};

// =========================================================================
// BARRA DE BUSCA GERAL (INJETADA DIRETO NA PÁGINA DO ELEMENTO)
// =========================================================================

window.filtrarRomaneiosGeral = function(termo) {
    termo = termo.toLowerCase();
    
    // 1. Filtra as linhas (tr) da Tabela Principal do Elemento
    const trs = document.querySelectorAll('table tbody tr');
    trs.forEach(tr => {
        // Trava de segurança: Ignora linhas que estão dentro de modais de WMS/Caixas
        if (tr.closest('.modal-content') || tr.closest('#listaCaixasContainer') || tr.closest('#wmsAuditoriaModal')) return;
        
        if(tr.textContent.toLowerCase().includes(termo)) {
            tr.style.display = '';
        } else {
            tr.style.display = 'none';
        }
    });

    // 2. Filtra as seções dos pedidos caso o usuário abra o modal
    const sections = document.querySelectorAll('.doc-section');
    sections.forEach(sec => {
        if(sec.textContent.toLowerCase().includes(termo)) {
            sec.style.display = '';
        } else {
            sec.style.display = 'none';
        }
    });
};


// =========================================================================
// BARRA DE BUSCA GERAL: BOTÃO EXPANSÍVEL ANIMADO
// =========================================================================

window.expandirBuscaWms = function() {
    const input = document.getElementById('wms-search-input');
    const container = document.getElementById('wms-search-container');
    if(input) {
        // Ao clicar, o container ganha fundo branco e expande
        container.style.background = '#fff';
        container.style.boxShadow = '0 2px 5px rgba(0,0,0,0.05)';
        container.style.border = '1px solid #ccd7e6';
        container.style.paddingRight = '10px';
        
        input.style.width = '220px';
        input.style.padding = '0 10px';
        input.style.opacity = '1';
        input.style.marginLeft = '5px';
        input.focus();
    }
};

window.encolherBuscaWms = function() {
    const input = document.getElementById('wms-search-input');
    const container = document.getElementById('wms-search-container');
    // Só encolhe se o usuário não tiver digitado nada
    if(input && input.value.trim() === '') {
        container.style.background = 'transparent';
        container.style.boxShadow = 'none';
        container.style.border = '1px solid transparent';
        container.style.paddingRight = '0px';
        
        input.style.width = '0px';
        input.style.padding = '0px';
        input.style.opacity = '0';
        input.style.marginLeft = '0px';
    }
};

window.injetarBuscaGeralNaPagina = function() {
    const barraExistente = document.getElementById('busca-geral-romaneios-wms');

    // 1. Caça todos os botões e badges da página
    const elementosPossiveis = Array.from(document.querySelectorAll('button, a, span, .badge'));

    // 2. Filtro Rigoroso: Acha os botões do topo, IGNORANDO qualquer Modal
    const btnAlvo = elementosPossiveis.find(el => {
        if (el.closest('.modal') || el.closest('.modal-content') || el.closest('[id*="modal"]') || el.closest('[id*="Modal"]')) {
            return false;
        }
        const texto = el.textContent ? el.textContent.trim() : '';
        return texto === '+ Novo Pedido' || texto.includes('Pedidos:') || texto === 'Caixas Master' || texto === 'Desempenho';
    });

    if (!btnAlvo || !btnAlvo.parentElement) return; 

    const containerTopo = btnAlvo.parentElement;

    if (barraExistente && barraExistente.parentElement !== containerTopo) {
        barraExistente.remove();
    } else if (barraExistente) {
        return; 
    }

    // 3. Criação do Botão Animado
    const barraGeral = document.createElement('div');
    barraGeral.id = 'busca-geral-romaneios-wms';
    // O margin-right: auto empurra a barra para a esquerda, separando do resto
    barraGeral.style.marginRight = 'auto'; 
    
    // HTML Estrutural para a transição CSS
    barraGeral.innerHTML = `
        <div id="wms-search-container" style="display:flex; align-items:center; background:transparent; border:1px solid transparent; border-radius:25px; transition:all 0.3s ease; height: 40px; overflow: hidden;">
            
            <div onclick="window.expandirBuscaWms()" style="width: 38px; height: 38px; display: flex; align-items: center; justify-content: center; border-radius: 50%; cursor: pointer; color: var(--primary); background: #eef2f8; transition: 0.2s; box-shadow: 0 2px 4px rgba(0,0,0,0.05); flex-shrink: 0;" onmouseover="this.style.background='#dce5f2'" onmouseout="this.style.background='#eef2f8'" title="Pesquisar Romaneios">
                <i class="fa-solid fa-magnifying-glass"></i>
            </div>
            
            <input type="text" id="wms-search-input" onkeyup="window.filtrarRomaneiosGeral(this.value)" onblur="window.encolherBuscaWms()" placeholder="Buscar Romaneio ou Loja..." style="width: 0px; padding: 0px; border: none; font-size: 13px; outline: none; background: transparent; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); opacity: 0; margin-left: 0px;">
        
        </div>
    `;

    // 4. Injeção no Layout
    containerTopo.style.display = 'flex';
    containerTopo.style.alignItems = 'center';
    containerTopo.style.width = '100%'; 
    
    containerTopo.insertBefore(barraGeral, containerTopo.firstChild);
};

// Mantém os rastreadores de carregamento
setTimeout(window.injetarBuscaGeralNaPagina, 500);
setInterval(window.injetarBuscaGeralNaPagina, 1500);