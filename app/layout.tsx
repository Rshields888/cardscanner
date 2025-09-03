export const metadata = { title: 'Card Scan API', description: 'Google Vision + eBay Finding' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{fontFamily:'system-ui', padding:20}}>{children}</body>
    </html>
  );
}
