-- Boost não guarda mais posição (BoostsService): a descoberta usa a presença de sempre, anonimizada.
-- Apaga a coordenada PRECISA que as compras antigas gravavam pra sempre em boosts.latitude/longitude.
-- Só dados (as colunas continuam, nulas); idempotente: rodar de novo não muda nada.
UPDATE boosts SET latitude = NULL, longitude = NULL WHERE latitude IS NOT NULL OR longitude IS NOT NULL;
