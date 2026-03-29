"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

type HeaderProps = {
  title?: string;
  links?: { label: string; href: string }[];
};

const Header: React.FC<HeaderProps> = ({ title = "ReportStudio", links = [] }) => {
  const pathname = usePathname();

  return (
    <header className="w-full flex justify-center mt-4">
      <div className="w-full max-w-7xl px-4 py-3 flex items-center space-x-6 bg-white/70 border border-gray-300 rounded-3xl shadow-sm">

        {/* Название */}
        <div className="text-xl font-semibold text-black">
          {title}
        </div>

        {/* Меню */}
        <nav className="flex space-x-2">
          {links.map((link) => {
            const isActive = pathname === link.href;

            return (
              <Link
                key={link.href}
                href={link.href}
                className={`px-3 py-1.5 rounded-3xl text-sm transition-colors ${
                  isActive
                    ? "bg-black text-white"
                    : "text-black hover:bg-gray-100"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

      </div>
    </header>
  );
};

export default Header;