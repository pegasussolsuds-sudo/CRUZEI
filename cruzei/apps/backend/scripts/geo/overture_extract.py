"""
Extrai os lugares do Overture Places (GeoParquet público no S3, sem chave) de um bbox e grava NDJSON.
Só leitura na rede; não toca no banco. O import pro Postgres é o import.ts.

Uso (em apps/backend):
  py -3.13 -m pip install --user duckdb        # uma vez (DuckDB 1.5+)
  py -3.13 scripts/geo/overture_extract.py                                   # Uberlândia e arredores, release mais recente
  py -3.13 scripts/geo/overture_extract.py --bbox -48.40,-19.02,-48.15,-18.82 --release 2026-09-23.1

Saída: data/geo/overture-places.ndjson (uma linha por lugar) + data/geo/overture-places.meta.json (release, bbox, data).
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone

BUCKET = 'overturemaps-us-west-2'
DEFAULT_BBOX = '-48.40,-19.02,-48.15,-18.82'
HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.normpath(os.path.join(HERE, '..', '..', 'data', 'geo'))


def latest_release() -> str:
    """maior prefixo release/AAAA-MM-DD.N/ do bucket público (a listagem é XML do S3, sem auth)"""
    url = f'https://{BUCKET}.s3.amazonaws.com/?list-type=2&prefix=release/&delimiter=/'
    with urllib.request.urlopen(url, timeout=30) as r:
        xml = r.read().decode('utf-8')
    rels = re.findall(r'<Prefix>release/(\d{4}-\d{2}-\d{2}\.\d+)/</Prefix>', xml)
    if not rels:
        sys.exit('não achei nenhum release do Overture no S3')
    return sorted(rels, key=lambda s: (s.split('.')[0], int(s.split('.')[1])))[-1]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--bbox', default=DEFAULT_BBOX, help='oeste,sul,leste,norte (graus)')
    ap.add_argument('--release', default=None, help='ex.: 2026-09-23.1 (padrão: o mais recente)')
    ap.add_argument('--out', default=os.path.join(OUT_DIR, 'overture-places.ndjson'))
    a = ap.parse_args()

    w, s, e, n = [float(x) for x in a.bbox.split(',')]
    if not (w < e and s < n):
        sys.exit('bbox inválido: use oeste,sul,leste,norte')
    release = a.release or latest_release()

    import duckdb  # só aqui: o --help funciona sem o DuckDB instalado

    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial; SET s3_region='us-west-2';")
    src = f"s3://{BUCKET}/release/{release}/theme=places/type=place/*.parquet"
    t0 = time.time()
    # filtro no bbox (struct) primeiro: o DuckDB pula os row groups fora pela estatística do Parquet
    rows = con.execute(
        f"""
        SELECT
          id,
          names."primary"                                  AS name,
          ST_X(geometry)                                   AS lon,
          ST_Y(geometry)                                   AS lat,
          confidence,
          basic_category,
          taxonomy."primary"                               AS category,
          taxonomy.hierarchy                               AS hierarchy,
          taxonomy.alternates                              AS alternates,
          operating_status,
          socials,
          websites,
          phones,
          addresses[1]                                     AS address,
          brand.names."primary"                            AS brand,
          list_max(list_transform(sources, x -> x.update_time)) AS updated,
          list_distinct(list_transform(sources, x -> x.dataset)) AS datasets
        FROM read_parquet('{src}', hive_partitioning = false)
        WHERE bbox.xmin <= ? AND bbox.xmax >= ? AND bbox.ymin <= ? AND bbox.ymax >= ?
          AND ST_X(geometry) BETWEEN ? AND ? AND ST_Y(geometry) BETWEEN ? AND ?
        """,
        [e, w, n, s, w, e, s, n],
    ).fetchall()
    cols = [d[0] for d in con.description]

    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    tmp = a.out + '.tmp'
    with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
        for r in rows:
            f.write(json.dumps(dict(zip(cols, r)), ensure_ascii=False, default=str) + '\n')
    os.replace(tmp, a.out)  # arquivo novo só aparece inteiro
    meta = {
        'release': release,
        'bbox': [w, s, e, n],
        'count': len(rows),
        'extractedAt': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'source': src,
        'license': 'Overture Maps Places: CDLA-Permissive-2.0 / Apache-2.0 / CC0 conforme a fonte (docs.overturemaps.org/attribution)',
    }
    with open(os.path.splitext(a.out)[0] + '.meta.json', 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    print(json.dumps({**meta, 'seconds': round(time.time() - t0, 1)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
