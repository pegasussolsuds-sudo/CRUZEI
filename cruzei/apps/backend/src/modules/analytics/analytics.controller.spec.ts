import { ANALYTICS_LIMITS } from '@cruzei/shared-types';
import { ExecutionContext, ValidationPipe } from '@nestjs/common';

import { ANON_EVENTS_PER_MINUTE } from './analytics-sanitize';
import {
  AnalyticsBatchDto,
  AnalyticsController,
  AnalyticsLinkDto,
  eventsRouteLimit,
} from './analytics.controller';
import type { AnalyticsService } from './analytics.service';

// o mesmo ValidationPipe do main.ts: campo sobrando no corpo dá 400, mas o que vai DENTRO de cada evento é saneado no
// serviço (evento esquisito não pode derrubar o lote)
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});
const validate = (metatype: new () => object, body: unknown) =>
  pipe.transform(body, { type: 'body', metatype });

const INSTALL = '3f2b8c1e-9a7d-4e1b-8c55-0a1b2c3d4e5f';

describe('corpo do POST /analytics/events e /link', () => {
  it('evento com campo desconhecido passa pelo pipe (o serviço descarta o que não presta)', async () => {
    const out = (await validate(AnalyticsBatchDto, {
      installId: INSTALL,
      events: [{ name: 'app_open', lat: -18.9, extra: { a: 1 } }, 'lixo', null],
    })) as AnalyticsBatchDto;
    expect(out.installId).toBe(INSTALL);
    expect(out.events).toHaveLength(3);
  });

  it('recusa installId inválido, lote grande demais e campo sobrando no topo', async () => {
    await expect(validate(AnalyticsBatchDto, { installId: 'x', events: [] })).rejects.toBeDefined();
    await expect(
      validate(AnalyticsBatchDto, {
        installId: INSTALL,
        events: Array.from({ length: ANALYTICS_LIMITS.batchMax + 1 }, () => ({ name: 'app_open' })),
      }),
    ).rejects.toBeDefined();
    await expect(
      validate(AnalyticsBatchDto, { installId: INSTALL, events: [], lat: -18.9 }),
    ).rejects.toBeDefined();
    await expect(
      validate(AnalyticsBatchDto, { installId: INSTALL, events: 'app_open' }),
    ).rejects.toBeDefined();
    await expect(validate(AnalyticsLinkDto, { installId: INSTALL })).resolves.toBeDefined();
    await expect(validate(AnalyticsLinkDto, { installId: '../../etc' })).rejects.toBeDefined();
  });
});

describe('limite da rota e quem mandou', () => {
  const ctxOf = (req: Record<string, unknown>) =>
    ({ switchToHttp: () => ({ getRequest: () => req }) }) as unknown as ExecutionContext;

  it('sem conta o teto por IP é apertado; com Bearer é o da conta', () => {
    expect(ANON_EVENTS_PER_MINUTE).toBeLessThanOrEqual(20);
    expect(eventsRouteLimit(ctxOf({ headers: {} }))).toBe(ANON_EVENTS_PER_MINUTE);
    expect(eventsRouteLimit(ctxOf({ headers: { authorization: 'Basic abc' } }))).toBe(
      ANON_EVENTS_PER_MINUTE,
    );
    expect(eventsRouteLimit(ctxOf({ headers: { authorization: 'Bearer eyJ.x.y' } }))).toBe(
      ANALYTICS_LIMITS.perMinute * 4,
    );
  });

  it('o serviço recebe a conta (ou null) e o IP do pedido', async () => {
    const ingest = jest.fn(async () => ({ accepted: 0 }));
    const ctl = new AnalyticsController({ ingest } as unknown as AnalyticsService);
    const dto = { installId: INSTALL, events: [] };
    await ctl.events(dto, { ip: '200.1.2.3', headers: {} });
    await ctl.events(dto, {
      ip: '10.0.0.1',
      ips: ['200.9.9.9', '10.0.0.1'],
      user: { id: 'u1', phone: '+55', role: 'user' },
    } as never);
    expect(ingest).toHaveBeenNthCalledWith(1, INSTALL, [], { userId: null, ip: 'ip:200.1.2.3' });
    expect(ingest).toHaveBeenNthCalledWith(2, INSTALL, [], { userId: 'u1', ip: 'ip:200.9.9.9' });
  });
});
