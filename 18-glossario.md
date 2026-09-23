# 18 — Glossário e FAQ

> Termos do produto + perguntas frequentes.
> Pra alinhamento interno, suporte, e onboarding.

---

## 📖 Glossário de Termos

### Termos de Produto

| Termo | Definição |
|-------|-----------|
| **Avatar** | Foto circular do usuário exibida no mapa |
| **Match** | Quando dois usuários se curtem mutuamente |
| **Match context** | Informação geográfica exibida no momento do match (ex: "vocês se cruzaram no Bar do Léo") |
| **Hotspot** | Local com concentração de usuários (5+) |
| **Geohash** | Sistema de codificação geográfica em string (ex: "u3gy2") |
| **Geofence** | Área geográfica virtual delimitada |
| **Background location** | Atualização de GPS com app fechado |
| **Modo Visível** | Usuário aparece no mapa e pode dar match |
| **Modo Anônimo** | Usuário vê mas não aparece, sem match |
| **Boost** | Destaque temporário no mapa (1h, R$ 4,90) |
| **Premium** | Assinatura R$ 29,90/mês com recursos extras |
| **Premium+** | Assinatura R$ 49,90/mês com avatar destacado |
| **Super curtida** | Curtida com notificação prioritária |
| **Selo** | Conquista por visitar X locais de uma categoria |
| **Chat expiry** | Tempo até conversa expirar (48h) |
| **Renovação** | Quando chat expira, visita ao mesmo local renova |
| **Verificação** | Badge azul via selfie + AWS Rekognition |
| **Pausa** | User some do mapa por X tempo |
| **Bloqueio** | User não pode mais interagir com outro |
| **Denúncia** | Report de comportamento inadequado |

### Termos Técnicos

| Termo | Definição |
|-------|-----------|
| **POI** | Point of Interest (bar, restaurante, etc) |
| **TTL** | Time To Live (tempo até dado expirar) |
| **JWT** | JSON Web Token (autenticação) |
| **IAP** | In-App Purchase |
| **FCM** | Firebase Cloud Messaging (push) |
| **REST** | Arquitetura de API |
| **WebSocket** | Conexão persistente pra chat |
| **PostGIS** | Extensão PostgreSQL pra geolocalização |
| **Redis** | Banco chave-valor em memória |
| **Bull** | Sistema de filas (jobs assíncronos) |
| **Geofencing** | Detecção de entrada/saída de área |
| **CDN** | Content Delivery Network (imagens) |
| **Rate limit** | Limite de requests por tempo |
| **Soft delete** | Marcar como deletado sem remover do DB |
| **Audit log** | Registro de ações sensíveis (LGPD) |
| **WebHook** | Notificação HTTP pra evento externo |

### Termos de Negócio

| Termo | Definição |
|-------|-----------|
| **CAC** | Custo de Aquisição de Cliente |
| **LTV** | Lifetime Value (valor vitalício do usuário) |
| **MRR** | Monthly Recurring Revenue |
| **ARR** | Annual Recurring Revenue |
| **ARPU** | Average Revenue Per User |
| **MAU** | Monthly Active Users |
| **DAU** | Daily Active Users |
| **Churn** | Taxa de cancelamento |
| **DAU/MAU** | Stickiness (frequência de uso) |
| **D7/D30** | Retention no dia 7/dia 30 |
| **NPS** | Net Promoter Score |
| **TAM** | Total Addressable Market |
| **SAM** | Serviceable Addressable Market |
| **SOM** | Serviceable Obtainable Market |

### Termos LGPD

| Termo | Definição |
|-------|-----------|
| **Consentimento** | Autorização explícita do usuário |
| **Eliminação** | Direito de deletar dados |
| **Portabilidade** | Direito de exportar dados |
| **DPO** | Data Protection Officer |
| **Anonimização** | Tornar dado não-identificável |
| **Base legal** | Justificativa pra processar dados |
| **Encarregado** | DPO |
| **Finalidade** | Propósito do uso de dados |

---

## ❓ FAQ — Perguntas Frequentes

### Sobre o produto

**O que é o Cruzei?**
> É um app de encontros baseado em geolocalização real. Você vê quem está ou esteve no mesmo lugar que você nas últimas 5 horas, com mapa em tempo real estilo Pokémon GO.

**Como funciona o match?**
> Você curte perfis de pessoas que estavam no mesmo local que você. Se elas também te curtirem, é match. Cada match vem com contexto: "Vocês se cruzaram no Bar do Léo sábado às 22h".

**Quanto custa?**
> O Cruzei é gratuito com limitações. Premium é R$ 29,90/mês com mais recursos. Premium+ é R$ 49,90/mês com avatar destacado. Boost único custa R$ 4,90.

