PROMPT — EVOLUÇÃO DOS AVATARES 3D DO CRUZE

IMPORTANTE: transforme os bonequinhos do mapa do Cruze em personagens 3D VIVOS, com animações e movimentação natural, criando uma sensação semelhante à experiência de jogos sociais como Pokémon GO/Habbo, mas sem copiar personagens, assets ou identidade visual desses produtos.

CONTEXTO
O Cruze já possui:
- mapa 3D com Mapbox;
- pessoas aparecendo no mapa;
- avatar 3D;
- localização/aproximação;
- sistema de match;
- modo anônimo/invisível;
- locais e pontos de interesse;
- interface própria.

NÃO REFAÇA O PROJETO DO ZERO.

Antes de alterar:
1. Analise a arquitetura atual.
2. Identifique como o Mapbox está sendo utilizado.
3. Identifique como os avatares são renderizados.
4. Identifique como a posição das pessoas é atualizada.
5. Preserve tudo que já funciona.
6. Faça a implementação modular e reutilizável.

OBJETIVO
Os avatares não devem parecer modelos estáticos no mapa. Eles precisam parecer personagens vivos dentro da cidade.

A sensação desejada é:
“Estou andando por uma cidade onde existem outras pessoas vivendo, andando, chegando, interagindo e fazendo matches.”

ANIMAÇÕES

Criar um sistema de estados:

1. IDLE
- respiração sutil;
- pequeno movimento corporal;
- leve movimento de cabeça;
- pequenas variações para evitar que todos pareçam clones.

2. WALK
- caminhada natural;
- braços e pernas sincronizados;
- movimento corporal;
- rotação gradual na direção do deslocamento;
- transição suave entre IDLE e WALK.

3. RUN
Preparar suporte para corrida, mesmo que inicialmente seja usado apenas em situações específicas.

4. WAVE
Animação de aceno para interações sociais.

5. LIKE
Pequena reação quando receber uma curtida/interação.

6. MATCH
Animação especial quando dois usuários derem match.

7. CELEBRATE
Animação curta de comemoração.

8. ARRIVE
Ao chegar a um local:
- pequena animação de chegada;
- depois retornar para IDLE.

TECNOLOGIA
Se o sistema atual do Mapbox não suportar adequadamente animações completas dos modelos 3D, utilizar Three.js integrada ao Mapbox através de uma custom layer.

Priorizar modelos GLB/glTF com animações.

A arquitetura deve permitir:
- carregar um modelo;
- carregar várias animações;
- trocar animações;
- fazer blend/transições;
- controlar velocidade;
- controlar rotação;
- controlar posição;
- reutilizar o mesmo asset entre vários usuários.

MOVIMENTAÇÃO
Os avatares não devem simplesmente “teleportar”.

Quando a posição mudar:
- interpolar a posição;
- criar deslocamento suave;
- calcular direção;
- girar gradualmente;
- iniciar WALK;
- chegar ao destino;
- parar;
- voltar para IDLE.

PRIVACIDADE
Não mostrar localização GPS exata de ninguém.
Continuar respeitando o sistema atual de privacidade.
As posições devem continuar aproximadas/generalizadas.
O modo ANÔNIMO/INVISÍVEL existente deve continuar funcionando.

MATCH NO MAPA
Quando duas pessoas próximas derem match:
1. Os dois avatares se aproximam visualmente.
2. Fazem uma pequena animação de interação.
3. Criar efeito visual especial.
4. Mostrar a identidade visual do Cruze.
5. Exibir “🔥 CRUZE!”
6. Fazer uma animação curta e elegante.
7. Retornar ao estado normal.

Deve parecer premium, não infantil.

AVATAR COMO IDENTIDADE DIGITAL
Preparar a arquitetura para futuramente ter:
- roupas;
- cabelo;
- acessórios;
- óculos;
- bonés;
- estilos;
- skins;
- itens premium;
- itens desbloqueáveis;
- itens especiais.

Não precisa implementar tudo agora, mas a estrutura deve permitir isso.

VARIAÇÃO ENTRE USUÁRIOS
Preparar suporte para:
- diferentes avatares base;
- diferentes cores;
- diferentes roupas;
- diferentes acessórios;
- pequenas variações de escala;
- pequenas variações de animação.

PERFORMANCE
O Cruze poderá ter dezenas ou centenas de pessoas no mapa.

