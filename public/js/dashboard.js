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

// DOM Elements
const userEmail = document.getElementById('user-email');
const userName = document.getElementById('user-name');
const logoutBtn = document.getElementById('logoutBtn');
const logoutConfirmModal = document.getElementById('logoutConfirmModal');
const closeLogoutModal = document.getElementById('closeLogoutModal');
const cancelLogoutBtn = document.getElementById('cancelLogoutBtn');
const confirmLogoutBtn = document.getElementById('confirmLogoutBtn');
const openModalBtn = document.getElementById('openModalBtn');
const modal = document.getElementById('modal');
const closeModal = document.getElementById('closeModal');
const createElementBtn = document.getElementById('createElementBtn');
const elementTitleInput = document.getElementById('element-title');
const itemContainer = document.getElementById('item-container');
const logoBtn = document.getElementById("logoBtn");
const sortSelect = document.getElementById('sort-select');

// Search Elements
const searchResultsModal = document.getElementById('searchResultsModal');
const closeSearchModal = document.getElementById('closeSearchModal');
const searchResultsContainer = document.getElementById('searchResultsContainer');
const searchInput = document.getElementById('searchInput');

// Loader & App Elements
const pageLoader = document.getElementById('page-loader');
const appContent = document.getElementById('app-content');

// Adm Elements
const admAccessBtn = document.getElementById('admAccessBtn');
const admAuthModal = document.getElementById('admAuthModal');
const admPasswordInput = document.getElementById('admPasswordInput');
const confirmAdmBtn = document.getElementById('confirmAdmBtn');
const closeAdmModal = document.getElementById('closeAdmModal');

// Novo Botão TV
const tvModeBtn = document.getElementById('tvModeBtn');

let currentUser = null;
let elementsUnsubscriber = null;

// --- TRANSIÇÃO SUAVE DE PÁGINA ---
window.transitionToPage = function(url) {
    if(appContent) appContent.classList.remove('content-visible');
    // Pequeno delay para o fade-out antes de mudar a URL
    setTimeout(() => { window.location.href = url; }, 400);
}

// Autenticação e Load Inicial
firebase.auth().onAuthStateChanged(user => {
    if(user){
        currentUser = user;
        userEmail.textContent = user.email;
        // Pega o nome antes do @
        const namePart = user.email.split('@')[0];
        // Capitaliza a primeira letra
        userName.textContent = namePart.charAt(0).toUpperCase() + namePart.slice(1);
        
        loadElementsRealtime();
    } else {
        window.location.href = "index.html";
    }
});

// Logout
function startLogoutTransition() {
    // 1. Inicia o fade-out do conteúdo
    if(appContent) appContent.classList.remove('content-visible');
    
    // 2. Aguarda a transição CSS e realiza o logout
    setTimeout(() => {
        firebase.auth().signOut().then(() => window.location.href="index.html");
    }, 400);
}

// 1. Ao clicar no botão de Logout da Navbar: Abrir o modal
logoutBtn.addEventListener('click', () => {
    logoutConfirmModal.style.display = "flex";
});

// 2. Fechar modal (usando o X ou o botão Cancelar)
closeLogoutModal.addEventListener('click', () => {
    logoutConfirmModal.style.display = "none";
});

cancelLogoutBtn.addEventListener('click', () => {
    logoutConfirmModal.style.display = "none";
});

// 3. Ao clicar em "Sim, Sair": Iniciar o processo de logout
confirmLogoutBtn.addEventListener('click', () => {
    logoutConfirmModal.style.display = "none"; // Fecha o modal
    startLogoutTransition(); // Inicia a transição e logout
});

logoBtn.addEventListener("click", () => window.location.reload());

// --- AÇÃO DO BOTÃO TV ---
if(tvModeBtn) {
    tvModeBtn.addEventListener('click', () => {
        transitionToPage('painel-tv.html');
    });
}

// --- LÓGICA DE ACESSO ADM ---
admAccessBtn.addEventListener('click', () => {
    admPasswordInput.value = "";
    admAuthModal.style.display = "flex"; // MUDADO DE 'block' PARA 'flex'
    admPasswordInput.focus();
});

closeAdmModal.addEventListener('click', () => admAuthModal.style.display = "none");

function checkAdmPassword() {
    const senha = admPasswordInput.value;
    if (senha === "ega@123") { // Configure sua senha
        admAuthModal.style.display = "none";
        transitionToPage("dashboard-adm.html");
    } else {
        alert("Senha incorreta!");
        admPasswordInput.value = "";
        admPasswordInput.focus();
    }
}

