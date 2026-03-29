"use client";

import React from "react";
import Link from "next/link";

type HeaderProps = {
  title?: string;
  links?: { label: string; href: string }[];
};

const Header: React.FC<HeaderProps> = ({ title = "ReportStudio", links = [] }) => {
  return (
    <header className="w-full bg-gray-800 text-white shadow-md">
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
        {/* Левый блок — название программы */}
        <div className="text-xl font-bold">{title}</div>

        {/* Правый блок — ссылки или кнопки */}
        <nav className="flex space-x-4">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="hover:text-gray-300 transition-colors"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
};

export default Header;