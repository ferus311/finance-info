"use client";

import React from "react";
import {
    BookOutlined,
    CheckOutlined,
    CloseOutlined,
    ReloadOutlined,
    SwapOutlined,
} from "@ant-design/icons";
import {
    Alert,
    Button,
    Card,
    Empty,
    Progress,
    Segmented,
    Space,
    Spin,
    Tag,
    Typography,
    message,
} from "antd";

type Language = "en" | "ja";
type Rating = "again" | "hard" | "good" | "easy";
type Example = { sentence: string; translation: string };
type VocabularyEntry = {
    id: string;
    word: string;
    phonetic: string;
    partOfSpeech: string;
    meaning: string;
    description: string;
    examples: Example[];
};
type Schedule = {
    dueAt: string;
    intervalDays: number;
    easeFactor: number;
    repetitions: number;
    lapses: number;
    lastReviewedAt: string | null;
};
type StudyData = {
    language: Language;
    total: number;
    newCount: number;
    dueCount: number;
    cards: Array<{ entry: VocabularyEntry; state: Schedule | null }>;
};

const ratingOptions: Array<{ value: Rating; label: string; description: string }> = [
    { value: "again", label: "Again", description: "10 phút" },
    { value: "hard", label: "Hard", description: "Khó" },
    { value: "good", label: "Good", description: "Ổn" },
    { value: "easy", label: "Easy", description: "Dễ" },
];

