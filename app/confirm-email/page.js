import { Suspense } from 'react';
import TokenAction from '@/components/TokenAction';
import { strings as s } from '@/lib/strings';

export const metadata = { title: `${s.tokenPage.confirmTitle} · ${s.appName}`, robots: { index: false } };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <TokenAction kind="confirm" />
    </Suspense>
  );
}
