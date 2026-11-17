import ModulePlaceholder from '@/components/module-placeholder';

export default function Page() {
  return (
    <ModulePlaceholder
      title="Listing moderation"
      description="Parts and machinery listings waiting for review (scope A3)"
      scope={[
        "Queue of pending listings, oldest first",
        "Approve / reject with a reason the seller sees",
        "Check media, specifications, compatibility, condition and side (Left / Right / Pair)",
        "Flag inappropriate or fraudulent listings",
      ]}
    />
  );
}
