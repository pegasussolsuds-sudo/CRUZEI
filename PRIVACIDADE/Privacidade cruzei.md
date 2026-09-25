PROMPT TÉCNICO — CRUZE
PRIVACIDADE DE LOCALIZAÇÃO, ANTI-TRIANGULAÇÃO E DESCOBERTA SEGURA

OBJETIVO
Quero que você, Claude Fable 5.1, faça uma revisão técnica completa do sistema de localização, presença e descoberta por proximidade do Cruze.

NÃO recrie o aplicativo do zero. NÃO remova funcionalidades existentes. NÃO altere o design atual sem necessidade.

Antes de alterar qualquer código, analise a arquitetura atual, identificando frontend, backend, banco, realtime/WebSocket, Mapbox, descoberta, presença, lugares, eventos, modo anônimo/invisível, bloqueios e notificações.

Objetivo principal: impedir que o Cruze possa ser usado para rastrear, perseguir ou reconstruir a rotina de outro usuário.

PRINCÍPIO CENTRAL:
“O Cruze não mostra onde uma pessoa está. O Cruze mostra quem está disponível para encontrar/interagir perto de você.”

==================================================
1. REGRA ABSOLUTA — NUNCA EXPOR GPS DE OUTRO USUÁRIO
==================================================

O frontend NUNCA deve receber latitude/longitude real de outro usuário.

O backend pode receber a localização precisa do próprio usuário e utilizá-la internamente para calcular proximidade, mas a coordenada precisa de terceiros deve permanecer no backend.

É proibido enviar ao cliente:
- latitude
- longitude
- preciseLatitude / preciseLongitude
- exactDistance
- locationHistory
- previousCoordinates
- heading
- speed
- movementHistory
- routeHistory

Esses dados não podem estar presentes em respostas da API, payloads realtime, WebSockets, caches ou qualquer outro canal acessível ao cliente.

==================================================
2. RAIO MÁXIMO DE DESCOBERTA — 350 METROS
==================================================

Implementar aproximadamente 350 metros como raio máximo padrão da descoberta por proximidade.

O cálculo exato deve ocorrer no backend.

O resultado numérico da distância NÃO deve ser enviado ao frontend.

NUNCA baixar todos os usuários próximos para o frontend e filtrar no cliente. O filtro precisa acontecer no backend/banco.

==================================================
3. FAIXAS DE PROXIMIDADE
==================================================

Nunca mostrar distância exata, como “João — 127 metros”.

Criar categorias:
🟢 Muito perto
🟢 Perto
🟡 Na região
⚪ Até 350 m

Sugestão:
0–100 m → Muito perto
100–250 m → Perto
250–350 m → Na região

Essas categorias podem ser retornadas ao frontend. A distância numérica exata nunca deve ser retornada.

==================================================
4. POSIÇÃO VISUAL ANONIMIZADA
==================================================

Quando a experiência exigir a representação de uma pessoa no mapa, NUNCA utilizar a coordenada real dela.

Criar uma posição visual aproximada/anonimizada gerada pelo servidor.

Jitter NÃO pode ser a única proteção. Se uma posição aproximada ainda representar risco de identificação ou rastreamento, NÃO mostrar marcador individual. Usar “Pessoa próxima” ou uma região social genérica.

==================================================
5. ANTI-TRIANGULAÇÃO — REQUISITO CRÍTICO
==================================================

Impedir que consultas repetidas permitam reconstruir uma trajetória.

Implementar:
- intervalo mínimo entre atualizações;
- atualização de presença controlada;
- rate limiting;
- cooldown;
- pequenas variações espaciais quando houver marcador;
- nenhuma trilha de movimentação;
- nenhuma posição anterior;
- nenhuma direção;
- nenhuma seta de deslocamento;
- nenhuma velocidade;
- nenhuma rota;
- nenhuma informação “saiu daqui e foi para ali”.

Não permitir que alguém consulte repetidamente uma pessoa e obtenha uma sequência espacial útil para reconstruir sua rotina.

