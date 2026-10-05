import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { colors } from '@cruzei/ui-mobile';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { LegalDocView } from '../../components/legal/LegalDocView';

type Props = NativeStackScreenProps<RootStackParamList, 'Legal'>;

/** Termos de Uso · Política de privacidade · Padrões de segurança infantil (abre antes e depois do login) */
export function LegalScreen({ route }: Props) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['bottom']}>
      <LegalDocView slug={route.params.slug} />
    </SafeAreaView>
  );
}

export const LEGAL_TITLES = {
  termos: 'Termos de Uso',
  privacidade: 'Política de privacidade',
  'seguranca-infantil': 'Segurança infantil',
  'excluir-conta': 'Excluir conta',
} as const;
