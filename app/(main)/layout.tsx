"use client";

import React from 'react';
import {
    BookOutlined,
    DashboardOutlined,
    FileTextOutlined,
    FolderOpenOutlined,
    MenuFoldOutlined,
    MenuUnfoldOutlined,
    RobotOutlined,
    ScheduleOutlined,
    StockOutlined,
} from '@ant-design/icons';
import type { MenuProps } from 'antd';
import { Button, Layout, Menu, theme } from 'antd';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import './layout.style.css';

const { Header, Content, Sider } = Layout;

type AppMenuItem = {
    key: string;
    label: string;
    href: string;
    icon?: React.ReactNode;
};

type AppMenuGroup = {
    key: string;
    label: string;
    icon?: React.ReactNode;
    items: AppMenuItem[];
};

const appNavigationGroups: AppMenuGroup[] = [
    {
        key: 'study',
        label: 'Study',
        icon: <BookOutlined />,
        items: [
            { key: '/dictation', label: 'Dictation', href: '/dictation', icon: <FileTextOutlined /> },
            { key: '/mindmap', label: 'Mindmap', href: '/mindmap', icon: <BookOutlined /> },
            { key: '/vocabulary', label: 'Vocabulary', href: '/vocabulary', icon: <BookOutlined /> },
            { key: '/flashcards', label: 'Flashcards', href: '/flashcards', icon: <ScheduleOutlined /> },
        ],
    },
    {
        key: 'work',
        label: 'Work',
        icon: <FolderOpenOutlined />,
        items: [
            { key: '/dashboard/stocks', label: 'Stocks', href: '/dashboard/stocks', icon: <StockOutlined /> },
            { key: '/dashboard/newsfeed', label: 'News Feed', href: '/dashboard/newsfeed', icon: <FileTextOutlined /> },
            { key: '/dashboard/crypto', label: 'Crypto', href: '/dashboard/crypto', icon: <DashboardOutlined /> },
            { key: '/dashboard/trade', label: 'Trade Test', href: '/dashboard/trade', icon: <RobotOutlined /> },
            { key: '/dashboard/ai', label: 'AI', href: '/dashboard/ai', icon: <RobotOutlined /> },
        ],
    },

];

const headerNavItems: MenuProps['items'] = [
    { key: '/dashboard/newsfeed', label: <Link href="/dashboard/newsfeed">News Feed</Link> },
    { key: '/dashboard/crypto', label: <Link href="/dashboard/crypto">Crypto</Link> },
    { key: '/dashboard/trade', label: <Link href="/dashboard/trade">Trade Test</Link> },
    { key: '/dashboard/stocks', label: <Link href="/dashboard/stocks">Stocks</Link> },
    { key: '/dashboard/ai', label: <Link href="/dashboard/ai">AI</Link> },
];

const sidebarMenuItems: MenuProps['items'] = appNavigationGroups.map((group) => ({
    key: group.key,
    icon: group.icon,
    label: group.label,
    children: group.items.map((item) => ({
        key: item.key,
        icon: item.icon,
        label: <Link href={item.href}>{item.label}</Link>,
    })),
}));

interface MainLayoutProps {
    children: React.ReactNode;
}

const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
    const {
        token: { colorBgContainer, borderRadiusLG },
    } = theme.useToken();
    const [collapsed, setCollapsed] = React.useState(false);
    const [mobileSidebarOpen, setMobileSidebarOpen] = React.useState(false);
    const [checkingAuth, setCheckingAuth] = React.useState(true);
    const pathname = usePathname();
    const router = useRouter();

    const activeMenuKey = React.useMemo(() => {
        const safePath = pathname === '/dashboard' ? '/dashboard/stocks' : pathname;
        const allKeys = appNavigationGroups.flatMap((group) => group.items.map((item) => item.key));
        return allKeys.includes(safePath) ? safePath : '';
    }, [pathname]);

    const isMindmapRoute = pathname === '/mindmap';

    React.useEffect(() => {
        setMobileSidebarOpen(false);
    }, [pathname]);

    React.useEffect(() => {
        fetch('/api/auth/me', { cache: 'no-store' })
            .then((response) => response.json())
            .then(({ user }) => {
                if (!user) router.replace('/login');
            })
            .catch(() => router.replace('/login'))
            .finally(() => setCheckingAuth(false));
    }, [router]);

    const logout = async () => {
        await fetch('/api/auth/logout', { method: 'POST' });
        router.replace('/login');
        router.refresh();
    };

    if (checkingAuth) {
        return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>Loading...</div>;
    }

    return (
        <Layout className="app-main-layout" style={{ height: '100vh' }}>
            <Header
                className="app-main-header"
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0 12px 0 0',
                    backgroundColor: colorBgContainer,
                    borderBottom: '1px solid rgba(5, 5, 5, 0.06)',
                    zIndex: 10,
                }}
            >
                <div className="demo-logo flex items-center justify-center" style={{ width: 200 }}>
                    <Link href="/dashboard/stocks" className="flex items-center justify-center w-full h-full">
                        <img src="/assets/images/logo.png" alt="Logo" style={{ width: '52%', height: '100%', objectFit: 'contain' }} />
                    </Link>
                </div>

                <Button
                    type="text"
                    icon={mobileSidebarOpen ? <MenuFoldOutlined /> : <MenuUnfoldOutlined />}
                    onClick={() => setMobileSidebarOpen((prev) => !prev)}
                    className="app-sider-toggle"
                    aria-label={mobileSidebarOpen ? 'Close navigation' : 'Open navigation'}
                    aria-expanded={mobileSidebarOpen}
                />

                <Menu
                    theme="light"
                    selectedKeys={activeMenuKey ? [activeMenuKey] : []}
                    items={headerNavItems}
                    mode="horizontal"
                    className="app-top-nav"
                />

                <Button type="text" onClick={() => void logout()} style={{ marginRight: 12 }}>Đăng xuất</Button>
            </Header>

            <Layout className="app-main-body">
                <Sider
                    className={`app-main-sider${mobileSidebarOpen ? ' app-main-sider-open' : ''}`}
                    width={220}
                    collapsedWidth={80}
                    breakpoint="lg"
                    collapsible
                    collapsed={mobileSidebarOpen ? false : collapsed}
                    onCollapse={(value) => setCollapsed(value)}
                    style={{
                        background: colorBgContainer,
                        overflow: 'hidden',
                        borderRight: '1px solid rgba(5, 5, 5, 0.06)',
                    }}
                >
                    <Menu
                        mode="inline"
                        theme="light"
                        selectedKeys={activeMenuKey ? [activeMenuKey] : []}
                        defaultOpenKeys={['work', 'study']}
                        style={{
                            height: '100%',
                            borderInlineEnd: 0,
                            background: 'transparent',
                        }}
                        items={sidebarMenuItems}
                    />
                </Sider>
                {mobileSidebarOpen && (
                    <button
                        type="button"
                        className="app-mobile-sider-backdrop"
                        aria-label="Close navigation"
                        onClick={() => setMobileSidebarOpen(false)}
                    />
                )}

                <Layout className="app-main-content-shell">
                    <Content
                        className="app-main-content"
                        style={{
                            flex: 1,
                            minHeight: 0,
                            margin: 0,
                            background: colorBgContainer,
                            borderRadius: borderRadiusLG,
                            overflow: isMindmapRoute ? 'hidden' : 'auto',
                            overscrollBehavior: isMindmapRoute ? 'none' : 'auto',
                        }}
                    >
                        {children}
                    </Content>
                </Layout>
            </Layout>
        </Layout>
    );
};

export default MainLayout;
