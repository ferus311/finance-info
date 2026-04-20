import { Button, Card, Space, Statistic, Typography } from "antd";

type DashboardSummaryProps = {
    totalCrypto: number;
    totalStocks: number;
    lastCryptoUpdated: string | null;
    lastStockUpdated: string | null;
    vnDate: string;
    refreshing: boolean;
    onRefresh: () => void;
};

export function DashboardSummary({
    totalCrypto,
    totalStocks,
    lastCryptoUpdated,
    lastStockUpdated,
    vnDate,
    refreshing,
    onRefresh,
}: DashboardSummaryProps) {
    return (
        <Card>
            <Space direction="vertical" size={8} style={{ width: "100%", gap: 6 }}>
                <Typography.Title level={2} style={{ margin: 0 }}>
                    Finance Dashboard
                </Typography.Title>
                <Typography.Text type="secondary">
                    Near realtime price tracking for crypto and Vietnam stocks
                </Typography.Text>
                <Space wrap>
                    <Statistic title="Crypto quotes available" value={totalCrypto} />
                    <Statistic title="Stock quotes available" value={totalStocks} />
                    <Button onClick={onRefresh} loading={refreshing}>
                        Refresh now
                    </Button>
                </Space>
                <Typography.Text type="secondary">Auto refresh every 10 seconds</Typography.Text>
                <Typography.Text type="secondary">
                    Crypto updated at: {lastCryptoUpdated ? new Date(lastCryptoUpdated).toLocaleString() : "-"}
                </Typography.Text>
                <Typography.Text type="secondary">
                    Vietnam stocks updated at: {lastStockUpdated ? new Date(lastStockUpdated).toLocaleString() : "-"}
                </Typography.Text>
                <Typography.Text type="secondary">Vietnam stocks request date: {vnDate}</Typography.Text>
            </Space>
        </Card>
    );
}
