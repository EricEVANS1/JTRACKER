export type FitLabel =
  | 'Strong fit'
  | 'Good fit'
  | 'Possible fit'
  | 'Stretch role'
  | 'Avoid';

export const getFitLabel = (score?: number | null): FitLabel => {
  if (score == null) return 'Stretch role';

  if (score >= 80) return 'Strong fit';
  if (score >= 70) return 'Good fit';
  if (score >= 60) return 'Possible fit';
  if (score >= 45) return 'Stretch role';

  return 'Avoid';
};