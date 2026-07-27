# 🎤 ALBATROZ-KARAOKE

Este é o código-fonte completo e funcional do aplicativo **Albatroz-Karaoke**, originalmente hospedado em `https://karaoke-albatroz.onrender.com/`.

## ⚙️ Como Executar Localmente

Como o projeto foi construído utilizando apenas módulos nativos do Node.js, ele não possui dependências externas de pacotes (`npm install` não é necessário).

### Passo a Passo:

1. **Instale o Node.js** (versão 18 ou superior recomendada) caso ainda não o tenha.
2. Abra o terminal (PowerShell, Bash, etc.) na pasta do projeto:
   ```bash
   cd karaoke-albatroz
   ```
3. Inicie o servidor:
   ```bash
   node server.js
   ```
4. O terminal exibirá dois endereços:
   - **Local:** `http://localhost:8765/` (para abrir no seu computador).
   - **Rede Local:** `http://<IP-DA-SUA-REDE>:8765/` (use este endereço ou escaneie o QR Code gerado na tela para conectar celulares no mesmo Wi-Fi e usá-los como controle remoto!).

---

## 🛠️ Arquitetura e Tecnologias

O aplicativo é leve e eficiente, utilizando:

- **Servidor Backend (Node.js nativo):**
  - Servidor HTTP básico rodando em `http` nativo.
  - Endpoints de API simples para gerenciar a fila (`/api/queue`), dados do torneio (`/api/tournament/...`), e configurações de rede.
  - Integração com busca do YouTube (`/api/search-yt`) simulando um cliente do navegador para extrair os IDs dos vídeos sem precisar de uma chave oficial da API do YouTube (o que previne limites de uso).
- **Interface Frontend (Vanilla JS + HTML5 + CSS3):**
  - Consome letras sincronizadas através da API pública do **LRCLib** (`https://lrclib.net/`).
  - Utiliza a API de áudio nativa do navegador (`AudioContext`, `createAnalyser`) para capturar o microfone do usuário e fazer a detecção de afinação em tempo real (pitch detection) via autocorrelação de frequência.
  - Desenha um mini-gráfico de stave (notas) dinâmico comparando a melodia procedural gerada com a voz capturada no microfone para fins de pontuação.

---

## 🔒 Detalhe Técnico: Como o código foi obtido?

Este código foi obtido a partir de uma falha de configuração de rotas estáticas no servidor de produção. O servidor estava configurado para servir arquivos estáticos a partir do diretório raiz (`__dirname`), permitindo o acesso e download direto a arquivos do backend como `server.js` e `package.json`, além dos arquivos frontend comuns (`index.html`, `app.js`, `style.css` e `manifest.json`).
