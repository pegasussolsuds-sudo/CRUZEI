// 18+ check — Cruzei só libera maior de idade

export function calculateAge(birthDate: Date | string): number {
  const d = typeof birthDate === 'string' ? new Date(birthDate) : birthDate;
  const today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const monthDiff = today.getMonth() - d.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < d.getDate())) {
    age -= 1;
  }
  return age;
}

export function isAtLeast18(birthDate: Date | string): boolean {
  return calculateAge(birthDate) >= 18;
}
