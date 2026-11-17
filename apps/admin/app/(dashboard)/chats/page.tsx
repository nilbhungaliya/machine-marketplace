import ModulePlaceholder from '@/components/module-placeholder';

export default function Page() {
  return (
    <ModulePlaceholder
      title="Conversations"
      description="Reported conversations and disputes (scope A5)"
      scope={[
        "Review a reported conversation with its listing and offers",
        "Resolve or escalate",
      ]}
    />
  );
}
