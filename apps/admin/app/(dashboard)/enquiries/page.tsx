import ModulePlaceholder from '@/components/module-placeholder';

export default function Page() {
  return (
    <ModulePlaceholder
      title="Enquiries & offers"
      description="Enquiries, offers and counteroffers (scope A5)"
      scope={[
        "View enquiries by listing, buyer or seller",
        "Monitor offers and counteroffers and their status",
      ]}
    />
  );
}
