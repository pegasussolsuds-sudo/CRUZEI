// Lugares: sugestões da galera ("Pôr no Metch"), denúncias de lugar e o catálogo inteiro.
import { useSearchParams } from 'react-router';
import { Flag, MapPinned, MapPinPlus } from 'lucide-react';
import { Tabs } from '@/components/ui/Tabs';
import { PageHeader } from '@/components/ui/misc';
import { CandidatesTab } from './CandidatesTab';
import { PoiReportsTab } from './PoiReportsTab';
import { AllPoisTab } from './AllPoisTab';

type Tab = 'sugestoes' | 'denuncias' | 'todos';

export default function PlacesPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('aba');
  const tab: Tab = raw === 'denuncias' || raw === 'todos' ? raw : 'sugestoes';

  return (
    <div className="content">
      <PageHeader title="Lugares" sub="O que aparece no mapa do app: sugestões da galera, denúncias e o catálogo." />
      <Tabs<Tab>
        label="Seções de lugares"
        value={tab}
        onChange={(k) => setParams(k === 'sugestoes' ? {} : { aba: k }, { replace: true })}
        items={[
          { key: 'sugestoes', label: 'Sugestões', icon: <MapPinPlus size={16} /> },
          { key: 'denuncias', label: 'Denúncias de lugar', icon: <Flag size={16} /> },
          { key: 'todos', label: 'Todos os lugares', icon: <MapPinned size={16} /> },
        ]}
      >
        {tab === 'sugestoes' ? <CandidatesTab /> : tab === 'denuncias' ? <PoiReportsTab /> : <AllPoisTab />}
      </Tabs>
    </div>
  );
}