**Por que Premium?**
> Pra ter acesso à cidade inteira (não só ao local onde você está), mais super curtidas, e filtros avançados.

**Posso cancelar quando quiser?**
> Sim. Você pode cancelar a assinatura a qualquer momento nas configurações do seu telefone (App Store / Google Play).

**O Cruzei é só pra SP?**
> Não. Lançamos em Uberlândia como beta, depois expandimos pra SP, RJ, BH, Curitiba, Salvador e outras capitais.

**Tem versão web?**
> Ainda não. Estamos focados em mobile (iOS + Android). Versão web é plano futuro.

---

### Sobre privacidade e segurança

**Vocês compartilham minha localização exata?**
> Não. Sua localização exata nunca é compartilhada com outros usuários. Eles veem só distância aproximada ("perto", "300m"). Seus dados ficam seguros no nosso servidor com criptografia.

**Vocês deletam minha localização?**
> Sim. Localizações são apagadas após 5 horas de inatividade. Nosso banco mantém histórico por 30 dias (LGPD permite isso pra segurança), depois é deletado automaticamente.

**Como faço pra deletar minha conta?**
> Configurações > Conta > Deletar conta. Após 30 dias (pra caso você mude de ideia), tudo é removido permanentemente.

**Vocês usam meus dados pra vender?**
> Não. Nunca vendemos dados pessoais. Anonimização pra estatísticas internas, mas dados pessoais ficam privados.

**Como denunciar alguém?**
> Abre o perfil da pessoa > "..." > "Denunciar". Escolha o motivo e envie. Moderação revisa em até 24h.

**Como bloquear alguém?**
> Abre o perfil > "..." > "Bloquear". A pessoa não vai mais ver você, nem te mandar mensagem.

**O que acontece se eu for assediada?**
> Use o botão de pânico (configurações > emergência) ou denuncie. Nossa equipe de moderação prioriza casos de assédio e toma ação em até 8h.

---

### Sobre o mapa

**Como funciona o mapa?**
> É um mapa estilo Pokémon GO com avatares circulares das pessoas que estão ou estiveram no mesmo local que você nas últimas 5 horas. Você vê só quem está no mesmo raio.

**Por que algumas pessoas estão sem foto?**
> Elas estão em modo anônimo. Você vê que tem alguém ali, mas não vê a identidade. Se você quer ver quem é, mude pra modo visível e veja se elas se revelam.

**Como ativo o modo anônimo?**
> Botão no topo do mapa: 👁️ Visível ↔ 🕶️ Anônimo. Quando anônimo, você vê mas não aparece. Não pode dar nem receber match.

**Por que não vejo ninguém no mapa?**
> Pode ser que o local tenha pouca gente no momento. Tente aumentar o zoom out, ou vá pra regiões mais movimentadas. Em horários de pico (sexta à noite, por exemplo) tem mais gente.

**O mapa gasta muita bateria?**
> Não. Usamos geofencing inteligente que só atualiza quando você entra em áreas conhecidas. Em uso normal, gasta ~5% de bateria por dia.

**Vocês sabem onde estou 24h?**
> Não. A localização só é registrada quando o app está aberto ou em background. Você pode pausar o app (Configurações > Pausar) pra parar de aparecer.

---

### Sobre o chat

**Por que os chats expiram em 48h?**
> Pra criar urgência e evitar acúmulo de matches abandonados. Você tem 48h pra ter uma conversa boa. Depois, o chat some mas o match fica no histórico.

**Como renovo um chat que expirou?**
> Se ambos visitarem o mesmo local nas próximas 72h, o chat renova automaticamente. Você recebe notificação.

**Posso salvar uma conversa?**
> Não diretamente. Mas se quiser manter, é só continuar conversando. O chat não expira se tiver mensagens recentes (atualiza o timer).

**Posso mandar foto no chat?**
> Sim. Mas são fotos temporárias que somem após 10 segundos (estilo Snapchat).

**Posso mandar áudio?**
> Sim, áudios de até 60 segundos. Não expiram.

**Vocês monitoram mensagens?**
> Sim, automaticamente. Filtramos palavras proibidas, números de telefone, e-mails e tentativas de contato externo. Denuncie mensagens inadequadas.

**Por que não posso mandar contato?**
> Pra sua segurança. Se a outra pessoa quiser te dar o número, vai ter que ser em outro chat. Isso evita golpes e exposição prematura.

---

### Sobre matches e curtidas

**Como sei quem me curtiu?**
> Free: você só vê nos matches efetivos. Premium: últimas 5 curtidas. Premium+: TODAS as curtidas.

