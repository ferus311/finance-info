"use client";
import React from 'react';
import { LaptopOutlined, MenuFoldOutlined, MenuUnfoldOutlined, NotificationOutlined, UserOutlined } from '@ant-design/icons';
import type { MenuProps } from 'antd';
import { Button, Layout, Menu, theme } from 'antd';
import Link from 'next/link';
import './layout.style.css';

const { Header, Content, Sider } = Layout;


const headerNavItems: MenuProps['items'] = [
    {
        key: '/dashboard/newsfeed',
        label: <Link href="/dashboard/newsfeed">News Feed</Link>,
    },
    {
        key: '/dashboard/crypto',
        label: <Link href="/dashboard/crypto">Crypto</Link>,
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
    const [collapsed, setCollapsed] = React.useState(false);

    const siderTrigger = (
        <Button
            type="text"
            aria-label={collapsed ? 'Open sidebar' : 'Close sidebar'}
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            className="dashboard-sider-trigger"
        />
    );

    return (
        <Layout className="h-full flex flex-col overflow-hidden">
            <Header className="bg-white" style={{ display: 'flex', padding: 0, backgroundColor: colorBgContainer, alignItems: 'center' }}>
                <div className="demo-logo flex items-center justify-center w-[200px] " >
                    <img src="/assets/images/logo.png" alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                </div>
                <Menu
                    theme="light"
                    // mode="horizontal"
                    defaultSelectedKeys={['2']}
                    items={headerNavItems}
                    className="flex-1 flex justify-around [&>li.ant-menu-item-only-child]:(flex-1 flex justify-center items-center) "
                />
            </Header>
            <Layout className="flex flex-1 min-h-0 overflow-hidden">
                <Sider
                    width={200}
                    breakpoint="lg"
                    collapsedWidth={0}
                    collapsible
                    collapsed={collapsed}
                    onCollapse={setCollapsed}
                    trigger={siderTrigger}
                    style={{ background: colorBgContainer, overflow: 'auto' }}
                >
                    <Menu
                        mode="inline"
                        defaultSelectedKeys={['1']}
                        defaultOpenKeys={['sub1']}
                        style={{ height: '100%', borderInlineEnd: 0 }}
                        items={items2}
                    />
                </Sider>
                <Layout className="flex min-h-0 flex-1 flex-col overflow-hidden pl-2 pt-2">
                    <Content
                        style={{
                            flex: 1,
                            minHeight: 0,
                            padding: 24,
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
