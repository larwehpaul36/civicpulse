// The office reply page is private: it carries a secret in its address.
// Search engines must not index it, and the address must not leak to other sites through the Referer header.
export const metadata = {
  title: 'Reply to a report',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function Layout({ children }) {
  return children;
}