==================================================
6. RATE LIMITING E ANTI-SCRAPING
==================================================

Proteger endpoints de proximidade e presença contra:
- polling excessivo;
- consultas repetidas contra o mesmo usuário;
- enumeração de usuários;
- consultas sistemáticas em regiões;
- comportamento de scraping;
- tentativa de reconstrução de localização.

Quando houver comportamento suspeito:
- reduzir frequência;
- aplicar cooldown/rate limit;
- aumentar anonimização;
- bloquear temporariamente a descoberta;
- ou impedir a consulta.

A API não pode funcionar como serviço de rastreamento.

==================================================
7. MÍNIMO DE ANONIMATO
==================================================

Criar proteção para regiões com poucas pessoas.

Se existe apenas uma pessoa em determinada área e mostrar essa pessoa revelar indiretamente onde ela está, não mostrar o marcador individual.

Pode retornar “Pessoa próxima” ou não mostrar a pessoa.

Criar regra configurável no backend.

==================================================
8. PROTEÇÃO ESPECIAL PARA RESIDÊNCIA
==================================================

Criar proteção específica para áreas residenciais.

Se o sistema detectar uma área recorrente de residência, não mostrar a pessoa exatamente naquele ponto.

Usar, por exemplo:
🏠 Área privada
ou
“Usuário próximo”
ou ocultar.

Criar também opção para o próprio usuário definir manualmente uma área privada/residencial.

A proteção deve ocorrer no backend.

==================================================
9. LOCAIS SENSÍVEIS
==================================================

Permitir proteção para locais definidos pelo usuário ou identificados internamente como sensíveis:
- casa;
- trabalho;
- escola;
- endereço pessoal;
- localização personalizada.

Nessas regiões, reduzir ou eliminar exposição individual.

==================================================
10. PRESENÇA EM LOCAIS — PRIORIDADE
==================================================

O Cruze é uma rede social baseada em lugares.

Quando possível, priorizar presença em um local em vez de coordenada.

Exemplo:

BAR DO LÉO
🔥 5 pessoas aqui
👤 Ana
👤 Pedro
👤 João

A experiência deve comunicar “essas pessoas estão neste local”, e não “essas pessoas estão exatamente nesta coordenada”.

Aplicar para bares, restaurantes, cafés, academias, shoppings, cinemas, eventos, casas noturnas e outros POIs.

Integrar com o sistema de “lugares em alta” já existente.

==================================================
11. PROTEÇÃO DE LOCAIS COM POUCAS PESSOAS
==================================================

Criar regra configurável para evitar revelar a presença de uma pessoa quando houver pouquíssimas pessoas no local.

Não implementar número rígido sem analisar o sistema existente.

==================================================
12. DESCOBERTA POR PROXIMIDADE
==================================================

Criar/adaptar:
“Descoberta por proximidade”

Opções:
🟢 Todos
🟡 Pessoas com interesses compatíveis
🔴 Ninguém

Se estiver em “Ninguém”, o usuário não aparece na descoberta por proximidade.

Preservar integralmente o modo ANÔNIMO/INVISÍVEL existente.

==================================================
13. RECIPROCIDADE / OPT-IN
==================================================

Sempre que possível, aplicar descoberta recíproca.

Um usuário só aparece para outro se as regras de descoberta de AMBOS permitirem.

Se A permite descoberta e B desativou:
B não aparece para A.
A não aparece para B.

Aplicar no backend.

==================================================
14. FOTO + AVATAR + NOME
==================================================

Preservar:
- foto real;
- avatar 3D;
- nome;
- status.

Mas esses dados só aparecem quando o usuário estiver elegível para descoberta.

Identidade pública NÃO significa localização pública.

==================================================
15. MAPBOX
==================================================

Preservar Mapbox.

O frontend/Mapbox NÃO deve receber coordenadas reais de outros usuários.

Mapbox pode receber apenas:
- posição visual anonimizada;
- região aproximada;
- POIs;
- lugares;
- eventos;
- dados necessários à experiência.

