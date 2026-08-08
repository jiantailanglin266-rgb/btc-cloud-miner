"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client";
import { Button } from "@/components/ui";

export function MarkAllRead() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <Button
      variant="secondary"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await apiFetch("/api/notifications", { json: { action: "read-all" } });
          router.refresh();
        } finally {
          setBusy(false);
        }
      }}
    >
      すべて既読にする
    </Button>
  );
}
