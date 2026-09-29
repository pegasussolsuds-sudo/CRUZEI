// Criar/editar lugar feito pela equipe (POST/PATCH /v1/admin/places/pois)
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MapPin } from 'lucide-react';
import type { AdminPoi, UpsertPoiPayload } from '@cruzei/shared-types';
import { adminApi } from '@/api/admin';
import { qk } from '@/api/keys';
import { errorMessage } from '@/api/http';
import { isValidLatLng, type LatLng } from '@/lib/geo';
import { POI_CATEGORIES, poiCategoryLabel } from '@/lib/labels';
import { MapPointField } from '@/components/pickers';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Checkbox, SelectField, TextAreaField, TextField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';

interface Form {
  name: string;
  category: string;
  point: LatLng | null;
  address: string;
  city: string;
  isPartner: boolean;
  partnerOffer: string;
}

function toForm(p: AdminPoi | null): Form {
  return {
    name: p?.name ?? '',
    category: p?.category ?? 'bar',
    point: p ? { lat: p.lat, lng: p.lng } : null,
    address: p?.address ?? '',
    city: p?.city ?? '',
    isPartner: p?.isPartner ?? false,
    // o contrato não devolve a oferta atual do parceiro no AdminPoi: edição começa vazia
    partnerOffer: '',
  };
}

export function PoiFormDialog({ open, onClose, poi }: { open: boolean; onClose: () => void; poi: AdminPoi | null }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<Form>(() => toForm(poi));
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(toForm(poi));
      setTouched(false);
    }
  }, [open, poi]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const errors = {
    name: form.name.trim().length < 2 ? 'Dá um nome pro lugar.' : null,
    point: !form.point || !isValidLatLng(form.point.lat, form.point.lng) ? 'Marca o lugar no mapa.' : null,
  };
  const valid = !errors.name && !errors.point;

  const mutation = useMutation({
    mutationFn: () => {
      const p = form.point as LatLng;
      const body: UpsertPoiPayload = {
        name: form.name.trim(),
        category: form.category,
        lat: p.lat,
        lng: p.lng,
        address: form.address.trim() || null,
        city: form.city.trim() || null,
        isPartner: form.isPartner,
      };
      if (form.isPartner && form.partnerOffer.trim()) body.partnerOffer = form.partnerOffer.trim();
      if (!form.isPartner) body.partnerOffer = null;
      return poi ? adminApi.updatePoi(poi.id, body) : adminApi.createPoi(body);
    },
    onSuccess: (saved) => {
      toast.success(poi ? 'Lugar atualizado' : `${saved?.name ?? 'Lugar'} entrou no mapa`);
      void qc.invalidateQueries({ queryKey: qk.placesAll });
      onClose();
    },
  });
  const { reset } = mutation;
  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      icon={<MapPin size={20} />}
      iconTone="accent"
      title={poi ? `Editar “${poi.name}”` : 'Novo lugar'}
      description={poi ? 'As mudanças aparecem no mapa do app na hora.' : 'Lugar feito pela equipe: entra no mapa assim que salvar.'}
      busy={mutation.isPending}
      onSubmit={() => {
        setTouched(true);
        if (valid) mutation.mutate();
      }}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" loading={mutation.isPending}>
            {poi ? 'Salvar' : 'Criar lugar'}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <TextField label="Nome" required maxLength={120} value={form.name} onChange={(e) => set('name', e.target.value)} error={touched ? errors.name : null} autoFocus />
        <SelectField label="Categoria" value={form.category} onChange={(e) => set('category', e.target.value)}>
          {POI_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {poiCategoryLabel(c)}
            </option>
          ))}
          {!POI_CATEGORIES.includes(form.category) ? <option value={form.category}>{form.category}</option> : null}
        </SelectField>
        <div className="span-2">
          <MapPointField value={form.point} onChange={(p) => set('point', p)} label="Onde fica" error={touched ? errors.point : null} height={300} />
        </div>
        <TextField label="Endereço" maxLength={200} value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="Rua, número, bairro" />
        <TextField label="Cidade" maxLength={80} value={form.city} onChange={(e) => set('city', e.target.value)} placeholder="Uberlândia" />
        <div className="span-2 stack" style={{ gap: 10 }}>
          <Checkbox label="Parceiro do Metch" checked={form.isPartner} onChange={(v) => set('isPartner', v)} hint="Ganha destaque no mapa." />
          {form.isPartner ? (
            <TextAreaField
              label="Oferta do parceiro"
              maxLength={200}
              showCounter
              rows={2}
              value={form.partnerOffer}
              onChange={(e) => set('partnerOffer', e.target.value)}
              placeholder="Ex.: 10% no primeiro drink mostrando o Metch"
              hint={poi ? 'Deixe vazio pra manter a oferta atual.' : undefined}
            />
          ) : null}
        </div>
      </div>
      {mutation.isError ? (
        <div className="banner banner-danger" role="alert">
          {errorMessage(mutation.error)}
        </div>
      ) : null}
    </Dialog>
  );
}
