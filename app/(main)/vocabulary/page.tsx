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
type MindmapFlashcard = {
    id: string;
    language: "en" | "ja" | "vi";
    notebookId: string;
    notebookTitle: string;
    nodeId: string;
    front: string;
    context: string;
    children: string[];
};
type MindmapDraft = Pick<MindmapFlashcard, "front" | "context"> & { children: string };

const STORAGE_KEY = "finance-info-vocabulary-v1";
const MODEL_OPTIONS: Record<Provider, { value: string; label: string }[]> = {
    openai: [
        { value: "gpt-4o-mini", label: "GPT-4o mini · default" },
        { value: "gpt-4.1-mini", label: "GPT-4.1 mini" },
    ],
    gemini: [
        { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash · default" },
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
    const [activeTab, setActiveTab] = React.useState<Language | "mindmap">("en");
    const [sourceText, setSourceText] = React.useState("");
    const [entries, setEntries] = React.useState<Record<Language, VocabularyEntry[]>>({ en: [], ja: [] });
    const [mindmapCards, setMindmapCards] = React.useState<MindmapFlashcard[]>([]);
    const [hydrated, setHydrated] = React.useState(false);
    const [mindmapLoading, setMindmapLoading] = React.useState(false);
    const [loading, setLoading] = React.useState(false);
    const [search, setSearch] = React.useState("");
    const [editingId, setEditingId] = React.useState<string | null>(null);
    const [draft, setDraft] = React.useState<Draft | null>(null);
    const [editingMindmapId, setEditingMindmapId] = React.useState<string | null>(null);
    const [mindmapDraft, setMindmapDraft] = React.useState<MindmapDraft | null>(null);
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
                messageApi.error("Could not read legacy vocabulary data on this device.");
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
                        if (!importResponse.ok) throw new Error("Could not migrate legacy vocabulary data to the database.");
                    }
                    const response = await fetch(`/api/vocabulary?language=${targetLanguage}`, { cache: "no-store" });
                    const payload = await response.json() as { vocabulary?: unknown[]; error?: string };
                    if (!response.ok) throw new Error(payload.error || "Could not load vocabulary from the database.");
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
                    messageApi.error(error instanceof Error ? error.message : "Could not load vocabulary data.");
                }
            } finally {
                if (!cancelled) setHydrated(true);
            }
        };

        void loadVocabulary();
        return () => { cancelled = true; };
    }, [messageApi]);

    React.useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const response = await fetch("/api/flashcards/mindmap", { cache: "no-store" });
                const payload = await response.json() as { cards?: MindmapFlashcard[]; error?: string };
                if (!response.ok) throw new Error(payload.error || "Could not load mindmap cards.");
                if (!cancelled) setMindmapCards(payload.cards ?? []);
            } catch (error) {
                if (!cancelled) messageApi.error(error instanceof Error ? error.message : "Could not load mindmap cards.");
            } finally {
                if (!cancelled) setMindmapLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [activeTab, messageApi]);

    const currentEntries = entries[language];
    const filteredEntries = currentEntries.filter((entry) =>
        [entry.word, entry.phonetic, entry.partOfSpeech, entry.meaning, entry.description,
        ...entry.examples.flatMap((example) => [example.sentence, example.translation])]
            .join(" ")
            .toLocaleLowerCase()
            .includes(search.trim().toLocaleLowerCase()),
    );
    const filteredMindmapCards = mindmapCards.filter((card) =>
        [card.notebookTitle, card.front, card.context, ...card.children]
            .join(" ")
            .toLocaleLowerCase()
            .includes(search.trim().toLocaleLowerCase()),
    );

    const handleLookup = async () => {
        if (!sourceText.trim()) {
            messageApi.warning("Enter a word, a list of words, or a paragraph to begin.");
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
            if (!response.ok) throw new Error(payload.error || "Could not look up vocabulary at this time.");
            const newEntries = payload.vocabulary ?? [];
            if (!newEntries.length) {
                messageApi.info("These words already exist in the vocabulary, duplicates were not added.");
                return;
            }
            setEntries((current) => ({
                ...current,
                [language]: [...newEntries, ...current[language]],
            }));
            messageApi.success(`Added ${newEntries.length} words to the ${language === "en" ? "English" : "Japanese"} list.`);
        } catch (error) {
            messageApi.error(error instanceof Error ? error.message : "Could not look up vocabulary at this time.");
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
                if (!response.ok || !payload.vocabulary) throw new Error(payload.error || "Could not save changes.");
                setEntries((current) => ({
                    ...current,
                    [language]: current[language].map((entry) => entry.id === editingId ? payload.vocabulary! : entry),
                }));
                setEditingId(null);
                setDraft(null);
                messageApi.success("Vocabulary updated in the database.");
            } catch (error) {
                messageApi.error(error instanceof Error ? error.message : "Could not save changes.");
            }
        })();
    };

    const removeEntry = (id: string) => {
        void (async () => {
            try {
                const response = await fetch(`/api/vocabulary?language=${language}&id=${encodeURIComponent(id)}`, { method: "DELETE" });
                const payload = await response.json() as { error?: string };
                if (!response.ok) throw new Error(payload.error || "Could not delete vocabulary.");
                setEntries((current) => ({ ...current, [language]: current[language].filter((entry) => entry.id !== id) }));
                if (editingId === id) {
                    setEditingId(null);
                    setDraft(null);
                }
                messageApi.success("Vocabulary deleted.");
            } catch (error) {
                messageApi.error(error instanceof Error ? error.message : "Could not delete vocabulary.");
            }
        })();
    };

    const saveMindmapEdit = () => {
        if (!editingMindmapId || !mindmapDraft) return;
        const children = mindmapDraft.children.split("\n").map((child) => child.trim()).filter(Boolean);
        if (!mindmapDraft.front.trim() || children.length === 0) {
            messageApi.warning("Front side and at least one answer point are required.");
            return;
        }
        void (async () => {
            try {
                const response = await fetch("/api/flashcards/mindmap", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        id: editingMindmapId,
                        front: mindmapDraft.front,
                        context: mindmapDraft.context,
                        children,
                    }),
                });
                const payload = await response.json() as { card?: MindmapFlashcard; error?: string };
                if (!response.ok || !payload.card) throw new Error(payload.error || "Could not save mindmap card.");
                setMindmapCards((current) => current.map((card) => card.id === editingMindmapId ? payload.card! : card));
                setEditingMindmapId(null);
                setMindmapDraft(null);
                messageApi.success("Mindmap card updated.");
            } catch (error) {
                messageApi.error(error instanceof Error ? error.message : "Could not save mindmap card.");
            }
        })();
    };

    const removeMindmapCard = (id: string) => {
        void (async () => {
            try {
                const response = await fetch(`/api/flashcards/mindmap?id=${encodeURIComponent(id)}`, { method: "DELETE" });
                const payload = await response.json() as { error?: string };
                if (!response.ok) throw new Error(payload.error || "Could not delete mindmap card.");
                setMindmapCards((current) => current.filter((card) => card.id !== id));
                if (editingMindmapId === id) {
                    setEditingMindmapId(null);
                    setMindmapDraft(null);
                }
                messageApi.success("Mindmap card deleted.");
            } catch (error) {
                messageApi.error(error instanceof Error ? error.message : "Could not delete mindmap card.");
            }
        })();
    };

    const exportCsv = () => {
        if (activeTab === "mindmap") {
            if (!mindmapCards.length) {
                messageApi.info("There are no mindmap cards to export.");
                return;
            }
            const baseName = `mindmap-flashcards-${new Date().toISOString().slice(0, 10)}`;
            const maxAnswerPoints = Math.max(...mindmapCards.map((card) => card.children.length));
            const headers = [
                "Mindmap",
                "Language",
                "Front",
                "Context",
                ...Array.from({ length: maxAnswerPoints }, (_, index) => `Answer point ${index + 1}`),
            ];
            const rows = mindmapCards.map((card) => [
                card.notebookTitle,
                card.language,
                card.front,
                card.context,
                ...Array.from({ length: maxAnswerPoints }, (_, index) => card.children[index] ?? ""),
            ].map(csvField).join(","));
            downloadFile(`\uFEFF${[headers.map(csvField).join(","), ...rows].join("\r\n")}`, `${baseName}.csv`, "text/csv;charset=utf-8");
            messageApi.success(`Exported ${mindmapCards.length} UTF-8 CSV mindmap cards.`);
            return;
        }

        if (!currentEntries.length) {
            messageApi.info("This vocabulary list has no data to export.");
            return;
        }
        const baseName = `vocabulary-${language}-${new Date().toISOString().slice(0, 10)}`;
        const headers = [
            "Word",
            "Phonetics",
            "Part of Speech",
            "Meaning",
            "Description",
            "Example 1",
            "Translation 1",
            "Example 2",
            "Translation 2",
        ];
        const rows = currentEntries.map((entry) => {
            return [
                entry.word,
                entry.phonetic,
                entry.partOfSpeech,
                entry.meaning,
                entry.description,
                entry.examples[0]?.sentence ?? "",
                entry.examples[0]?.translation ?? "",
                entry.examples[1]?.sentence ?? "",
                entry.examples[1]?.translation ?? "",
            ].map(csvField).join(",");
        });
        downloadFile(`\uFEFF${[headers.map(csvField).join(","), ...rows].join("\r\n")}`, `${baseName}.csv`, "text/csv;charset=utf-8");
        messageApi.success(`Exported ${currentEntries.length} UTF-8 CSV cards.`);
    };

    const columns: TableColumnsType<VocabularyEntry> = [
        {
            title: "Word",
            dataIndex: "word",
            width: 150,
            render: (_value, entry) => editingId === entry.id && draft
                ? <Input aria-label="Word" value={draft.word} onChange={(event) => updateDraft("word", event.target.value)} />
                : <Typography.Text strong>{entry.word}</Typography.Text>,
        },
        {
            title: "Phonetics",
            dataIndex: "phonetic",
            width: 130,
            render: (_value, entry) => editingId === entry.id && draft
                ? <Input aria-label="Phonetics" value={draft.phonetic} onChange={(event) => updateDraft("phonetic", event.target.value)} />
                : entry.phonetic || <Typography.Text type="secondary">—</Typography.Text>,
        },
        {
            title: "Part of Speech & Meanings",
            width: 180,
            render: (_value, entry) => editingId === entry.id && draft
                ? <Space orientation="vertical" size={4} style={{ width: "100%" }}>
                    <Input aria-label="Part of speech" placeholder="Part of speech" value={draft.partOfSpeech} onChange={(event) => updateDraft("partOfSpeech", event.target.value)} />
                    <Input.TextArea aria-label="Meanings" placeholder="Meanings, separated by ;" autoSize={{ minRows: 2, maxRows: 5 }} value={draft.meaning} onChange={(event) => updateDraft("meaning", event.target.value)} />
                </Space>
                : <Space orientation="vertical" size={0}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>{entry.partOfSpeech}</Typography.Text>
                    <Typography.Text>{entry.meaning}</Typography.Text>
                </Space>,
        },
        {
            title: "Usage Description",
            dataIndex: "description",
            width: 280,
            render: (_value, entry) => editingId === entry.id && draft
                ? <Input.TextArea aria-label="Usage Description" autoSize={{ minRows: 3, maxRows: 8 }} value={draft.description} onChange={(event) => updateDraft("description", event.target.value)} />
                : <Typography.Text>{entry.description || <Typography.Text type="secondary">No description</Typography.Text>}</Typography.Text>,
        },
        {
            title: "Two example sentences",
            dataIndex: "examples",
            width: 300,
            render: (_value, entry) => editingId === entry.id && draft
                ? <Space orientation="vertical" size={8} style={{ width: "100%" }}>
                    {draft.examples.map((example, index) => (
                        <div key={index}>
                            <Input.TextArea aria-label={`Example sentence ${index + 1}`} placeholder={`Example sentence ${index + 1}`} autoSize={{ minRows: 2, maxRows: 4 }} value={example.sentence} onChange={(event) => updateExample(index, "sentence", event.target.value)} />
                            <Input.TextArea aria-label={`Translation for sentence ${index + 1}`} placeholder="Translation" autoSize={{ minRows: 1, maxRows: 3 }} value={example.translation} onChange={(event) => updateExample(index, "translation", event.target.value)} style={{ marginTop: 4 }} />
                        </div>
                    ))}
                </Space>
                : <Space orientation="vertical" size={10}>
                    {entry.examples.map((example, index) => (
                        <div key={index}>
                            <Typography.Text>{example.sentence || `Example ${index + 1}`}</Typography.Text>
                            {example.translation && <div><Typography.Text type="secondary">{example.translation}</Typography.Text></div>}
                        </div>
                    ))}
                </Space>,
        },
        {
            title: "Actions",
            key: "actions",
            width: 112,
            fixed: "right",
            render: (_value, entry) => editingId === entry.id
                ? <Space size={4}>
                    <Button type="text" size="small" icon={<CheckOutlined />} aria-label="Save changes" title="Save changes" onClick={saveEdit} />
                    <Button type="text" size="small" icon={<CloseOutlined />} aria-label="Cancel editing" title="Cancel editing" onClick={() => { setEditingId(null); setDraft(null); }} />
                </Space>
                : <Space size={4}>
                    <Button type="text" size="small" icon={<EditOutlined />} aria-label="Edit word" title="Edit word" onClick={() => { setEditingId(entry.id); setDraft(makeDraft(entry)); }} />
                    <Popconfirm title="Delete this vocabulary?" okText="Delete" cancelText="Cancel" onConfirm={() => removeEntry(entry.id)}>
                        <Button type="text" danger size="small" icon={<DeleteOutlined />} aria-label="Delete word" title="Delete word" />
                    </Popconfirm>
                </Space>,
        },
    ];

    const mindmapColumns: TableColumnsType<MindmapFlashcard> = [
        {
            title: "Mindmap",
            dataIndex: "notebookTitle",
            width: 170,
            render: (_value, card) => <Typography.Text type="secondary">{card.notebookTitle || "Unnamed mindmap"}</Typography.Text>,
        },
        {
            title: "Front",
            dataIndex: "front",
            width: 250,
            render: (_value, card) => editingMindmapId === card.id && mindmapDraft
                ? <Input.TextArea aria-label="Mindmap card front" autoSize={{ minRows: 2, maxRows: 6 }} value={mindmapDraft.front} onChange={(event) => setMindmapDraft((current) => current ? { ...current, front: event.target.value } : current)} />
                : <Typography.Text strong style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{card.front}</Typography.Text>,
        },
        {
            title: "Context",
            dataIndex: "context",
            width: 210,
            render: (_value, card) => editingMindmapId === card.id && mindmapDraft
                ? <Input.TextArea aria-label="Mindmap card context" autoSize={{ minRows: 2, maxRows: 6 }} value={mindmapDraft.context} onChange={(event) => setMindmapDraft((current) => current ? { ...current, context: event.target.value } : current)} />
                : <Typography.Text style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{card.context || "—"}</Typography.Text>,
        },
        {
            title: "Answer points",
            dataIndex: "children",
            width: 300,
            render: (_value, card) => editingMindmapId === card.id && mindmapDraft
                ? <Input.TextArea aria-label="Answer points, one per line" autoSize={{ minRows: 3, maxRows: 8 }} value={mindmapDraft.children} onChange={(event) => setMindmapDraft((current) => current ? { ...current, children: event.target.value } : current)} />
                : <ul style={{ margin: 0, paddingLeft: 20 }}>
                    {card.children.map((child, index) => <li key={`${card.id}-${index}`} style={{ overflowWrap: "anywhere" }}>{child}</li>)}
                </ul>,
        },
        {
            title: "Actions",
            key: "actions",
            width: 112,
            fixed: "right",
            render: (_value, card) => editingMindmapId === card.id
                ? <Space size={4}>
                    <Button type="text" size="small" icon={<CheckOutlined />} aria-label="Save mindmap card" title="Save changes" onClick={saveMindmapEdit} />
                    <Button type="text" size="small" icon={<CloseOutlined />} aria-label="Cancel mindmap card editing" title="Cancel editing" onClick={() => { setEditingMindmapId(null); setMindmapDraft(null); }} />
                </Space>
                : <Space size={4}>
                    <Button
                        type="text"
                        size="small"
                        icon={<EditOutlined />}
                        aria-label="Edit mindmap card"
                        title="Edit card"
                        onClick={() => {
                            setEditingMindmapId(card.id);
                            setMindmapDraft({ front: card.front, context: card.context, children: card.children.join("\n") });
                        }}
                    />
                    <Popconfirm title="Delete this mindmap card?" okText="Delete" cancelText="Cancel" onConfirm={() => removeMindmapCard(card.id)}>
                        <Button type="text" danger size="small" icon={<DeleteOutlined />} aria-label="Delete mindmap card" title="Delete card" />
                    </Popconfirm>
                </Space>,
        },
    ];

    const tabItems = [
        { key: "en", label: `English (${entries.en.length})` },
        { key: "ja", label: `Japanese (${entries.ja.length})` },
        { key: "mindmap", label: `Mindmap (${mindmapCards.length})` },
    ];

    return (
        <div style={{ padding: "24px clamp(16px, 3vw, 36px)", maxWidth: 1600, margin: "0 auto" }}>
            {contextHolder}
            <Space align="start" size={12} style={{ marginBottom: 20 }}>
                <BookOutlined style={{ fontSize: 22, marginTop: 5, color: "#1677ff" }} />
                <div>
                    <Typography.Title level={3} style={{ margin: 0 }}>Vocabulary Book</Typography.Title>
                    <Typography.Text type="secondary">Look up from a single word, a list, or an entire paragraph.</Typography.Text>
                </div>
            </Space>

            {activeTab !== "mindmap" && <>
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
                                aria-label="Select AI model"
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
                        placeholder="Enter a word to look up, paste a word list or text/email..."
                        autoSize={{ minRows: 4, maxRows: 10 }}
                        maxLength={10000}
                        showCount
                        onKeyDown={(event) => {
                            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") void handleLookup();
                        }}
                    />
                    <Space wrap style={{ width: "100%", justifyContent: "space-between", marginTop: 12 }}>
                        <Typography.Text type="secondary">New words are added to the top of the list and saved to your account database.</Typography.Text>
                        <Button type="primary" icon={<ThunderboltOutlined />} loading={loading} onClick={() => void handleLookup()}>
                            Look up and add to book
                        </Button>
                    </Space>
                </div>
            </>}

            <Tabs
                activeKey={activeTab}
                items={tabItems}
                onChange={(key) => {
                    setActiveTab(key as Language | "mindmap");
                    if (key === "mindmap") setMindmapLoading(true);
                    setSearch("");
                    setEditingId(null);
                    setDraft(null);
                    setEditingMindmapId(null);
                    setMindmapDraft(null);
                    if (key === "en" || key === "ja") setLanguage(key);
                }}
                tabBarExtraContent={
                    <Space wrap>
                        <Statistic
                            title={activeTab === "mindmap" ? "Mindmap cards" : "Words in list"}
                            value={activeTab === "mindmap" ? mindmapCards.length : currentEntries.length}
                            styles={{ content: { fontSize: 18 } }}
                        />
                        <Input
                            allowClear
                            aria-label={activeTab === "mindmap" ? "Search mindmap cards" : "Search vocabulary list"}
                            prefix={<SearchOutlined />}
                            placeholder={activeTab === "mindmap" ? "Search mindmap cards" : "Search word or meaning"}
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            style={{ width: 210 }}
                        />
                        <Button icon={<ExportOutlined />} onClick={exportCsv}>Export UTF-8 CSV</Button>
                    </Space>
                }
            />

            {activeTab === "mindmap" ? (
                <>
                    <Alert
                        type="info"
                        showIcon
                        style={{ marginBottom: 12 }}
                        title="Cards added from mindmap. You can edit the front, context, and individual answer points, or delete cards here."
                    />
                    <Table<MindmapFlashcard>
                        rowKey="id"
                        columns={mindmapColumns}
                        dataSource={filteredMindmapCards}
                        expandable={{ childrenColumnName: "__nestedRows" }}
                        loading={mindmapLoading}
                        size="middle"
                        scroll={{ x: 1050 }}
                        pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 20, 50], showTotal: (total) => `${total} cards` }}
                        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={search ? "No matching cards found" : "No mindmap cards yet. Add a card from a node's context menu."} /> }}
                    />
                </>
            ) : (
                <>
                    <Table<VocabularyEntry>
                        rowKey="id"
                        columns={columns}
                        dataSource={filteredEntries}
                        loading={!hydrated}
                        size="middle"
                        scroll={{ x: 1100 }}
                        pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 20, 50], showTotal: (total) => `${total} words` }}
                        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={search ? "No matching words found" : "No vocabulary yet. Look up words in the input above."} /> }}
                    />
                </>
            )}
        </div>
    );
};

export default VocabularyPage;
