// Papel da conta (só admin; o servidor não deixa mudar o próprio e garante que sobra 1 admin)
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import type { UserRole } from '@cruzei/shared-types';
import { adminApi } from '@/api/admin';
import { qk } from '@/api/keys';
import { errorMessage } from '@/api/http';
import { ROLE_LABEL } from '@/lib/labels';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { OptionCards } from '@/components/ui/Choice';
import { Checkbox } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';

const DESCRIPTIONS: Record<UserRole, string> = {
  user: 'Conta comum, sem acesso ao painel',
  moderator: 'Painel: usuários, lugares, eventos e suporte',
  admin: 'Tudo, inclusive Premium, papéis, campanhas e auditoria',
};

export function RoleDialog({ open, onClose, user }: { open: boolean; onClose: () => void; user: { id: string; name: string; role: UserRole } }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [role, setRole] = useState<UserRole>(user.role);
  const [sure, setSure] = useState(false);

  useEffect(() => {
    if (open) {
      setRole(user.role);
      setSure(false);
    }
  }, [open, user.role]);

  const mutation = useMutation({
    mutationFn: () => adminApi.setRole(user.id, { role }),
    onSuccess: () => {
      toast.success(`${user.name} agora é ${ROLE_LABEL[role]}`);
      void qc.invalidateQueries({ queryKey: qk.user(user.id) });
      void qc.invalidateQueries({ queryKey: qk.usersAll });
      onClose();
    },
  });
  const { reset } = mutation;
  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  const changed = role !== user.role;
  const grantsAdmin = role === 'admin' && changed;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Papel de ${user.name}`}
      description={`Hoje: ${ROLE_LABEL[user.role]}.`}
      icon={<ShieldCheck size={20} />}
      iconTone="accent"
      size="md"
      busy={mutation.isPending}
      onSubmit={() => {
        if (changed && (!grantsAdmin || sure)) mutation.mutate();
      }}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>
            Voltar
          </Button>
          <Button type="submit" variant="primary" loading={mutation.isPending} disabled={!changed || (grantsAdmin && !sure)}>
            Salvar papel
          </Button>
        </>
      }
    >
      <OptionCards<UserRole>
        label="Papel"
        value={role}
        onChange={setRole}
        options={(['user', 'moderator', 'admin'] as UserRole[]).map((r) => ({ value: r, label: ROLE_LABEL[r], description: DESCRIPTIONS[r] }))}
      />
      {grantsAdmin ? <Checkbox label="Confirmo: essa pessoa vai poder tudo no painel." checked={sure} onChange={setSure} /> : null}
      {mutation.isError ? (
        <div className="banner banner-danger" role="alert">
          {errorMessage(mutation.error)}
        </div>
      ) : null}
    </Dialog>
  );
}
