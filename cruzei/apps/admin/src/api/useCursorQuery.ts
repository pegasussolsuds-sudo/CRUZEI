// Lista paginada por cursor (todas as listas do painel têm { items, nextCursor }).
// Tipos escritos à mão: o monorepo força o @tanstack/query-core 5.103 (override da raiz) por baixo do
// react-query 5.51, e as opções do useInfiniteQuery perdem a inferência nessa mistura.
import { useInfiniteQuery, type InfiniteData, type QueryKey, type UseInfiniteQueryResult } from '@tanstack/react-query';

export type CursorPage = { nextCursor: string | null };
export type CursorData<T extends CursorPage> = InfiniteData<T, string | null>;

export function useCursorQuery<T extends CursorPage>(
  queryKey: QueryKey,
  fetchPage: (cursor: string | null, signal: AbortSignal) => Promise<T>,
  opts: { enabled?: boolean; refetchInterval?: number | false; staleTime?: number } = {},
): UseInfiniteQueryResult<CursorData<T>, Error> {
  return useInfiniteQuery<T, Error, CursorData<T>, QueryKey, string | null>({
    queryKey,
    queryFn: ({ pageParam, signal }: { pageParam: string | null; signal: AbortSignal }) => fetchPage(pageParam, signal),
    initialPageParam: null,
    getNextPageParam: (last: T) => last.nextCursor,
    ...opts,
  });
}
