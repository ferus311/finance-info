"use client";

import { useState } from "react";
import { App, Button, Card, ConfigProvider, Form, Input, Segmented, Typography } from "antd";
import { useRouter } from "next/navigation";

export default function LoginPage() {
    const router = useRouter();
    const [mode, setMode] = useState<"login" | "register">("login");
    const [loading, setLoading] = useState(false);
    const [form] = Form.useForm<{ email: string; password: string }>();
    const { message } = App.useApp();

    const submit = async (values: { email: string; password: string }) => {
        setLoading(true);
        try {
            const response = await fetch(`/api/auth/${mode}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(values),
            });
            const payload = await response.json() as { error?: string };
            if (!response.ok) throw new Error(payload.error ?? "Không thể xác thực tài khoản.");
            router.replace("/dashboard/stocks");
            router.refresh();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "Không thể xác thực tài khoản.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <ConfigProvider theme={{ token: { colorPrimary: "#0f766e", borderRadius: 10 } }}>
            <App>
                <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 20, background: "#f3f7f5" }}>
                    <Card style={{ width: "100%", maxWidth: 420 }}>
                        <Typography.Text style={{ color: "#0f766e", fontWeight: 800, letterSpacing: 1.5 }}>FINANCE INFO</Typography.Text>
                        <Typography.Title level={2}>{mode === "login" ? "Đăng nhập" : "Tạo tài khoản"}</Typography.Title>
                        <Typography.Paragraph type="secondary">Dữ liệu watchlist và giao dịch sẽ được lưu riêng theo tài khoản của bạn.</Typography.Paragraph>
                        <Segmented block value={mode} onChange={(value) => setMode(value as typeof mode)} options={[{ label: "Đăng nhập", value: "login" }, { label: "Đăng ký", value: "register" }]} style={{ marginBottom: 20 }} />
                        <Form form={form} layout="vertical" onFinish={submit} autoComplete="on">
                            <Form.Item name="email" label="Email" rules={[{ required: true, type: "email", message: "Nhập email hợp lệ." }]}>
                                <Input type="email" autoComplete="email" placeholder="you@example.com" />
                            </Form.Item>
                            <Form.Item name="password" label="Mật khẩu" rules={[{ required: true, min: 8, message: "Mật khẩu tối thiểu 8 ký tự." }]}>
                                <Input.Password autoComplete={mode === "login" ? "current-password" : "new-password"} />
                            </Form.Item>
                            <Button type="primary" htmlType="submit" loading={loading} block>{mode === "login" ? "Đăng nhập" : "Tạo tài khoản"}</Button>
                        </Form>
                    </Card>
                </main>
            </App>
        </ConfigProvider>
    );
}
