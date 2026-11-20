import ModulePlaceholder from '@/components/module-placeholder';

// AC-STUB(B2): the nav entry (C0-5) needs a page; lane B2 replaces it with the Admin users table (admin close-out §13).
export default function Page() {
  return (
    <ModulePlaceholder
      title="Admin users"
      description="Invite admins, change roles, reset passwords and deactivate accounts (AD7)"
      scope={[
        'Invite an admin with a one-time set-password link',
        'Change role, rename, reset password, sign out everywhere, deactivate / reactivate',
      ]}
    />
  );
}