**Posso desfazer uma curtida?**
> Premium pode voltar perfil (5 por dia). Free não.

**O que é super curtida?**
> É uma curtida que avisa a outra pessoa (notificação prioritária). Free tem 1 por dia. Premium tem 9.

**Como uso a super curtida?**
> Toque na ⭐ em vez do ❤️ ao curtir. Ela vai aparecer destacada pra pessoa.

**Como funciona o Boost?**
> Você paga R$ 4,90 e seu avatar fica em destaque no mapa por 1 hora. Aparece maior, com brilho, e no topo da lista. Premium+ tem 1 grátis por mês.

---

### Sobre cidades

**Quando Cruzei chega na minha cidade?**
> Após beta em Uberlândia, expandimos pra SP/RJ (mês 4-5), depois outras capitais. Acompanhe @cruzei.app no Instagram pra updates.

**Posso usar Cruzei em qualquer cidade?**
> Sim, mas só vai mostrar gente da cidade onde você está. Se você for pra SP e tiver o app, vai ver gente de SP.

**Por que Uberlândia primeiro?**
> Cidade universitária, vida noturna ativa, e sem concorrência forte. É o tamanho perfeito pra provar o modelo.

**Cruzei funciona fora do Brasil?**
> Não por enquanto. Apenas Brasil. Internacionalização é plano futuro (ano 2).

---

### Sobre verificação

**Como funciona a verificação?**
> Você tira uma selfie em tempo real. Comparamos com sua foto de perfil via IA. Se for a mesma pessoa, ganha badge azul. A selfie não é pública.

**Preciso verificar pra usar?**
> Não. Verificação é opcional, mas recomendada. Pessoas verificadas ganham mais curtidas (outros usuários preferem).

**Quem vê minha selfie?**
> Só a equipe de verificação, e só por 30 dias. Depois é deletada.

**E se eu for rejeitado na verificação?**
> Você pode tentar novamente. Geralmente rejeitamos por foto ruim (sem luz, óculos, etc).

**Posso ser banido sem verificação?**
> Não. Mas contas não verificadas podem receber menos confiança.

---

### Sobre cancelamento e reembolso

**Como cancelo Premium?**
> iOS: Ajustes > [seu nome] > Assinaturas > Cruzei > Cancelar.
> Android: Google Play > Assinaturas > Cruzei > Cancelar.

**Tenho direito a reembolso?**
> Sim, dentro de 7 dias (lei do consumidor). Após isso, política de cada plataforma.

**Se eu cancelar, perco imediatamente?**
> Não. Você continua premium até o fim do período pago.

**Posso reativar depois?**
> Sim, a qualquer momento. Os dados e selos ficam guardados.

---

### Sobre problemas técnicos

**O app tá lento**
> Verifique sua conexão. Feche e abra o app. Se persistir, reporte pra suporte@cruzei.com.br.

**Não tô recebendo notificações**
> Configurações do telefone > Notificações > Cruzei > Ativar. Verifique também se tá no "modo não perturbe".

**Não consigo fazer upload de foto**
> Verifique conexão e espaço no telefone. Foto deve ter menos de 5MB.

**Minha localização tá errada**
> Configurações do telefone > Localização > Ativar e em "alta precisão". Dentro do app, force update tocando no botão de centralizar.

**Como reporto um bug?**
> Configurações > Ajuda > Reportar problema. Ou email suporte@cruzei.com.br.

---

### Sobre o beta

**Como entro no beta?**
> Baixe o app na App Store/Play Store e crie conta. O beta é público em Uberlândia.

**Tem fila de espera?**
> Pode ter em horários de pico. Geralmente não.

**O beta é completo?**
> É a versão MVP. Faltam alguns recursos que vêm na V2 (selos, histórias, premium+ com glow).

---

## 🆘 Contatos de Suporte

| Canal | Contato | SLA |
|-------|---------|-----|
| Email | suporte@cruzei.com.br | 24h |
| Chat in-app | Configurações > Ajuda | Imediato (horário comercial) |
| Instagram | @cruzei.app | 12h |
| Twitter | @cruzei | 12h |
| Emergência | Botão de pânico in-app | Imediato |

---

## 📞 Contatos Externos

| Necessidade | Contato |
|-------------|---------|
| Emergência (Polícia) | 190 |
| Violência contra mulher | 180 |
| LGPD / Direitos | ANPD (gov.br/anpd) |
| SaferNet Brasil | safernet.org.br |

---

**Versão:** 1.0
**Status:** ✅ Aprovado
**Próximo:** [19-prompt-vanta.md](./19-prompt-vanta.md)