Auditar qualquer uso de:
user.latitude
user.longitude
user.lat
user.lng
coordinates

e verificar se dados de terceiros estão chegando ao cliente.

==================================================
16. BACKEND E DTO SEGURO
==================================================

Revisar endpoints de:
- nearby users;
- discovery;
- location;
- presence;
- realtime;
- WebSocket;
- Mapbox markers;
- matchmaking;
- places;
- events.

Criar resposta segura de descoberta, por exemplo:

{
  "id": "opaque_user_id",
  "displayName": "João",
  "photo": "...",
  "avatar": "...",
  "proximityBand": "near",
  "presenceType": "nearby",
  "placeId": null,
  "privacyLevel": "protected"
}

NÃO incluir:
latitude
longitude
exactDistance
previousLocations
heading
speed
routeHistory

==================================================
17. IDENTIFICADORES E ENUMERAÇÃO
==================================================

Revisar IDs públicos.

Evitar IDs previsíveis como user/1001, user/1002, user/1003.

Verificar endpoints para impedir enumeração de usuários.

==================================================
18. BLOQUEIO, DENÚNCIA E OCULTAÇÃO
==================================================

Preservar/implementar:
- bloquear usuário;
- denunciar usuário;
- ocultar usuário.

Se A bloqueia B:
B não pode descobrir A por proximidade.
A não pode descobrir B por proximidade.

Aplicar no backend.

==================================================
19. NOTIFICAÇÕES
==================================================

Não criar:
“João está a 80 metros de você.”
“Maria está perto da sua casa.”
“Pedro acabou de chegar perto de você.”

Preferir:
“Há pessoas próximas no Cruze.”
“Há pessoas disponíveis para conhecer perto de você.”

Notificações não podem virar ferramenta de rastreamento.

==================================================
20. BACKGROUND LOCATION
==================================================

Revisar se localização em segundo plano é realmente necessária.

Se não for essencial, preferir localização em primeiro plano.

Coletar somente o necessário.

==================================================
21. SEGURANÇA DO BANCO E PERMISSÕES
==================================================

Revisar:
- regras de acesso;
- queries;
- policies;
- RLS;
- permissões;
- endpoints;
- realtime subscriptions;
- WebSockets;
- caches.

Usuário comum NÃO pode consultar diretamente:
- coordenadas de terceiros;
- histórico;
- áreas privadas;
- localização precisa.

Mesmo manipulando manualmente a requisição.

A proteção precisa existir no servidor/banco.

==================================================
22. RETENÇÃO DE LOCALIZAÇÃO
==================================================

Minimizar armazenamento de localização precisa.

Não manter histórico social de localização se não for necessário.

Se algum dado preciso precisar existir internamente:
- usar retenção mínima;
- TTL;
- acesso restrito;
- proteção adequada;
- nunca disponibilizar ao cliente.

==================================================
23. TESTES DE SEGURANÇA
==================================================

Criar e executar:

TESTE 1 — API
Interceptar resposta de nearby/discovery.
Resultado: nenhuma latitude/longitude de outro usuário.

TESTE 2 — USUÁRIO ARBITRÁRIO
Tentar consultar localização de usuário específico.
Resultado: acesso negado ou resultado seguro/anonimizado.

TESTE 3 — RATE LIMIT
Executar dezenas/centenas de consultas.
Resultado: rate limit/cooldown/bloqueio/redução de exposição.

TESTE 4 — TRIANGULAÇÃO
Consultar repetidamente o mesmo usuário.
Resultado: não deve ser possível construir trajetória precisa.

TESTE 5 — BLOQUEIO
A bloqueia B.
Resultado: nenhuma descoberta entre os dois.

TESTE 6 — ÁREA RESIDENCIAL
Usuário está em área residencial.
Resultado: não revelar coordenada residencial.

TESTE 7 — REGIÃO ESPARSA
Somente uma pessoa na região.
Resultado: aplicar anonimização.

