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
    <header className="w-full bg-gray-800 text-white shadow-md">
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center space-x-6">
        {/* Название программы */}
        <div className="text-xl font-bold">{title}</div>

        {/* Меню слева после названия */}
        <nav className="flex space-x-4">
          {links.map((link) => {
            const isActive = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`px-3 py-1 rounded-md transition-colors ${
                  isActive
                    ? "bg-gray-700 text-white font-semibold"
                    : "text-gray-300 hover:bg-gray-700 hover:text-white"
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