import { Card, Input, Space, Table, Tag } from "antd";
import type { TableProps } from "antd";
import type { MarketRow } from "../types/market";

type MarketSectionProps = {
    title: string;
    loading: boolean;
    symbols: string[];
    rows: MarketRow[];
    inputValue: string;
    inputPlaceholder: string;
    onInputChange: (nextValue: string) => void;
    onAddSymbol: (value: string) => void;
    onRemoveSymbol: (symbol: string) => void;
    dateValue?: string;
    onDateChange?: (value: string) => void;
};

const columns: TableProps<MarketRow>["columns"] = [
    {
        title: "Symbol",
        dataIndex: "symbol",
        key: "symbol",
        render: (value: string) => <Tag color="blue">{value}</Tag>,
    },
    {
        title: "Price",
        dataIndex: "price",
        key: "price",
        render: (value: number | null, row: MarketRow) =>
            value === null ? "N/A" : `${value.toLocaleString()} ${row.currency}`,
    },
    {
        title: "Change %",
        dataIndex: "changePercent",
        key: "changePercent",
        render: (value: number | null) => {
            if (value === null) {
                return "N/A";
            }

            const color = value >= 0 ? "green" : "red";
            return <Tag color={color}>{value.toFixed(2)}%</Tag>;
        },
    },
    {
        title: "Status",
        dataIndex: "status",
        key: "status",
        render: (value: MarketRow["status"]) =>
            value === "ok" ? <Tag color="success">OK</Tag> : <Tag>Unavailable</Tag>,
    },
    {
        title: "Source",
        dataIndex: "source",
        key: "source",
    },
];

export function MarketSection({
    title,
    loading,
    symbols,
    rows,
    inputValue,
    inputPlaceholder,
    onInputChange,
    onAddSymbol,
    onRemoveSymbol,
    dateValue,
    onDateChange,
}: MarketSectionProps) {
    return (
        <Card title={title} loading={loading} className="dashboard-card">
            <Space direction="vertical" style={{ width: "100%" }} size={12}>
                {onDateChange ? (
                    <Input
                        type="date"
                        value={dateValue}
                        onChange={(event) => onDateChange(event.target.value)}
                    />
                ) : null}
                <Input.Search
                    value={inputValue}
                    onChange={(event) => onInputChange(event.target.value)}
                    onSearch={(value) => onAddSymbol(value)}
                    placeholder={inputPlaceholder}
                    enterButton="Add"
                />
                <Space wrap>
                    {symbols.map((symbol) => (
                        <Tag key={symbol} closable onClose={() => onRemoveSymbol(symbol)}>
                            {symbol}
                        </Tag>
                    ))}
                </Space>
                <Table<MarketRow>
                    rowKey="symbol"
                    columns={columns}
                    dataSource={rows}
                    pagination={false}
                    size="small"
                    scroll={{ x: 560 }}
                />
            </Space>
        </Card>
    );
}
