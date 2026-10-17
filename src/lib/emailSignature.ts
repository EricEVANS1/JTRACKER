// The name follow-up emails are signed with: the user's profile name, then the
// name from their sign-in account. Without either, the sign-off is left for the
// user to finish rather than guessing.

const clean = (value: unknown) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '');

export const getSignatureName = (
  profileFullName: string | null | undefined,
  userMetadata: Record<string, unknown> | null | undefined,
) => clean(profileFullName) || clean(userMetadata?.full_name) || clean(userMetadata?.name);

export const signOff = (name: string) => (name ? `Best regards,\n${name}` : 'Best regards,');
