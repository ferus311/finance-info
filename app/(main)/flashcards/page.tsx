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
type DeckType = "vocabulary" | "mindmap";
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
type MindmapFlashcardEntry = {
    id: string;
    language: "en" | "ja" | "vi";
    notebookId: string;
    notebookTitle: string;
    nodeId: string;
    front: string;
    context: string;
    children: string[];
};
type Schedule = {
    dueAt: string;
    intervalDays: number;
    easeFactor: number;
    repetitions: number;
    lapses: number;
    lastReviewedAt: string | null;
};
type StudyCard =
    | { type: "vocabulary"; entry: VocabularyEntry; state: Schedule | null }
    | { type: "mindmap"; entry: MindmapFlashcardEntry; state: Schedule | null };
type NotebookSummary = { id: string; title: string; total: number; newCount: number; dueCount: number };
type StudyData = {
    total: number;
    newCount: number;
    dueCount: number;
    cards: StudyCard[];
    notebooks?: NotebookSummary[];
};

const ratingOptions: Array<{ value: Rating; label: string }> = [
    { value: "again", label: "Again" },
    { value: "hard", label: "Hard" },
    { value: "good", label: "Good" },
    { value: "easy", label: "Easy" },
];

function getRepeatTime(state: Schedule | null, rating: Rating) {
    const repetitions = state?.repetitions ?? 0;
    const interval = state?.intervalDays ?? 0;
    const ease = state?.easeFactor ?? 2.5;
    if (rating === "again") return "10 min";

    const days = rating === "hard"
        ? repetitions === 0 ? 1 : Math.max(1, Math.round(interval * 1.2))
        : rating === "good"
            ? repetitions === 0 ? 1 : repetitions === 1 ? 3 : Math.max(1, Math.round(interval * ease))
            : repetitions === 0 ? 4 : Math.max(1, Math.round(interval * ease * 1.3));
    return `${days} ${days === 1 ? "day" : "days"}`;
}