confirmAdmBtn.addEventListener('click', checkAdmPassword);
admPasswordInput.addEventListener('keydown', (e) => { if(e.key === 'Enter') checkAdmPassword(); });


// --- MODAL NOVO ELEMENTO ---
openModalBtn.addEventListener('click', () => {
    modal.style.display = "flex"; // MUDADO DE 'block' PARA 'flex'
    elementTitleInput.focus();
});
closeModal.addEventListener('click', () => modal.style.display="none");

window.addEventListener('click', (e) => { 
    if(e.target==modal) modal.style.display="none";
    if(e.target==searchResultsModal) searchResultsModal.style.display="none";
    if(e.target==admAuthModal) admAuthModal.style.display="none";
    if(e.target==logoutConfirmModal) logoutConfirmModal.style.display="none";
});

createElementBtn.addEventListener('click', async () => {
    const title = elementTitleInput.value.trim();
    if(!title || !currentUser) return;

    try {
        const docRef = await db.collection("usuarios")
            .doc(currentUser.uid)
            .collection("elementos")
            .add({
                titulo: title,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                contagemDocumentos: 0
            });

        modal.style.display="none";
        elementTitleInput.value="";
        transitionToPage(`elemento.html?id=${docRef.id}`);
    } catch(e) {
        alert("Erro: "+e.message);
    }
});

// --- LOAD ELEMENTS (COM ANIMAÇÃO) ---
let currentEditId = null;
let currentDeleteId = null;

// Elementos dos Novos Modais
const renameModal = document.getElementById('renameModal');
const renameInput = document.getElementById('renameInput');
const confirmRenameBtn = document.getElementById('confirmRenameBtn');

const deleteModal = document.getElementById('deleteModal');
const deleteTargetName = document.getElementById('deleteTargetName');
const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');