const FlashcardsPage = () => {
    const [language, setLanguage] = React.useState<Language>("en");
    const [session, setSession] = React.useState<StudyData | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [loadError, setLoadError] = React.useState("");
    const [revealed, setRevealed] = React.useState(false);
    const [rating, setRating] = React.useState<Rating | null>(null);
    const [messageApi, contextHolder] = message.useMessage();

    React.useEffect(() => {
        let cancelled = false;
        fetch(`/api/flashcards?language=${language}`, { cache: "no-store" })
            .then(async (response) => {
                const payload = await response.json() as StudyData & { error?: string };
                if (!response.ok) throw new Error(payload.error || "Không thể tải thẻ ôn tập.");
                if (!cancelled) {
                    setSession({ ...payload, language });
                    setRevealed(false);
                }
            })
            .catch((error: unknown) => {
                if (!cancelled) {
                    const errorText = error instanceof Error ? error.message : "Không thể tải thẻ ôn tập.";
                    setLoadError(errorText);
                    messageApi.error(errorText);
                }
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
    }, [language, messageApi]);

    const activeSession = session?.language === language ? session : null;
    const currentCard = activeSession?.cards[0] ?? null;
    const studiedCount = activeSession ? activeSession.total - activeSession.newCount - activeSession.dueCount : 0;
    const progress = activeSession?.total ? Math.round((studiedCount / activeSession.total) * 100) : 0;

    const submitRating = async (selectedRating: Rating) => {
        if (!currentCard) return;
        setRating(selectedRating);
        try {
            const response = await fetch("/api/flashcards", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    targetLanguage: language,
                    entryId: currentCard.entry.id,
                    rating: selectedRating,
                }),
            });
            const payload = await response.json() as { error?: string };
            if (!response.ok) throw new Error(payload.error || "Không thể lưu kết quả ôn tập.");

            const refresh = await fetch(`/api/flashcards?language=${language}`, { cache: "no-store" });
            const studyData = await refresh.json() as StudyData & { error?: string };
            if (!refresh.ok) throw new Error(studyData.error || "Không thể tải thẻ tiếp theo.");
            setSession({ ...studyData, language });
            setRevealed(false);
        } catch (error) {
            messageApi.error(error instanceof Error ? error.message : "Không thể lưu kết quả ôn tập.");
        } finally {
            setRating(null);
        }
    };

    const switchLanguage = (value: string | number) => {
        setLoadError("");
        setLanguage(value as Language);
        setLoading(true);
    };

    return (
        <main style={{ maxWidth: 1050, margin: "0 auto", padding: "28px clamp(16px, 3vw, 36px) 48px" }}>
            {contextHolder}
            <Space align="start" size={12} style={{ marginBottom: 24 }}>
                <BookOutlined style={{ color: "#1677ff", fontSize: 24, marginTop: 4 }} />
                <div>
                    <Typography.Title level={3} style={{ margin: 0 }}>Flashcards</Typography.Title>
                    <Typography.Text type="secondary">Ôn từ vựng theo lịch lặp lại ngắt quãng.</Typography.Text>
                </div>
            </Space>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 20 }}>
                <Segmented
                    value={language}
                    onChange={switchLanguage}
                    options={[{ label: "Tiếng Anh", value: "en" }, { label: "Tiếng Nhật", value: "ja" }]}
                />
                <Space wrap>
                    <Typography.Text type="secondary">
                        {activeSession ? `${activeSession.dueCount} đến hạn · ${activeSession.newCount} thẻ mới · ${activeSession.total} từ` : "Đang tải bộ thẻ"}
                    </Typography.Text>
                    <Button href={`/api/flashcards?language=${language}`} icon={<ReloadOutlined />} onClick={(event) => {
                        event.preventDefault();
                        setLoading(true);
                        fetch(`/api/flashcards?language=${language}`, { cache: "no-store" })
                            .then(async (response) => {
                                const payload = await response.json() as StudyData & { error?: string };
                                if (!response.ok) throw new Error(payload.error || "Không thể làm mới thẻ.");
                                setSession({ ...payload, language });
                                setRevealed(false);
                            })
                            .catch((error: unknown) => messageApi.error(error instanceof Error ? error.message : "Không thể làm mới thẻ."))
                            .finally(() => setLoading(false));
                    }}>
                        Làm mới
                    </Button>
                    <Button type="link" href="/vocabulary" icon={<SwapOutlined />}>Sổ từ vựng</Button>
                </Space>
            </div>

            {activeSession && activeSession.total > 0 && (
                <Progress percent={progress} showInfo={false} size="small" style={{ marginBottom: 22 }} />
            )}

            {loading ? (
                <div style={{ minHeight: 360, display: "grid", placeItems: "center" }}><Spin size="large" /></div>
            ) : loadError ? (
                <Alert
                    type="error"
                    showIcon
                    message={loadError}
                    action={<Button size="small" icon={<ReloadOutlined />} onClick={() => {
                        setLoadError("");
                        setLoading(true);
                        fetch(`/api/flashcards?language=${language}`, { cache: "no-store" })
                            .then(async (response) => {
                                const payload = await response.json() as StudyData & { error?: string };
                                if (!response.ok) throw new Error(payload.error || "Không thể tải thẻ ôn tập.");
                                setSession({ ...payload, language });
                                setRevealed(false);
                            })
                            .catch((error: unknown) => setLoadError(error instanceof Error ? error.message : "Không thể tải thẻ ôn tập."))
                            .finally(() => setLoading(false));
                    }}>Thử lại</Button>}
                />
            ) : !activeSession ? (
                <div style={{ minHeight: 360, display: "grid", placeItems: "center" }}><Spin size="large" /></div>
            ) : !currentCard ? (
                <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={activeSession.total === 0 ? "Sổ từ vựng chưa có thẻ. Hãy thêm từ trong mục Vocabulary." : "Đã ôn hết các thẻ đang đến hạn. Hẹn gặp lại ở lượt ôn tiếp theo."}
                >
                    {activeSession.total === 0 && <Button type="primary" href="/vocabulary">Mở sổ từ vựng</Button>}
                </Empty>
            ) : (
                <>
                    <div style={{ textAlign: "center", marginBottom: 12 }}>
                        <Tag color={currentCard.state ? "processing" : "blue"}>{currentCard.state ? "ĐẾN HẠN" : "THẺ MỚI"}</Tag>
                        <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
                            {activeSession.cards.length} thẻ trong lượt này
                        </Typography.Text>
                    </div>

                    <Card
                        style={{ maxWidth: 720, minHeight: 360, margin: "0 auto", borderRadius: 8 }}
                        styles={{ body: { minHeight: 310, display: "flex", flexDirection: "column", justifyContent: "center", padding: "32px clamp(20px, 5vw, 56px)" } }}
                    >
                        <div style={{ textAlign: "center" }}>
                            <Typography.Title level={1} style={{ margin: "0 0 8px", overflowWrap: "anywhere" }}>
                                {currentCard.entry.word}
                            </Typography.Title>
                            {currentCard.entry.phonetic && (
                                <Typography.Text type="secondary" style={{ fontSize: 16 }}>{currentCard.entry.phonetic}</Typography.Text>
                            )}
                            {currentCard.entry.partOfSpeech && (
                                <div style={{ marginTop: 12 }}><Tag>{currentCard.entry.partOfSpeech}</Tag></div>
                            )}
                        </div>

                        {revealed && (
                            <div style={{ borderTop: "1px solid #f0f0f0", marginTop: 28, paddingTop: 22 }}>
                                <Typography.Title level={4} style={{ marginTop: 0 }}>{currentCard.entry.meaning}</Typography.Title>
                                {currentCard.entry.description && <Typography.Paragraph>{currentCard.entry.description}</Typography.Paragraph>}
                                {currentCard.entry.examples?.filter((example) => example.sentence || example.translation).map((example, index) => (
                                    <div key={`${currentCard.entry.id}-${index}`} style={{ marginTop: 12 }}>
                                        <Typography.Text>{example.sentence}</Typography.Text>
                                        {example.translation && <div><Typography.Text type="secondary">{example.translation}</Typography.Text></div>}
                                    </div>
                                ))}
                                {currentCard.state && (
                                    <Typography.Text type="secondary" style={{ display: "block", marginTop: 16 }}>
                                        Khoảng ôn hiện tại: {currentCard.state.intervalDays} ngày · độ dễ {currentCard.state.easeFactor.toFixed(2)}
                                    </Typography.Text>
                                )}
                            </div>
                        )}
                    </Card>

                    <div style={{ maxWidth: 720, margin: "20px auto 0", textAlign: "center" }}>
                        {!revealed ? (
                            <Button type="primary" size="large" onClick={() => setRevealed(true)} style={{ minWidth: 180 }}>
                                Lật thẻ
                            </Button>
                        ) : (
                            <Space wrap size={[8, 12]} style={{ justifyContent: "center" }}>
                                {ratingOptions.map((option) => (
                                    <Button
                                        key={option.value}
                                        danger={option.value === "again"}
                                        type={option.value === "good" ? "primary" : "default"}
                                        icon={option.value === "again" ? <CloseOutlined /> : <CheckOutlined />}
                                        loading={rating === option.value}
                                        disabled={rating !== null}
                                        onClick={() => void submitRating(option.value)}
                                        style={{ minWidth: 104, height: 54 }}
                                    >
                                        <span>{option.label}<br /><Typography.Text type="secondary" style={{ fontSize: 11 }}>{option.description}</Typography.Text></span>
                                    </Button>
                                ))}
                            </Space>
                        )}
                    </div>
                </>
            )}

            {activeSession && activeSession.total > 0 && activeSession.newCount === 0 && activeSession.dueCount === 0 && (
                <Alert type="success" showIcon style={{ maxWidth: 720, margin: "28px auto 0" }} message="Bạn đã hoàn thành lượt ôn hôm nay." />
            )}
        </main>
    );
};

export default FlashcardsPage;