const FlashcardsPage = () => {
    const [language, setLanguage] = React.useState<Language>("en");
    const [deckType, setDeckType] = React.useState<DeckType>("vocabulary");
    const [selectedNotebookId, setSelectedNotebookId] = React.useState<string | null>(null);
    const [session, setSession] = React.useState<(StudyData & {
        deckType: DeckType;
        language: Language;
        notebookId: string | null;
    }) | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [loadError, setLoadError] = React.useState("");
    const [revealed, setRevealed] = React.useState(false);
    const [rating, setRating] = React.useState<Rating | null>(null);
    const [messageApi, contextHolder] = message.useMessage();

    const refreshSession = React.useCallback(async (showSpinner = true, signal?: AbortSignal) => {
        if (showSpinner) setLoading(true);
        setLoadError("");
        const params = new URLSearchParams({ deck: deckType });
        if (deckType === "vocabulary") params.set("language", language);
        if (deckType === "mindmap" && selectedNotebookId) params.set("notebookId", selectedNotebookId);
        try {
            const response = await fetch(`/api/flashcards?${params}`, { cache: "no-store", signal });
            const payload = await response.json() as StudyData & { error?: string };
            if (!response.ok) throw new Error(payload.error || "Could not load flashcards.");
            setSession({ ...payload, deckType, language, notebookId: selectedNotebookId });
            setRevealed(false);
        } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") return;
            const errorText = error instanceof Error ? error.message : "Could not load flashcards.";
            setLoadError(errorText);
            messageApi.error(errorText);
        } finally {
            if (showSpinner && !signal?.aborted) setLoading(false);
        }
    }, [deckType, language, messageApi, selectedNotebookId]);

    React.useEffect(() => {
        const controller = new AbortController();
        let active = true;
        queueMicrotask(() => {
            if (active) void refreshSession(true, controller.signal);
        });
        return () => {
            active = false;
            controller.abort();
        };
    }, [refreshSession]);

    const activeSession = session?.deckType === deckType
        && session.language === language
        && session.notebookId === selectedNotebookId
        ? session
        : null;
    const availableNotebooks = session?.deckType === "mindmap" ? session.notebooks ?? [] : [];
    const currentCard = activeSession?.cards[0] ?? null;
    const studiedCount = activeSession ? activeSession.total - activeSession.newCount - activeSession.dueCount : 0;
    const progress = activeSession?.total ? Math.round((studiedCount / activeSession.total) * 100) : 0;
    const isStudying = !loading && !loadError && !!currentCard;

    const submitRating = async (selectedRating: Rating) => {
        if (!currentCard) return;
        setRating(selectedRating);
        try {
            const response = await fetch("/api/flashcards", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    targetLanguage: currentCard.type === "mindmap" ? currentCard.entry.language : language,
                    entryId: currentCard.entry.id,
                    cardType: currentCard.type,
                    rating: selectedRating,
                }),
            });
            const payload = await response.json() as { error?: string };
            if (!response.ok) throw new Error(payload.error || "Could not save your review.");
            await refreshSession(false);
        } catch (error) {
            messageApi.error(error instanceof Error ? error.message : "Could not save your review.");
        } finally {
            setRating(null);
        }
    };

    const switchLanguage = (value: string | number) => {
        setLoadError("");
        setLanguage(value as Language);
        setRevealed(false);
    };

    return (
        <main className={`mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8 ${isStudying ? "flex min-h-full flex-col py-3" : "py-6 pb-10"} ${isStudying && revealed ? "pb-32" : ""}`}>
            {contextHolder}
            <header className={`flex flex-shrink-0 ${isStudying ? "mb-2 items-center gap-2" : "mb-6 items-start gap-3"}`}>
                <span className={`flex flex-shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600 ${isStudying ? "h-8 w-8" : "mt-1 h-10 w-10 rounded-xl"}`}>
                    <BookOutlined style={{ fontSize: isStudying ? 15 : 18 }} />
                </span>
                <div>
                    <Typography.Title level={isStudying ? 4 : 3} style={{ margin: 0, color: "#211F38" }}>Flashcards</Typography.Title>
                    {!isStudying && <Typography.Text type="secondary">Review vocabulary and notes from your mindmaps.</Typography.Text>}
                </div>
            </header>

            <section className={`flex flex-shrink-0 flex-wrap items-center justify-between border border-slate-200/80 bg-white shadow-sm ${isStudying ? "mb-2 gap-2 rounded-lg p-2" : "mb-5 gap-3 rounded-xl p-3"}`}>
                <Segmented
                    size={isStudying ? "small" : "middle"}
                    value={deckType}
                    onChange={(value) => {
                        setLoadError("");
                        setDeckType(value as DeckType);
                        setSelectedNotebookId(null);
                        setRevealed(false);
                    }}
                    options={[{ label: "Vocabulary", value: "vocabulary" }, { label: "Mindmap", value: "mindmap" }]}
                />
                <Space wrap>
                    <Typography.Text type="secondary" className="text-xs">
                        {activeSession ? `${activeSession.dueCount} due · ${activeSession.newCount} new · ${activeSession.total} cards` : "Loading deck"}
                    </Typography.Text>
                    <Button size={isStudying ? "small" : "middle"} icon={<ReloadOutlined />} onClick={() => void refreshSession()}>Refresh</Button>
                    {deckType === "vocabulary" && <Button size={isStudying ? "small" : "middle"} type="link" href="/vocabulary" icon={<SwapOutlined />}>Vocabulary list</Button>}
                </Space>
            </section>

            {deckType === "vocabulary" ? (
                <div className={`flex flex-shrink-0 flex-wrap items-center gap-2 ${isStudying ? "mb-2" : "mb-5 gap-3"}`}>
                    <span className="text-xs font-medium text-slate-500">Language</span>
                    <Segmented
                        size={isStudying ? "small" : "middle"}
                        value={language}
                        onChange={switchLanguage}
                        options={[{ label: "English", value: "en" }, { label: "Japanese", value: "ja" }]}
                    />
                </div>
            ) : availableNotebooks.length > 0 ? (
                <nav aria-label="Filter by notebook" className={`flex flex-shrink-0 gap-2 overflow-x-auto ${isStudying ? "mb-2" : "mb-6 pb-2"}`}>
                    <button
                        type="button"
                        aria-pressed={selectedNotebookId === null}
                        onClick={() => { setSelectedNotebookId(null); setRevealed(false); }}
                        className={`flex-shrink-0 rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${selectedNotebookId === null ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:text-indigo-700"}`}
                    >
                        All notebooks
                    </button>
                    {availableNotebooks.map((notebook) => (
                        <button
                            key={notebook.id}
                            type="button"
                            aria-pressed={selectedNotebookId === notebook.id}
                            onClick={() => { setSelectedNotebookId(notebook.id); setRevealed(false); }}
                            className={`flex-shrink-0 rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${selectedNotebookId === notebook.id ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:text-indigo-700"}`}
                        >
                            {notebook.title || "Untitled notebook"} <span className="ml-1 opacity-70">{notebook.total}</span>
                        </button>
                    ))}
                </nav>
            ) : null}

            {activeSession && activeSession.total > 0 && (
                <div className={`flex-shrink-0 ${isStudying ? "mb-2" : "mb-7"}`}>
                    <div className="mb-1 flex justify-between text-[11px] font-medium text-slate-500">
                        <span>Study progress</span>
                        <span>{progress}%</span>
                    </div>
                    <Progress percent={progress} showInfo={false} size="small" />
                </div>
            )}

            {loading ? (
                <div className="grid min-h-[420px] place-items-center"><Spin size="large" /></div>
            ) : loadError ? (
                <Alert
                    type="error"
                    showIcon
                    message={loadError}
                    action={<Button size="small" icon={<ReloadOutlined />} onClick={() => void refreshSession()}>Try again</Button>}
                />
            ) : !activeSession ? (
                <div className="grid min-h-[420px] place-items-center"><Spin size="large" /></div>
            ) : !currentCard ? (
                <div className="rounded-3xl border border-slate-200 bg-white px-5 py-12 shadow-sm">
                    <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description={activeSession.total === 0
                            ? deckType === "mindmap"
                                ? "No mindmap flashcards yet. Create one from a node's context menu."
                                : "Your vocabulary deck is empty. Add words in Vocabulary."
                            : "No cards are due right now. Come back later for your next review."}
                    >
                        {activeSession.total === 0 && deckType === "vocabulary" && <Button type="primary" href="/vocabulary">Open vocabulary list</Button>}
                    </Empty>
                </div>
            ) : (
                <>
                    <div className="mb-1.5 flex flex-shrink-0 flex-wrap items-center justify-center gap-1">
                        <Tag className="m-0 text-[10px] leading-5" color={currentCard.state ? "processing" : "blue"}>{currentCard.state ? "DUE" : "NEW"}</Tag>
                        <Tag className="m-0 text-[10px] leading-5" color={currentCard.type === "mindmap" ? "purple" : "default"}>
                            {currentCard.type === "mindmap" ? currentCard.entry.notebookTitle || "MINDMAP" : "VOCABULARY"}
                        </Tag>
                        <Typography.Text type="secondary" className="text-xs">
                            {activeSession.cards.length} cards in this session
                        </Typography.Text>
                    </div>

                    <Card
                        className="mx-auto w-full max-w-2xl self-center overflow-hidden rounded-xl border-slate-200 shadow-[0_12px_36px_-28px_rgba(47,42,91,0.35)]"
                        styles={{ body: { padding: 0 } }}
                    >
                        <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-1 border-b border-indigo-100 bg-gradient-to-r from-indigo-50 via-white to-sky-50 px-4 py-2 sm:px-5">
                            <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-indigo-600">
                                {currentCard.type === "mindmap" ? "Mindmap · Front" : "Vocabulary · Front"}
                            </span>
                            <span className="text-[10px] font-medium text-slate-400">{revealed ? "Back" : "Try to recall before revealing"}</span>
                        </div>

                        <div className="px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
                            {currentCard.type === "mindmap" ? (
                                <>
                                    <div className="mx-auto max-w-xl text-center">
                                        {currentCard.entry.context && (
                                            <div className="mb-3 inline-flex max-w-full rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700">
                                                <span className="break-words [overflow-wrap:anywhere]">{currentCard.entry.context}</span>
                                            </div>
                                        )}
                                        <h2 className="whitespace-pre-wrap break-words text-2xl font-bold leading-tight tracking-tight text-[#25233A] [overflow-wrap:anywhere] sm:text-3xl">
                                            {currentCard.entry.front}
                                        </h2>
                                    </div>
                                    {revealed && (
                                        <section className="mx-auto mt-4 max-w-xl rounded-lg border border-emerald-100 bg-emerald-50/60 p-3 sm:p-4">
                                            <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-700">Direct child ideas</p>
                                            <ul className="space-y-2">
                                                {currentCard.entry.children.map((child, index) => (
                                                    <li key={`${currentCard.entry.id}-${index}`} className="flex gap-2 text-xs leading-relaxed text-slate-800 sm:text-sm">
                                                        <span className="mt-2 h-2 w-2 flex-shrink-0 rounded-full bg-emerald-500" />
                                                        <span className="whitespace-pre-wrap break-words">{child}</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        </section>
                                    )}
                                </>
                            ) : (
                                <>
                                    <div className="mx-auto max-w-xl text-center">
                                        {currentCard.entry.partOfSpeech && (
                                            <Tag className="mb-2 rounded-full px-2 py-0 text-[10px]">{currentCard.entry.partOfSpeech}</Tag>
                                        )}
                                        <h2 className="break-words text-3xl font-bold leading-tight tracking-tight text-[#25233A] [overflow-wrap:anywhere] sm:text-4xl">
                                            {currentCard.entry.word}
                                        </h2>
                                        {currentCard.entry.phonetic && (
                                            <p className="mt-1 text-xs font-medium tracking-wide text-slate-500">{currentCard.entry.phonetic}</p>
                                        )}
                                    </div>

                                    {revealed && (
                                        <div className="mx-auto mt-4 max-w-xl space-y-2">
                                            <section className="rounded-lg border border-indigo-100 bg-indigo-50/80 p-3 sm:p-4">
                                                <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-indigo-600">Main meaning</p>
                                                <p className="text-sm font-semibold leading-relaxed text-[#292741] sm:text-base">{currentCard.entry.meaning}</p>
                                            </section>

                                            {currentCard.entry.examples?.filter((example) => example.sentence || example.translation).length > 0 && (
                                                <section className="rounded-lg border border-slate-200 bg-white p-3 sm:p-4">
                                                    <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Examples</p>
                                                    <div className="space-y-2">
                                                        {currentCard.entry.examples.filter((example) => example.sentence || example.translation).map((example, index) => (
                                                            <div key={`${currentCard.entry.id}-${index}`} className="border-l-2 border-sky-200 pl-2.5">
                                                                {example.sentence && <p className="text-xs font-medium leading-relaxed text-slate-800 sm:text-sm">{example.sentence}</p>}
                                                                {example.translation && <p className="mt-1 text-xs leading-relaxed text-slate-500">{example.translation}</p>}
                                                            </div>
                                                        ))}
                                                    </div>
                                                </section>
                                            )}

                                            {currentCard.entry.description && (
                                                <section className="rounded-md bg-slate-50 px-3 py-2">
                                                    <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Notes</p>
                                                    <p className="text-xs leading-relaxed text-slate-600">{currentCard.entry.description}</p>
                                                </section>
                                            )}
                                        </div>
                                    )}
                                </>
                            )}

                            {currentCard.state && (
                                <p className="mt-3 text-center text-[10px] text-slate-400">
                                    Current interval: {currentCard.state.intervalDays} days · ease {currentCard.state.easeFactor.toFixed(2)}
                                </p>
                            )}
                        </div>
                    </Card>

                    <div className={`mx-auto mt-2 flex w-full max-w-2xl flex-shrink-0 justify-center self-center ${revealed ? "fixed inset-y-auto right-3 bottom-0 left-[92px] z-50 mt-0 max-w-none border-t border-slate-200 bg-white/95 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] shadow-[0_-8px_24px_rgba(15,23,42,0.12)] backdrop-blur max-[991px]:right-2 max-[991px]:left-[80px] max-[575px]:left-0" : ""}`}>
                        {!revealed ? (
                            <Button size="small" type="primary" onClick={() => setRevealed(true)} className="h-8 w-full max-w-44 rounded-md text-xs font-medium shadow-sm shadow-indigo-200">
                                Reveal answer
                            </Button>
                        ) : (
                            <div className="mx-auto grid w-full max-w-2xl grid-cols-2 gap-2 sm:grid-cols-4">
                                {ratingOptions.map((option) => (
                                    <Button
                                        key={option.value}
                                        danger={option.value === "again"}
                                        type={option.value === "good" ? "primary" : "default"}
                                        icon={option.value === "again" ? <CloseOutlined /> : <CheckOutlined />}
                                        loading={rating === option.value}
                                        disabled={rating !== null}
                                        onClick={() => void submitRating(option.value)}
                                        size="small"
                                        className="!flex h-auto min-h-11 w-full min-w-0 items-center justify-center whitespace-normal rounded-md px-2 py-1.5 text-xs"
                                    >
                                        <span className="block min-w-0 max-w-full break-words text-center leading-tight">
                                            <span className="block font-semibold">{option.label}</span>
                                            <span className="mt-0.5 block text-[10px] text-slate-500">in {getRepeatTime(currentCard.state, option.value)}</span>
                                        </span>
                                    </Button>
                                ))}
                            </div>
                        )}
                    </div>
                </>
            )}

            {activeSession && activeSession.total > 0 && activeSession.newCount === 0 && activeSession.dueCount === 0 && (
                <Alert type="success" showIcon className="mx-auto mt-7 max-w-3xl rounded-xl" message="You have completed today's review." />
            )}
        </main>
    );
};

export default FlashcardsPage;
