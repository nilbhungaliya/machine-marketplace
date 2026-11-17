import ModulePlaceholder from '@/components/module-placeholder';

export default function Page() {
  return (
    <ModulePlaceholder
      title="Settings & roles"
      description="Admin accounts, roles and marketplace configuration (scope A6)"
      scope={[
        "Admin accounts and roles",
        "Marketplace settings (limits, counter rounds, alert matching)",
      ]}
    />
  );
}
