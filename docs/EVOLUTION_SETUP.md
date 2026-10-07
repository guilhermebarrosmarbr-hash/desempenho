# Configuração da Integração com WhatsApp (Evolution API)

O sistema de envio em lote de PDFs via WhatsApp foi projetado para funcionar de forma **100% estática** no front-end (GitHub Pages) e utilizar um **Cloudflare Worker** como proxy de segurança. 

O proxy impede que a URL base e a API Key da sua Evolution API fiquem expostas no código-fonte público.

## 1. Arquitetura

1. **Frontend (GitHub Pages)**: Exibe a interface, gera o PDF em Base64 e envia para o Cloudflare Worker via POST. Apenas o "Worker URL" e o "Token de Acesso do Frontend" ficam salvos no \`localStorage\` do navegador do usuário (no menu da Engrenagem do WhatsApp).
2. **Cloudflare Worker (Proxy)**: Recebe a requisição, valida o Token de Acesso do Frontend. Se válido, monta o payload no formato da Evolution API v2, anexa a \`API Key\` verdadeira e envia a requisição para o seu servidor.
3. **Evolution API**: Recebe o base64, converte para PDF real, anexa a legenda e dispara para o número de WhatsApp (através da instância conectada).

## 2. Requisitos

- Uma instância da **Evolution API (v2)** rodando e com o celular/WhatsApp já conectado.
- Conta no **Cloudflare** (Workers são gratuitos até 100.000 requisições/dia).
- Node.js instalado localmente (para configurar o Cloudflare via \`wrangler\`).

## 3. Implantação do Cloudflare Worker

1. Abra o terminal na pasta \`worker/\` deste projeto.
2. Faça login no Cloudflare:
   \`\`\`bash
   npx wrangler login
   \`\`\`
3. Defina os Segredos (Secrets) que o worker utilizará. Rode os comandos abaixo e cole os valores quando solicitado:
   
   \`\`\`bash
   # 1. Uma senha inventada por você para proteger o Worker. 
   # É esta senha que você digitará na interface web (Token).
   npx wrangler secret put FRONTEND_ACCESS_TOKEN
   
   # 2. A Global API Key ou a API Key da sua instância da Evolution API
   npx wrangler secret put EVOLUTION_API_KEY
   
   # 3. A URL do seu servidor Evolution API (sem a barra no final)
   # Ex: https://api.meudominio.com
   npx wrangler secret put EVOLUTION_API_URL
   
   # 4. O nome da instância que está conectada
   # Ex: mar-brasil-oficial
   npx wrangler secret put EVOLUTION_INSTANCE_NAME
   \`\`\`
4. Publique o Worker:
   \`\`\`bash
   npx wrangler deploy
   \`\`\`
5. O terminal irá retornar a URL pública do seu worker (ex: \`https://pmoc-whatsapp-proxy.seu-usuario.workers.dev\`). Guarde essa URL!

## 4. Configuração no Sistema Web (Frontend)

1. Abra o sistema web (local ou pelo GitHub Pages).
2. Clique no ícone de Engrenagem (⚙️) na barra superior, ou no botão ⚙️ dentro do Modal do WhatsApp.
3. Preencha:
   - **Worker URL**: Cole a URL gerada no passo 4 acima.
   - **Token de Acesso**: Cole a mesma senha que você configurou no segredo \`FRONTEND_ACCESS_TOKEN\`.
   - **Template de Mensagem**: (Opcional) Ajuste a mensagem. Variáveis válidas: \`{tecnico}\`, \`{competencia}\`, \`{setor}\`.
4. Clique em **Salvar Configurações**.

## 5. Modo de Teste

É recomendável utilizar o botão de **Modo de Teste** (Checkbox) dentro do modal do WhatsApp antes de realizar disparos reais. 
Ao habilitar o modo de teste, um número de telefone de destino forçado (o seu, por exemplo) será usado para todos os envios. Assim, você garante que os PDFs estão sendo gerados corretamente e enviados com o template certo sem importunar os técnicos.

## 6. LGPD / Regras de Negócio

Para que o envio funcione, certifique-se de que:
1. O técnico inserido nas "Configurações de Contratos & Técnicos" tenha o **telefone formatado corretamente** (DDD + 9 dígitos, ex: \`13 99999-9999\`).
2. O técnico já tenha **iniciado uma conversa** com o número do remetente (mar-brasil-oficial) para evitar bloqueios por spam no WhatsApp, conforme boas práticas. O sistema fará os envios em lote com um delay aleatório de **4 a 10 segundos** entre as mensagens, mitigando as chances de bloqueio pela Meta.
