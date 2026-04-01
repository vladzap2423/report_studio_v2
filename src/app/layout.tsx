import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Header from "./components/Header";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ReportStudio",
  description: "Report processing studio",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <div className="app-shell">
          <Header
            title="ReportStudio"
            links={[
              { label: "Главная", href: "/" },
              { label: "Задачи", href: "/tasks" },
              { label: "Админ", href: "/admin" },
            ]}
          />

          <main className="app-main-slot">
            <div className="app-main-frame app-page">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}
