// Veículos (slot `vehicle`, cor ctx.col.vehicle). Dono: veículos.
//
// Montaria (ctx.scene.mount, vem do catálogo vehicleMountOf):
//   cover    carro de frente, cobre da cintura pra baixo (pernas escondidas), mãos no volante
//   straddle moto/bike/lambreta, pernas montadas, mãos no guidão
//   stand    patinete (guidão), skate e hoverboard (mãos livres) — o corpo sobe ctx.scene.lift
//   seat     cadeira de rodas, sentado (o tronco desce SEAT_DROP pela pose da cena; as pernas sentadas vêm do anatomy)
//   hover    tapete/nuvem/disco, balanço suave (pose.mount) — o corpo sobe ctx.scene.lift
//
// Contrato:
//   - TODAS as camadas no grupo 'mount' e com k:'mount' (o orquestrador já põe os dois antes de chamar); a sombra no
//     chão vai no grupo 'shadow' (fica no chão quando o veículo balança);
//   - pivô do grupo: rig.mount (anatomy.rigFromAnatomy); o piloto herda a transformação do mount (rig.ts);
//   - tudo dentro do viewBox 0..100 x 0..140; rodas e apoios no chão em y≈134;
//   - mãos no volante/guidão: a cena (scene.ts) leva a palma até os pontos de vehicles-geom.ts, os mesmos que o desenho
//     usa — guidão e volante ficam sempre embaixo da mão, em qualquer corpo;
//   - busto (ctx.opts.mode === 'bust') não chama estas funções.
//
// Arquivos: vehicles-geom (pontos e pose-base), vehicles-kit (materiais: lataria, cromo, borracha, vidro, luz, rodas),
// vehicles-cars (conversível, retrô, jipe, esportivo), vehicles-two (bike, moto, lambreta), vehicles-boards (patinete,
// skate, hoverboard), vehicles-chairs (cadeira de rodas e esportiva), vehicles-magic (tapete, nuvem, disco voador).

import type { LayerCtx } from '../ctx';
import { lodCtx } from '../shading';

import { boardBack, boardFront } from './vehicles-boards';
import { carBack, carFront } from './vehicles-cars';
import { chairBack, chairFront } from './vehicles-chairs';
import { magicBack, magicFront } from './vehicles-magic';
import { twoBack, twoFront } from './vehicles-two';

type Draw = (ctx: LayerCtx, id: never) => void;

const DRAW: Record<string, [Draw, Draw]> = {
  car: [carBack as Draw, carFront as Draw],
  classic: [carBack as Draw, carFront as Draw],
  jeep: [carBack as Draw, carFront as Draw],
  sport: [carBack as Draw, carFront as Draw],
  bike: [twoBack as Draw, twoFront as Draw],
  moto: [twoBack as Draw, twoFront as Draw],
  lambreta: [twoBack as Draw, twoFront as Draw],
  kick: [boardBack as Draw, boardFront as Draw],
  skate: [boardBack as Draw, boardFront as Draw],
  hoverboard: [boardBack as Draw, boardFront as Draw],
  wheelchair: [chairBack as Draw, chairFront as Draw],
  wheelchair_sport: [chairBack as Draw, chairFront as Draw],
  carpet: [magicBack as Draw, magicFront as Draw],
  cloud: [magicBack as Draw, magicFront as Draw],
  ufo: [magicBack as Draw, magicFront as Draw],
};

function drawOf(ctx: LayerCtx, i: 0 | 1): void {
  const id = ctx.cfg.vehicle;
  if (!id || id === 'none' || !ctx.scene.mount) return;
  const fns = Object.prototype.hasOwnProperty.call(DRAW, id) ? DRAW[id] : null;
  if (!fns) return;
  ctx.group('mount').tag('mount');
  fns[i](lodCtx(ctx), id as never);
}

/** 2. parte de trás do veículo (sombra no chão, encosto, banco, roda de trás, prancha) — antes de tudo do corpo */
export function vehicleBack(ctx: LayerCtx): void {
  drawOf(ctx, 0);
}

/** 13. parte da frente (carroceria, volante, guidão, roda da frente) — por cima do tronco e dos braços, por baixo dos antebraços */
export function vehicleFront(ctx: LayerCtx): void {
  drawOf(ctx, 1);
}
