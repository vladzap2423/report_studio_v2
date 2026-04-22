import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css"
import Header from "./components/Header";
import { AppToastProvider } from "./components/AppToastProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  applicationName: "ГП1 Платформа",
  title: {
    default: "ГП1 Платформа",
    template: "%s | ГП1 Платформа",
  },
  description: "Платформа ГП1",
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/icon.png", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    apple: "/icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <AppToastProvider>
          <div className="app-shell">
            <Header
              title="ГП1 Платформа"
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
        </AppToastProvider>
      </body>
    </html>
  );
}
