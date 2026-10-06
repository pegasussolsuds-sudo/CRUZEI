// Registro dos lisos/ondulados (hair-long.ts). Dono: cabelo.

import type { HairKit } from './hair-kit';
import { BOB, CURTAIN, LONG, WAVY, curtainBangs, fallBack, fallFront } from './hair-long';

type Style = { back?: (k: HairKit) => void; front?: (k: HairKit) => void; belowWrap?: boolean };

export const LONG_STYLES: Record<string, Style> = {
  long: { back: (k) => fallBack(k, LONG), front: (k) => void fallFront(k, LONG), belowWrap: true },
  wavy: { back: (k) => fallBack(k, WAVY), front: (k) => void fallFront(k, WAVY), belowWrap: true },
  curtain: {
    back: (k) => fallBack(k, CURTAIN),
    front: (k) => {
      fallFront(k, { ...CURTAIN, wisps: false });
      curtainBangs(k);
    },
    belowWrap: true,
  },
  bob: { back: (k) => fallBack(k, BOB), front: (k) => void fallFront(k, BOB) },
};
