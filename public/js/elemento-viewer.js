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
let emailToUidMap = {};
let uidToEmailMapReverso = {};

// Elementos de UI
const userEmail = document.getElementById('user-email');
const pageLoader = document.getElementById('page-loader');
const appContent = document.getElementById('app-content');
const tituloElemento = document.getElementById('tituloElemento');
const voltarBtn = document.getElementById('voltarBtn');
const logoBtn = document.getElementById('logoBtn');
const multiOrdersTableBody = document.getElementById('multiOrdersTableBody');
const caixasPopup = document.getElementById('caixasPopup');
const logoutConfirmModal = document.getElementById('logoutConfirmModal');

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
        tituloElemento.innerHTML = `<i class="fa-solid fa-globe"></i> Visão Global: ${dia}/${mes}/${ano}`;
        
        await carregarUsuarios();
        iniciarMonitoramentoVisualizador();
    } else {
        window.location.href = "index.html";
    }
});

async function carregarUsuarios() {
    const snap = await db.collection("usuarios").get();
    snap.forEach(doc => { 
        if(doc.data().email) {
            const emailL = doc.data().email.trim().toLowerCase();
            uidToEmailMapReverso[doc.id] = emailL;
        }
    });
}

// =========================================================================
// 1. LÓGICA DE DADOS - MODO VISUALIZADOR
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
            let detalhes = initDetalhes();
            snap.forEach(doc => {
                const data = doc.data();
                const pathSegments = doc.ref.path.split('/');
                const elemIdOriginal = pathSegments[3]; 
                
                const pedidoFormatado = { id: doc.id, ...data, elementoIdOriginal: elemIdOriginal };
                cachePedidosGlobais.push(pedidoFormatado);
                contabilizarDetalhesGlobal(pedidoFormatado, detalhes); 
            }); 
            
            cachePedidosGlobais.sort((a, b) => getSafeTimestamp(b) - getSafeTimestamp(a));

            renderizarTabela(cachePedidosGlobais);
            atualizarTotais(detalhes);
            renderOngoingAdmin();
            ocultarLoader();
        });
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

function atualizarTotais(det) {
    document.getElementById('totalPedidosVisor').textContent = det.total;
    const cxVisor = document.getElementById('totalCaixasVisor');
    if (cxVisor) cxVisor.textContent = det.caixas + det.caixasBonus;
    
    document.getElementById('ttNf').textContent = det.nf;
    document.getElementById('ttBonif').textContent = det.bonif;
    document.getElementById('ttMinuta').textContent = det.minuta;
    document.getElementById('ttCx').textContent = det.caixas;
    document.getElementById('ttCxB').textContent = det.caixasBonus;

    const sorted = Object.keys(det.agrupado).sort((a, b) => (parseInt(a.replace(/\D/g, '')) || 0) - (parseInt(b.replace(/\D/g, '')) || 0));
    
    document.getElementById('caixasDetalhadasList').innerHTML = sorted.map(k => {
        const style = k.includes('Bônus') ? 'color:var(--secondary); font-weight:bold;' : '';
        return `<span style="display:inline-block; margin-right:5px; ${style}">${k}: ${det.agrupado[k]}</span>`;
    }).join(' | ');
}

// =========================================================================
// 2. RENDERIZAÇÃO DA TABELA (SOMENTE LEITURA E SIMPLIFICADA)
// =========================================================================

