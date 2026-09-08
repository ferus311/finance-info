"use client";
import React from 'react';
import { LaptopOutlined, MenuFoldOutlined, MenuUnfoldOutlined, NotificationOutlined, UserOutlined } from '@ant-design/icons';
import type { MenuProps } from 'antd';
import { Button, Layout, Menu, theme } from 'antd';
import Link from 'next/link';
import './layout.style.css';
import { usePathname, useRouter } from 'next/navigation';

const { Header, Content, Sider } = Layout;


const headerNavItems: MenuProps['items'] = [
    {
        key: '/dashboard/newsfeed',
        label: <Link href="/dashboard/newsfeed">News Feed</Link>,
    },
    {
        key: '/dashboard/crypto',
        label: <Link href="/dashboard/trade">Trade Test</Link>,
    },
    {
        key: '/dashboard/stocks',
        label: <Link href="/dashboard/stocks">Stocks</Link>,
    },
    {
        key: '/dashboard/ai',
        label: <Link href="/dashboard/ai">AI</Link>,
    }
];

interface MainLayoutProps {
    children: React.ReactNode;
}

const items2: MenuProps['items'] = [UserOutlined, LaptopOutlined, NotificationOutlined].map(
    (icon, index) => {
        const key = String(index + 1);

        return {
            key: `sub${key}`,
            icon: React.createElement(icon),
            label: `subnav ${key}`,
            children: Array.from({ length: 4 }).map((_, j) => {
                const subKey = index * 4 + j + 1;
                return {
                    key: subKey,
                    label: `option${subKey}`,
                };
            }),
        };
    },
);



const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
    const {
        token: { colorBgContainer, borderRadiusLG },
    } = theme.useToken();
    const [collapsed, setCollapsed] = React.useState(true);
    const [checkingAuth, setCheckingAuth] = React.useState(true);
    const pathName = usePathname();
    const router = useRouter();

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
        <Layout className="h-full flex flex-col overflow-hidden">
            <Header className="bg-white" style={{ display: 'flex', padding: 0, backgroundColor: colorBgContainer, alignItems: 'center' }}>
                <div className="demo-logo flex items-center justify-center w-[200px] " >
                    <Link href="/dashboard/stocks" className="flex items-center justify-center w-full h-full">
                        <img src="/assets/images/logo.png" alt="Logo" style={{ width: '50%', height: '100%', objectFit: 'contain' }} />
                    </Link>
                </div>
                <Menu
                    theme="light"
                    // defaultSelectedKeys={}
                    selectedKeys={[pathName]}
                    items={headerNavItems}
                    className="flex-1 flex justify-around [&>li.ant-menu-item-only-child]:(flex-1 flex justify-center items-center) "
                />
                <Button type="text" onClick={() => void logout()} style={{ marginRight: 16 }}>Đăng xuất</Button>
            </Header>
            <Layout className="flex flex-1 min-h-0 overflow-hidden">
                <Sider
                    width={200}
                    breakpoint="lg"
                    // collapsedWidth={0}
                    collapsible
                    collapsed={collapsed}
                    onCollapse={(value) => setCollapsed(value)}
                    style={{ background: colorBgContainer, overflow: 'auto' }}
                >
                    <Menu
                        mode="inline"
                        // defaultSelectedKeys={['1']}
                        // defaultOpenKeys={['sub1']}
                        theme="light"
                        style={{ height: '100%', borderInlineEnd: 0 }}
                        items={items2}
                    />
                </Sider>
                <Layout className="flex min-h-0 flex-1 flex-col overflow-hidden pl-2 pt-2">
                    <Content
                        style={{
                            flex: 1,
                            minHeight: 0,
                            // padding: 24,
                            margin: 0,
                            background: colorBgContainer,
                            borderRadius: borderRadiusLG,
                            overflow: 'auto',
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
