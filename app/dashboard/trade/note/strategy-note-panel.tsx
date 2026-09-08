import { Typography } from "antd";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import { useEffect } from "react";
import type { CSSProperties } from "react";

export type NoteChecklistItem = {
    id: string;
    text: string;
    done: boolean;
};

export type StrategyNote = {
    content: string;
    thesis?: string;
    rules?: string;
    journal?: string;
    checklist?: NoteChecklistItem[];
};

const DEFAULT_NOTE_BLOCKS = [
    {
        id: "intro-1",
        type: "paragraph",
        props: { textAlignment: "left" },
        content: [{ type: "text", text: "Mục tiêu chính của chiến lược:" }],
    },
    {
        id: "intro-2",
        type: "bulletListItem",
        content: [{ type: "text", text: "Không vào nếu tín hiệu không rõ." }],
    },
    {
        id: "intro-3",
        type: "bulletListItem",
        content: [{ type: "text", text: "Kiểm tra vùng dừng lỗ và chốt lời trước khi đặt lệnh." }],
    },
    {
        id: "intro-4",
        type: "checkListItem",
        props: { checked: false },
        content: [{ type: "text", text: "Xác nhận xu hướng chính và khung giá" }],
    },
] as any[];

function normalizeNoteBlocks(blocks: any[] = []): any[] {
    return blocks
        .filter(Boolean)
        .map((block) => {
            const nextBlock = { ...block };
            const type = nextBlock.type;

            if (type === "checklistItem") {
                nextBlock.type = "checkListItem";
            }

            if (Array.isArray(nextBlock.children) && nextBlock.children.length > 0) {
                nextBlock.children = normalizeNoteBlocks(nextBlock.children);
            }

            return nextBlock;
        });
}

export const createDefaultStrategyNote = (): StrategyNote => ({
    content: JSON.stringify(DEFAULT_NOTE_BLOCKS),
    thesis: "",
    rules: "",
    journal: "",
    checklist: [],
});

function parseContent(content?: string | null) {
    if (!content || !content.trim()) return normalizeNoteBlocks(DEFAULT_NOTE_BLOCKS);

    try {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed) && parsed.length > 0) {
            return normalizeNoteBlocks(parsed);
        }
    } catch {
        return normalizeNoteBlocks(DEFAULT_NOTE_BLOCKS);
    }

    return normalizeNoteBlocks(DEFAULT_NOTE_BLOCKS);
}

export function mergeStrategyNote(note?: Partial<StrategyNote> | null): StrategyNote {
    const base = createDefaultStrategyNote();
    const nextChecklist = Array.isArray(note?.checklist) && note.checklist.length > 0
        ? note.checklist.map((item) => ({
            id: item.id || `${Date.now()}-${Math.random()}`,
            text: item.text ?? "",
            done: Boolean(item.done),
        }))
        : [];

    return {
        content: note?.content && note.content.trim() ? note.content : base.content,
        thesis: note?.thesis ?? base.thesis,
        rules: note?.rules ?? base.rules,
        journal: note?.journal ?? base.journal,
        checklist: nextChecklist,
    };
}

export function StrategyNotePanel({
    title,
    note,
    onChange,
    style,
}: {
    title: string;
    note: StrategyNote;
    onChange: (value: StrategyNote) => void;
    style?: CSSProperties;
}) {
    const editor = useCreateBlockNote({
        initialContent: parseContent(note.content),
    });

    useEffect(() => {
        try {
            const nextBlocks = parseContent(note.content);
            const currentBlocks = JSON.stringify(editor.document);
            const nextValue = JSON.stringify(nextBlocks);

            if (currentBlocks !== nextValue) {
                editor.replaceBlocks(editor.document, nextBlocks as any);
            }
        } catch {
            editor.replaceBlocks(editor.document, DEFAULT_NOTE_BLOCKS as any);
        }
    }, [editor, note.content]);

    useEffect(() => {
        const unsubscribe = editor.onChange((editorInstance) => {
            onChange({
                ...note,
                content: JSON.stringify(editorInstance.document),
            });
        });

        return unsubscribe;
    }, [editor, note, onChange]);

    return (
        <div className="strategy-note-panel" style={style}>
            <div className="strategy-note-header">
                <div>
                    <Typography.Text className="eyebrow secondary">STRATEGY NOTE</Typography.Text>
                    <Typography.Title level={4} style={{ margin: 0 }}>{title}</Typography.Title>
                </div>
                <Typography.Text type="secondary">Notion editor</Typography.Text>
            </div>

            <div className="blocknote-shell">
                <BlockNoteView editor={editor} theme="light" />
            </div>
        </div>
    );
}
