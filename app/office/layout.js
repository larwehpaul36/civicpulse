// The office page shows reports and staff sign-in. It is for invited staff only: not indexed, and no Referer sent to other sites.
export const metadata = {
  title: 'Office page',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function Layout({ children }) {
  return children;
}