Implementar:
- reutilização de modelos;
- cache de assets;
- instancing quando apropriado;
- Level of Detail (LOD);
- redução de qualidade para personagens distantes;
- pausa de animações fora da área visível;
- clustering;
- carregamento progressivo;
- limite de personagens animados simultaneamente;
- evitar recriação desnecessária de objetos 3D.

Personagens próximos podem ter animações completas.
Personagens distantes podem usar versão simplificada.

MAPA COMO MUNDO VIVO
O mapa deve parecer uma cidade viva.

Pessoa andando → personagem anda.
Pessoa parada → IDLE.
Pessoa chegando a um local → ARRIVE.
Duas pessoas dando match → interação especial.
Muitas pessoas no mesmo lugar → clustering.
Local movimentado → efeito visual discreto.

ESTÉTICA
Manter a identidade do Cruze:
- dark;
- premium;
- moderno;
- urbano;
- futurista;
- social;
- elegante.

A inspiração é a sensação de exploração e vida de um jogo social, não copiar Pokémon GO, Habbo ou qualquer outro produto.

MICROINTERAÇÕES
Adicionar quando fizer sentido:
- avatar olhando para outro avatar próximo;
- pequeno aceno;
- reação ao match;
- efeitos de entrada;
- transições suaves;
- feedback visual ao tocar em um avatar;
- animações de abertura do perfil.

TOQUE NO AVATAR
Ao tocar:
- destacar o personagem;
- pequena animação;
- abrir o bottom sheet/perfil existente;
- mostrar informações disponíveis;
- permitir as ações sociais existentes.

ARQUITETURA
Criar componentes reutilizáveis, por exemplo:
Avatar3D
AvatarController
AvatarAnimationController
AvatarMovementController
AvatarState
AvatarCustomization
AvatarManager
Map3DLayer

Os nomes podem ser adaptados à arquitetura atual.

O objetivo é evitar código duplicado e permitir adicionar novas animações sem reescrever o mapa.

TRANSIÇÕES
As transições devem ser suaves:
IDLE → WALK
WALK → IDLE
IDLE → WAVE
WALK → MATCH
MATCH → IDLE

Evitar cortes bruscos.

EVOLUÇÃO DO UNIVERSO
Preparar a arquitetura para futuramente os avatares:
- entrarem em locais;
- aparecerem em bares, restaurantes, academias e eventos;
- encontrarem outras pessoas;
- receberem efeitos relacionados a locais;
- participarem de eventos dentro do mapa.

IMPORTANTE SOBRE O CÓDIGO ATUAL
NÃO substitua funcionalidades que já funcionam apenas para implementar essa ideia.

Faça alterações incrementais.

Preserve:
- APIs;
- estado;
- navegação;
- autenticação;
- localização;
- match;
- modo anônimo/invisível;
- funcionalidades Premium;
- mapa existente.

Se precisar criar nova camada de renderização 3D, integre cuidadosamente ao Mapbox.

RESULTADO ESPERADO
Quando eu abrir o Cruze, quero perceber imediatamente:

“O Cruze não é apenas um mapa.”

É uma cidade social viva.

As pessoas são representadas por personagens.
Os personagens respiram.
Andam.
Interagem.
Param.
Se encontram.
Dão match.
E tudo acontece dentro do mapa.

PRIORIDADE

FASE 1 — IDLE, WALK e transições.

FASE 2 — movimentação com interpolação, direção, rotação e chegada.

FASE 3 — WAVE, LIKE e CELEBRATE.

FASE 4 — MATCH com aproximação, interação, efeito e “🔥 CRUZE!”.

FASE 5 — performance: LOD, clustering, cache, instancing e controle de animações.

FASE 6 — preparação para customização: roupas, acessórios, skins e identidade digital.

FASE 7 — preparar a arquitetura para o Cruze evoluir como universo social.

CRITÉRIO FINAL
Não quero apenas “um bonequinho animado”.

Quero que o avatar transmita VIDA.

Ao olhar para o mapa, deve parecer que existem pessoas reais vivendo naquele espaço digital.

Faça isso mantendo:
- performance;
- privacidade;
- estabilidade;
- arquitetura limpa;
- visual premium;
- identidade própria do Cruze.

Antes de finalizar, teste:
- muitos avatares simultâneos;
- entrada e saída de usuários;
- movimentação;
- zoom;
- rotação do mapa;
- match;
- modo anônimo;
- troca de telas;
- retorno ao mapa;
- dispositivos móveis;
- diferentes tamanhos de tela.

Se houver limitação técnica da implementação atual, explique qual é e escolha a solução mais adequada sem destruir o que já está funcionando.
