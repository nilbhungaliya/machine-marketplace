import ModulePlaceholder from '@/components/module-placeholder';

export default function Page() {
  return (
    <ModulePlaceholder
      title="Audit log"
      description="Every admin action: who, what, before and after"
      scope={[
        "Filter by admin, action and target",
      ]}
    />
  );
}