window.renderizarTabela = function(pedidos) {
    if(!multiOrdersTableBody) return;
    multiOrdersTableBody.innerHTML = "";
    
    if(pedidos.length === 0) {
        multiOrdersTableBody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:#999; padding:30px;">Nenhum pedido encontrado.</td></tr>`;
        return;
    }

    pedidos.forEach((p, index) => {
        const tr = document.createElement('tr');
        tr.style.animationDelay = `${index * 0.05}s`;
        if(p.efetivado) tr.classList.add('efetivado');
        if(p.mondayVerified) {
            tr.classList.remove('efetivado'); 
            tr.classList.add('monday-verified');
        }

        const criadorUid = p.criadorUid || currentUser.uid;

        tr.onclick = (e) => {
            if (!e.target.closest('.action-btn')) {
                abrirCaixasVisualizador(p.id, criadorUid, p.elementoIdOriginal, p.romaneio);
            }
        };

        // --- FILTROS DE DADOS SIMPLIFICADOS ---
        let resps = new Set();
        (p.documentos || []).forEach(d => {
            const arr = d.responsaveis && d.responsaveis.length > 0 ? d.responsaveis : (d.responsavel ? [d.responsavel] : []);
            arr.forEach(r => resps.add(r.split('@')[0].toUpperCase()));
        });
        const responsavelStr = Array.from(resps).join(', ') || (p.criadorEmail ? p.criadorEmail.split('@')[0].toUpperCase() : '---');

        const allCaixas = (p.documentos || []).flatMap(d => d.caixas || []);
        const totalCaixas = allCaixas.length;

        // Status (Pílula)
        let statusBadgeHtml = '';
        if (p.mondayVerified) {
            statusBadgeHtml = `<span class="doc-pill" style="background:#e0f2fe; color:#075985; border-color:#bae6fd; margin:0;"><i class="fa-solid fa-check-double"></i> Verificado</span>`;
        } else if (p.efetivado) {
            statusBadgeHtml = `<span class="doc-pill" style="background:#d4edda; color:#155724; border-color:#c3e6cb; margin:0;"><i class="fa-solid fa-check"></i> Concluído</span>`;
        } else {
            statusBadgeHtml = `<span class="doc-pill" style="background:#fff3cd; color:#856404; border-color:#ffeeba; margin:0;"><i class="fa-solid fa-spinner fa-spin"></i> Andamento</span>`;
        }

        // Tempo Decorrido
        let tempoHtml = "---";
        if (p.createdAt) {
            if (p.efetivado) {
                if (p.completedAt) {
                    const tempoTotal = calcularTempoDecorrido(p.createdAt.toMillis(), p.completedAt.toMillis());
                    tempoHtml = `<span style="font-family: monospace; color: #155724; font-weight: bold; background: #d4edda; padding: 3px 6px; border-radius: 6px;">${tempoTotal}</span>`;
                } else {
                    tempoHtml = `<span style="color: #666; font-size: 11px; font-weight: bold; background: #eee; padding: 3px 6px; border-radius: 6px;">Finalizado</span>`;
                }
            } else {
                tempoHtml = `<span class="live-timer" data-start="${p.createdAt.toMillis()}" style="font-family: monospace; color: var(--secondary); font-weight: bold; background: #fff3cd; padding: 3px 6px; border-radius: 6px;"><span>Calculando...</span></span>`;
            }
        }

        // --- BOTÕES E ESCONDIDOS ---
        const resumoEscondido = `<div class="texto-resumo-caixas" style="display:none;">${calcularResumoCaixasStr(allCaixas)}</div>`;
        const btnCopy = `<button class="action-btn btn-copy" title="Copiar Resumo" onclick="copiarResumo(event, this)"><i class="fa-regular fa-copy"></i></button>`;
        const btnCaixas = `<button class="action-btn btn-caixas" title="Ver Caixas" onclick="abrirCaixasVisualizador('${p.id}', '${criadorUid}', '${p.elementoIdOriginal}', '${p.romaneio || ''}')"><i class="fa-solid fa-boxes-stacked"></i></button>`;

        // --- MONTAGEM DA LINHA HTML ---
        tr.innerHTML = `
            <td data-label="Romaneio"><strong>${p.romaneio || '---'}</strong></td>
            <td data-label="Loja">${p.loja || '---'}</td>
            <td data-label="Local">${p.local || 'DF'}</td>
            <td data-label="Responsável"><i class="fa-regular fa-user" style="color:#aaa;"></i> ${responsavelStr}</td>
            <td data-label="Caixas" style="text-align: center; font-size: 16px;"><strong>${totalCaixas}</strong></td>
            <td data-label="Tempo" style="text-align: center;">${tempoHtml}</td>
            <td data-label="Status" style="text-align: center;">${statusBadgeHtml}</td>
            <td data-label="Ações" style="display:flex; justify-content:center; gap:5px; flex-wrap:wrap;">
                ${resumoEscondido}
                ${btnCopy}
                ${btnCaixas}
            </td>
        `;
        multiOrdersTableBody.appendChild(tr);
    });

    if (typeof aplicarFiltroTabela === 'function') aplicarFiltroTabela();
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
// 3. WIDGETS E CAIXAS (SOMENTE LEITURA)
// =========================================================================
function renderOngoingAdmin() {
    const container = document.getElementById('ongoingOrdersContainer');
    if (!container) return;
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

window.abrirCaixasVisualizador = async function(id, criadorUid, elemIdOriginal, romaneioNum) {
    const title = document.getElementById('caixasPopupTitle');
    if(title) title.innerHTML = `<i class="fa-solid fa-boxes-stacked"></i> Caixas do Pedido <span style="font-weight:300; color:#999; margin-left:10px;">${romaneioNum || ''}</span>`;
    if(caixasPopup) caixasPopup.style.display = 'flex';
    
    const container = document.getElementById('listaCaixasContainer');
    container.innerHTML = '<div style="text-align:center; width:100%;"><i class="fa-solid fa-spinner fa-spin"></i> Carregando...</div>';

    const docSnap = await db.collection("usuarios").doc(criadorUid).collection("elementos").doc(elemIdOriginal).collection("pedidosMultiDocumento").doc(id).get();
    
    if(!docSnap.exists) {
        container.innerHTML = '<div style="text-align:center; width:100%; color:red;">Pedido não encontrado.</div>';
        return;
    }
    
    let dados = docSnap.data();
    container.innerHTML = "";

    (dados.documentos || []).forEach(doc => {
        const section = document.createElement('div');
        section.className = 'doc-section';

        let caixasHtml = '';
        (doc.caixas || []).forEach(cx => {
            const icon = cx.isBonificacao ? '<i class="fa-solid fa-star" style="color:var(--secondary)"></i>' : '<i class="fa-regular fa-star"></i>';
            const temProdutos = cx.produtos && cx.produtos.length > 0;
            const produtosList = temProdutos ? cx.produtos.map(p => `<tr><td>${p.referencia}</td><td>${p.descricao}</td><td style="text-align:right;">${p.quantidade || 1}</td></tr>`).join('') : '<tr><td colspan="3" style="text-align:center; color:#999;">Caixa Manual</td></tr>';

            // Sem botões de excluir na header da caixa
            caixasHtml += `
                <div class="caixa-item ${temProdutos ? '' : 'manual'}">
                    <div class="caixa-header" onclick="this.parentElement.classList.toggle('open')">
                        <div style="display:flex; align-items:center; gap:10px;">
                            <span class="bonificacao-star">${icon}</span>
                            <strong>${cx.num || 'CX ?'}</strong> 
                            <span style="color:#666; font-weight:400;">(${cx.peso} kg)</span>
                        </div>
                    </div>
                    <div class="caixa-body"><table style="width:100%; font-size:11px;"><thead style="background:#eee;"><tr><th>Ref</th><th>Desc</th><th style="text-align:right;">Qtd</th></tr></thead><tbody>${produtosList}</tbody></table></div>
                </div>`;
        });

        if(!caixasHtml) caixasHtml = '<p style="text-align:center; color:#ccc; font-style:italic;">Nenhuma caixa.</p>';
        const respText = doc.responsaveis ? doc.responsaveis.join(', ') : doc.responsavel;

        section.innerHTML = `
            <div class="doc-header">
                <h4>${doc.tipo} <small style="color:#999;">(${respText})</small></h4>
            </div>
            <div style="max-height:300px; overflow-y:auto;">${caixasHtml}</div>
        `;
        container.appendChild(section);
    });
}

// =========================================================================
// 4. UTILITÁRIOS E CRONÔMETRO
// =========================================================================
function calcularTempoDecorrido(startTs, endTs) {
    const diff = Math.max(0, endTs - startTs);
    const hh = Math.floor(diff / 3600000).toString().padStart(2, '0');
    const mm = Math.floor((diff % 3600000) / 60000).toString().padStart(2, '0');
    const ss = Math.floor((diff % 60000) / 1000).toString().padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
}

function getSafeTimestamp(obj) {
    if (!obj || !obj.createdAt) return Date.now();
    if (typeof obj.createdAt.toMillis === 'function') return obj.createdAt.toMillis();
    if (obj.createdAt instanceof Date) return obj.createdAt.getTime();
    return obj.createdAt;
}

setInterval(() => {
    const now = Date.now();
    document.querySelectorAll('.live-timer').forEach(el => {
        const start = parseInt(el.getAttribute('data-start'));
        el.querySelector('span').textContent = calcularTempoDecorrido(start, now);
    });
    document.querySelectorAll('.ongoing-timer').forEach(el => {
        const start = parseInt(el.getAttribute('data-start'));
        el.textContent = calcularTempoDecorrido(start, now);
    });
}, 1000);

window.copiarResumo = function(event, btn) {
    event.stopPropagation();
    const row = btn.closest('tr');
    const containerCaixas = row.querySelector('.texto-resumo-caixas');
    const textoParaCopiar = containerCaixas ? containerCaixas.innerText : '';

    navigator.clipboard.writeText(textoParaCopiar).then(() => {
        const iconeOriginal = btn.innerHTML; 
        btn.innerHTML = '<i class="fa-solid fa-check"></i>'; 
        btn.style.background = '#d4edda'; 
        btn.style.color = '#155724';
        setTimeout(() => { btn.innerHTML = iconeOriginal; btn.style.background = ''; btn.style.color = ''; }, 1500);
    });
}

function initDetalhes() { return { total: 0, nf: 0, bonif: 0, minuta: 0, caixas: 0, caixasBonus: 0, agrupado: {} }; }
function ocultarLoader() { setTimeout(() => { pageLoader.classList.add('loader-hidden'); appContent.classList.add('content-visible'); document.body.classList.remove('loading-active'); }, 500); }

document.getElementById('fecharCaixasBtn')?.addEventListener('click', () => { caixasPopup.style.display = 'none'; });
document.getElementById('logoutBtn')?.addEventListener('click', () => { logoutConfirmModal.style.display = 'flex'; });
document.getElementById('cancelLogoutBtn')?.addEventListener('click', () => { logoutConfirmModal.style.display = 'none'; });
document.getElementById('closeLogoutModal')?.addEventListener('click', () => { logoutConfirmModal.style.display = 'none'; });
document.getElementById('confirmLogoutBtn')?.addEventListener('click', () => {
    logoutConfirmModal.style.display = "none";
    if(appContent) appContent.classList.remove('content-visible');
    setTimeout(() => { firebase.auth().signOut().then(() => window.location.href="index.html"); }, 400);
});

// =========================================================================
// FILTRO DE TABELA (PESQUISA LOCAL ESTILO CTRL+F)
// =========================================================================
window.aplicarFiltroTabela = function() {
    const input = document.getElementById('tableSearchInput');
    if(!input) return;
    
    const term = input.value.toLowerCase().trim();
    const rows = document.querySelectorAll('#multiOrdersTableBody tr');
    
    rows.forEach(row => {
        // Ignora a linha padrão de "Nenhum pedido encontrado"
        if(row.querySelector('td[colspan]')) return; 
        
        // Pega todo o texto da linha (romaneio, loja, caixas, status, etc)
        const text = row.innerText.toLowerCase();
        
        // Exibe se encontrar o termo, esconde se não encontrar
        if (text.includes(term)) {
            row.style.display = '';
        } else {
            row.style.display = 'none';
        }
    });
}

// Aciona o filtro toda vez que o usuário digita algo
const tableSearchInput = document.getElementById('tableSearchInput');
if(tableSearchInput) {
    tableSearchInput.addEventListener('input', aplicarFiltroTabela);
}