// --- FUNÇÃO DE CARREGAMENTO DOS CARDS (ATUALIZADA) ---
function loadElementsRealtime(orderByField = "createdAt", orderByDirection = "desc") {
    if (elementsUnsubscriber) elementsUnsubscriber();

    // Loader Fake (Visual)
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

                // Cria o Card
                const card = document.createElement('div');
                card.className = 'element-card';
                card.style.animationDelay = `${index * 0.05}s`; // Efeito cascata

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
                        <button class="overlay-btn access-btn">
                            Abrir Pasta <i class="fa-solid fa-arrow-right"></i>
                        </button>
                    </div>
                `;

                // --- EVENT LISTENERS DO CARD ---
                
                // Botão Renomear (Abre Modal)
                card.querySelector('.edit-btn').addEventListener('click', (e) => {
                    e.stopPropagation();
                    openRenameModal(elementoId, data.titulo);
                });

                // Botão Excluir (Abre Modal)
                card.querySelector('.del-btn').addEventListener('click', (e) => {
                    e.stopPropagation();
                    openDeleteModal(elementoId, data.titulo);
                });

                // Clicar no card ou botão acessar leva para dentro
                const goToElement = () => transitionToPage(`elemento.html?id=${elementoId}`);
                card.querySelector('.access-btn').addEventListener('click', (e) => {
                    e.stopPropagation();
                    goToElement();
                });
                card.addEventListener('click', (e) => {
                    // Evita disparar se clicar nos botões de ação
                    if(!e.target.closest('.icon-btn')) goToElement();
                });

                itemContainer.appendChild(card);
            });
        });
}

// --- LÓGICA DOS MODAIS DE AÇÃO ---

// 1. Renomear
window.openRenameModal = function(id, currentTitle) {
    currentEditId = id;
    renameInput.value = currentTitle;
    renameModal.style.display = "flex";
    renameInput.focus();
}

window.closeRenameModal = function() {
    renameModal.style.display = "none";
    currentEditId = null;
}

confirmRenameBtn.addEventListener('click', async () => {
    const newTitle = renameInput.value.trim();
    if (!newTitle || !currentEditId) return;

    try {
        confirmRenameBtn.textContent = "Salvando...";
        await db.collection("usuarios").doc(currentUser.uid)
            .collection("elementos").doc(currentEditId)
            .update({ titulo: newTitle });
        
        closeRenameModal();
    } catch (error) {
        alert("Erro ao renomear: " + error.message);
    } finally {
        confirmRenameBtn.textContent = "Salvar Alteração";
    }
});

// 2. Excluir
window.openDeleteModal = function(id, title) {
    currentDeleteId = id;
    deleteTargetName.textContent = title;
    deleteModal.style.display = "flex";
}

window.closeDeleteModal = function() {
    deleteModal.style.display = "none";
    currentDeleteId = null;
}

confirmDeleteBtn.addEventListener('click', async () => {
    if (!currentDeleteId) return;

    try {
        confirmDeleteBtn.textContent = "Excluindo...";
        
        // Excluir o documento do elemento
        await db.collection("usuarios").doc(currentUser.uid)
            .collection("elementos").doc(currentDeleteId).delete();
            
        closeDeleteModal();
    } catch (error) {
        alert("Erro ao excluir: " + error.message);
    } finally {
        confirmDeleteBtn.textContent = "Sim, Excluir";
    }
});

// Fechar modais ao clicar fora
window.onclick = function(event) {
    if (event.target == renameModal) closeRenameModal();
    if (event.target == deleteModal) closeDeleteModal();
}
// --- ORDENAÇÃO ---
sortSelect.addEventListener('change', (e) => {
    const sortType = e.target.value;
    itemContainer.innerHTML = ""; // Limpa visualmente para reiniciar animação
    if (sortType === 'recentes') loadElementsRealtime('createdAt', 'desc');
    else if (sortType === 'antigos') loadElementsRealtime('createdAt', 'asc');
    else if (sortType === 'quantidade') loadElementsRealtime('contagemDocumentos', 'desc');
});

// --- BUSCA GLOBAL ---
searchInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
        const searchTerm = searchInput.value.trim();
        if (searchTerm.length < 3) { alert("Digite pelo menos 3 caracteres."); return; }
        performGlobalSearch(searchTerm);
    }
});

closeSearchModal.addEventListener('click', () => searchResultsModal.style.display = "none");

async function performGlobalSearch(term) {
    if (!currentUser) return;
    searchResultsModal.style.display = "flex"; // MUDADO DE 'block' PARA 'flex'
    searchResultsContainer.innerHTML = '<div style="text-align:center; padding:20px;"><i class="fa-solid fa-spinner fa-spin"></i> Pesquisando...</div>';

    let allResults = [];
    const elementosRef = db.collection("usuarios").doc(currentUser.uid).collection("elementos");
    
    try {
        const elementosSnapshot = await elementosRef.get();
        const searchPromises = [];

        elementosSnapshot.forEach(elementoDoc => {
            const elementoData = elementoDoc.data();
            const elementoId = elementoDoc.id;

            // Busca em pedidos simples e multi-documento
            const p1 = elementosRef.doc(elementoId).collection('pedidos').where('romaneio', '==', term).get();
            const p2 = elementosRef.doc(elementoId).collection('pedidos').where('loja', '==', term).get();
            const p3 = elementosRef.doc(elementoId).collection('pedidosMultiDocumento').where('romaneio', '==', term).get();
            const p4 = elementosRef.doc(elementoId).collection('pedidosMultiDocumento').where('loja', '==', term).get();

            searchPromises.push(
                Promise.all([p1, p2, p3, p4]).then(results => {
                    results.forEach(snapshot => {
                        snapshot.forEach(doc => {
                            allResults.push({
                                id: doc.id, 
                                data: doc.data(), 
                                elemento: { id: elementoId, titulo: elementoData.titulo }
                            });
                        });
                    });
                })
            );
        });

        await Promise.all(searchPromises);

        // Remove duplicatas
        const uniqueResults = allResults.reduce((acc, current) => {
            if (!acc.find(item => item.id === current.id)) acc.push(current);
            return acc;
        }, []);

        displaySearchResults(uniqueResults, term);

    } catch (error) {
        searchResultsContainer.innerHTML = `<p style="color:red; text-align:center;">Erro na busca: ${error.message}</p>`;
    }
}

function displaySearchResults(results, term) {
    if (results.length === 0) {
        searchResultsContainer.innerHTML = `<p style="text-align:center; color:#999; padding:20px;">Nada encontrado para "<strong>${term}</strong>".</p>`;
        return;
    }
    let html = '';
    results.forEach(result => {
        const pedido = result.data;
        html += `
            <div class="search-result-item">
                <h3>
                    <span><i class="fa-solid fa-box"></i> ${pedido.romaneio || 'S/N'}</span>
                    <span class="elemento-info">Elemento: ${result.elemento.titulo}</span>
                </h3>
                <div class="details-grid">
                    <div><strong>Loja:</strong> ${pedido.loja || '---'}</div>
                    <div><strong>Local:</strong> ${pedido.local || '---'}</div>
                </div>
                <div style="text-align:right;">
                    <a href="#" onclick="window.transitionToPage('elemento.html?id=${result.elemento.id}')" class="go-to-element-btn">
                        Ir para Elemento <i class="fa-solid fa-arrow-right"></i>
                    </a>
                </div>
            </div>
        `;
    });
    searchResultsContainer.innerHTML = html;
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        
        // 1. Se o Modal "Novo Elemento" estiver aberto
        if (modal.style.display === 'flex') {
            e.preventDefault();
            createElementBtn.click();
        }

        // 2. Se o Modal "Renomear" estiver aberto
        else if (renameModal && renameModal.style.display === 'flex') {
            e.preventDefault();
            confirmRenameBtn.click();
        }

        // 3. Se o Modal "Excluir" estiver aberto
        else if (deleteModal && deleteModal.style.display === 'flex') {
            e.preventDefault();
            confirmDeleteBtn.click();
        }

        // 4. Se o Modal "Admin" estiver aberto
        else if (admAuthModal && admAuthModal.style.display === 'flex') {
            e.preventDefault();
            confirmAdmBtn.click();
        }
        
        // 5. Busca Principal (Se o foco estiver no campo de busca e nenhum modal aberto)
        else if (document.activeElement === searchInput) {
            // A busca já tem seu próprio listener
        }
    }
});

// --- FUNÇÃO DE AUTOCORREÇÃO DO CONTADOR ---
async function verifyRealCount(uid, elementId, currentStoredCount) {
    try {
        const elementRef = db.collection("usuarios").doc(uid).collection("elementos").doc(elementId);
        
        // Recupera dados para contexto
        const elementDoc = await elementRef.get();
        if (!elementDoc.exists) return;
        const elementTitle = elementDoc.data().titulo;
        
        const userEmail = firebase.auth().currentUser.email.trim().toLowerCase();

        const [pedidosSnap, multiSnap, producoesSnap, sharedSnap] = await Promise.all([
            elementRef.collection('pedidos').get(),
            elementRef.collection('pedidosMultiDocumento').get(),
            elementRef.collection('producoes').get(),
            db.collection("usuarios").doc(uid).collection("pedidosCompartilhadosComigo")
              .where("elementoTitulo", "==", elementTitle).get()
        ]);

        let totalCount = 0;

        // 1. Pedidos Simples
        totalCount += pedidosSnap.size;
        
        // 2. Produções
        totalCount += producoesSnap.size;

        // 3. Multi Documento
        multiSnap.forEach(doc => {
            const data = doc.data();
            
            if (data.documentos && Array.isArray(data.documentos)) {
                const meusDocs = data.documentos.filter(d => {
                    const isResponsavel = d.responsavel && d.responsavel.trim().toLowerCase() === userEmail;
                    const isFinanceiro = d.tipo === 'Nota Fiscal' || d.tipo === 'Minuta';
                    return isResponsavel && isFinanceiro;
                });
                totalCount += meusDocs.length;
            } else {
                totalCount += 1;
            }
        });

        // 4. Itens Compartilhados
        const sharedPromises = sharedSnap.docs.map(async (shareDoc) => {
            const info = shareDoc.data(); 
            try {
                const originDoc = await db.collection("usuarios").doc(info.criadorUid)
                    .collection("elementos").doc(info.elementoId)
                    .collection("pedidosMultiDocumento").doc(info.pedidoId).get();

                if (originDoc.exists) {
                    const data = originDoc.data();
                    if (data.documentos && Array.isArray(data.documentos)) {
                        const meusDocs = data.documentos.filter(d => {
                            const isResponsavel = d.responsavel && d.responsavel.trim().toLowerCase() === userEmail;
                            const isFinanceiro = d.tipo === 'Nota Fiscal' || d.tipo === 'Minuta';
                            return isResponsavel && isFinanceiro;
                        });
                        return meusDocs.length;
                    }
                }
            } catch (err) { console.warn("Erro compartilhado:", err); }
            return 0;
        });

        const countsShared = await Promise.all(sharedPromises);
        totalCount += countsShared.reduce((a, b) => a + b, 0);

        if (totalCount !== currentStoredCount) {
            console.log(`Corrigindo ID ${elementId}: De ${currentStoredCount} para ${totalCount}`);
            await elementRef.update({ contagemDocumentos: totalCount });
        }

    } catch (error) {
        console.error("Erro verificação:", error);
    }
}