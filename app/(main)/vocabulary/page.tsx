"use client";

import React from "react";
import {
    BookOutlined,
    CheckOutlined,
    CloseOutlined,
    DeleteOutlined,
    EditOutlined,
    ExportOutlined,
    SearchOutlined,
    ThunderboltOutlined,
} from "@ant-design/icons";
import {
    Alert,
    Button,
    Empty,
    Input,
    message,
    Popconfirm,
    Select,
    Segmented,
    Space,
    Statistic,
    Table,
    Tabs,
    Typography,
} from "antd";
import type { TableColumnsType } from "antd";

type Language = "en" | "ja";
type Provider = "openai" | "gemini";
type Example = { sentence: string; translation: string };
type VocabularyEntry = {
    id: string;
    word: string;
    phonetic: string;
    partOfSpeech: string;
    meaning: string;
    description: string;
    examples: Example[];
    targetLanguage: Language;
};
type Draft = Omit<VocabularyEntry, "id" | "targetLanguage">;

const STORAGE_KEY = "finance-info-vocabulary-v1";
const MODEL_OPTIONS: Record<Provider, { value: string; label: string }[]> = {
    openai: [
        { value: "gpt-4o-mini", label: "GPT-4o mini · mặc định" },
        { value: "gpt-4.1-mini", label: "GPT-4.1 mini" },
    ],
    gemini: [
        { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash · mặc định" },
        { value: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite" },
    ],
};

function makeDraft(entry: VocabularyEntry): Draft {
    return {
        word: entry.word,
        phonetic: entry.phonetic,
        partOfSpeech: entry.partOfSpeech,
        meaning: entry.meaning,
        description: entry.description,
        examples: entry.examples,
    };
}

function fromStoredEntry(value: unknown, language: Language, index: number): VocabularyEntry | null {
    if (!value || typeof value !== "object") return null;
    const row = value as Record<string, unknown>;
    if (typeof row.word !== "string" || !row.word.trim()) return null;
    const oldExamples = Array.isArray(row.examples)
        ? row.examples
        : [{ sentence: row.example, translation: row.translation }];
    const examples = oldExamples.slice(0, 2).map((value) => {
        const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
        return {
            sentence: typeof item.sentence === "string" ? item.sentence : "",
            translation: typeof item.translation === "string" ? item.translation : "",
        };
    });
    while (examples.length < 2) examples.push({ sentence: "", translation: "" });
    return {
        id: typeof row.id === "string" && row.id ? row.id : `${language}-${index}-${crypto.randomUUID()}`,
        word: row.word.trim(),
        phonetic: typeof row.phonetic === "string" ? row.phonetic : "",
        partOfSpeech: typeof row.partOfSpeech === "string" ? row.partOfSpeech : "",
        meaning: Array.isArray(row.meaning)
            ? row.meaning.filter((item): item is string => typeof item === "string").join("; ")
            : typeof row.meaning === "string" ? row.meaning : "",
        description: typeof row.description === "string" ? row.description : "",
        examples,
        targetLanguage: language,
    };
}

function csvField(value: string) {
    return `"${value.replace(/"/g, '""')}"`;
}

function downloadFile(content: string, fileName: string, mimeType: string) {
    const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
}

const VocabularyPage = () => {
    const [provider, setProvider] = React.useState<Provider>("openai");
    const [models, setModels] = React.useState<Record<Provider, string>>({
        openai: "gpt-4o-mini",
        gemini: "gemini-2.5-flash",
    });
    const [language, setLanguage] = React.useState<Language>("en");
    const [sourceText, setSourceText] = React.useState("");
    const [entries, setEntries] = React.useState<Record<Language, VocabularyEntry[]>>({ en: [], ja: [] });
    const [hydrated, setHydrated] = React.useState(false);
    const [loading, setLoading] = React.useState(false);
    const [search, setSearch] = React.useState("");
    const [editingId, setEditingId] = React.useState<string | null>(null);
    const [draft, setDraft] = React.useState<Draft | null>(null);
    const [messageApi, contextHolder] = message.useMessage();

    React.useEffect(() => {
        let cancelled = false;
        const loadVocabulary = async () => {
            let legacy: Record<Language, VocabularyEntry[]> = { en: [], ja: [] };
            try {
                const saved = window.localStorage.getItem(STORAGE_KEY);
                if (saved) {
                    const parsed = JSON.parse(saved) as Partial<Record<Language, unknown[]>>;
                    legacy = {
                        en: (Array.isArray(parsed.en) ? parsed.en : []).map((item, index) => fromStoredEntry(item, "en", index)).filter((item): item is VocabularyEntry => item !== null),
                        ja: (Array.isArray(parsed.ja) ? parsed.ja : []).map((item, index) => fromStoredEntry(item, "ja", index)).filter((item): item is VocabularyEntry => item !== null),
                    };
                }
            } catch {
                messageApi.error("Không thể đọc dữ liệu từ vựng cũ trên thiết bị này.");
            }

            if (cancelled) return;
            setEntries(legacy);
            try {
                const loadLanguage = async (targetLanguage: Language) => {
                    if (legacy[targetLanguage].length) {
                        const importResponse = await fetch("/api/vocabulary", {
                            method: "PUT",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ targetLanguage, entries: legacy[targetLanguage] }),
                        });
                        if (!importResponse.ok) throw new Error("Không thể chuyển dữ liệu từ vựng cũ vào cơ sở dữ liệu.");
                    }
                    const response = await fetch(`/api/vocabulary?language=${targetLanguage}`, { cache: "no-store" });
                    const payload = await response.json() as { vocabulary?: unknown[]; error?: string };
                    if (!response.ok) throw new Error(payload.error || "Không thể tải sổ từ vựng từ cơ sở dữ liệu.");
                    return (payload.vocabulary ?? [])
                        .map((item, index) => fromStoredEntry(item, targetLanguage, index))
                        .filter((item): item is VocabularyEntry => item !== null);
                };
                const [en, ja] = await Promise.all([loadLanguage("en"), loadLanguage("ja")]);
                if (cancelled) return;
                setEntries({ en, ja });
                window.localStorage.removeItem(STORAGE_KEY);
            } catch (error) {
                if (!cancelled) {
                    messageApi.error(error instanceof Error ? error.message : "Không thể tải dữ liệu từ vựng.");
                }
            } finally {
                if (!cancelled) setHydrated(true);
            }
        };

        void loadVocabulary();
        return () => { cancelled = true; };
    }, [messageApi]);

    const currentEntries = entries[language];
    const filteredEntries = currentEntries.filter((entry) =>
        [entry.word, entry.phonetic, entry.partOfSpeech, entry.meaning, entry.description,
        ...entry.examples.flatMap((example) => [example.sentence, example.translation])]
            .join(" ")
            .toLocaleLowerCase()
            .includes(search.trim().toLocaleLowerCase()),
    );

    const handleLookup = async () => {
        if (!sourceText.trim()) {
            messageApi.warning("Nhập một từ, danh sách từ hoặc đoạn văn để bắt đầu.");
            return;
        }
        setLoading(true);
        try {
            const response = await fetch("/api/vocabulary", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    text: sourceText,
                    provider,
                    model: models[provider],
                    targetLanguage: language,
                }),
            });
            const payload = await response.json() as { vocabulary?: VocabularyEntry[]; error?: string };
            if (!response.ok) throw new Error(payload.error || "Không thể tra từ lúc này.");
            const newEntries = payload.vocabulary ?? [];
            if (!newEntries.length) {
                messageApi.info("Các từ này đã có trong sổ, không thêm mục trùng.");
                return;
            }
            setEntries((current) => ({
                ...current,
                [language]: [...newEntries, ...current[language]],
            }));
            messageApi.success(`Đã thêm ${newEntries.length} từ vào bảng ${language === "en" ? "Tiếng Anh" : "Tiếng Nhật"}.`);
        } catch (error) {
            messageApi.error(error instanceof Error ? error.message : "Không thể tra từ lúc này.");
        } finally {
            setLoading(false);
        }
    };

    const updateDraft = (field: keyof Draft, value: string) => {
        setDraft((current) => current ? { ...current, [field]: value } : current);
    };

    const updateExample = (index: number, field: keyof Example, value: string) => {
        setDraft((current) => current ? {
            ...current,
            examples: current.examples.map((example, exampleIndex) =>
                exampleIndex === index ? { ...example, [field]: value } : example,
            ),
        } : current);
    };

    const saveEdit = () => {
        if (!editingId || !draft) return;
        void (async () => {
            try {
                const response = await fetch("/api/vocabulary", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ targetLanguage: language, entry: { ...draft, id: editingId } }),
                });
                const payload = await response.json() as { vocabulary?: VocabularyEntry; error?: string };
                if (!response.ok || !payload.vocabulary) throw new Error(payload.error || "Không thể lưu thay đổi.");
                setEntries((current) => ({
                    ...current,
                    [language]: current[language].map((entry) => entry.id === editingId ? payload.vocabulary! : entry),
                }));
                setEditingId(null);
                setDraft(null);
                messageApi.success("Đã cập nhật từ vựng trong cơ sở dữ liệu.");
            } catch (error) {
                messageApi.error(error instanceof Error ? error.message : "Không thể lưu thay đổi.");
            }
        })();
    };

    const removeEntry = (id: string) => {
        void (async () => {
            try {
                const response = await fetch(`/api/vocabulary?language=${language}&id=${encodeURIComponent(id)}`, { method: "DELETE" });
                const payload = await response.json() as { error?: string };
                if (!response.ok) throw new Error(payload.error || "Không thể xóa từ vựng.");
                setEntries((current) => ({ ...current, [language]: current[language].filter((entry) => entry.id !== id) }));
                if (editingId === id) {
                    setEditingId(null);
                    setDraft(null);
                }
                messageApi.success("Đã xóa từ vựng.");
            } catch (error) {
                messageApi.error(error instanceof Error ? error.message : "Không thể xóa từ vựng.");
            }
        })();
    };

    const exportCsv = () => {
        if (!currentEntries.length) {
            messageApi.info("Bảng từ vựng này chưa có dữ liệu để xuất.");
            return;
        }
        const baseName = `vocabulary-${language}-${new Date().toISOString().slice(0, 10)}`;
        const rows = currentEntries.map((entry) => {
            const front = [entry.word, entry.phonetic].filter(Boolean).join(" / ");
            const back = [
                entry.partOfSpeech && `[${entry.partOfSpeech}]`,
                entry.meaning,
                entry.description,
                ...entry.examples.flatMap((example, index) => [
                    example.sentence && `Ví dụ ${index + 1}: ${example.sentence}`,
                    example.translation && `Dịch: ${example.translation}`,
                ]),
            ].filter(Boolean).join("\n");
            return `${csvField(front)},${csvField(back)}`;
        });
        downloadFile(`\uFEFF${rows.join("\r\n")}`, `${baseName}.csv`, "text/csv;charset=utf-8");
        messageApi.success(`Đã xuất ${currentEntries.length} thẻ CSV UTF-8.`);
    };

    const columns: TableColumnsType<VocabularyEntry> = [
        {
            title: "Từ vựng",
            dataIndex: "word",
            width: 150,
            render: (_value, entry) => editingId === entry.id && draft
                ? <Input aria-label="Từ vựng" value={draft.word} onChange={(event) => updateDraft("word", event.target.value)} />
                : <Typography.Text strong>{entry.word}</Typography.Text>,
        },
        {
            title: "Phiên âm",
            dataIndex: "phonetic",
            width: 130,
            render: (_value, entry) => editingId === entry.id && draft
                ? <Input aria-label="Phiên âm" value={draft.phonetic} onChange={(event) => updateDraft("phonetic", event.target.value)} />
                : entry.phonetic || <Typography.Text type="secondary">—</Typography.Text>,
        },
        {
            title: "Từ loại & các nghĩa",
            width: 180,
            render: (_value, entry) => editingId === entry.id && draft
                ? <Space orientation="vertical" size={4} style={{ width: "100%" }}>
                    <Input aria-label="Từ loại" placeholder="Từ loại" value={draft.partOfSpeech} onChange={(event) => updateDraft("partOfSpeech", event.target.value)} />
                    <Input.TextArea aria-label="Các nghĩa tiếng Việt" placeholder="Các nghĩa, ngăn cách bằng dấu ;" autoSize={{ minRows: 2, maxRows: 5 }} value={draft.meaning} onChange={(event) => updateDraft("meaning", event.target.value)} />
                </Space>
                : <Space orientation="vertical" size={0}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>{entry.partOfSpeech}</Typography.Text>
                    <Typography.Text>{entry.meaning}</Typography.Text>
                </Space>,
        },
        {
            title: "Mô tả cách dùng",
            dataIndex: "description",
            width: 280,
            render: (_value, entry) => editingId === entry.id && draft
                ? <Input.TextArea aria-label="Mô tả cách dùng" autoSize={{ minRows: 3, maxRows: 8 }} value={draft.description} onChange={(event) => updateDraft("description", event.target.value)} />
                : <Typography.Text>{entry.description || <Typography.Text type="secondary">Chưa có mô tả</Typography.Text>}</Typography.Text>,
        },
        {
            title: "Hai câu ví dụ",
            dataIndex: "examples",
            width: 300,
            render: (_value, entry) => editingId === entry.id && draft
                ? <Space orientation="vertical" size={8} style={{ width: "100%" }}>
                    {draft.examples.map((example, index) => (
                        <div key={index}>
                            <Input.TextArea aria-label={`Câu ví dụ ${index + 1}`} placeholder={`Câu ví dụ ${index + 1}`} autoSize={{ minRows: 2, maxRows: 4 }} value={example.sentence} onChange={(event) => updateExample(index, "sentence", event.target.value)} />
                            <Input.TextArea aria-label={`Dịch câu ${index + 1}`} placeholder="Bản dịch tiếng Việt" autoSize={{ minRows: 1, maxRows: 3 }} value={example.translation} onChange={(event) => updateExample(index, "translation", event.target.value)} style={{ marginTop: 4 }} />
                        </div>
                    ))}
                </Space>
                : <Space orientation="vertical" size={10}>
                    {entry.examples.map((example, index) => (
                        <div key={index}>
                            <Typography.Text>{example.sentence || `Ví dụ ${index + 1}`}</Typography.Text>
                            {example.translation && <div><Typography.Text type="secondary">{example.translation}</Typography.Text></div>}
                        </div>
                    ))}
                </Space>,
        },
        {
            title: "Thao tác",
            key: "actions",
            width: 112,
            fixed: "right",
            render: (_value, entry) => editingId === entry.id
                ? <Space size={4}>
                    <Button type="text" size="small" icon={<CheckOutlined />} aria-label="Lưu thay đổi" title="Lưu thay đổi" onClick={saveEdit} />
                    <Button type="text" size="small" icon={<CloseOutlined />} aria-label="Hủy sửa" title="Hủy sửa" onClick={() => { setEditingId(null); setDraft(null); }} />
                </Space>
                : <Space size={4}>
                    <Button type="text" size="small" icon={<EditOutlined />} aria-label="Sửa từ" title="Sửa từ" onClick={() => { setEditingId(entry.id); setDraft(makeDraft(entry)); }} />
                    <Popconfirm title="Xóa từ vựng này?" okText="Xóa" cancelText="Hủy" onConfirm={() => removeEntry(entry.id)}>
                        <Button type="text" danger size="small" icon={<DeleteOutlined />} aria-label="Xóa từ" title="Xóa từ" />
                    </Popconfirm>
                </Space>,
        },
    ];

    const tabItems = (["en", "ja"] as Language[]).map((key) => ({
        key,
        label: `${key === "en" ? "Tiếng Anh" : "Tiếng Nhật"} (${entries[key].length})`,
    }));

    return (
        <div style={{ padding: "24px clamp(16px, 3vw, 36px)", maxWidth: 1600, margin: "0 auto" }}>
            {contextHolder}
            <Space align="start" size={12} style={{ marginBottom: 20 }}>
                <BookOutlined style={{ fontSize: 22, marginTop: 5, color: "#1677ff" }} />
                <div>
                    <Typography.Title level={3} style={{ margin: 0 }}>Sổ từ vựng</Typography.Title>
                    <Typography.Text type="secondary">Tra từ từ một từ đơn, danh sách hoặc cả đoạn văn.</Typography.Text>
                </div>
            </Space>

            <div style={{ border: "1px solid #f0f0f0", borderRadius: 6, padding: 20, marginBottom: 24 }}>
                <Space wrap size={[16, 12]} style={{ marginBottom: 16 }}>
                    <Space size={8}>
                        <Typography.Text type="secondary">AI</Typography.Text>
                        <Segmented
                            value={provider}
                            options={[{ label: "OpenAI", value: "openai" }, { label: "Gemini", value: "gemini" }]}
                            onChange={(value) => setProvider(value as Provider)}
                        />
                    </Space>
                    <Space size={8}>
                        <Typography.Text type="secondary">Model</Typography.Text>
                        <Select
                            aria-label="Chọn model AI"
                            value={models[provider]}
                            options={MODEL_OPTIONS[provider]}
                            onChange={(value) => setModels((current) => ({ ...current, [provider]: value }))}
                            style={{ width: 220 }}
                        />
                    </Space>
                </Space>

                <Input.TextArea
                    value={sourceText}
                    onChange={(event) => setSourceText(event.target.value)}
                    placeholder="Nhập từ cần tra, dán danh sách từ hoặc đoạn văn bản/email..."
                    autoSize={{ minRows: 4, maxRows: 10 }}
                    maxLength={10000}
                    showCount
                    onKeyDown={(event) => {
                        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") void handleLookup();
                    }}
                />
                <Space wrap style={{ width: "100%", justifyContent: "space-between", marginTop: 12 }}>
                    <Typography.Text type="secondary">Từ mới được thêm lên đầu bảng và lưu vào cơ sở dữ liệu tài khoản của bạn.</Typography.Text>
                    <Button type="primary" icon={<ThunderboltOutlined />} loading={loading} onClick={() => void handleLookup()}>
                        Tra từ và thêm vào sổ
                    </Button>
                </Space>
            </div>

            <Tabs
                activeKey={language}
                items={tabItems}
                onChange={(key) => { setLanguage(key as Language); setSearch(""); setEditingId(null); setDraft(null); }}
                tabBarExtraContent={
                    <Space wrap>
                        <Statistic title="Từ trong bảng" value={currentEntries.length} styles={{ content: { fontSize: 18 } }} />
                        <Input
                            allowClear
                            aria-label="Tìm trong bảng từ vựng"
                            prefix={<SearchOutlined />}
                            placeholder="Tìm từ hoặc nghĩa"
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            style={{ width: 210 }}
                        />
                        <Button icon={<ExportOutlined />} onClick={exportCsv}>Xuất CSV UTF-8</Button>
                    </Space>
                }
            />

            {currentEntries.length > 0 && (
                <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 12 }}
                    title="CSV UTF-8 gồm 2 cột cho Anki: Mặt trước (từ và phiên âm), Mặt sau (nghĩa, mô tả, hai ví dụ và bản dịch)."
                />
            )}
            <Table<VocabularyEntry>
                rowKey="id"
                columns={columns}
                dataSource={filteredEntries}
                loading={!hydrated}
                size="middle"
                scroll={{ x: 1100 }}
                pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 20, 50], showTotal: (total) => `${total} từ` }}
                locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={search ? "Không tìm thấy từ phù hợp" : "Chưa có từ vựng. Hãy tra từ ở ô phía trên."} /> }}
            />
        </div>
    );
};

export default VocabularyPage;
