import React, { useMemo } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { LegalDoc, LegalSlug } from '@cruzei/shared-types';
import { parseMiniMarkdown, type MdInline } from '@cruzei/shared-utils';
import { colors, fontFamily, spacing, typography } from '@cruzei/ui-mobile';
import { api, toApiError } from '../../services/api';

/** texto legal vindo do servidor (mesma fonte das páginas públicas /legal/:slug), renderizado nativo */
export function LegalDocView({ slug, footer }: { slug: LegalSlug; footer?: React.ReactNode }) {
  const q = useQuery({
    queryKey: ['legal', slug],
    queryFn: async () => (await api.get<LegalDoc>(`/legal-docs/${slug}`)).data,
    staleTime: 3_600_000,
  });
  const blocks = useMemo(() => (q.data ? parseMiniMarkdown(q.data.markdown) : []), [q.data]);

  if (q.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.black} />
      </View>
    );
  }
  if (q.isError || !q.data) {
    return (
      <View style={styles.center}>
        <Text style={styles.p}>Não deu pra abrir o documento ({toApiError(q.error).message}).</Text>
        <Pressable onPress={() => q.refetch()} style={styles.retry} accessibilityRole="button">
          <Text style={styles.retryText}>Tentar de novo</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <ScrollView contentContainerStyle={styles.content}>
      {blocks.map((b, i) => {
        if ('items' in b) {
          return (
            <View key={i} style={styles.list}>
              {b.items.map((item, j) => (
                <View key={j} style={styles.item}>
                  <Text style={styles.bullet}>{b.type === 'ol' ? `${j + 1}.` : '•'}</Text>
                  <Text style={[styles.p, { flex: 1 }]}>
                    <Inline parts={item} />
                  </Text>
                </View>
              ))}
            </View>
          );
        }
        const style = b.type === 'h1' ? styles.h1 : b.type === 'h2' ? styles.h2 : b.type === 'h3' ? styles.h3 : styles.p;
        return (
          <Text key={i} style={style} accessibilityRole={b.type === 'p' ? undefined : 'header'}>
            <Inline parts={b.inlines} />
          </Text>
        );
      })}
      {footer}
    </ScrollView>
  );
}

function Inline({ parts }: { parts: MdInline[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.href ? (
          <Text key={i} style={styles.link} onPress={() => Linking.openURL(p.href!)} accessibilityRole="link">
            {p.text}
          </Text>
        ) : (
          <Text key={i} style={p.bold ? styles.bold : undefined}>
            {p.text}
          </Text>
        ),
      )}
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  content: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  h1: { ...typography.h2, color: colors.black, marginBottom: spacing.xs },
  h2: { ...typography.h4, color: colors.black, marginTop: spacing.xl, marginBottom: spacing.sm },
  h3: { ...typography.body, fontFamily: fontFamily.bodyBold, color: colors.black, marginTop: spacing.lg, marginBottom: spacing.xs },
  p: { ...typography.body, color: colors.gray[800], lineHeight: 23, marginBottom: spacing.sm },
  bold: { fontFamily: fontFamily.bodyBold, color: colors.black },
  link: { color: '#B3006A', textDecorationLine: 'underline' },
  list: { marginBottom: spacing.sm },
  item: { flexDirection: 'row', gap: spacing.sm, paddingRight: spacing.sm },
  bullet: { ...typography.body, color: colors.gray[500], width: 18, lineHeight: 23 },
  retry: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: 999, backgroundColor: colors.black },
  retryText: { ...typography.body, color: colors.white, fontFamily: fontFamily.bodySemiBold },
});
