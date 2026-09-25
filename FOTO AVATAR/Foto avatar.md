PROMPT PREMIUM — CRUZE
IDENTIDADE SOCIAL NO MAPA: FOTO REAL + AVATAR 3D + NOME

OBJETIVO
Evolua a representação das pessoas no mapa para combinar FOTO REAL + AVATAR 3D + NOME + STATUS, criando uma identidade híbrida elegante e premium.

“Quem eu vejo no mapa é uma pessoa real, representada pelo seu avatar dentro do universo Cruze.”

IMPORTANTE: não apenas coloque uma foto sobre o boneco. Crie uma composição visual integrada, como uma única identidade social.

1. ANTES DE ALTERAR
Analise a arquitetura atual, Mapbox, avatares, localização, perfil, fotos, nomes, status, modo anônimo/invisível, Premium, clustering e interações.
Não refaça o projeto do zero. Preserve tudo que já funciona e implemente de forma incremental.

2. NOVA REPRESENTAÇÃO
Cada usuário visível deve ter:
- foto real circular;
- avatar 3D abaixo;
- nome discreto;
- status quando aplicável;
- anel/efeito de seleção;
- distância aproximada;
- integração com match e interações.

A foto não pode parecer separada do avatar. Deve parecer uma “bolha de identidade” flutuando acima do personagem.

3. FOTO
- círculo perfeito;
- borda elegante;
- sombra sutil;
- boa legibilidade sobre o mapa;
- carregamento otimizado;
- fallback sem foto;
- object-fit/cover;
- sem distorção.

4. COMPOSIÇÃO
Foto acima do avatar, com nome entre eles ou em posição visualmente melhor.
A distância entre foto, nome e avatar deve ser dinâmica para evitar sobreposição.

5. NOME
Tipografia limpa, pequena e legível.
Truncar nomes longos de forma inteligente, por exemplo “Leonardo S.”.
Não deixar nomes gigantes no mapa.

6. STATUS
ONLINE: ponto verde discreto.
OFFLINE/RECENTE: visual neutro.
EM ALTA: badge/efeito sutil.
MATCH: estado especial.
ANÔNIMO: não mostrar foto real.
INVISÍVEL: não aparecer no mapa.

7. PRIVACIDADE — MUITO IMPORTANTE
Adicionar/usar a preferência “Mostrar minha foto no mapa”.
ON: foto aparece.
OFF: apenas avatar.
Modo anônimo: não revelar foto/identidade além do permitido.
Modo invisível: não aparecer.
Nunca revelar GPS exato, endereço, coordenadas ou histórico de movimentação.
Continuar usando posições aproximadas/generalizadas.

8. ZOOM E DISTÂNCIA
Muito distante: avatar simplificado e indicador pequeno.
Distância média: avatar + foto pequena + nome opcional.
Próximo: foto + nome + avatar completo + status.
Selecionado: foto maior + nome + avatar + status + ações.

Quanto mais longe, menos informação. Quanto mais perto, mais informação.

9. CLUSTERING
Com muitas pessoas próximas, não sobrepor dezenas de fotos.
Usar clustering, por exemplo “27 pessoas”.
Ao tocar, aproximar o mapa e separar gradualmente os usuários.
Manter animação suave.

10. TOQUE NO USUÁRIO
Ao tocar:
- destacar avatar;
- aumentar a foto suavemente;
- destacar nome;
- pequeno efeito de seleção;
- abrir o bottom sheet/perfil existente;
- mostrar as ações atuais.
Não criar fluxo paralelo desnecessário.

11. ANIMAÇÕES
Foto, nome e avatar devem se mover como uma composição.
Avatar andando: foto e nome acompanham suavemente.
Parado: pequena flutuação/respiração.
Chegando: foto com fade + scale e avatar aparecendo.
Saindo: fade suave.
Nada exagerado; acabamento premium.

12. MATCH
Quando duas pessoas derem match:
- avatares se aproximam;
- fotos ficam visíveis;
- personagens fazem animação especial;
- criar conexão visual;
- mostrar “🔥 CRUZE!”;
- usar partículas/efeito premium discreto;
- retornar ao estado normal após alguns segundos.
Não deixar infantil.

13. IDENTIDADE VISUAL
Manter o estilo:
dark, urbano, futurista, premium, social, moderno, 3D e elegante.
Evitar excesso de neon, bordas grossas e excesso de efeitos.
A foto deve parecer parte do universo Cruze.

