// Este código será executado em todas as páginas para verificar se o usuário está logado.

document.addEventListener('DOMContentLoaded', () => {
    const userEmailSpan = document.getElementById('user-email');
    const logoutBtn = document.getElementById('logoutBtn');

    // Verifica o estado da autenticação do Firebase
    firebase.auth().onAuthStateChanged(user => {
        if (user) {
            // Se o usuário estiver logado...
            console.log('Usuário logado:', user.email);

            // Encontramos o elemento para exibir o nome/email
            if (userEmailSpan) {
                // Damos preferência ao nome de exibição (displayName), se existir.
                // Se não, usamos o email como fallback.
                userEmailSpan.textContent = user.displayName || user.email;
            }

            // Adicionamos a funcionalidade ao botão de Sair
            if (logoutBtn) {
                logoutBtn.addEventListener('click', () => {
                    firebase.auth().signOut().then(() => {
                        // Redireciona para a página de login após o logout
                        window.location.href = 'index.html'; // Ajuste se sua página de login tiver outro nome
                    }).catch(error => {
                        console.error('Erro ao fazer logout:', error);
                    });
                });
            }

        } else {
            // Se o usuário NÃO estiver logado...
            console.log('Nenhum usuário logado. Redirecionando para o login.');
            // Redireciona para a página de login
            window.location.href = 'index.html'; // Ajuste se sua página de login tiver outro nome
        }
    });
});