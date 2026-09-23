# Cruzei — Documentação Completa do Projeto

> Conexões reais de lugares reais.
> App de relacionamento baseado em geolocalização com mapa estilo Pokémon GO, modo anônimo livre e selos de local.

---

## 📖 Sobre o Projeto

**Cruzei** é um aplicativo de conexão humana que transforma lugares em pontos de encontro. Diferente de Tinder/Bumble, o match acontece quando duas pessoas **compartilharam o mesmo espaço físico** num intervalo recente — com contexto real de vivência.

### Conceito central
Você abre o mapa. Vê avatares no bar em que esteve ontem. Curte quem te interessou. Se a outra pessoa também curtir, vocês descobrem **onde e quando se cruzaram**. O chat abre com contexto, não com "oi".

### Diferenciais competitivos
- 🗺️ **Mapa estilo Pokémon GO** com avatares em tempo real e hotspots pulsantes
- 🕶️ **Modo anônimo livre** — vê todo mundo, mas só dá match quando se revelar
- 🏅 **Selos de local** (Praieiro, Roadie, Cafeteria, Boêmio…) — gamificação por hábitos
- 💬 **Chat com expiração de 48h** renovável por contexto compartilhado
- 📸 **Mídia temporária** (foto some em 10s) estilo Snapchat
- 🛡️ **LGPD desde o MVP** — retenção de 30 dias, opt-in explícito

### Público-alvo
Jovens urbanos 18-35, ativos em redes sociais, frustrados com matches sem substância.
**Beta:** Uberlândia/MG → capitais do Sudeste → Brasil.

---

## 📚 Índice da Documentação

| # | Arquivo | Conteúdo |
|---|---------|----------|
| 00 | **README.md** | Este arquivo — visão geral e índice |
| 01 | [01-escopo-produto.md](./01-escopo-produto.md) | PRD completo: visão, problemas, personas, requisitos |
| 02 | [02-pesquisa-mercado.md](./02-pesquisa-mercado.md) | Análise de concorrência (Tinder, Bumble, Happn, Badoo) e diferenciais |
| 03 | [03-roadmap-lancamento.md](./03-roadmap-lancamento.md) | 4 fases: MVP → Beta → Lançamento → Escala nacional |
| 04 | [04-funcionalidades-free-premium.md](./04-funcionalidades-free-premium.md) | Tiers Free/Premium/Premium+ e todas as compras in-app |
| 05 | [05-wireframes.md](./05-wireframes.md) | Wireframes das 12 telas principais + fluxos |
| 06 | [06-identidade-visual.md](./06-identidade-visual.md) | Branding, paleta, tipografia, tom de voz |
| 07 | [07-arquitetura-tecnica.md](./07-arquitetura-tecnica.md) | Stack, módulos, decisões de arquitetura |
| 08 | [08-schema-banco-dados.md](./08-schema-banco-dados.md) | PostgreSQL completo + Redis (presença real-time) |
| 09 | [09-api-endpoints.md](./09-api-endpoints.md) | REST + WebSocket documentados |
| 10 | [10-geolocalizacao-presenca.md](./10-geolocalizacao-presenca.md) | Estratégia de geofencing, bateria, privacidade |
| 11 | [11-lgpd-privacidade.md](./11-lgpd-privacidade.md) | Compliance LGPD, segurança, anti-stalking |
| 12 | [12-metricas-kpis.md](./12-metricas-kpis.md) | KPIs por fase, dashboards, growth loops |
| 13 | [13-estrutura-pastas.md](./13-estrutura-pastas.md) | Estrutura do monorepo (frontend + backend) |
| 14 | [14-guia-implementacao.md](./14-guia-implementacao.md) | Passo-a-passo de como executar (do zero ao deploy) |
| 15 | [15-pitch-investidor.md](./15-pitch-investidor.md) | Deck de investidor (estrutura + slides) |
| 16 | [16-press-kit.md](./16-press-kit.md) | Material de PR e marketing de lançamento |
| 17 | [17-riscos-mitigacoes.md](./17-riscos-mitigacoes.md) | Riscos técnicos, de mercado e plano B |
| — | [PLANO.md](./PLANO.md) | Roadmap sequencial em checkpoints práticos |
| — | [ADRs.md](./ADRs.md) | Architecture Decision Records (decisões técnicas) |

---

## 🎯 Stack (TL;DR)

| Camada | Tecnologia | Justificativa |
|--------|-----------|---------------|
| **Mobile** | React Native + TypeScript | 1 codebase iOS + Android, ecossistema maduro |
| **Mapa** | Mapbox GL (estilo custom) | Visual único estilo Pokémon GO, customização total |
| **Backend** | Node.js + NestJS + TypeScript | Estrutura sólida, escalável, tipado |
| **Banco relacional** | PostgreSQL 15 + PostGIS | Geolocalização nativa, JSONB pra metadados |
| **Cache/presença** | Redis 7 | Geohash, presence, pub/sub pro chat |
| **Storage** | Cloudflare R2 | Fotos a custo baixo |
| **Push** | Firebase Cloud Messaging | iOS + Android unificado |
| **Pagamento** | Stripe (web) + Apple/Google IAP | Receita global + compliance lojas |
| **Analytics** | Mixpanel + Amplitude | Funis, cohort, retention |
| **Deploy** | AWS São Paulo | Latência baixa, LGPD-friendly |

---

## 🗓️ Marcos Resumidos

| Marco | Entrega | Status |
|-------|---------|--------|
| **M1 — Definição** | PRD + Identidade visual + Wireframes | ✅ Documentado |
| **M2 — Banco + API** | Schema PostgreSQL + Endpoints REST + WebSocket | ✅ Documentado |
| **M3 — Setup dev** | Monorepo + Docker + CI básico | ⏭️ Próximo |
| **M4 — Auth + Perfil** | Cadastro, login, edição de perfil | ⏭️ Próximo |
| **M5 — Mapa MVP** | Mapa Mapbox + avatares + modo anônimo | ⏭️ |
| **M6 — Match + Chat** | Curtir, match, chat com expiração | ⏭️ |
| **M7 — Beta fechado** | 100 usuários Uberlândia/MG | ⏭️ |
| **M8 — Lançamento público** | App Store + Play Store + marketing | ⏭️ |

---

## 🚀 Como usar esta documentação

1. **Leia o `PLANO.md`** primeiro — tem o roadmap sequencial em checkpoints práticos
2. **Consulte `ADRs.md`** para entender decisões de arquitetura já tomadas
3. **Siga `14-guia-implementacao.md`** para executar do zero
4. **Use `01-escopo-produto.md`** como referência de produto
5. **`15-pitch-investidor.md`** se for apresentar o projeto

---

## 📂 Localização dos arquivos

Todos os documentos estão em:
```
C:\Users\User\Documents\Cruzei APP\
```

---

## 📝 Convenções da documentação

- ✅ = pronto / aprovado
- ⏭️ = próximo passo
- 🚧 = em construção
- ❌ = bloqueado / cancelado
- ⚠️ = atenção / risco
- 💡 = ideia / sugestão

Cada documento `.md` pode ser aberto em qualquer editor (VS Code, Obsidian, Notion).

---

**Versão:** 1.0
**Data:** Outubro 2025
**Stack confirmada:** React Native + Mapbox + NestJS + PostgreSQL + Redis
**Beta:** Uberlândia/MG
**Modo de trabalho:** Sequencial guiado (marco a marco)