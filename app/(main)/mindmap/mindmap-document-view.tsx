'use client';

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';

type DocumentNode = {
    id: string;
    parentId: string | null;
    text: string;
    imageUrl: string | null;
    y: number;
};

type DocumentNotebook = {
    id: string;
    title: string;
    description: string;
} | null;

type MindmapDocumentViewProps = {
    notebook: DocumentNotebook;
    nodes: DocumentNode[];
    loading: boolean;
    onEditingChange: (editing: boolean) => void;
    onSavingChange: (saving: boolean) => void;
    onSaveNodeText: (id: string, text: string) => Promise<void>;
};

export type MindmapDocumentActions = {
    expandAll: () => void;
    collapseAll: () => void;
    beginEditing: () => void;
    cancelEditing: () => void;
    saveChanges: () => Promise<void>;
};

function makeChildrenMap(nodes: DocumentNode[]) {
    const childrenByParent = new Map<string | null, DocumentNode[]>();
    for (const node of nodes) {
        const children = childrenByParent.get(node.parentId) ?? [];
        children.push(node);
        childrenByParent.set(node.parentId, children);
    }
    childrenByParent.forEach((children) => children.sort((a, b) => a.y - b.y));
    return childrenByParent;
}

function getInitiallyCollapsedIds(
    childrenByParent: Map<string | null, DocumentNode[]>,
) {
    const collapsed = new Set<string>();
    const visited = new Set<string>();

    function visit(nodes: DocumentNode[], depth: number) {
        for (const node of nodes) {
            if (visited.has(node.id)) continue;
            visited.add(node.id);
            const children = childrenByParent.get(node.id) ?? [];
            if (children.length > 0 && depth >= 2) collapsed.add(node.id);
            visit(children, depth + 1);
        }
    }

    visit(childrenByParent.get(null) ?? [], 0);
    return collapsed;
}

function DisclosureIcon({ collapsed }: { collapsed: boolean }) {
    return (
        <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            {collapsed ? <path d="m6 3 5 5-5 5" /> : <path d="m3 6 5 5 5-5" />}
        </svg>
    );
}

