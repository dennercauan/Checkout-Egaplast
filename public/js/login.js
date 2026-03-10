// Config Firebase (Mesma do Dashboard)
var firebaseConfig = {
    apiKey: "AIzaSyAqTSk9j6pRvRaDn6f1DlPX4w6xbRO3tL4",
    authDomain: "checkout-egaplast.firebaseapp.com",
    projectId: "checkout-egaplast",
    storageBucket: "checkout-egaplast.firebasestorage.app",
    messagingSenderId: "727373395159",
    appId: "1:727373395159:web:7c9cca0884b4fdfe5c2c92"
};

if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore(); // NOVO: Iniciando o banco de dados

// Elementos DOM
const loginForm = document.getElementById('loginForm');
const loginContent = document.getElementById('login-content');
const successContent = document.getElementById('success-content');
const userNameDisplay = document.getElementById('user-name-display');
const pageLoader = document.getElementById('page-loader');
const errorMsg = document.getElementById('error-msg');
const loginBtn = document.getElementById('loginBtn');

// Verifica se já está logado
auth.onAuthStateChanged(user => {
    if (user && !sessionStorage.getItem('justLoggedIn')) {
        // Se já estava logado (não é login novo), poderia redirecionar direto aqui também
        // Mas mantemos comentado conforme seu original para não quebrar fluxos
    }
});

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    
    // Estado de Carregando no Botão
    loginBtn.textContent = "Verificando...";
    loginBtn.disabled = true;
    errorMsg.textContent = "";

    try {
        const userCredential = await auth.signInWithEmailAndPassword(email, password);
        const user = userCredential.user;
        
        // --- O GUARDA DE TRÂNSITO PROVISÓRIO (SEM GASTAR COTA) ---
        let targetUrl = "dashboard.html"; // Vai para a operação por padrão
        
        // Coloque aqui o e-mail exato que você quer usar para testar a tela do comercial
        // LEMBRE-SE DE ALTERAR PARA O E-MAIL QUE VOCÊ VAI USAR AGORA!
        if (user.email === "alan@egaplast.com") {
            targetUrl = "dashboard-viewer.html"; 
        }
        // ---------------------------------------------------------

        // 1. Formatação do nome
        const namePart = user.email.split('@')[0];
        const formattedName = namePart.charAt(0).toUpperCase() + namePart.slice(1);
        userNameDisplay.textContent = formattedName;

        // 2. Mostra mensagem de boas vindas
        loginContent.style.display = 'none';
        successContent.style.display = 'flex';
        
        sessionStorage.setItem('justLoggedIn', 'true');

        // 3. Espera visualizando a mensagem de sucesso
        setTimeout(() => {
            
            // Ativa a cortina branca
            const curtain = document.getElementById('transition-curtain');
            if(curtain) curtain.classList.add('curtain-visible'); 
            
            // Espera a tela ficar branca e redireciona para a url correta
            setTimeout(() => {
                window.location.href = targetUrl; // Usa a URL definida pelo guarda de trânsito
            }, 600); 

        }, 1500); 

    } catch (error) {
        console.error(error);
        loginBtn.textContent = "Entrar na Plataforma";
        loginBtn.disabled = false;
        
        // Tratamento de erros amigável
        if(error.code === 'auth/wrong-password') {
            errorMsg.textContent = "Senha incorreta. Tente novamente.";
        } else if(error.code === 'auth/user-not-found') {
            errorMsg.textContent = "E-mail não encontrado.";
        } else {
            errorMsg.textContent = "Erro ao acessar: " + error.message;
        }
    }
});