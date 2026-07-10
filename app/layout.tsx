// app/layout.tsx
import React from 'react';
import { AntdRegistry } from '@ant-design/nextjs-registry';
import { Inter } from 'next/font/google';
import '@/globals.css';

const inter = Inter({ subsets: ['latin'] });

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en" className={`${inter.className} h-full`}>
            <body className="h-full overflow-hidden flex flex-col">
                <AntdRegistry>
                    <div className="h-full w-full overflow-hidden">{children}</div>
                </AntdRegistry>
            </body>
        </html>
    );
}
