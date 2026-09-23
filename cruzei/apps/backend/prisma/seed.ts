// Seed inicial — interests + POIs da cidade do beta (Uberlândia/MG)
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const INTERESTS = [
  { name: 'Música', icon: 'music', category: 'lifestyle' },
  { name: 'Viagem', icon: 'travel', category: 'lifestyle' },
  { name: 'Esporte', icon: 'sports', category: 'lifestyle' },
  { name: 'Culinária', icon: 'food', category: 'lifestyle' },
  { name: 'Filmes', icon: 'movies', category: 'entertainment' },
  { name: 'Séries', icon: 'tv', category: 'entertainment' },
  { name: 'Leitura', icon: 'books', category: 'lifestyle' },
  { name: 'Games', icon: 'gaming', category: 'entertainment' },
  { name: 'Praia', icon: 'beach', category: 'lifestyle' },
  { name: 'Academia', icon: 'fitness', category: 'lifestyle' },
  { name: 'Yoga', icon: 'yoga', category: 'lifestyle' },
  { name: 'Pets', icon: 'pets', category: 'lifestyle' },
  { name: 'Fotografia', icon: 'photography', category: 'creative' },
  { name: 'Arte', icon: 'art', category: 'creative' },
  { name: 'Tecnologia', icon: 'tech', category: 'lifestyle' },
  { name: 'Empreendedorismo', icon: 'business', category: 'lifestyle' },
  { name: 'Cerveja', icon: 'beer', category: 'food' },
  { name: 'Vinho', icon: 'wine', category: 'food' },
  { name: 'Café', icon: 'coffee', category: 'food' },
  { name: 'Dança', icon: 'dance', category: 'entertainment' },
];

// POIs públicos conhecidos de Uberlândia/MG (coordenadas aproximadas, fonte OSM)
const POIS = [
  { externalId: 'udi-parque-sabia', name: 'Parque do Sabiá', category: 'park', lat: -18.9096, lng: -48.2338, neighborhood: 'Tibery' },
  { externalId: 'udi-praca-tubal', name: 'Praça Tubal Vilela', category: 'park', lat: -18.9186, lng: -48.2772, neighborhood: 'Centro' },
  { externalId: 'udi-center-shopping', name: 'Center Shopping', category: 'shopping', lat: -18.9147, lng: -48.2597, neighborhood: 'Tibery' },
  { externalId: 'udi-uberlandia-shopping', name: 'Uberlândia Shopping', category: 'shopping', lat: -18.9497, lng: -48.2887, neighborhood: 'Gávea' },
  { externalId: 'udi-mercado-municipal', name: 'Mercado Municipal', category: 'restaurant', lat: -18.9161, lng: -48.2823, neighborhood: 'Centro' },
  { externalId: 'udi-parque-gavea', name: 'Parque Gávea', category: 'park', lat: -18.9436, lng: -48.2944, neighborhood: 'Gávea' },
  { externalId: 'udi-museu-municipal', name: 'Museu Municipal', category: 'museum', lat: -18.9186, lng: -48.2779, neighborhood: 'Centro' },
  { externalId: 'udi-praca-clarimundo', name: 'Praça Clarimundo Carneiro', category: 'park', lat: -18.9180, lng: -48.2795, neighborhood: 'Centro' },
  { externalId: 'udi-arena-sabiazinho', name: 'Arena Sabiazinho', category: 'show', lat: -18.9070, lng: -48.2400, neighborhood: 'Tibery' },
  { externalId: 'udi-parque-siquierolli', name: 'Parque Siquierolli', category: 'park', lat: -18.8830, lng: -48.2740, neighborhood: 'Umuarama' },
  { externalId: 'udi-shopping-park', name: 'Shopping Park', category: 'shopping', lat: -18.9540, lng: -48.2330, neighborhood: 'Shopping Park' },
  { externalId: 'udi-teatro-municipal', name: 'Teatro Municipal', category: 'event', lat: -18.9127, lng: -48.2768, neighborhood: 'Centro' },
];

async function main() {
  for (const i of INTERESTS) {
    await prisma.interest.upsert({
      where: { name: i.name },
      update: { icon: i.icon, category: i.category },
      create: i,
    });
  }
  console.log(`✅ Seed: ${INTERESTS.length} interests`);

  for (const p of POIS) {
    await prisma.pOI.upsert({
      where: { source_externalId: { source: 'osm', externalId: p.externalId } },
      update: { name: p.name, latitude: p.lat, longitude: p.lng },
      create: {
        externalId: p.externalId,
        name: p.name,
        category: p.category as never,
        latitude: p.lat,
        longitude: p.lng,
        city: 'Uberlândia',
        state: 'MG',
        neighborhood: p.neighborhood,
        source: 'osm',
      },
    });
  }
  console.log(`✅ Seed: ${POIS.length} POIs (Uberlândia/MG)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
