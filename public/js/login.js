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

// Elementos DOM
const loginForm = document.getElementById('loginForm');
const loginContent = document.getElementById('login-content');
const successContent = document.getElementById('success-content');
const userNameDisplay = document.getElementById('user-name-display');
const pageLoader = document.getElementById('page-loader');
const errorMsg = document.getElementById('error-msg');
const loginBtn = document.getElementById('loginBtn');

// Verifica se já está logado (Redirecionamento rápido se já tiver sessão)
auth.onAuthStateChanged(user => {
    if (user && !sessionStorage.getItem('justLoggedIn')) {
        // Se já estava logado (não é login novo), vai direto
        // window.location.href = "dashboard.html";
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
        
        // 1. Formatação do nome (Mantém igual)
        const namePart = user.email.split('@')[0];
        const formattedName = namePart.charAt(0).toUpperCase() + namePart.slice(1);
        userNameDisplay.textContent = formattedName;

        // 2. Mostra mensagem de boas vindas (Mantém igual)
        loginContent.style.display = 'none';
        successContent.style.display = 'flex';
        
        sessionStorage.setItem('justLoggedIn', 'true');

        // 3. Espera visualizando a mensagem de sucesso
        setTimeout(() => {
            
            // --- MUDANÇA AQUI ---
            // Ao invés de mostrar loader girando, ativamos a cortina branca
            const curtain = document.getElementById('transition-curtain');
            if(curtain) curtain.classList.add('curtain-visible'); // Adiciona a classe do CSS
            
            // Espera a tela ficar branca (0.5s) e redireciona
            setTimeout(() => {
                window.location.href = "dashboard.html";
            }, 600); // Tempo levemente maior que a transição CSS (0.5s) para garantir tela branca total

        }, 1500); // Tempo vendo o "Bem-vindo"


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