TESTE 8 — MANIPULAÇÃO DO FRONTEND
Alterar parâmetros enviados pelo cliente.
Resultado: backend não confia nos valores manipulados.

TESTE 9 — WEBSOCKET/REALTIME
Inspecionar payloads.
Resultado: nenhuma coordenada precisa de terceiros.

TESTE 10 — CACHE/LOCAL STORAGE
Inspecionar dados locais.
Resultado: nenhuma localização precisa de terceiros armazenada sem necessidade.

==================================================
24. AUDITORIA GLOBAL
==================================================

Fazer busca global por:
latitude
longitude
lat
lng
coordinates
location
locationHistory
nearby
distance
geolocation
watchPosition
getCurrentPosition
realtime
websocket
presence

Analisar cada ocorrência relacionada à localização.

Não considerar o sistema seguro apenas porque o mapa visualmente não mostra a coordenada.

==================================================
25. PRESERVAR O SISTEMA ATUAL
==================================================

Preservar:
- Mapbox 3D;
- mapa social;
- avatares;
- foto de perfil;
- nome;
- status;
- lugares;
- locais em alta;
- eventos;
- matches;
- conexões;
- mensagens;
- Premium;
- modo anônimo;
- modo invisível;
- clustering;
- animações.

A mudança deve ser principalmente arquitetural e de segurança.

==================================================
26. ORDEM DE PRIORIDADE
==================================================

1. Segurança de localização
2. Privacidade
3. Anti-stalking
4. Integridade do backend
5. Experiência do usuário
6. Performance
7. Efeitos visuais

Nunca sacrificar segurança para manter um marcador visual.

==================================================
27. PROCESSO DE IMPLEMENTAÇÃO
==================================================

FASE 1 — Auditar arquitetura atual.
FASE 2 — Mapear coleta de localização.
FASE 3 — Mapear armazenamento.
FASE 4 — Mapear envio ao frontend.
FASE 5 — Mapear Mapbox, realtime e WebSockets.
FASE 6 — Identificar vulnerabilidades.
FASE 7 — Implementar proteção no backend.
FASE 8 — Implementar proximidade de 350 m.
FASE 9 — Implementar anonimização.
FASE 10 — Implementar anti-triangulação.
FASE 11 — Implementar proteção residencial/sensível.
FASE 12 — Implementar rate limiting/anti-scraping.
FASE 13 — Integrar presença em lugares.
FASE 14 — Preservar anonimato/invisibilidade.
FASE 15 — Executar testes.
FASE 16 — Fazer segunda auditoria procurando vazamentos.

==================================================
28. ENTREGA OBRIGATÓRIA
==================================================

Ao terminar, entregar:
1. Lista de arquivos modificados.
2. Arquivos novos criados.
3. Arquitetura antiga vs. nova.
4. Como funciona o raio de 350 m.
5. Como funciona a anonimização.
6. Como funciona a anti-triangulação.
7. Como funciona a proteção residencial.
8. Como funciona o rate limiting.
9. Quais dados deixaram de ser enviados ao frontend.
10. Como Mapbox foi protegido.
11. Como realtime/WebSocket foi protegido.
12. Como o modo anônimo/invisível foi preservado.
13. Resultado dos testes de segurança.
14. Vulnerabilidades restantes.
15. Qualquer decisão manual necessária.

NÃO diga que está seguro sem executar os testes.

Se encontrar uma vulnerabilidade que não consiga corrigir, informe claramente qual é e por quê.

==================================================
RESULTADO ESPERADO
==================================================

O Cruze deve continuar sendo um mapa social vivo, mas a arquitetura deve impedir que ele seja utilizado como rastreador de pessoas.

O conceito final é:

“Quem está disponível para interagir perto de você?”

e não:

“Exatamente onde essa pessoa está?”

IMPLEMENTE ISSO NO PROJETO EXISTENTE, COM O MÍNIMO DE ALTERAÇÃO VISUAL POSSÍVEL E MÁXIMA PROTEÇÃO NO BACKEND.