function DocumentNodeItem({
    node,
    depth,
    childrenByParent,
    collapsedIds,
    isEditing,
    drafts,
    onToggle,
    onDraftChange,
}: {
    node: DocumentNode;
    depth: number;
    childrenByParent: Map<string | null, DocumentNode[]>;
    collapsedIds: Set<string>;
    isEditing: boolean;
    drafts: Record<string, string>;
    onToggle: (id: string) => void;
    onDraftChange: (id: string, text: string) => void;
}) {
    const children = childrenByParent.get(node.id) ?? [];
    const hasChildren = children.length > 0;
    const collapsed = collapsedIds.has(node.id);
    const lines = node.text.split(/\r\n|\n|\r/);
    const draftText = drafts[node.id] ?? node.text;
    const isMultilineLeaf = !hasChildren && lines.length > 1;
    const text = node.text.trim() || (node.imageUrl ? 'Image attachment' : 'Untitled idea');

    return (
        <div
            role="listitem"
            className="min-w-0"
            style={{ marginLeft: depth > 0 ? 16 : 0 }}
        >
            <div className="flex min-w-0 items-start gap-2">
                {hasChildren ? (
                    <button
                        type="button"
                        aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${text}`}
                        aria-expanded={!collapsed}
                        onClick={() => onToggle(node.id)}
                        className="mt-[2px] flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-[#77766E] hover:bg-[#F0EEE8] hover:text-[#38372F] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#7B61FF]"
                    >
                        <DisclosureIcon collapsed={collapsed} />
                    </button>
                ) : isMultilineLeaf ? (
                    <span aria-hidden="true" className="w-6 flex-shrink-0" />
                ) : (
                    <span aria-hidden="true" className="mt-[11px] ml-[9px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#8B7960]" />
                )}

                <div className="min-w-0 flex-1">
                    {isEditing ? (
                        <textarea
                            aria-label={`Edit ${text}`}
                            value={draftText}
                            onChange={(event) => onDraftChange(node.id, event.target.value)}
                            rows={Math.max(2, Math.min(8, draftText.split(/\r\n|\n|\r/).length))}
                            className="w-full resize-y rounded-lg border border-[#C9C3B5] bg-white px-3 py-2 text-sm leading-6 text-[#34332D] outline-none focus:border-[#7B61FF] focus:ring-2 focus:ring-[#7B61FF]/15"
                        />
                    ) : isMultilineLeaf ? (
                        <div className="space-y-1.5 py-0.5">
                            {lines.map((line, index) => line.trim() ? (
                                <div key={`${node.id}-line-${index}`} className="flex items-start gap-2 text-sm leading-6 text-[#34332D]">
                                    <span aria-hidden="true" className="mt-[10px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#8B7960]" />
                                    <span className="min-w-0 whitespace-pre-wrap break-words">{line}</span>
                                </div>
                            ) : null)}
                            {!lines.some((line) => line.trim()) && <p className="text-sm leading-6 text-[#77766E]">{text}</p>}
                        </div>
                    ) : (
                        <div className="py-0.5 text-sm leading-6 text-[#34332D]">
                            {lines.map((line, index) => (
                                <div key={`${node.id}-line-${index}`} className="min-h-6 whitespace-pre-wrap break-words">
                                    {line || '\u00a0'}
                                </div>
                            ))}
                            {!node.text.trim() && <span className="text-[#77766E]">{text}</span>}
                        </div>
                    )}

                    {node.imageUrl && (
                        <img
                            src={node.imageUrl}
                            alt={text}
                            className="mt-2 max-h-56 max-w-full rounded-lg border border-[#E9E7E1] object-contain"
                        />
                    )}
                </div>
            </div>

            {hasChildren && !collapsed && (
                <div role="list" className={depth < 2 ? 'mt-4 space-y-6' : 'mt-2 space-y-2'}>
                    {children.map((child) => (
                        <DocumentNodeItem
                            key={child.id}
                            node={child}
                            depth={depth + 1}
                            childrenByParent={childrenByParent}
                            collapsedIds={collapsedIds}
                            isEditing={isEditing}
                            drafts={drafts}
                            onToggle={onToggle}
                            onDraftChange={onDraftChange}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

const MindmapDocumentView = forwardRef<MindmapDocumentActions, MindmapDocumentViewProps>(function MindmapDocumentView({
    notebook,
    nodes,
    loading,
    onEditingChange,
    onSavingChange,
    onSaveNodeText,
}, ref) {
    const childrenByParent = useMemo(() => makeChildrenMap(nodes), [nodes]);
    const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
    const [isEditing, setIsEditing] = useState(false);
    const [drafts, setDrafts] = useState<Record<string, string>>({});
    const [isSaving, setIsSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const loadingStarted = useRef(false);

    useEffect(() => {
        if (loading) {
            loadingStarted.current = true;
            return;
        }
        if (loadingStarted.current && nodes.length > 0) {
            setCollapsedIds(getInitiallyCollapsedIds(childrenByParent));
            loadingStarted.current = false;
        }
    }, [childrenByParent, loading, nodes.length]);

    function toggleNode(id: string) {
        setCollapsedIds((previous) => {
            const next = new Set(previous);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }

    function setAllExpanded(expanded: boolean) {
        if (expanded) {
            setCollapsedIds(new Set());
            return;
        }
        setCollapsedIds(new Set(nodes.filter((node) => (childrenByParent.get(node.id)?.length ?? 0) > 0).map((node) => node.id)));
    }

    function beginEditing() {
        setDrafts(Object.fromEntries(nodes.map((node) => [node.id, node.text])));
        setSaveError(null);
        setIsEditing(true);
    }

    async function saveChanges() {
        setIsSaving(true);
        setSaveError(null);
        try {
            for (const node of nodes) {
                const draft = drafts[node.id] ?? node.text;
                if (draft !== node.text) await onSaveNodeText(node.id, draft);
            }
            setIsEditing(false);
            setDrafts({});
        } catch {
            setSaveError('Could not save all changes. Your remaining edits are still here; try saving again.');
        } finally {
            setIsSaving(false);
        }
    }

    function cancelEditing() {
        setIsEditing(false);
        setDrafts({});
        setSaveError(null);
    }

    useImperativeHandle(ref, () => ({
        expandAll: () => setAllExpanded(true),
        collapseAll: () => setAllExpanded(false),
        beginEditing,
        cancelEditing,
        saveChanges,
    }));

    useEffect(() => {
        onEditingChange(isEditing);
    }, [isEditing, onEditingChange]);

    useEffect(() => {
        onSavingChange(isSaving);
    }, [isSaving, onSavingChange]);

    return (
        <div className="min-h-full px-4 pb-16 sm:px-8">
            <article className="mx-auto min-h-[calc(100vh-6rem)] w-full max-w-4xl bg-white px-5 py-8 shadow-sm sm:px-12 sm:py-12">
                <header className="mb-8 border-b border-[#E9E7E1] pb-6">
                    <p className="mb-2 text-xs font-bold uppercase text-[#8B7960]">Mindmap document</p>
                    <h1 className="text-2xl font-bold text-[#25251F]" style={{ fontFamily: 'var(--font-display)' }}>{notebook?.title ?? 'Mindmap'}</h1>
                    {notebook?.description && <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[#68675F]">{notebook.description}</p>}
                    <p className="mt-3 text-xs text-[#939187]">{nodes.length} {nodes.length === 1 ? 'idea' : 'ideas'}</p>
                </header>
                {loading ? (
                    <p className="text-sm text-[#77766E]">Loading ideas…</p>
                ) : nodes.length === 0 ? (
                    <p className="text-sm text-[#77766E]">No ideas in this notebook yet.</p>
                ) : (
                    <div role="list" aria-label={`${notebook?.title ?? 'Mindmap'} ideas`} className="space-y-8">
                        {(childrenByParent.get(null) ?? []).map((node) => (
                            <DocumentNodeItem
                                key={node.id}
                                node={node}
                                depth={0}
                                childrenByParent={childrenByParent}
                                collapsedIds={collapsedIds}
                                isEditing={isEditing}
                                drafts={drafts}
                                onToggle={toggleNode}
                                onDraftChange={(id, text) => {
                                    setDrafts((previous) => ({ ...previous, [id]: text }));
                                    setSaveError(null);
                                }}
                            />
                        ))}
                    </div>
                )}
                {saveError && <p role="alert" className="mt-5 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{saveError}</p>}
            </article>
        </div>
    );
});

MindmapDocumentView.displayName = 'MindmapDocumentView';

export default MindmapDocumentView;
