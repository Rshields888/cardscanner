export const metadata = { title: 'Card Scanner API', description: 'Vision OCR + eBay Finding (sold comps)' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body style={{fontFamily:'system-ui',padding:20}}>{children}</body></html>);
}