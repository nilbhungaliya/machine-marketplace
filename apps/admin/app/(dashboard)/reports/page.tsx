import ModulePlaceholder from '@/components/module-placeholder';

export default function Page() {
  return (
    <ModulePlaceholder
      title="Reports & flags"
      description="Reported users, businesses, listings and conversations (scope A6)"
      scope={[
        "User / business reports and listing reports",
        "Fraud and abuse flags",
        "Act on a report: hide listing, suspend user, dismiss",
      ]}
    />
  );
}