14. AVATAR CONTINUA IMPORTANTE
A foto não substitui o avatar.
Foto = quem está por trás.
Avatar = como a pessoa existe dentro do universo Cruze.

15. PERSONALIZAÇÃO FUTURA
Preparar arquitetura para roupas, cabelo, acessórios, óculos, bonés, skins, itens Premium, poses, animações e efeitos.
A foto deve continuar independente do avatar.

16. PERFORMANCE
Preparar para dezenas/centenas de usuários:
- cache de imagens;
- thumbnails;
- lazy loading;
- compressão;
- pré-carregamento inteligente;
- clustering;
- LOD;
- pausa de animações fora da viewport;
- reduzir detalhes em zoom distante;
- evitar recriação de componentes;
- evitar downloads repetidos.
Nunca carregar fotos gigantes quando thumbnail for suficiente.

17. FOTO SEM CARREGAR
Usar placeholder circular/skeleton discreto ou avatar.
Se falhar, usar avatar e não quebrar o mapa.

18. PERFIL
Ao clicar:
FOTO + NOME + AVATAR + STATUS + DISTÂNCIA APROXIMADA + INTERESSES + AÇÕES SOCIAIS.
Reutilizar a lógica de perfil existente.

19. LOCAIS E EVENTOS
Em locais como “Bar do Léo”, mostrar pequenos avatares/fotos das pessoas presentes quando permitido.
Isso deve criar a sensação de “Quem está aqui agora?”.
Eventos também podem mostrar participantes.

20. ESTADOS
Preparar para:
- online;
- perto;
- em alta;
- evento;
- match;
- novo usuário;
- selecionado;
- anônimo;
- invisível.

21. ARQUITETURA
Criar componentes reutilizáveis, adaptados à arquitetura atual, por exemplo:
UserMapMarker
Avatar3D
UserPhotoBubble
UserNameLabel
UserStatusIndicator
AvatarComposition
MapUserManager
UserCluster
MatchAnimation
MapInteractionController

Não é obrigatório usar esses nomes. Separe responsabilidades e evite código duplicado.

22. RESPONSIVIDADE
Funcionar bem em iPhone, Android, telas pequenas/grandes e diferentes densidades.
A foto nunca deve ficar desproporcional ao avatar.

23. TESTES
Testar:
- sem foto;
- com foto;
- foto carregando;
- foto quebrada;
- nome grande/curto;
- dezenas/centenas de pessoas;
- clustering;
- zoom;
- rotação;
- movimentação;
- match;
- modo anônimo;
- invisível;
- entrada/saída;
- conexão lenta;
- conexão rápida;
- dispositivos móveis.

24. NÃO QUEBRAR O EXISTENTE
Preservar Mapbox, mapa 3D, localização, pessoas, avatares, match, perfil, navegação, Premium, anônimo, invisível, locais, eventos, clustering e autenticação.
Evitar refatorações gigantes sem necessidade.

25. RESULTADO
Ao olhar o mapa, quero entender:
“Essas são pessoas reais dentro de uma cidade digital.”

Cada pessoa:
FOTO REAL + NOME + AVATAR 3D + STATUS.

O resultado deve combinar mapa 3D + rede social + jogo social + descoberta local, mas com identidade própria do Cruze.

26. PRINCÍPIO DE UX
LONGE: “Tem alguém ali.”
PERTO: “Quem é essa pessoa?”
SELECIONADO: “Quero conhecer essa pessoa.”
MATCH: “🔥 CRUZE!”
LOCAL: “Quem está aqui?”
EVENTO: “O que está acontecendo perto de mim?”

27. OBJETIVO PREMIUM
Não quero sensação de protótipo.
Quero acabamento, fluidez, consistência, performance, privacidade, personalidade, identidade visual, microinterações e arquitetura escalável.

Primeiro analise a implementação atual.
Depois implemente em etapas.
Depois teste.
Se alguma limitação impedir uma implementação de qualidade, explique o problema e escolha a solução mais segura sem destruir funcionalidades existentes.

RESULTADO FINAL:
O Cruze não deve mostrar apenas “bonequinhos no mapa”.
Cada personagem deve representar uma pessoa real.
O mapa deve parecer uma cidade social viva.
