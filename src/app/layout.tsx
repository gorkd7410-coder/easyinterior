import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "실측없이 — 인테리어 상담용 3D 골조",
  description: "평면도와 평수만으로 골조를 띄우고 마감재 조합을 바로 보여준 뒤 스케치업으로 넘기는 상담 도구",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="h-full">{children}</body>
    </html>
  );
}
