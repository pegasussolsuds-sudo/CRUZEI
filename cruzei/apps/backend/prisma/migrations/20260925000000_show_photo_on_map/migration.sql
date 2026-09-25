-- Preferência "Mostrar minha foto no mapa" (brief FOTO AVATAR §7).
-- ON (default): a foto principal (thumbnail) aparece na bolha de identidade em cima do avatar no mapa.
-- OFF: no mapa só o avatar; o perfil continua mostrando as fotos normalmente.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "show_photo_on_map" BOOLEAN NOT NULL DEFAULT true;
