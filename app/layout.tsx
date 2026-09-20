import "./globals.css";

export const metadata = {
  title: "Agent Boundary Demo",
  description: "External enforcement gateway + participant-aware output gate + verifiable replay",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
