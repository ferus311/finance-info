'use client';

import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type PointerEvent as ReactPointerEvent,
} from 'react';
import { Manrope, Inter } from 'next/font/google';
import MindmapDocumentView, { type MindmapDocumentActions } from './mindmap-document-view';

const manrope = Manrope({ subsets: ['latin'], weight: ['600', '700', '800'], variable: '--font-display' });
const inter = Inter({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-ui' });

const API_BASE = '/api/mindmap';

const LANGUAGES = ['vi', 'ja', 'en'] as const;
type Language = (typeof LANGUAGES)[number];
type AIProvider = 'openai' | 'gemini';
type NodeComparison = { language: Language; text: string };

const LANGUAGE_LABELS: Record<Language, string> = { vi: 'Tiếng Việt', ja: '日本語', en: 'English' };
const ROOT_TEXT: Record<Language, string> = { vi: 'Ý tưởng trung tâm', ja: '中心となる考え', en: 'Central idea' };
const otherLanguages = (language: Language) => LANGUAGES.filter((candidate) => candidate !== language);

const AI_MODELS: Record<AIProvider, { id: string; label: string }[]> = {
    openai: [
        { id: 'gpt-4o-mini', label: 'GPT-4o mini' },
        { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini' },
    ],
    gemini: [
        { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
        { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite' },
    ],
};
type Notebook = { id: string; title: string; groupName: string; sortOrder: number; language: Language; description: string };
type NotebookGroup = { name: string; sortOrder: number };
type SidebarDrag = { kind: 'notebook' | 'group'; id: string };
type SidebarDrop = { kind: 'notebook' | 'group'; id: string; position: 'before' | 'after' | 'inside' };

type MindNode = {
    id: string; notebookId: string; parentId: string | null;
    text: string; sourceText: string; sourceLanguage: Language; x: number; y: number;
    type: 'text' | 'image'; width: number; height: number; autoWidth: boolean;
    imageUrl: string | null; preserveAspect: boolean; color: string | null;
    textAlign: 'left' | 'center' | 'right';
    translationPending: boolean;
};
type MindNodeResponse = {
    id: string; notebook_id: string; parent_id: string | null;
    text: string; source_language?: Language; x: number; y: number; type?: string | null;
    width: number; height: number; auto_width?: number | null;
    image_url: string | null; preserve_aspect?: number | null;
    color: string | null; text_align?: 'left' | 'center' | 'right' | null;
    display_text?: string; translation_pending?: number;
};

function mapMindNode(node: MindNodeResponse): MindNode {
    return {
        id: node.id, notebookId: node.notebook_id, parentId: node.parent_id,
        text: node.display_text ?? node.text, sourceText: node.text,
        sourceLanguage: node.source_language ?? 'vi', x: node.x, y: node.y,
        type: (node.type as 'text' | 'image') || 'text', width: node.width, height: node.height,
        autoWidth: Boolean(node.auto_width ?? 1), imageUrl: node.image_url,
        preserveAspect: Boolean(node.preserve_aspect ?? 1), color: node.color,
        textAlign: node.text_align || 'center', translationPending: Boolean(node.translation_pending),
    };
}

// ───────────────────────── History (diff-based) ─────────────────────────
type NodeChange = { before: MindNode | null; after: MindNode | null }; // before=null: tạo mới, after=null: xóa
type MindmapHistoryEntry = { notebookId: string; label: string; changes: NodeChange[] };
type HistorySync = { notebookId: string; targets: Map<string, MindNode | null> };

const HISTORY_LIMIT = 100;
const HISTORY_COMMIT_DELAY = 180; // gom sửa text + tạo node + relayout thành 1 entry
const HISTORY_SYNC_DELAY = 350;   // gom nhiều lần undo/redo liên tiếp thành 1 request
const POSITION_SAVE_DELAY = 250;

const TRACKED_FIELDS = ['parentId', 'sourceText', 'sourceLanguage', 'x', 'y', 'type', 'width', 'height', 'autoWidth', 'imageUrl', 'preserveAspect', 'color', 'textAlign'] as const;

const changeId = (change: NodeChange) => (change.before ?? change.after)!.id;

function nodeEquals(a: MindNode, b: MindNode) {
    return TRACKED_FIELDS.every((key) => key === 'x' || key === 'y' ? Math.abs(a[key] - b[key]) < 0.5 : a[key] === b[key]);
}

function diffNodes(before: MindNode[], after: MindNode[]): NodeChange[] {
    const beforeById = new Map(before.map((n) => [n.id, n]));
    const afterById = new Map(after.map((n) => [n.id, n]));
    const changes: NodeChange[] = [];
    for (const node of before) {
        const next = afterById.get(node.id);
        if (!next) changes.push({ before: node, after: null });
        else if (!nodeEquals(node, next)) changes.push({ before: node, after: next });
    }
    for (const node of after) if (!beforeById.has(node.id)) changes.push({ before: null, after: node });
    return changes;
}

function describeChanges(changes: NodeChange[]): string {
    const deleted = changes.filter((c) => !c.after).length;
    if (deleted) return deleted > 1 ? `delete ${deleted} nodes` : 'delete node';
    if (changes.some((c) => !c.before)) return 'add node';
    const updated = changes.filter((c): c is { before: MindNode; after: MindNode } => Boolean(c.before && c.after));
    if (updated.some(({ before, after }) => before.sourceText !== after.sourceText)) return 'edit text';
    if (updated.some(({ before, after }) => before.parentId !== after.parentId)) return 'change parent';
    if (updated.some(({ before, after }) => before.width !== after.width || before.height !== after.height)) return 'resize';
    if (updated.some(({ before, after }) => before.color !== after.color || before.textAlign !== after.textAlign)) return 'format';
    return 'move node';
}

// Giữ text đang hiển thị (có thể là bản dịch) nếu nội dung gốc không đổi.
function restoreNode(target: MindNode, current?: MindNode): MindNode {
    if (current && current.sourceText === target.sourceText && current.sourceLanguage === target.sourceLanguage) {
        return { ...target, text: current.text, translationPending: current.translationPending };
    }
    return { ...target, text: target.sourceText, translationPending: Boolean(target.sourceText.trim()) };
}

function toSyncPayload(targets: Map<string, MindNode | null>) {
    const depthOf = (node: MindNode) => {
        let depth = 0, parentId = node.parentId;
        const seen = new Set<string>();
        while (parentId && !seen.has(parentId)) {
            const parent = targets.get(parentId);
            if (!parent) break;
            seen.add(parentId); depth += 1; parentId = parent.parentId;
        }
        return depth;
    };
    const upsert: MindNode[] = [];
    const remove: string[] = [];
    targets.forEach((node, id) => { if (node) upsert.push(node); else remove.push(id); });
    upsert.sort((a, b) => depthOf(a) - depthOf(b)); // cha trước con (FK)
    return {
        remove,
        upsert: upsert.map((n) => ({
            id: n.id, parentId: n.parentId, text: n.sourceText, language: n.sourceLanguage, x: n.x, y: n.y,
            type: n.type, width: n.width, height: n.height, autoWidth: n.autoWidth, imageUrl: n.imageUrl,
            preserveAspect: n.preserveAspect, color: n.color, textAlign: n.textAlign,
        })),
    };
}

const DEFAULT_W = 208, DEFAULT_H = 60;
const MAX_AUTO_NODE_W = 400;
const LEVEL_GAP_X = 64, SIBLING_GAP = 28, TREE_GAP = 64;
const MIN_ZOOM = 0.05, MAX_ZOOM = 3, DEFAULT_PAN = { x: 160, y: 180 };
const NODE_COLORS = ['#FFFFFF', '#FFEFE5', '#E5F4FF', '#EAFCE9', '#F4E5FF', '#FFF0F0'];

// Canvas context được tạo một lần và tái sử dụng thay vì tạo mới mỗi lần đo chữ.
let measureContext: CanvasRenderingContext2D | null | undefined;

function getAutoNodeWidth(text: string) {
    if (typeof document === 'undefined') return DEFAULT_W;
    if (measureContext === undefined) measureContext = document.createElement('canvas').getContext('2d');
    if (!measureContext) return DEFAULT_W;

    measureContext.font = '600 15px Manrope, sans-serif';
    const longestLine = text.split('\n').reduce((width, line) => Math.max(width, measureContext!.measureText(line).width), 0);
    return Math.max(DEFAULT_W, Math.min(MAX_AUTO_NODE_W, Math.ceil(longestLine + 40)));
}

async function apiFetch(path: string, options?: RequestInit) {
    const res = await fetch(path, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
}

// Gửi JSON tới API_BASE (POST/PATCH...) để bớt lặp code.
function apiSend(method: 'POST' | 'PATCH', body: unknown) {
    return apiFetch(API_BASE, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

// Sắp xếp các node cùng cha dựa trên TỌA ĐỘ Y HIỆN TẠI thay vì thứ tự tạo.
function buildChildrenMap(nodes: MindNode[]) {
    const map = new Map<string | null, MindNode[]>();
    for (const n of nodes) {
        const arr = map.get(n.parentId);
        if (arr) arr.push(n);
        else map.set(n.parentId, [n]);
    }
    map.forEach(arr => arr.sort((a, b) => a.y - b.y));
    return map;
}

function layoutTree(nodes: MindNode[]): MindNode[] {
    const byParent = buildChildrenMap(nodes);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const positions = new Map<string, { x: number; y: number }>();

    const getRealSize = (id: string) => {
        if (typeof document !== 'undefined') {
            const el = document.getElementById(`node-${id}`);
            if (el) return { w: el.offsetWidth, h: el.offsetHeight };
        }
        const node = byId.get(id)!;
        return { w: Math.max(node.width, DEFAULT_W), h: Math.max(node.height, DEFAULT_H) };
    };

    const subtreeHeight = new Map<string, number>();
    function calcSubtree(nodeId: string): number {
        const children = byParent.get(nodeId) ?? [];
        const size = getRealSize(nodeId);

        if (children.length === 0) {
            subtreeHeight.set(nodeId, size.h);
            return size.h;
        }
        let childrenTotalH = 0;
        for (const c of children) childrenTotalH += calcSubtree(c.id);
        childrenTotalH += (children.length - 1) * SIBLING_GAP;

        const totalH = Math.max(size.h, childrenTotalH);
        subtreeHeight.set(nodeId, totalH);
        return totalH;
    }

    const roots = byParent.get(null) ?? [];
    for (const root of roots) calcSubtree(root.id);

    function place(nodeId: string, x: number, startY: number) {
        const size = getRealSize(nodeId);
        const children = byParent.get(nodeId) ?? [];
        const stHeight = subtreeHeight.get(nodeId)!;

        positions.set(nodeId, { x, y: startY + (stHeight / 2) - (size.h / 2) });

        let childrenTotalH = 0;
        for (const c of children) childrenTotalH += subtreeHeight.get(c.id)!;
        childrenTotalH += Math.max(0, children.length - 1) * SIBLING_GAP;

        let childStartY = startY + (stHeight / 2) - (childrenTotalH / 2);
        for (const c of children) {
            place(c.id, x + size.w + LEVEL_GAP_X, childStartY);
            childStartY += subtreeHeight.get(c.id)! + SIBLING_GAP;
        }
    }

    let currentY = 0;
    for (const root of roots) {
        place(root.id, 0, currentY);
        currentY += subtreeHeight.get(root.id)! + TREE_GAP;
    }

    return nodes.map((n) => {
        const pos = positions.get(n.id);
        return pos ? { ...n, x: pos.x, y: pos.y } : n;
    });
}

// Duyệt cây một lần (O(n)) thay vì lặp đến khi không còn thay đổi (O(n²)).
function collectSubtreeIds(nodes: MindNode[], rootId: string): Set<string> {
    const childrenOf = new Map<string, string[]>();
    for (const n of nodes) {
        if (!n.parentId) continue;
        const arr = childrenOf.get(n.parentId);
        if (arr) arr.push(n.id);
        else childrenOf.set(n.parentId, [n.id]);
    }
    const ids = new Set<string>([rootId]);
    const stack = [rootId];
    while (stack.length) {
        for (const childId of childrenOf.get(stack.pop()!) ?? []) {
            if (!ids.has(childId)) { ids.add(childId); stack.push(childId); }
        }
    }
    return ids;
}

function getVisibleNodes(nodes: MindNode[], collapsedIds: Set<string>) {
    if (collapsedIds.size === 0) return nodes;
    const byId = new Map(nodes.map((node) => [node.id, node]));
    return nodes.filter((node) => {
        let parentId = node.parentId;
        while (parentId) {
            if (collapsedIds.has(parentId)) return false;
            parentId = byId.get(parentId)?.parentId ?? null;
        }
        return true;
    });
}

function mergePositions(list: MindNode[], laidOut: MindNode[]) {
    const positions = new Map(laidOut.map((node) => [node.id, { x: node.x, y: node.y }]));
    return list.map((node) => {
        const position = positions.get(node.id);
        return position ? { ...node, ...position } : node;
    });
}

export default function MindmapPage() {
    const [notebooks, setNotebooks] = useState<Notebook[]>([]);
    const [notebookGroups, setNotebookGroups] = useState<NotebookGroup[]>([]);
    const [collapsedNotebookGroups, setCollapsedNotebookGroups] = useState<Set<string>>(new Set());
    const [selectedGroupName, setSelectedGroupName] = useState<string | null>(null);
    const [activeNotebookId, setActiveNotebookId] = useState<string | null>(null);
    const [loadingNotebooks, setLoadingNotebooks] = useState(true);
    const [loadingNodes, setLoadingNodes] = useState(false);
    const [isCreatingNotebook, setIsCreatingNotebook] = useState(false);
    const [editingNotebookId, setEditingNotebookId] = useState<string | null>(null);
    const [sidebarDrag, setSidebarDrag] = useState<SidebarDrag | null>(null);
    const [sidebarDrop, setSidebarDrop] = useState<SidebarDrop | null>(null);
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [recentlyDeletedNotebook, setRecentlyDeletedNotebook] = useState<Notebook | null>(null);

    const [nodes, setNodes] = useState<MindNode[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);
    const [notebookContextMenu, setNotebookContextMenu] = useState<{ x: number; y: number; notebookId: string } | null>(null);
    const [descriptionEditor, setDescriptionEditor] = useState<{ notebookId: string; value: string } | null>(null);
    const [isTranslating, setIsTranslating] = useState(false);
    const [translatingNodeId, setTranslatingNodeId] = useState<string | null>(null);
    const [translationTargetLanguage, setTranslationTargetLanguage] = useState<Language>('en');
    const [translationProvider, setTranslationProvider] = useState<AIProvider>('openai');
    const [translationModel, setTranslationModel] = useState(AI_MODELS.openai[0].id);
    const [nodeComparisons, setNodeComparisons] = useState<Record<string, NodeComparison>>({});
    const [error, setError] = useState<string | null>(null);
    const [historyFlags, setHistoryFlags] = useState<{ undo: string | null; redo: string | null }>({ undo: null, redo: null });
    const [historyToast, setHistoryToast] = useState<string | null>(null);

    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState(DEFAULT_PAN);
    const [autoFormat, setAutoFormat] = useState(true);
    const [viewMode, setViewMode] = useState<'map' | 'document'>('map');
    const [isDocumentEditing, setIsDocumentEditing] = useState(false);
    const [isDocumentSaving, setIsDocumentSaving] = useState(false);
    const [boardActive, setBoardActive] = useState(false);
    const [collapsedNodeIds, setCollapsedNodeIds] = useState<Set<string>>(new Set());
    const [dropTargetId, setDropTargetId] = useState<string | null>(null);

    const containerRef = useRef<HTMLDivElement>(null);
    const contextMenuRef = useRef<HTMLDivElement>(null);
    const notebookContextMenuRef = useRef<HTMLDivElement>(null);
    const documentActionsRef = useRef<MindmapDocumentActions>(null);
    const translationBusyRef = useRef(false);
    const panRef = useRef({ panning: false });
    const viewRef = useRef({ zoom: 1, pan: DEFAULT_PAN });
    const touchPointersRef = useRef(new Map<number, { x: number; y: number }>());
    const pinchRef = useRef<{ distance: number; centerX: number; centerY: number } | null>(null);
    const dragRef = useRef<{ type: 'move' | 'resize' | null, id: string | null, startX: number, startY: number, startW: number, startH: number }>({ type: null, id: null, startX: 0, startY: 0, startW: 0, startH: 0 });
    const nodesRef = useRef<MindNode[]>([]);
    const historyRef = useRef<{ undo: MindmapHistoryEntry[]; redo: MindmapHistoryEntry[] }>({ undo: [], redo: [] });
    const historyActionsRef = useRef<{ undo: () => void; redo: () => void }>({ undo: () => { }, redo: () => { } });
    const baselineRef = useRef<MindNode[]>([]);            // trạng thái đã commit gần nhất
    const commitTimerRef = useRef<number | null>(null);
    const syncTimerRef = useRef<number | null>(null);
    const pendingSyncRef = useRef<HistorySync | null>(null);
    const positionTimerRef = useRef<number | null>(null);
    const pendingPositionsRef = useRef(new Map<string, { id: string; x: number; y: number }>());
    const writeQueueRef = useRef<Promise<unknown>>(Promise.resolve());
    const collapsedRef = useRef(collapsedNodeIds);
    collapsedRef.current = collapsedNodeIds;
    const activeNotebook = notebooks.find((notebook) => notebook.id === activeNotebookId) ?? null;
    const activeLanguage = activeNotebook?.language ?? 'vi';
    const activeViewRef = useRef({ notebookId: activeNotebookId, language: activeLanguage });
    activeViewRef.current = { notebookId: activeNotebookId, language: activeLanguage };
    const handleDocumentEditingChange = useCallback((editing: boolean) => setIsDocumentEditing(editing), []);
    const handleDocumentSavingChange = useCallback((saving: boolean) => setIsDocumentSaving(saving), []);

    useEffect(() => {
        try {
            const savedGroups = JSON.parse(window.localStorage.getItem('mindmap-collapsed-groups') || '[]');
            if (Array.isArray(savedGroups)) {
                const groupNames = savedGroups.filter((name): name is string => typeof name === 'string');
                queueMicrotask(() => setCollapsedNotebookGroups(new Set(groupNames)));
            }
        } catch { }
    }, []);

    useEffect(() => {
        if (!recentlyDeletedNotebook) return;
        const timeoutId = window.setTimeout(() => setRecentlyDeletedNotebook(null), 6000);
        return () => window.clearTimeout(timeoutId);
    }, [recentlyDeletedNotebook]);

    useEffect(() => {
        if (!historyToast) return;
        const id = window.setTimeout(() => setHistoryToast(null), 1800);
        return () => window.clearTimeout(id);
    }, [historyToast]);

    // Đẩy hết dữ liệu đang debounce khi rời trang/unmount
    useEffect(() => {
        const flushAll = () => { commitHistory(); flushHistorySync(); flushPositions(); };
        window.addEventListener('pagehide', flushAll);
        return () => { window.removeEventListener('pagehide', flushAll); flushAll(); };
    }, []);

    useEffect(() => {
        const handleWindowWheel = (event: WheelEvent) => {
            if (viewMode !== 'map') return;
            const target = event.target as Node | null;
            const rect = containerRef.current?.getBoundingClientRect();
            if (!rect) return;

            const isInsideBoard = Boolean(target && containerRef.current?.contains(target))
                || (event.clientX >= rect.left && event.clientX <= rect.right
                    && event.clientY >= rect.top && event.clientY <= rect.bottom);
            if (!isInsideBoard) return;

            event.preventDefault();
            event.stopPropagation();
            if (target instanceof HTMLElement && target.closest('[data-canvas-controls]')) return;

            const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1;

            if (event.deltaY !== 0) {
                // Nếu deltaMode === 0 (Touchpad), dùng hệ số 0.008 (Nhanh)
                // Nếu deltaMode khác 0 (Chuột), giữ nguyên hệ số 0.002 (Chuẩn)
                // const zoomMultiplier = event.deltaMode === 0 ? 0.008 : 0.001;
                const zoomMultiplier = 0.001;

                zoomAtPoint(
                    event.clientX,
                    event.clientY,
                    viewRef.current.zoom * Math.exp(-event.deltaY * unit * zoomMultiplier)
                );
                return;
            }

            const { zoom: currentZoom, pan: currentPan } = viewRef.current;
            setCanvasView(currentZoom, { x: currentPan.x - event.deltaX * unit, y: currentPan.y });
        };

        window.addEventListener('wheel', handleWindowWheel, { capture: true, passive: false });
        return () => window.removeEventListener('wheel', handleWindowWheel, true);
    }, [activeNotebookId, viewMode]);

    useEffect(() => {
        const reset = () => {
            dragRef.current.id = null;
            dragRef.current.type = null;
            panRef.current.panning = false;
            touchPointersRef.current.clear();
            pinchRef.current = null;
            setDropTargetId(null);
        };
        window.addEventListener('pointerup', reset);
        window.addEventListener('pointercancel', reset);
        window.addEventListener('blur', reset);
        return () => {
            window.removeEventListener('pointerup', reset);
            window.removeEventListener('pointercancel', reset);
            window.removeEventListener('blur', reset);
        };
    }, []);

    const visibleNodes = useMemo(() => getVisibleNodes(nodes, collapsedNodeIds), [nodes, collapsedNodeIds]);
    const childCounts = useMemo(() => {
        const counts = new Map<string, number>();
        for (const node of nodes) if (node.parentId) counts.set(node.parentId, (counts.get(node.parentId) ?? 0) + 1);
        return counts;
    }, [nodes]);

    const edges = useMemo(() => {
        const nodeById = new Map(nodes.map((node) => [node.id, node]));
        const visibleIds = new Set(visibleNodes.map((node) => node.id));
        const hasDom = typeof document !== 'undefined';

        return visibleNodes.filter((n) => n.parentId && visibleIds.has(n.parentId)).map((n) => {
            const parent = nodeById.get(n.parentId!);
            if (!parent) return null;

            let pw = parent.width || DEFAULT_W, ph = parent.height || DEFAULT_H;
            let nh = n.height || DEFAULT_H;

            if (hasDom) {
                const pEl = document.getElementById(`node-${parent.id}`);
                if (pEl) { pw = pEl.offsetWidth; ph = pEl.offsetHeight; }
                const nEl = document.getElementById(`node-${n.id}`);
                if (nEl) nh = nEl.offsetHeight;
            }

            const x1 = parent.x + pw;
            const y1 = parent.y + ph / 2;
            const x2 = n.x;
            const y2 = n.y + nh / 2;
            const mx = x1 + (x2 - x1) / 2;
            return { id: n.id, d: `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}` };
        }).filter((e): e is { id: string; d: string } => e !== null);
    }, [nodes, visibleNodes]);

    useEffect(() => {
        (async () => {
            setLoadingNotebooks(true);
            try {
                const data = await apiFetch(`${API_BASE}?resource=notebooks`);
                const mapped: Notebook[] = (data.notebooks as { id: string; title: string; group_name?: string; sort_order?: number; language?: Language; description?: string }[]).map((n) => ({
                    id: n.id, title: n.title, groupName: n.group_name || '', sortOrder: n.sort_order || 0,
                    language: n.language || 'vi', description: n.description || '',
                }));
                setNotebooks(mapped);
                setNotebookGroups((data.groups as { name: string; sort_order: number }[] || []).map((group) => ({ name: group.name, sortOrder: group.sort_order })));
                const savedNotebookId = window.localStorage.getItem('mindmap-active-notebook');
                const activeId = mapped.find((notebook) => notebook.id === savedNotebookId)?.id ?? mapped[0]?.id;
                if (activeId) setActiveNotebookId(activeId);
            } catch { setError('Could not load notebooks.'); } finally { setLoadingNotebooks(false); }
        })();
    }, []);

    useEffect(() => {
        if (activeNotebookId) window.localStorage.setItem('mindmap-active-notebook', activeNotebookId);
    }, [activeNotebookId]);

    useEffect(() => {
        if (!activeNotebookId) {
            queueMicrotask(() => { applyNodes([]); resetHistory([]); });
            return;
        }
        let cancelled = false;
        (async () => {
            setLoadingNodes(true); setSelectedId(null); setEditingId(null);
            try {
                const data = await apiFetch(`${API_BASE}?resource=nodes&notebookId=${activeNotebookId}&language=${activeLanguage}`) as { nodes: MindNodeResponse[] };
                if (cancelled) return;
                const mapped = data.nodes.map(mapMindNode);
                applyNodes(mapped); resetHistory(mapped); setPan(DEFAULT_PAN); setZoom(1);
            } catch { if (!cancelled) setError('Could not load this board.'); } finally { if (!cancelled) setLoadingNodes(false); }
        })();
        return () => { cancelled = true; };
    }, [activeNotebookId, activeLanguage]);

    // Bắt sự kiện bàn phím toàn cầu (Global Hotkeys)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLElement && e.target.closest('input, textarea, [contenteditable="true"]')) return;
            const modifierPressed = e.ctrlKey || e.metaKey;
            const key = e.key.toLowerCase();
            if (viewMode === 'map' && modifierPressed && key === 'z') {
                e.preventDefault();
                if (e.shiftKey) void historyActionsRef.current.redo();
                else void historyActionsRef.current.undo();
                return;
            }
            if (viewMode === 'map' && modifierPressed && key === 'y') {
                e.preventDefault();
                void historyActionsRef.current.redo();
                return;
            }
            if (editingId || !selectedId) return; // Bỏ qua nếu đang gõ text

            const node = nodes.find(n => n.id === selectedId);
            if (!node) return;

            if (e.key === 'Enter') {
                e.preventDefault();
                createNode(node.parentId, '', 'text');
            } else if (e.key === 'Tab') {
                e.preventDefault();
                createNode(node.id, '', 'text');
            } else if (e.key === 'F2') {
                e.preventDefault();
                setEditingId(node.id);
            } else if (e.key.toLowerCase() === 't' && !e.altKey && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                const language = nodeComparisons[node.id]?.language
                    ?? (translationTargetLanguage !== activeLanguage
                        ? translationTargetLanguage
                        : otherLanguages(activeLanguage)[0]);
                void toggleNodeComparison(node.id, language);
            } else if (e.key === 'Delete' || e.key === 'Backspace') {
                deleteNode(node.id);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedId, editingId, nodes, activeNotebookId, pan, zoom, nodeComparisons, translationTargetLanguage, activeLanguage, viewMode]);

    useEffect(() => {
        if (!contextMenu) return;
        const frameId = window.requestAnimationFrame(() => {
            const element = contextMenuRef.current;
            if (!element) return;
            const bounds = element.getBoundingClientRect();
            const left = Math.max(8, Math.min(contextMenu.x, window.innerWidth - bounds.width - 8));
            const top = Math.max(8, Math.min(contextMenu.y, window.innerHeight - bounds.height - 8));
            setContextMenu((current) => {
                if (!current || current.nodeId !== contextMenu.nodeId || (current.x === left && current.y === top)) return current;
                return { ...current, x: left, y: top };
            });
        });
        function handlePointerDown(e: PointerEvent) { if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) setContextMenu(null); }
        function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') setContextMenu(null); }
        window.addEventListener('pointerdown', handlePointerDown); window.addEventListener('keydown', handleKey);
        return () => {
            window.cancelAnimationFrame(frameId);
            window.removeEventListener('pointerdown', handlePointerDown);
            window.removeEventListener('keydown', handleKey);
        };
    }, [contextMenu]);

    useEffect(() => {
        if (!notebookContextMenu) return;
        function handlePointerDown(e: PointerEvent) { if (notebookContextMenuRef.current && !notebookContextMenuRef.current.contains(e.target as Node)) setNotebookContextMenu(null); }
        function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') setNotebookContextMenu(null); }
        window.addEventListener('pointerdown', handlePointerDown); window.addEventListener('keydown', handleKey);
        return () => { window.removeEventListener('pointerdown', handlePointerDown); window.removeEventListener('keydown', handleKey); };
    }, [notebookContextMenu]);

    useEffect(() => {
        const handlePaste = async (e: ClipboardEvent) => {
            if (!activeNotebookId || !selectedId) return;
            const items = e.clipboardData?.items;
            if (!items) return;

            const imageItem = Array.from(items).find((item) => item.type.startsWith('image/'));
            const file = imageItem?.getAsFile();
            const selectedNode = nodesRef.current.find((node) => node.id === selectedId);
            if (!file || !selectedNode) return;
            e.preventDefault();

            const reader = new FileReader();
            reader.onerror = () => setError('Image upload failed.');
            reader.onload = async (event) => {
                const base64 = event.target?.result as string;
                const img = new Image();
                img.onerror = () => setError('Image upload failed.');
                img.onload = async () => {
                    const scale = Math.min(1, 300 / img.width, 220 / img.height);
                    const width = Math.round(img.width * scale);
                    const height = Math.round(img.height * scale);
                    try {
                        const { url } = await apiSend('POST', { resource: 'upload', base64 });
                        await updateNodeProps(selectedNode.id, {
                            type: 'image', imageUrl: url, width: Math.max(selectedNode.width || DEFAULT_W, width),
                            height, preserveAspect: true,
                        });
                    } catch { setError('Image upload failed.'); }
                };
                img.src = base64;
            };
            reader.readAsDataURL(file);
        };
        window.addEventListener('paste', handlePaste);
        return () => window.removeEventListener('paste', handlePaste);
    }, [activeNotebookId, selectedId]);

    // Luôn đi qua đây để ref và state không lệch nhau
    function applyNodes(next: MindNode[]) {
        nodesRef.current = next;
        setNodes(next);
    }

    // ───── Hàng đợi ghi: thứ tự request trên server = thứ tự thao tác trên UI ─────
    function enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
        const run = writeQueueRef.current.then(task, task);
        writeQueueRef.current = run.then(() => undefined, () => undefined);
        return run;
    }
    function queuedSend(method: 'POST' | 'PATCH', body: unknown) {
        flushHistorySync(); // undo/redo đang chờ phải đi trước mọi thao tác mới
        return enqueueWrite(() => apiSend(method, body));
    }
    function queuedDelete(url: string) {
        flushHistorySync();
        return enqueueWrite(() => apiFetch(url, { method: 'DELETE' }));
    }

    // ───── Lưu vị trí: gom + debounce, chỉ gửi node thực sự đổi chỗ ─────
    function persistPositions(list: MindNode[]) {
        for (const n of list) pendingPositionsRef.current.set(n.id, { id: n.id, x: n.x, y: n.y });
        if (positionTimerRef.current !== null) window.clearTimeout(positionTimerRef.current);
        positionTimerRef.current = window.setTimeout(flushPositions, POSITION_SAVE_DELAY);
    }
    function flushPositions() {
        if (positionTimerRef.current !== null) { window.clearTimeout(positionTimerRef.current); positionTimerRef.current = null; }
        const items = [...pendingPositionsRef.current.values()];
        if (items.length === 0) return;
        pendingPositionsRef.current.clear();
        void queuedSend('PATCH', { resource: 'nodes-bulk', nodes: items }).catch(() => setError('Could not save node positions.'));
    }

    // ───── History ─────
    function syncHistoryFlags() {
        const { undo, redo } = historyRef.current;
        const next = { undo: undo[undo.length - 1]?.label ?? null, redo: redo[redo.length - 1]?.label ?? null };
        setHistoryFlags((prev) => prev.undo === next.undo && prev.redo === next.redo ? prev : next);
    }

    function resetHistory(list: MindNode[]) {
        if (commitTimerRef.current !== null) { window.clearTimeout(commitTimerRef.current); commitTimerRef.current = null; }
        historyRef.current = { undo: [], redo: [] };
        baselineRef.current = list;
        syncHistoryFlags();
    }

    function scheduleHistoryCommit() {
        if (commitTimerRef.current !== null) window.clearTimeout(commitTimerRef.current);
        commitTimerRef.current = window.setTimeout(commitHistory, HISTORY_COMMIT_DELAY);
    }

    // So sánh baseline với trạng thái hiện tại → 1 entry duy nhất cho mọi thay đổi đã gom
    function commitHistory() {
        if (commitTimerRef.current !== null) { window.clearTimeout(commitTimerRef.current); commitTimerRef.current = null; }
        const notebookId = activeViewRef.current.notebookId;
        const current = nodesRef.current;
        if (!notebookId || dragRef.current.id || current.some((node) => node.notebookId !== notebookId)) return;
        const changes = diffNodes(baselineRef.current, current);
        baselineRef.current = current;
        if (changes.length === 0) return;
        const { undo } = historyRef.current;
        undo.push({ notebookId, label: describeChanges(changes), changes });
        if (undo.length > HISTORY_LIMIT) undo.shift();
        historyRef.current.redo = [];
        syncHistoryFlags();
    }

    function flushHistorySync() {
        if (syncTimerRef.current !== null) { window.clearTimeout(syncTimerRef.current); syncTimerRef.current = null; }
        const sync = pendingSyncRef.current;
        if (!sync || sync.targets.size === 0) return;
        pendingSyncRef.current = null;
        const { remove, upsert } = toSyncPayload(sync.targets);
        void enqueueWrite(() => apiSend('PATCH', { resource: 'nodes-apply', notebookId: sync.notebookId, remove, upsert }))
            .catch(() => { setError('Could not sync undo/redo. Reloading the board…'); void reloadActiveBoard(); });
    }

    async function reloadActiveBoard() {
        const { notebookId, language } = activeViewRef.current;
        if (!notebookId) return;
        try {
            await writeQueueRef.current;
            const data = await apiFetch(`${API_BASE}?resource=nodes&notebookId=${notebookId}&language=${language}`) as { nodes: MindNodeResponse[] };
            if (activeViewRef.current.notebookId !== notebookId) return;
            const mapped = data.nodes.map(mapMindNode);
            applyNodes(mapped);
            resetHistory(mapped);
        } catch { /* giữ nguyên UI hiện tại */ }
    }

    // Đưa node vào vùng nhìn nếu đang nằm ngoài màn hình
    function revealNode(node: MindNode) {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const { zoom: z, pan: p } = viewRef.current;
        const left = node.x * z + p.x, top = node.y * z + p.y;
        const right = left + (node.width || DEFAULT_W) * z, bottom = top + (node.height || DEFAULT_H) * z;
        const margin = 80, topMargin = 72; // chừa thanh toolbar
        let dx = 0, dy = 0;
        if (left < margin) dx = margin - left; else if (right > rect.width - margin) dx = rect.width - margin - right;
        if (top < topMargin) dy = topMargin - top; else if (bottom > rect.height - margin) dy = rect.height - margin - bottom;
        if (dx || dy) setCanvasView(z, { x: p.x + dx, y: p.y + dy });
    }

    function applyHistory(direction: 'undo' | 'redo') {
        commitHistory(); // chốt thay đổi đang chờ trước khi đảo
        const history = historyRef.current;
        const entry = (direction === 'undo' ? history.undo : history.redo).pop();
        if (!entry || entry.notebookId !== activeViewRef.current.notebookId) { syncHistoryFlags(); return; }

        // Trạng thái đích của từng node trong entry (null = phải bị xóa)
        const targets = new Map<string, MindNode | null>();
        for (const change of entry.changes) targets.set(changeId(change), direction === 'undo' ? change.before : change.after);

        const placed = new Set<string>();
        const next: MindNode[] = [];
        for (const node of nodesRef.current) {
            if (!targets.has(node.id)) { next.push(node); continue; }
            placed.add(node.id);
            const target = targets.get(node.id);
            if (target) next.push(restoreNode(target, node));
        }
        targets.forEach((target, id) => { if (target && !placed.has(id)) next.push(restoreNode(target)); });

        applyNodes(next);
        baselineRef.current = next; // undo/redo không được tính là thay đổi mới
        (direction === 'undo' ? history.redo : history.undo).push(entry);
        syncHistoryFlags();

        // Đồng bộ server: gộp nhiều lần undo/redo liên tiếp thành 1 request
        if (pendingSyncRef.current && pendingSyncRef.current.notebookId !== entry.notebookId) flushHistorySync();
        const sync = pendingSyncRef.current ?? { notebookId: entry.notebookId, targets: new Map<string, MindNode | null>() };
        targets.forEach((target, id) => { sync.targets.set(id, target); pendingPositionsRef.current.delete(id); });
        pendingSyncRef.current = sync;
        if (syncTimerRef.current !== null) window.clearTimeout(syncTimerRef.current);
        syncTimerRef.current = window.setTimeout(flushHistorySync, HISTORY_SYNC_DELAY);

        // UI: bỏ trạng thái cũ, chọn node liên quan, cuộn tới nó, báo toast
        const textChangedIds = new Set(entry.changes
            .filter((c) => c.before && c.after && c.before.sourceText !== c.after.sourceText).map(changeId));
        if (textChangedIds.size > 0) {
            setNodeComparisons((previous) => {
                const rest = { ...previous };
                textChangedIds.forEach((id) => { delete rest[id]; });
                return rest;
            });
        }
        const restored = [...targets].find(([id, target]) => target && !placed.has(id));
        const removedChange = entry.changes.find((c) => targets.get(changeId(c)) === null);
        const removedNode = removedChange ? (removedChange.before ?? removedChange.after) : null;
        const focusId = restored?.[0] ?? removedNode?.parentId ?? [...targets].find(([, target]) => target)?.[0] ?? null;
        const focus = focusId ? next.find((node) => node.id === focusId) : undefined;
        setEditingId(null);
        setContextMenu(null);
        setSelectedId(focus?.id ?? null);
        if (focus && viewMode === 'map') window.requestAnimationFrame(() => revealNode(focus));
        setHistoryToast(`${direction === 'undo' ? 'Undo' : 'Redo'}: ${entry.label}`);
    }

    historyActionsRef.current = { undo: () => applyHistory('undo'), redo: () => applyHistory('redo') };

    function persistChangedPositions(before: MindNode[], after: MindNode[]) {
        const prev = new Map(before.map((n) => [n.id, n]));
        const changed = after.filter((n) => {
            const p = prev.get(n.id);
            return !p || Math.abs(p.x - n.x) > 0.5 || Math.abs(p.y - n.y) > 0.5;
        });
        if (changed.length) persistPositions(changed);
    }

    // silent: layout thuần hiển thị (bật/tắt bản dịch, collapse) → không tạo entry history
    function relayoutAfterPaint(options: { silent?: boolean } = {}) {
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
            if (options.silent) commitHistory();
            const before = nodesRef.current;
            const arranged = formatVisibleTree(before, collapsedRef.current);
            applyNodes(arranged);
            persistChangedPositions(before, arranged);
            if (options.silent) baselineRef.current = arranged;
            else scheduleHistoryCommit();
        }));
    }

    async function runPendingTranslations(notebookId: string, mode: 'manual' | 'force') {
        if (translationBusyRef.current) return;
        translationBusyRef.current = true;
        setIsTranslating(true);
        setError(null);
        try {
            if (mode === 'force') {
                await apiSend('POST', { resource: 'queue-force-retranslate', notebookId });
            }
            for (let batch = 0; batch < 20; batch += 1) {
                const result = await apiSend('POST', { resource: 'translate-pending', notebookId, mode }) as { translations: { id: string; texts: Partial<Record<Language, string>> }[]; pendingCount: number };
                const view = activeViewRef.current;
                if (view.notebookId === notebookId) {
                    const refreshed = await apiFetch(`${API_BASE}?resource=nodes&notebookId=${notebookId}&language=${view.language}`) as { nodes: MindNodeResponse[] };
                    if (activeViewRef.current.notebookId === notebookId && activeViewRef.current.language === view.language) {
                        // Chỉ merge phần hiển thị, không ghi đè vị trí/trạng thái cục bộ
                        const fresh = new Map(refreshed.nodes.map((n) => [n.id, mapMindNode(n)]));
                        applyNodes(nodesRef.current.map((n) => {
                            const f = fresh.get(n.id);
                            return f ? { ...n, text: f.text, translationPending: f.translationPending } : n;
                        }));
                    }
                }
                if (result.pendingCount === 0 || result.translations.length === 0) break;
            }
        } catch (translationError) {
            setError(translationError instanceof Error ? translationError.message : 'Could not translate pending nodes.');
        } finally {
            translationBusyRef.current = false;
            setIsTranslating(false);
        }
    }

    async function changeNotebookLanguage(language: Language) {
        if (!activeNotebook || activeNotebook.language === language) return;
        try {
            await apiSend('PATCH', { resource: 'notebook', id: activeNotebook.id, language });
            setNotebooks((previous) => previous.map((notebook) => notebook.id === activeNotebook.id ? { ...notebook, language } : notebook));
        } catch {
            setError('Could not change board language.');
        }
    }

    async function saveNotebookDescription() {
        if (!descriptionEditor) return;
        const { notebookId, value } = descriptionEditor;
        try {
            await apiSend('PATCH', { resource: 'notebook', id: notebookId, description: value });
            setNotebooks((previous) => previous.map((notebook) => notebook.id === notebookId ? { ...notebook, description: value.trim().slice(0, 2000) } : notebook));
            setDescriptionEditor(null);
        } catch {
            setError('Could not save notebook description.');
        }
    }

    async function translateNodeToLanguage(nodeId: string, language: Language) {
        setTranslatingNodeId(nodeId);
        setError(null);
        try {
            const result = await apiSend('POST', { resource: 'translate-node', nodeId, targetLanguage: language, provider: translationProvider, model: translationModel }) as NodeComparison;
            setNodeComparisons((previous) => ({ ...previous, [nodeId]: result }));
            setContextMenu(null);
            relayoutAfterPaint({ silent: true });
        } catch (translationError) {
            setError(translationError instanceof Error ? translationError.message : 'Could not translate this node.');
        } finally {
            setTranslatingNodeId(null);
        }
    }

    async function toggleNodeComparison(nodeId: string, language: Language) {
        if (nodeComparisons[nodeId]?.language === language) {
            setNodeComparisons((previous) => {
                const next = { ...previous };
                delete next[nodeId];
                return next;
            });
            setContextMenu(null);
            relayoutAfterPaint({ silent: true });
            return;
        }

        try {
            const result = await apiFetch(`${API_BASE}?resource=node-translation&nodeId=${encodeURIComponent(nodeId)}&language=${language}`) as { text: string };
            setNodeComparisons((previous) => ({ ...previous, [nodeId]: { language, text: result.text } }));
            setContextMenu(null);
            relayoutAfterPaint({ silent: true });
        } catch (translationError) {
            if (translationError instanceof Error && translationError.message === 'No current translation for this node and language.') {
                await translateNodeToLanguage(nodeId, language);
                return;
            }
            setError(translationError instanceof Error ? translationError.message : 'Could not load this translation.');
        }
    }

    function createStableId() {
        const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
        if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
            return cryptoObj.randomUUID();
        }

        return `node-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    }

    function getBranchBottomY(list: MindNode[], parentId: string | null, parentNode?: MindNode | null) {
        if (!parentId) return 0;
        const parent = parentNode ?? list.find((n) => n.id === parentId);
        if (!parent) return 0;

        const parentBottom = parent.y + (parent.height || DEFAULT_H);
        const bottom = list.reduce(
            (max, n) => n.parentId === parentId ? Math.max(max, n.y + (n.height || DEFAULT_H)) : max,
            parentBottom,
        );
        return bottom + 16;
    }

    async function createNotebook(title: string, groupName = '') {
        const id = createStableId(), rootId = createStableId(), cleanTitle = title.trim() || 'Untitled notebook';
        try {
            await apiSend('POST', { resource: 'notebook', id, title: cleanTitle, rootId, groupName, language: activeLanguage });
            setNotebooks((prev) => [...prev, { id, title: cleanTitle, groupName, language: activeLanguage, description: '', sortOrder: prev.filter((item) => item.groupName === groupName).length }]);
            setActiveNotebookId(id);
            const rootNode: MindNode = { id: rootId, notebookId: id, parentId: null, text: ROOT_TEXT[activeLanguage], sourceText: ROOT_TEXT[activeLanguage], sourceLanguage: activeLanguage, x: 0, y: 0, type: 'text', width: DEFAULT_W, height: DEFAULT_H, autoWidth: true, imageUrl: null, preserveAspect: true, color: null, textAlign: 'center', translationPending: true };
            applyNodes([rootNode]); resetHistory([rootNode]);
            setPan(DEFAULT_PAN); setZoom(1);
        } catch {
            setError('Could not create this notebook.');
        }
    }

    async function createNotebookGroup() {
        const name = window.prompt('New group name')?.trim().slice(0, 80);
        if (!name || notebookGroups.some((group) => group.name.toLocaleLowerCase() === name.toLocaleLowerCase())) return;
        const group = { name, sortOrder: notebookGroups.length };
        try {
            await apiSend('POST', { resource: 'group', name });
            setNotebookGroups((prev) => [...prev, group]);
            setSelectedGroupName(name);
            setCollapsedNotebookGroups((previous) => new Set([...previous].filter((groupName) => groupName !== name)));
        } catch {
            setError('Could not create this group.');
        }
    }

    function toggleNotebookGroup(name: string) {
        setCollapsedNotebookGroups((previous) => {
            const next = new Set(previous);
            if (next.has(name)) next.delete(name);
            else next.add(name);
            window.localStorage.setItem('mindmap-collapsed-groups', JSON.stringify([...next]));
            return next;
        });
    }

    async function deleteNotebookGroup(name: string, notebookCount: number) {
        if (!window.confirm(`Delete group "${name}" and all ${notebookCount} notebooks in it? This cannot be undone.`)) return;

        try {
            await apiFetch(`${API_BASE}?resource=group&name=${encodeURIComponent(name)}`, { method: 'DELETE' });
            const removedIds = new Set(notebooks.filter((notebook) => notebook.groupName === name).map((notebook) => notebook.id));
            const remaining = notebooks.filter((notebook) => notebook.groupName !== name);
            setNotebooks(remaining);
            setNotebookGroups((previous) => previous.filter((group) => group.name !== name));
            setCollapsedNotebookGroups((previous) => {
                const next = new Set(previous);
                next.delete(name);
                window.localStorage.setItem('mindmap-collapsed-groups', JSON.stringify([...next]));
                return next;
            });
            setSelectedGroupName((previous) => previous === name ? null : previous);
            if (activeNotebookId && removedIds.has(activeNotebookId)) setActiveNotebookId(remaining[0]?.id ?? null);
        } catch {
            setError('Could not delete this group.');
        }
    }

    function saveNotebookArrangement(updated: Notebook[]) {
        setNotebooks(updated);
        void apiSend('PATCH', { resource: 'notebook', action: 'reorder', notebooks: updated.map(({ id, sortOrder, groupName }) => ({ id, sortOrder, groupName })) })
            .catch(() => setError('Could not save notebook order.'));
    }

    function moveNotebookTo(id: string, groupName: string, targetId: string | null, position: 'before' | 'after' | 'inside') {
        const source = notebooks.find((item) => item.id === id);
        if (!source) return;

        const sourceItems = notebooks.filter((item) => item.groupName === source.groupName).sort((a, b) => a.sortOrder - b.sortOrder);
        const destinationItems = source.groupName === groupName
            ? sourceItems
            : notebooks.filter((item) => item.groupName === groupName).sort((a, b) => a.sortOrder - b.sortOrder);
        const sourceWithout = sourceItems.filter((item) => item.id !== id);
        const destinationWithout = destinationItems.filter((item) => item.id !== id);
        const targetIndex = targetId ? destinationWithout.findIndex((item) => item.id === targetId) : -1;
        const insertAt = targetIndex < 0 ? destinationWithout.length : targetIndex + (position === 'after' ? 1 : 0);
        destinationWithout.splice(insertAt, 0, { ...source, groupName });

        const updatedById = new Map<string, Notebook>();
        if (source.groupName !== groupName) sourceWithout.forEach((item, index) => updatedById.set(item.id, { ...item, sortOrder: index }));
        destinationWithout.forEach((item, index) => updatedById.set(item.id, { ...item, groupName, sortOrder: index }));
        const updated = notebooks.map((item) => updatedById.get(item.id) ?? item);
        if (updated.some((item, index) => item.groupName !== notebooks[index].groupName || item.sortOrder !== notebooks[index].sortOrder)) {
            saveNotebookArrangement(updated);
        }
    }

    function reorderNotebookGroup(id: string, targetId: string, position: 'before' | 'after') {
        if (id === targetId) return;
        const ordered = [...notebookGroups].sort((a, b) => a.sortOrder - b.sortOrder);
        const sourceIndex = ordered.findIndex((group) => group.name === id);
        const [source] = ordered.splice(sourceIndex, 1);
        const targetIndex = ordered.findIndex((group) => group.name === targetId);
        ordered.splice(targetIndex + (position === 'after' ? 1 : 0), 0, source);
        const updated = ordered.map((group, sortOrder) => ({ ...group, sortOrder }));
        setNotebookGroups(updated);
        void apiSend('PATCH', { resource: 'group', action: 'reorder', groups: updated })
            .catch(() => setError('Could not save group order.'));
    }

    function renameNotebook(id: string, title: string) {
        const cleanTitle = title.trim() || 'Untitled notebook';
        setNotebooks((prev) => prev.map((n) => (n.id === id ? { ...n, title: cleanTitle } : n)));
        apiSend('PATCH', { resource: 'notebook', id, title: cleanTitle }).catch(() => setError('Could not rename this notebook.'));
    }

    async function deleteNotebook(id: string) {
        if (!window.confirm('Delete this notebook and every idea on it?')) return;
        const deletedNotebook = notebooks.find((notebook) => notebook.id === id);
        if (!deletedNotebook) return;

        try {
            await apiFetch(`${API_BASE}?resource=notebook&id=${id}`, { method: 'DELETE' });
            const remaining = notebooks.filter((n) => n.id !== id);
            setNotebooks(remaining);
            setRecentlyDeletedNotebook(deletedNotebook);
            if (activeNotebookId === id) setActiveNotebookId(remaining[0]?.id ?? null);
        } catch {
            setError('Could not delete this notebook.');
        }
    }

    async function restoreNotebook() {
        if (!recentlyDeletedNotebook) return;
        try {
            await apiSend('PATCH', { resource: 'notebook', action: 'restore', id: recentlyDeletedNotebook.id });
            setNotebooks((prev) => [...prev, recentlyDeletedNotebook]);
            setActiveNotebookId(recentlyDeletedNotebook.id);
            setRecentlyDeletedNotebook(null);
        } catch {
            setError('Could not restore this notebook.');
        }
    }

    function createNode(parentId: string | null, text = '', type: 'text' | 'image' = 'text', imageUrl: string | null = null, width = DEFAULT_W, height = DEFAULT_H) {
        if (!activeNotebookId) return;

        const newNodeId = createStableId();
        const nextCollapsedIds = new Set(collapsedNodeIds);
        if (parentId) nextCollapsedIds.delete(parentId);
        if (nextCollapsedIds.size !== collapsedNodeIds.size) setCollapsedNodeIds(nextCollapsedIds);

        const currentNodes = nodesRef.current;
        const parent = parentId ? currentNodes.find(n => n.id === parentId) : null;
        let initialX = pan.x * -1 / zoom + 200;
        let initialY = pan.y * -1 / zoom + 200;

        if (parent) {
            const pEl = document.getElementById(`node-${parent.id}`);
            const pW = pEl ? pEl.offsetWidth : (parent.width || DEFAULT_W);
            initialX = parent.x + pW + LEVEL_GAP_X;
            initialY = getBranchBottomY(currentNodes, parentId, parent);
        }

        const newNode: MindNode = {
            id: newNodeId, notebookId: activeNotebookId, parentId, text,
            sourceText: text, sourceLanguage: activeLanguage,
            x: initialX, y: initialY, type, width, height, autoWidth: true, imageUrl, preserveAspect: true, color: null, textAlign: 'center', translationPending: false,
        };

        const beforeNodes = currentNodes;
        const afterNodes = autoFormat ? formatVisibleTree([...currentNodes, newNode], nextCollapsedIds) : [...currentNodes, newNode];
        applyNodes(afterNodes);
        scheduleHistoryCommit();

        void queuedSend('POST', { resource: 'node', ...newNode, imageUrl, preserveAspect: 1, language: activeLanguage })
            .catch(() => setError('Could not save this node.'));
        if (autoFormat) persistChangedPositions(beforeNodes, afterNodes);

        setSelectedId(newNodeId);
        if (type === 'text') setEditingId(newNodeId);
    }

    function deleteNode(id: string) {
        if (!activeNotebookId) return;
        const beforeNodes = nodesRef.current;
        if (!beforeNodes.some((node) => node.id === id)) return;
        const toRemove = collectSubtreeIds(beforeNodes, id);
        const remaining = beforeNodes.filter((node) => !toRemove.has(node.id));
        const laidOut = autoFormat ? formatVisibleTree(remaining, collapsedNodeIds) : remaining;
        applyNodes(laidOut);
        persistChangedPositions(remaining, laidOut);
        setCollapsedNodeIds((prev) => new Set([...prev].filter((nodeId) => !toRemove.has(nodeId))));
        setSelectedId((current) => current && toRemove.has(current) ? null : current);
        scheduleHistoryCommit();
        void queuedDelete(`${API_BASE}?resource=node&id=${encodeURIComponent(id)}`)
            .catch(() => { setError('Could not delete this node.'); void reloadActiveBoard(); });
    }

    async function updateNodeProps(id: string, updates: Partial<MindNode>, options: { throwOnError?: boolean; force?: boolean } = {}) {
        const beforeNodes = nodesRef.current;
        const currentNode = beforeNodes.find((node) => node.id === id);
        if (!currentNode) return;
        const textChanged = typeof updates.text === 'string' && updates.text !== currentNode.text;
        const savedUpdates: Partial<MindNode> = updates.text !== undefined && currentNode.autoWidth
            ? { ...updates, width: getAutoNodeWidth(updates.text) }
            : updates;
        // Không có gì đổi (vd: onBlur gọi lại sau Enter) → không gọi API
        const hasChange = (Object.keys(savedUpdates) as (keyof MindNode)[]).some((key) => savedUpdates[key] !== currentNode[key]);
        if (!hasChange && !options.force) return;

        applyNodes(beforeNodes.map((node) => node.id === id ? {
            ...node, ...savedUpdates,
            ...(textChanged ? { sourceText: updates.text!, sourceLanguage: activeLanguage } : {}),
            translationPending: textChanged ? Boolean(updates.text?.trim()) : node.translationPending,
        } : node));
        if (textChanged) {
            setNodeComparisons((previous) => {
                const next = { ...previous };
                delete next[id];
                return next;
            });
        }
        scheduleHistoryCommit();
        if ((savedUpdates.text !== undefined || savedUpdates.width !== undefined || savedUpdates.height !== undefined) && autoFormat) {
            relayoutAfterPaint(); // chạy ngay, không đợi server trả lời
        }

        const apiUpdates = { ...savedUpdates };
        if (!textChanged) delete apiUpdates.text;
        try {
            await queuedSend('PATCH', { resource: 'node', id, ...apiUpdates, ...(textChanged ? { language: activeLanguage } : {}) });
        } catch (saveError) {
            setError('Could not save this node.');
            if (options.throwOnError) throw saveError;
        }
    }

    function rearrangeAll() {
        const beforeNodes = nodesRef.current;
        const laidOut = formatVisibleTree(beforeNodes, collapsedNodeIds);
        applyNodes(laidOut);
        persistChangedPositions(beforeNodes, laidOut);
        scheduleHistoryCommit();
    }

    function formatVisibleTree(list: MindNode[], collapsedIds: Set<string>) {
        return mergePositions(list, layoutTree(getVisibleNodes(list, collapsedIds)));
    }

    // Collapse là trạng thái hiển thị: không vào history, phần layout được nhập vào baseline
    function toggleChildren(nodeId: string) {
        const nextCollapsedIds = new Set(collapsedNodeIds);
        if (nextCollapsedIds.has(nodeId)) nextCollapsedIds.delete(nodeId);
        else nextCollapsedIds.add(nodeId);

        setCollapsedNodeIds(nextCollapsedIds);
        if (!autoFormat) return;

        window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
            commitHistory();
            const before = nodesRef.current;
            const laidOut = formatVisibleTree(before, nextCollapsedIds);
            applyNodes(laidOut);
            baselineRef.current = laidOut;
            persistChangedPositions(before, laidOut);
        }));
    }

    function getDropTarget(clientX: number, clientY: number, draggedId: string) {
        const draggedSubtreeIds = collectSubtreeIds(nodesRef.current, draggedId);
        const elements = document.elementsFromPoint(clientX, clientY);
        for (const element of elements) {
            const nodeElement = element.closest<HTMLElement>('[data-node-id]');
            const targetId = nodeElement?.dataset.nodeId;
            if (targetId && !draggedSubtreeIds.has(targetId)) return targetId;
        }
        return null;
    }

    // Drag & Resize Handlers
    function handleNodePointerDown(e: ReactPointerEvent, node: MindNode) {
        e.stopPropagation(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        commitHistory(); // chốt thay đổi đang chờ để ranh giới entry rõ ràng
        dragRef.current = { type: 'move', id: node.id, startX: 0, startY: 0, startW: 0, startH: 0 };
        setSelectedId(node.id);
    }

    function handleResizePointerDown(e: ReactPointerEvent, node: MindNode) {
        e.stopPropagation();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        commitHistory();
        const el = document.getElementById(`node-media-${node.id}`) ?? document.getElementById(`node-${node.id}`);
        dragRef.current = { type: 'resize', id: node.id, startX: e.clientX, startY: e.clientY, startW: el ? el.offsetWidth : node.width, startH: el ? el.offsetHeight : node.height };
        setSelectedId(node.id);
    }

    function handlePointerMove(e: ReactPointerEvent) {
        const { type, id, startX, startY, startW, startH } = dragRef.current;
        if (!id) return;
        const current = nodesRef.current;

        if (type === 'move') {
            const nextDropTarget = getDropTarget(e.clientX, e.clientY, id);
            setDropTargetId((prev) => prev === nextDropTarget ? prev : nextDropTarget);
            const dx = e.movementX / zoom;
            const dy = e.movementY / zoom;
            const movedIds = autoFormat ? collectSubtreeIds(current, id) : new Set([id]);
            applyNodes(current.map((n) => movedIds.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n));
        } else if (type === 'resize') {
            const node = current.find(n => n.id === id);
            if (!node) return;
            let newW = Math.max(80, startW + (e.clientX - startX) / zoom);
            let newH = Math.max(40, startH + (e.clientY - startY) / zoom);

            if (node.preserveAspect && node.type === 'image') {
                const ratio = startW / startH;
                if (Math.abs(e.clientX - startX) > Math.abs(e.clientY - startY)) newH = newW / ratio;
                else newW = newH * ratio;
            }
            applyNodes(current.map((n) => n.id === id ? { ...n, width: newW, height: newH } : n));
        }
    }

    function handlePointerUp(e: ReactPointerEvent<HTMLDivElement>) {
        const { id, type, startX, startY } = dragRef.current;
        const liveNode = id ? nodesRef.current.find((n) => n.id === id) : undefined;
        if (id && liveNode) {
            if (type === 'resize') {
                if (e.clientX !== startX || e.clientY !== startY) {
                    void updateNodeProps(id, {
                        width: liveNode.width, height: liveNode.height,
                        ...(liveNode.type === 'text' ? { autoWidth: false } : {}),
                    }, { force: true });
                }
            } else if (type === 'move') {
                const targetId = getDropTarget(e.clientX, e.clientY, id);
                const parentChanged = Boolean(targetId && targetId !== liveNode.parentId);
                const liveNodes = nodesRef.current;
                const reparented = parentChanged
                    ? liveNodes.map((node) => node.id === id ? { ...node, parentId: targetId! } : node)
                    : liveNodes;
                const nextNodes = autoFormat ? formatVisibleTree(reparented, collapsedNodeIds) : reparented;
                applyNodes(nextNodes);
                if (parentChanged) {
                    void queuedSend('PATCH', { resource: 'node', id, parentId: targetId })
                        .catch(() => setError('Could not change this node parent.'));
                }
                persistChangedPositions(baselineRef.current, nextNodes); // chỉ node thực sự đổi vị trí
                scheduleHistoryCommit();                                  // click không kéo → diff rỗng → không có entry
            }
        }
        dragRef.current.id = null;
        setDropTargetId(null);
    }

    function setCanvasView(nextZoom: number, nextPan: { x: number; y: number }) {
        viewRef.current = { zoom: nextZoom, pan: nextPan };
        setZoom(nextZoom);
        setPan(nextPan);
    }

    function zoomAtPoint(clientX: number, clientY: number, nextZoom: number) {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;

        const { zoom: currentZoom, pan: currentPan } = viewRef.current;
        const boundedZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
        const localX = clientX - rect.left;
        const localY = clientY - rect.top;
        const worldX = (localX - currentPan.x) / currentZoom;
        const worldY = (localY - currentPan.y) / currentZoom;
        setCanvasView(boundedZoom, {
            x: localX - worldX * boundedZoom,
            y: localY - worldY * boundedZoom,
        });
    }

    function zoomBy(amount: number) {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const selectedNode = selectedId ? document.getElementById(`node-${selectedId}`) : null;
        const focusRect = selectedNode?.getBoundingClientRect();
        const focusX = focusRect ? focusRect.left + focusRect.width / 2 : rect.left + rect.width / 2;
        const focusY = focusRect ? focusRect.top + focusRect.height / 2 : rect.top + rect.height / 2;
        zoomAtPoint(focusX, focusY, viewRef.current.zoom + amount);
    }

    function centerRoot(nextZoom = viewRef.current.zoom) {
        const rect = containerRef.current?.getBoundingClientRect();
        const root = nodes.find((node) => node.parentId === null);
        if (!rect || !root) {
            setCanvasView(nextZoom, DEFAULT_PAN);
            return;
        }

        const element = document.getElementById(`node-${root.id}`);
        const width = element?.offsetWidth ?? root.width ?? DEFAULT_W;
        const height = element?.offsetHeight ?? root.height ?? DEFAULT_H;
        setCanvasView(nextZoom, {
            x: rect.width / 2 - (root.x + width / 2) * nextZoom,
            y: rect.height / 2 - (root.y + height / 2) * nextZoom,
        });
    }

    function handleCanvasPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
        if (viewMode !== 'map') return;
        if (e.pointerType !== 'touch' || editingId) return;
        if (e.target instanceof HTMLElement && e.target.closest('[data-canvas-controls]')) return;

        touchPointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touchPointersRef.current.size < 2) return;

        const [first, second] = Array.from(touchPointersRef.current.values());
        pinchRef.current = {
            distance: Math.hypot(second.x - first.x, second.y - first.y),
            centerX: (first.x + second.x) / 2,
            centerY: (first.y + second.y) / 2,
        };
        panRef.current.panning = false;
        dragRef.current.id = null;
    }

    function handleCanvasPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
        if (viewMode !== 'map') return;
        if (e.pointerType !== 'touch' || !touchPointersRef.current.has(e.pointerId)) return;
        touchPointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (!pinchRef.current || touchPointersRef.current.size < 2) return;

        const [first, second] = Array.from(touchPointersRef.current.values());
        const distance = Math.hypot(second.x - first.x, second.y - first.y);
        const centerX = (first.x + second.x) / 2;
        const centerY = (first.y + second.y) / 2;
        const previous = pinchRef.current;
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect || previous.distance === 0) return;

        const { zoom: currentZoom, pan: currentPan } = viewRef.current;
        const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, currentZoom * (distance / previous.distance)));
        const previousLocalX = previous.centerX - rect.left;
        const previousLocalY = previous.centerY - rect.top;
        const worldX = (previousLocalX - currentPan.x) / currentZoom;
        const worldY = (previousLocalY - currentPan.y) / currentZoom;
        setCanvasView(nextZoom, {
            x: centerX - rect.left - worldX * nextZoom,
            y: centerY - rect.top - worldY * nextZoom,
        });
        pinchRef.current = { distance, centerX, centerY };
    }

    function handleCanvasPointerEnd(e: ReactPointerEvent<HTMLDivElement>) {
        if (viewMode !== 'map') return;
        if (e.pointerType !== 'touch') return;
        touchPointersRef.current.delete(e.pointerId);
        if (touchPointersRef.current.size < 2) pinchRef.current = null;
        if (touchPointersRef.current.size === 0) panRef.current.panning = false;
    }

    function handleBackgroundPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
        if (viewMode !== 'map') return;
        if (e.target !== e.currentTarget) return;
        if (e.pointerType === 'touch' && touchPointersRef.current.size > 1) return;
        panRef.current.panning = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); setSelectedId(null);
    }
    function handleBackgroundPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
        if (viewMode !== 'map') return;
        if (!panRef.current.panning) return;
        const { zoom: currentZoom, pan: currentPan } = viewRef.current;
        setCanvasView(currentZoom, { x: currentPan.x + e.movementX, y: currentPan.y + e.movementY });
    }
    function handleBackgroundPointerUp() { panRef.current.panning = false; }

    function resetView() { centerRoot(1); }

    const groupedNotebooks = useMemo(() => [
        ...[...notebookGroups].sort((a, b) => a.sortOrder - b.sortOrder).map(({ name: groupName }) => ({
            groupName,
            notebooks: notebooks.filter((notebook) => notebook.groupName === groupName).sort((a, b) => a.sortOrder - b.sortOrder),
        })),
        {
            groupName: '',
            notebooks: notebooks.filter((notebook) => !notebook.groupName).sort((a, b) => a.sortOrder - b.sortOrder),
        },
    ], [notebookGroups, notebooks]);
    const pendingTranslationCount = nodes.filter((node) => node.translationPending).length;
    const forceTranslationCount = nodes.filter((node) => node.text.trim()).length;
    const contextNode = contextMenu ? nodes.find((node) => node.id === contextMenu.nodeId) : undefined;

    return (
        <div className={`${manrope.variable} ${inter.variable} flex h-full min-h-0 w-full min-w-0 overflow-hidden bg-[#FAFAFC]`} style={{ fontFamily: 'var(--font-ui)' }}>

            <div className={`transition-[width] duration-300 ease-in-out flex-shrink-0 z-20 ${isSidebarOpen ? 'w-64' : 'w-0'}`} style={{ overflow: 'hidden' }}>
                <aside className="w-64 flex h-full flex-col border-r border-[#E4E4ED] bg-white">
                    <div className="flex items-center justify-between border-b border-[#EEEDF6] px-3 py-3">
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-bold tracking-tight text-[#201F2E]" style={{ fontFamily: 'var(--font-display)' }}>Notebooks</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <button onClick={createNotebookGroup} aria-label="Create group" title="New group" className="flex h-8 w-8 items-center justify-center rounded-lg text-[#626174] hover:bg-[#F2F1FA] hover:text-[#4B33E0]">
                                <FolderPlusIcon />
                            </button>
                            <button onClick={() => setIsCreatingNotebook(true)} aria-label="Create notebook" title="New notebook" className="flex h-8 w-8 items-center justify-center rounded-lg text-[#626174] hover:bg-[#F2F1FA] hover:text-[#4B33E0]">
                                <NotebookPlusIcon />
                            </button>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto px-2 py-3">
                        {loadingNotebooks && <p className="px-2 py-2 text-xs text-[#A5A4B5]">Loading notebooks…</p>}
                        {isCreatingNotebook && (
                            <NotebookInputRow autoFocus placeholder="Subject name…" onSubmit={(title) => { if (title.trim()) createNotebook(title, selectedGroupName ?? ''); setIsCreatingNotebook(false); }} onCancel={() => setIsCreatingNotebook(false)} />
                        )}
                        {groupedNotebooks.map(({ groupName, notebooks: groupItems }) => (
                            <section
                                key={groupName || 'ungrouped'}
                                className="mb-2"
                                onDragOver={(event) => {
                                    if (sidebarDrag?.kind !== 'notebook') return;
                                    event.preventDefault();
                                    setSidebarDrop({ kind: 'group', id: groupName, position: 'inside' });
                                }}
                                onDrop={(event) => {
                                    if (sidebarDrag?.kind !== 'notebook') return;
                                    event.preventDefault();
                                    moveNotebookTo(sidebarDrag.id, groupName, null, 'inside');
                                    setSidebarDrag(null);
                                    setSidebarDrop(null);
                                }}
                            >
                                <div
                                    draggable={Boolean(groupName)}
                                    onDragStart={(event) => {
                                        if (!groupName) return;
                                        event.dataTransfer.effectAllowed = 'move';
                                        setSidebarDrag({ kind: 'group', id: groupName });
                                    }}
                                    onDragOver={(event) => {
                                        event.stopPropagation();
                                        event.preventDefault();
                                        if (sidebarDrag?.kind === 'notebook') {
                                            setSidebarDrop({ kind: 'group', id: groupName, position: 'inside' });
                                        } else if (sidebarDrag?.kind === 'group' && groupName && sidebarDrag.id !== groupName) {
                                            const bounds = event.currentTarget.getBoundingClientRect();
                                            setSidebarDrop({ kind: 'group', id: groupName, position: event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after' });
                                        }
                                    }}
                                    onDrop={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        if (!sidebarDrag) return;
                                        if (sidebarDrag.kind === 'notebook') {
                                            moveNotebookTo(sidebarDrag.id, groupName, null, 'inside');
                                        } else if (groupName && sidebarDrop?.kind === 'group') {
                                            reorderNotebookGroup(sidebarDrag.id, groupName, sidebarDrop.position === 'after' ? 'after' : 'before');
                                        }
                                        setSidebarDrag(null);
                                        setSidebarDrop(null);
                                    }}
                                    className={[
                                        'group/group mb-1 flex h-9 items-center gap-1 rounded-lg px-1 text-xs font-semibold transition-colors',
                                        groupName ? 'cursor-grab text-[#777687]' : 'text-[#A5A4B5]',
                                        selectedGroupName === groupName ? 'bg-[#F0F5F4] text-[#23675B]' : 'hover:bg-[#F7F7FB]',
                                        sidebarDrop?.kind === 'group' && sidebarDrop.id === groupName && sidebarDrop.position === 'inside' ? 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-300' : '',
                                        sidebarDrop?.kind === 'group' && sidebarDrop.id === groupName && sidebarDrop.position === 'before' ? 'border-t-2 border-emerald-500' : '',
                                        sidebarDrop?.kind === 'group' && sidebarDrop.id === groupName && sidebarDrop.position === 'after' ? 'border-b-2 border-emerald-500' : '',
                                    ].join(' ')}
                                >
                                    <button
                                        type="button"
                                        draggable={false}
                                        onClick={() => { setSelectedGroupName(groupName); toggleNotebookGroup(groupName); }}
                                        aria-expanded={!collapsedNotebookGroups.has(groupName)}
                                        aria-label={`${collapsedNotebookGroups.has(groupName) ? 'Show' : 'Hide'} notebooks in ${groupName || 'Ungrouped'}`}
                                        className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md px-1 text-left"
                                    >
                                        <FolderIcon />
                                        <span className="min-w-0 flex-1 truncate">{groupName || 'Ungrouped'}</span>
                                        <span className="text-[10px] font-medium text-[#A5A4B5]">{groupItems.length}</span>
                                    </button>
                                    {groupName && (
                                        <button
                                            type="button"
                                            draggable={false}
                                            onPointerDown={(event) => event.stopPropagation()}
                                            onClick={(event) => { event.stopPropagation(); void deleteNotebookGroup(groupName, groupItems.length); }}
                                            aria-label={`Delete ${groupName} group and its notebooks`}
                                            title="Delete group and notebooks"
                                            className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-[#A5A4B5] opacity-0 transition-opacity hover:bg-rose-50 hover:text-[#E5484D] focus-visible:opacity-100 group-hover/group:opacity-100"
                                        >
                                            <XIcon />
                                        </button>
                                    )}
                                </div>
                                {!collapsedNotebookGroups.has(groupName) && <div className="space-y-0.5 pl-2">
                                    {groupItems.map((nb) => (
                                        <div
                                            key={nb.id}
                                            draggable={editingNotebookId !== nb.id}
                                            onDragStart={(event) => {
                                                event.dataTransfer.effectAllowed = 'move';
                                                setSidebarDrag({ kind: 'notebook', id: nb.id });
                                            }}
                                            onDragOver={(event) => {
                                                if (!sidebarDrag || sidebarDrag.id === nb.id) return;
                                                event.preventDefault();
                                                const bounds = event.currentTarget.getBoundingClientRect();
                                                const position = event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after';
                                                setSidebarDrop({ kind: sidebarDrag.kind, id: sidebarDrag.kind === 'group' ? nb.groupName : nb.id, position });
                                            }}
                                            onDrop={(event) => {
                                                event.preventDefault();
                                                event.stopPropagation();
                                                if (sidebarDrag?.kind === 'notebook') moveNotebookTo(sidebarDrag.id, nb.groupName, nb.id, sidebarDrop?.position === 'after' ? 'after' : 'before');
                                                else if (sidebarDrag?.kind === 'group' && nb.groupName) reorderNotebookGroup(sidebarDrag.id, nb.groupName, sidebarDrop?.position === 'after' ? 'after' : 'before');
                                                setSidebarDrag(null);
                                                setSidebarDrop(null);
                                            }}
                                            onDragEnd={() => { setSidebarDrag(null); setSidebarDrop(null); }}
                                            onContextMenu={(event) => {
                                                event.preventDefault();
                                                event.stopPropagation();
                                                setContextMenu(null);
                                                setNotebookContextMenu({ x: event.clientX, y: event.clientY, notebookId: nb.id });
                                            }}
                                            className={[
                                                'group/notebook relative flex min-w-0 items-center rounded-lg text-sm transition-colors',
                                                nb.id === activeNotebookId ? 'bg-[#EFECFF] text-[#4B33E0]' : 'text-[#4B4A5C] hover:bg-[#F7F7FB]',
                                                sidebarDrop?.kind === 'notebook' && sidebarDrop.id === nb.id && sidebarDrop.position === 'before' ? 'border-t-2 border-sky-500' : '',
                                                sidebarDrop?.kind === 'notebook' && sidebarDrop.id === nb.id && sidebarDrop.position === 'after' ? 'border-b-2 border-sky-500' : '',
                                            ].join(' ')}
                                        >
                                            {editingNotebookId === nb.id ? (
                                                <NotebookInputRow autoFocus defaultValue={nb.title} onSubmit={(title) => { renameNotebook(nb.id, title); setEditingNotebookId(null); }} onCancel={() => setEditingNotebookId(null)} />
                                            ) : (
                                                <>
                                                    <span className="pl-2 text-[#A5A4B5]"><NotebookIcon /></span>
                                                    <button onClick={() => { setActiveNotebookId(nb.id); setSelectedGroupName(nb.groupName); }} onDoubleClick={() => setEditingNotebookId(nb.id)} className="min-w-0 flex-1 truncate px-2 py-2 text-left font-medium">{nb.title}</button>
                                                    <button onClick={() => deleteNotebook(nb.id)} aria-label={`Delete ${nb.title}`} title="Delete notebook" className="mr-1 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-[#A5A4B5] opacity-0 hover:bg-rose-50 hover:text-[#E5484D] group-hover/notebook:opacity-100"><XIcon /></button>
                                                </>
                                            )}
                                        </div>
                                    ))}
                                    {groupItems.length === 0 && <p className="px-3 py-1.5 text-[11px] text-[#B0AFBD]">Drop notebooks here</p>}
                                </div>}
                            </section>
                        ))}
                    </div>
                </aside>
            </div>

            <main
                ref={containerRef}
                className={`relative flex-1 ${viewMode === 'map' ? 'select-none overflow-hidden' : 'overflow-y-auto bg-[#F8F8F6]'}`}
                style={{
                    height: '100%',
                    backgroundImage: viewMode === 'map' ? 'linear-gradient(to right, #E4E4ED66 1px, transparent 1px), linear-gradient(to bottom, #E4E4ED66 1px, transparent 1px)' : 'none',
                    backgroundSize: `${40 * zoom}px ${40 * zoom}px`,
                    backgroundPosition: `${pan.x}px ${pan.y}px`,
                    touchAction: viewMode === 'map' ? 'none' : 'auto',
                    overflow: viewMode === 'map' ? 'clip' : 'auto',
                    overscrollBehavior: 'none',
                }}
                onScroll={(e) => {
                    if (viewMode !== 'map') return;
                    const el = e.currentTarget;
                    if (el.scrollLeft || el.scrollTop) el.scrollTo(0, 0);
                }}
                onContextMenu={(e) => { if (viewMode === 'map') e.preventDefault(); }}
                onPointerDown={(e: ReactPointerEvent<HTMLDivElement>) => { setBoardActive(true); handleCanvasPointerDown(e); handleBackgroundPointerDown(e); }}
                onPointerMove={(e: ReactPointerEvent<HTMLDivElement>) => { setBoardActive(true); handleCanvasPointerMove(e); handleBackgroundPointerMove(e); }}
                onPointerUp={(e: ReactPointerEvent<HTMLDivElement>) => { setBoardActive(true); handleCanvasPointerEnd(e); handleBackgroundPointerUp(); }}
                onPointerCancel={(e: ReactPointerEvent<HTMLDivElement>) => { handleCanvasPointerEnd(e); handleBackgroundPointerUp(); }}
                onPointerLeave={() => { setBoardActive(false); handleBackgroundPointerUp(); }}
                onMouseEnter={() => setBoardActive(true)}
                onMouseLeave={() => setBoardActive(false)}
            >
                <div data-canvas-controls className="sticky top-0 z-10 flex items-center gap-2 overflow-x-auto px-4 pt-4 pb-2">
                    <button onClick={() => setIsSidebarOpen(v => !v)} className="flex h-10 w-10 items-center justify-center rounded-xl bg-white border border-[#E4E4ED] shadow-sm text-[#4B4A5C] hover:bg-[#F2F1FA] transition-colors">
                        <PanelLeftIcon />
                    </button>
                    <button onClick={() => createNode(null, '', 'text')} disabled={!activeNotebookId} className="flex h-10 flex-shrink-0 items-center justify-center gap-1.5 rounded-xl bg-[#7B61FF] px-4 font-bold text-sm text-white shadow hover:bg-[#6A4FF5] transition-colors disabled:cursor-not-allowed disabled:opacity-40">
                        <PlusIcon /> Add
                    </button>
                    <div role="group" aria-label="Mindmap view" className="flex h-10 flex-shrink-0 items-center rounded-xl border border-[#E4E4ED] bg-white p-1 shadow-sm">
                        <button type="button" aria-pressed={viewMode === 'map'} onClick={() => setViewMode('map')} className={`h-8 rounded-lg px-3 text-sm font-semibold transition-colors ${viewMode === 'map' ? 'bg-[#2B2A3D] text-white' : 'text-[#626174] hover:bg-[#F2F1FA]'}`}>Map</button>
                        <button type="button" aria-pressed={viewMode === 'document'} onClick={() => setViewMode('document')} className={`h-8 rounded-lg px-3 text-sm font-semibold transition-colors ${viewMode === 'document' ? 'bg-[#2B2A3D] text-white' : 'text-[#626174] hover:bg-[#F2F1FA]'}`}>Document</button>
                    </div>
                    {viewMode === 'document' && (
                        <div role="group" aria-label="Document controls" className="flex h-10 flex-shrink-0 items-center gap-2 text-sm font-semibold text-[#4B4A5C]">
                            <button
                                type="button"
                                onClick={() => documentActionsRef.current?.expandAll()}
                                disabled={loadingNodes || nodes.length === 0}
                                className="h-9 rounded-lg border border-[#E4E4ED] bg-white px-3 shadow-sm transition-colors hover:bg-[#F7F7FB] disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                Expand all
                            </button>
                            <button
                                type="button"
                                onClick={() => documentActionsRef.current?.collapseAll()}
                                disabled={loadingNodes || nodes.length === 0}
                                className="h-9 rounded-lg border border-[#E4E4ED] bg-white px-3 shadow-sm transition-colors hover:bg-[#F7F7FB] disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                Collapse all
                            </button>
                            {isDocumentEditing ? (
                                <>
                                    <button
                                        type="button"
                                        onClick={() => documentActionsRef.current?.cancelEditing()}
                                        disabled={isDocumentSaving}
                                        className="h-9 rounded-lg border border-[#E4E4ED] bg-white px-3 shadow-sm transition-colors hover:bg-[#F7F7FB] disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => { void documentActionsRef.current?.saveChanges(); }}
                                        disabled={isDocumentSaving}
                                        className="h-9 rounded-lg border border-[#2B2A3D] bg-[#2B2A3D] px-3 text-white shadow-sm transition-colors hover:bg-[#424153] disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        {isDocumentSaving ? 'Saving…' : 'Save'}
                                    </button>
                                </>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => documentActionsRef.current?.beginEditing()}
                                    disabled={loadingNodes || nodes.length === 0}
                                    className="h-9 rounded-lg border border-[#E4E4ED] bg-white px-3 shadow-sm transition-colors hover:bg-[#F7F7FB] disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                    Edit
                                </button>
                            )}
                        </div>
                    )}
                    {viewMode === 'map' && <button onClick={rearrangeAll} disabled={!activeNotebookId} className="flex h-10 flex-shrink-0 items-center justify-center gap-1.5 rounded-xl bg-white border border-[#E4E4ED] px-4 font-bold text-sm text-[#4B4A5C] shadow-sm hover:bg-[#F2F1FA] transition-colors disabled:cursor-not-allowed disabled:opacity-40">
                        <SparkleIcon /> Re-arrange
                    </button>}
                    <select
                        aria-label="Board language"
                        value={activeLanguage}
                        disabled={!activeNotebookId}
                        onChange={(event) => { void changeNotebookLanguage(event.target.value as Language); }}
                        className="h-10 flex-shrink-0 rounded-xl border border-[#E4E4ED] bg-white px-3 text-sm font-semibold text-[#4B4A5C] shadow-sm outline-none focus:border-[#7B61FF] disabled:opacity-40"
                    >
                        {LANGUAGES.map((language) => <option key={language} value={language}>{LANGUAGE_LABELS[language]}</option>)}
                    </select>
                    {/* Keep batch actions for future use; hide them while per-node translation is preferred. */}
                    <button
                        onClick={() => { if (activeNotebookId) void runPendingTranslations(activeNotebookId, 'manual'); }}
                        disabled={!activeNotebookId || pendingTranslationCount === 0 || isTranslating}
                        title="Translate missing languages for nodes without current translations"
                        className=" flex h-10 flex-shrink-0 items-center justify-center gap-1.5 rounded-xl border border-[#E4E4ED] bg-white px-3 text-sm font-semibold text-[#4B4A5C] shadow-sm hover:bg-[#F2F1FA] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        <SparkleIcon /> {isTranslating ? 'Translating…' : `Translate missing (${pendingTranslationCount})`}
                    </button>
                    <button
                        onClick={() => {
                            if (!activeNotebookId || forceTranslationCount === 0) return;
                            const confirmed = window.confirm(`Re-translate all ${forceTranslationCount} non-empty nodes into the other languages? This will overwrite current translations and use AI credits.`);
                            if (confirmed) void runPendingTranslations(activeNotebookId, 'force');
                        }}
                        disabled={!activeNotebookId || forceTranslationCount === 0 || isTranslating}
                        title="Overwrite existing translations for every non-empty node in this board"
                        className="hidden flex h-10 flex-shrink-0 items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-white px-3 text-sm font-semibold text-rose-700 shadow-sm hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        <SparkleIcon /> Force retranslate ({forceTranslationCount})
                    </button>
                    {viewMode === 'map' && <div className="flex h-10 flex-shrink-0 items-center gap-1 rounded-xl border border-[#E4E4ED] bg-white px-1 shadow-sm">
                        <button
                            type="button"
                            onClick={() => historyActionsRef.current.undo()}
                            disabled={!historyFlags.undo}
                            title={historyFlags.undo ? `Undo ${historyFlags.undo} (Ctrl+Z)` : 'Nothing to undo'}
                            aria-label="Undo"
                            className="rounded-lg px-2 py-1 text-xs font-semibold text-[#4B4A5C] hover:bg-[#F2F1FA] disabled:cursor-not-allowed disabled:opacity-40"
                        >Undo</button>
                        <button
                            type="button"
                            onClick={() => historyActionsRef.current.redo()}
                            disabled={!historyFlags.redo}
                            title={historyFlags.redo ? `Redo ${historyFlags.redo} (Ctrl+Y)` : 'Nothing to redo'}
                            aria-label="Redo"
                            className="rounded-lg px-2 py-1 text-xs font-semibold text-[#4B4A5C] hover:bg-[#F2F1FA] disabled:cursor-not-allowed disabled:opacity-40"
                        >Redo</button>
                    </div>}
                    {viewMode === 'map' && <label className="flex items-center gap-2 rounded-xl border border-[#E4E4ED] bg-white px-3 py-2 text-xs font-semibold text-[#4B4A5C] shadow-sm">
                        <span>Auto format</span>
                        <button
                            type="button"
                            aria-label="Toggle auto arrange"
                            onClick={() => setAutoFormat((value) => !value)}
                            className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${autoFormat ? 'bg-[#7B61FF]' : 'bg-[#D9D7E6]'}`}>
                            <span className={`absolute top-1 left-0 h-4 w-4 rounded-full bg-white transition-transform ${autoFormat ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                    </label>}
                    {viewMode === 'map' && <div className="flex h-10 flex-shrink-0 items-center gap-1 rounded-xl bg-white border border-[#E4E4ED] px-2 shadow-sm text-[#4B4A5C]">
                        <button onClick={() => zoomBy(-0.1)} className="flex h-7 w-7 items-center justify-center rounded-lg text-base font-medium hover:bg-[#F2F1FA]">−</button>
                        <span className="min-w-[46px] text-center text-xs font-bold text-[#8A8A9A]">{Math.round(zoom * 100)}%</span>
                        <button
                            onClick={resetView}
                            disabled={!nodes.some((node) => node.parentId === null)}
                            aria-label="Center on root node"
                            title="Center on root node"
                            className="flex h-7 w-7 items-center justify-center rounded-lg text-[#4B4A5C] hover:bg-[#F2F1FA] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            <CenterIcon />
                        </button>
                        <button onClick={() => zoomBy(0.1)} className="flex h-7 w-7 items-center justify-center rounded-lg text-base font-medium hover:bg-[#F2F1FA]">+</button>
                    </div>}
                </div>


                {viewMode === 'document' ? (
                    <MindmapDocumentView
                        ref={documentActionsRef}
                        key={activeNotebook?.id ?? 'empty'}
                        notebook={activeNotebook}
                        nodes={nodes}
                        loading={loadingNodes}
                        onEditingChange={handleDocumentEditingChange}
                        onSavingChange={handleDocumentSavingChange}
                        onSaveNodeText={(id, text) => updateNodeProps(id, { text }, { throwOnError: true })}
                    />
                ) : <div className="absolute left-0 top-0" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0' }}>
                    <svg style={{ position: 'absolute', left: 0, top: 0, width: 6000, height: 4000, overflow: 'visible', pointerEvents: 'none' }}>
                        {edges.map((edge) => <path key={edge.id} d={edge.d} fill="none" stroke="#B9AEFF" strokeWidth={2.5} strokeLinecap="round" />)}
                    </svg>

                    {visibleNodes.map((node) => {
                        const isRoot = node.parentId === null;
                        const isSelected = selectedId === node.id;
                        const childCount = childCounts.get(node.id) ?? 0;
                        const comparison = nodeComparisons[node.id];
                        return (
                            <div
                                key={node.id} id={`node-${node.id}`} data-node-id={node.id}
                                className={[
                                    'group absolute rounded-2xl border shadow-sm transition-shadow flex flex-col items-stretch justify-center',
                                    isRoot ? 'border-[#2B2A3D] text-white' : 'border-[#DEDCEB] text-[#201F2E]',
                                    isSelected ? 'ring-2 ring-[#7B61FF] ring-offset-2 ring-offset-[#FAFAFC]' : '',
                                    dropTargetId === node.id ? 'ring-2 ring-[#19A974] ring-offset-2' : '',
                                ].join(' ')}
                                style={{
                                    left: node.x, top: node.y, width: comparison ? (node.width || DEFAULT_W) * 2 + 16 : node.width || DEFAULT_W,
                                    minHeight: node.imageUrl ? undefined : node.height || DEFAULT_H,
                                    backgroundColor: node.color || (isRoot ? '#2B2A3D' : '#ffffff'),
                                    cursor: dragRef.current.id === node.id ? 'grabbing' : 'grab',
                                    zIndex: dragRef.current.type === 'move' && dragRef.current.id === node.id ? 0 : 1,
                                    userSelect: 'none',
                                }}
                                onPointerDown={(e) => handleNodePointerDown(e, node)} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp}
                                onDoubleClick={(e) => { e.stopPropagation(); setEditingId(node.id); }}
                                onContextMenu={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setSelectedId(node.id);
                                    setTranslationTargetLanguage(otherLanguages(activeLanguage)[0]);
                                    setContextMenu({ x: e.clientX, y: e.clientY, nodeId: node.id });
                                }}
                            >
                                {node.imageUrl && (
                                    <div id={`node-media-${node.id}`} className="flex w-full flex-shrink-0 items-center justify-center overflow-hidden rounded-t-2xl p-1.5" style={{ height: node.height || DEFAULT_H }}>
                                        <img src={node.imageUrl} alt="Mindmap attachment" className="max-w-full max-h-full object-contain select-none pointer-events-none" />
                                    </div>
                                )}

                                {(!node.imageUrl || node.text || editingId === node.id) && (
                                    <div className={`flex w-full items-stretch ${node.imageUrl ? 'min-h-12 border-t border-black/10' : 'h-full'}`}>
                                        <div className={`${comparison ? 'w-1/2 border-r border-black/10' : 'w-full'} flex min-w-0 items-center ${node.imageUrl ? 'px-3 py-2' : 'px-4 py-3'}`}>
                                            {editingId === node.id ? (
                                                <textarea
                                                    autoFocus defaultValue={node.text} onPointerDown={(e) => e.stopPropagation()}
                                                    onBlur={(e) => { if (e.target.value !== node.text) updateNodeProps(node.id, { text: e.target.value }); setEditingId(prev => prev === node.id ? null : prev); }}
                                                    onChange={(e) => {
                                                        const text = e.currentTarget.value;
                                                        const width = !node.autoWidth
                                                            ? node.width || DEFAULT_W
                                                            : getAutoNodeWidth(text);
                                                        applyNodes(nodesRef.current.map((item) => item.id === node.id ? { ...item, width } : item));
                                                    }}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter' && !e.shiftKey) {
                                                            e.preventDefault();
                                                            updateNodeProps(node.id, { text: e.currentTarget.value });
                                                            if (e.ctrlKey || e.metaKey) {
                                                                const parentNode = nodes.find(n => n.id === node.parentId);
                                                                createNode(parentNode ? parentNode.parentId : null, '', 'text');
                                                            } else {
                                                                createNode(node.parentId, '', 'text');
                                                            }
                                                        } else if (e.key === 'Tab') {
                                                            e.preventDefault();
                                                            updateNodeProps(node.id, { text: e.currentTarget.value });
                                                            createNode(node.id, '', 'text');
                                                        } else if (e.key === 'Escape') {
                                                            setEditingId(null);
                                                        }
                                                    }}
                                                    className={`w-full bg-transparent text-[15px] font-semibold outline-none resize-none overflow-hidden ${isRoot && !node.color ? 'text-white' : 'text-[#201F2E]'}`}
                                                    style={{ minHeight: '40px', fieldSizing: 'content', userSelect: 'text', textAlign: node.textAlign } as React.CSSProperties}
                                                />
                                            ) : (
                                                <p className="whitespace-pre-wrap break-words text-[15px] font-semibold w-full leading-snug" style={{ fontFamily: 'var(--font-display)', color: isRoot && !node.color ? 'white' : '#201F2E', textAlign: node.textAlign }}>
                                                    {node.text}
                                                </p>
                                            )}
                                        </div>
                                        {comparison && (
                                            <div className="flex w-1/2 min-w-0 flex-col justify-center px-3 py-3" lang={comparison.language}>
                                                <span className="mb-1 text-[10px] font-bold uppercase text-[#777687]">{LANGUAGE_LABELS[comparison.language]}</span>
                                                <p className="whitespace-pre-wrap break-words text-[15px] font-semibold leading-snug text-[#201F2E]" style={{ fontFamily: 'var(--font-display)' }}>{comparison.text}</p>
                                            </div>
                                        )}
                                    </div>
                                )}

                                <button onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); createNode(node.id, '', 'text'); }} className="absolute -right-3 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-[#7B61FF] text-white opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100 hover:bg-[#6A4FF5]"><PlusIcon /></button>
                                {childCount > 0 && (
                                    <button
                                        type="button"
                                        onPointerDown={(e) => e.stopPropagation()}
                                        onClick={(e) => { e.stopPropagation(); toggleChildren(node.id); }}
                                        aria-label={`${collapsedNodeIds.has(node.id) ? 'Show' : 'Hide'} ${childCount} child nodes`}
                                        title={`${collapsedNodeIds.has(node.id) ? 'Show' : 'Hide'} child nodes`}
                                        className="absolute -bottom-3 left-1/2 z-10 flex h-6 min-w-6 -translate-x-1/2 items-center justify-center gap-1 rounded-full border border-[#DEDCEB] bg-white px-1.5 text-[10px] font-semibold text-[#686779] shadow-sm hover:border-[#7B61FF] hover:text-[#4B33E0]"
                                    >
                                        <span>{collapsedNodeIds.has(node.id) ? '+' : '−'}</span><span>{childCount}</span>
                                    </button>
                                )}
                                <div onPointerDown={(e) => handleResizePointerDown(e, node)} className={`absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize opacity-0 group-hover:opacity-100 ${isSelected ? 'opacity-100' : ''}`} style={{ background: 'linear-gradient(135deg, transparent 50%, #B9AEFF 50%)', borderBottomRightRadius: '14px' }} />
                            </div>
                        );
                    })}
                </div>}
            </main>

            {recentlyDeletedNotebook && (
                <div className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-[#E4E4ED] bg-white px-4 py-3 text-sm text-[#333244] shadow-xl">
                    <span>Notebook moved to trash.</span>
                    <button onClick={restoreNotebook} className="font-bold text-[#5B45E5] hover:text-[#432FC7]">Undo</button>
                </div>
            )}

            {historyToast && (
                <div role="status" className="pointer-events-none fixed bottom-20 left-1/2 z-40 -translate-x-1/2 rounded-xl bg-[#2B2A3D] px-4 py-2 text-sm font-semibold text-white shadow-xl">
                    {historyToast}
                </div>
            )}

            {contextMenu && (
                <div ref={contextMenuRef} style={{ position: 'fixed', left: contextMenu.x, top: contextMenu.y }} className="z-50 max-h-[calc(100vh-1rem)] w-56 overflow-y-auto rounded-xl border border-[#E4E4ED] bg-white py-1.5 shadow-xl text-black">
                    <div className="border-y border-[#EEEDF6] px-3 py-2.5">
                        <label className="mb-2 block text-xs font-semibold text-[#626174]" htmlFor="node-translation-language">Translate this note to</label>
                        <select
                            id="node-translation-language"
                            value={translationTargetLanguage}
                            onChange={(event) => setTranslationTargetLanguage(event.target.value as Language)}
                            className="mb-2 h-8 w-full rounded-md border border-[#DEDCEB] bg-white px-2 text-sm text-[#333244] outline-none focus:border-[#7B61FF]"
                        >
                            {otherLanguages(activeLanguage).map((language) => (
                                <option key={language} value={language}>{LANGUAGE_LABELS[language]}</option>
                            ))}
                        </select>
                        <button
                            type="button"
                            disabled={translatingNodeId === contextMenu.nodeId}
                            onClick={() => void toggleNodeComparison(contextMenu.nodeId, translationTargetLanguage)}
                            className="mb-1 flex h-9 w-full items-center justify-center rounded-md bg-[#2B2A3D] px-2 text-xs font-bold text-white hover:bg-[#424153] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {translatingNodeId === contextMenu.nodeId
                                ? 'Translating…'
                                : nodeComparisons[contextMenu.nodeId]?.language === translationTargetLanguage
                                    ? 'Hide translation'
                                    : 'Show translation'}
                        </button>
                        <button
                            type="button"
                            disabled={translatingNodeId === contextMenu.nodeId || !contextNode?.text.trim()}
                            onClick={() => void translateNodeToLanguage(contextMenu.nodeId, translationTargetLanguage)}
                            className="flex h-8 w-full items-center justify-center rounded-md px-2 text-xs font-semibold text-[#626174] hover:bg-[#F2F1FA] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {translatingNodeId === contextMenu.nodeId ? 'Translating…' : 'Force retranslate'}
                        </button>
                    </div>

                    <MenuItem label="Add child idea" onClick={() => { createNode(contextMenu.nodeId, '', 'text'); setContextMenu(null); }} />
                    <MenuItem label="Rename" onClick={() => { setEditingId(contextMenu.nodeId); setContextMenu(null); }} />

                    <div className="px-3 py-2">
                        <p className="mb-1.5 text-xs font-medium text-[#777687]">Text alignment</p>
                        <div className="flex gap-1">
                            {(['left', 'center', 'right'] as const).map((alignment) => (
                                <button
                                    key={alignment}
                                    type="button"
                                    aria-label={`Align text ${alignment}`}
                                    title={`Align ${alignment}`}
                                    onClick={() => { updateNodeProps(contextMenu.nodeId, { textAlign: alignment }); setContextMenu(null); }}
                                    className={`flex h-8 flex-1 items-center justify-center rounded-md ${contextNode?.textAlign === alignment ? 'bg-[#EFECFF] text-[#4B33E0]' : 'text-[#626174] hover:bg-[#F2F1FA]'}`}
                                >
                                    <AlignIcon alignment={alignment} />
                                </button>
                            ))}
                        </div>
                    </div>

                    {contextNode?.type === 'image' && (
                        <button className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-[#333244] hover:bg-[#F2F1FA] transition-colors" onClick={() => updateNodeProps(contextNode.id, { preserveAspect: !contextNode.preserveAspect })}>
                            Preserve Aspect Ratio <span>{contextNode.preserveAspect ? '✅' : '❌'}</span>
                        </button>
                    )}

                    <div className="px-3 py-2 flex gap-2">
                        {NODE_COLORS.map(c => (
                            <button key={c} onClick={() => { updateNodeProps(contextMenu.nodeId, { color: c === '#FFFFFF' ? null : c }); setContextMenu(null); }} className="w-6 h-6 rounded-full border border-gray-200 hover:scale-110 transition-transform shadow-sm" style={{ backgroundColor: c }} title="Change color" />
                        ))}
                    </div>

                    <div className="my-1 h-px bg-[#EEEDF6]" />
                    <MenuItem label="Delete" danger onClick={() => { deleteNode(contextMenu.nodeId); setContextMenu(null); }} />

                    <div className="mt-1 border-t border-[#EEEDF6] px-3 py-2.5">
                        <p className="mb-2 text-[11px] font-semibold text-[#777687]">AI provider and model</p>
                        <label htmlFor="node-ai-provider" className="sr-only">AI provider</label>
                        <select
                            id="node-ai-provider"
                            value={translationProvider}
                            onChange={(event) => {
                                const provider = event.target.value as AIProvider;
                                setTranslationProvider(provider);
                                setTranslationModel(AI_MODELS[provider][0].id);
                            }}
                            className="mb-2 h-8 w-full rounded-md border border-[#DEDCEB] bg-white px-2 text-xs text-[#333244] outline-none focus:border-[#7B61FF]"
                        >
                            <option value="openai">OpenAI</option>
                            <option value="gemini">Google Gemini</option>
                        </select>
                        <label htmlFor="node-ai-model" className="sr-only">AI model</label>
                        <select
                            id="node-ai-model"
                            value={translationModel}
                            onChange={(event) => setTranslationModel(event.target.value)}
                            className="h-8 w-full rounded-md border border-[#DEDCEB] bg-white px-2 text-xs text-[#333244] outline-none focus:border-[#7B61FF]"
                        >
                            {AI_MODELS[translationProvider].map((model) => (
                                <option key={model.id} value={model.id}>{model.label}</option>
                            ))}
                        </select>
                    </div>
                </div>
            )}

            {notebookContextMenu && (
                <div ref={notebookContextMenuRef} style={{ position: 'fixed', left: notebookContextMenu.x, top: notebookContextMenu.y }} className="z-50 w-52 overflow-hidden rounded-xl border border-[#E4E4ED] bg-white py-1.5 shadow-xl text-black">
                    <MenuItem label="Notebook description…" onClick={() => {
                        const notebook = notebooks.find((item) => item.id === notebookContextMenu.notebookId);
                        if (notebook) setDescriptionEditor({ notebookId: notebook.id, value: notebook.description });
                        setNotebookContextMenu(null);
                    }} />
                </div>
            )}

            {descriptionEditor && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/25 p-4" onPointerDown={(event) => { if (event.target === event.currentTarget) setDescriptionEditor(null); }}>
                    <section role="dialog" aria-modal="true" aria-labelledby="notebook-description-title" className="w-full max-w-lg rounded-xl border border-[#E4E4ED] bg-white p-5 shadow-2xl">
                        <h2 id="notebook-description-title" className="mb-3 text-base font-bold text-[#201F2E]">Notebook description</h2>
                        <textarea
                            autoFocus
                            maxLength={2000}
                            value={descriptionEditor.value}
                            onChange={(event) => setDescriptionEditor({ ...descriptionEditor, value: event.target.value })}
                            className="min-h-36 w-full resize-y rounded-lg border border-[#DEDCEB] px-3 py-2 text-sm text-[#201F2E] outline-none focus:border-[#7B61FF]"
                        />
                        <div className="mt-4 flex justify-end gap-2">
                            <button onClick={() => setDescriptionEditor(null)} className="h-9 rounded-lg px-3 text-sm font-semibold text-[#626174] hover:bg-[#F2F1FA]">Cancel</button>
                            <button onClick={() => void saveNotebookDescription()} className="h-9 rounded-lg bg-[#2B2A3D] px-4 text-sm font-semibold text-white hover:bg-[#424153]">Save</button>
                        </div>
                    </section>
                </div>
            )}

            {error && (
                <div role="alert" className="fixed bottom-5 left-1/2 z-[70] flex max-w-[min(90vw,36rem)] -translate-x-1/2 items-center gap-3 rounded-lg border border-rose-200 bg-white px-4 py-3 text-sm text-rose-800 shadow-xl">
                    <span>{error}</span>
                    <button type="button" aria-label="Dismiss error" onClick={() => setError(null)} className="ml-2 font-bold">×</button>
                </div>
            )}
        </div>
    );
}

function NotebookInputRow({ defaultValue = '', placeholder, autoFocus, onSubmit, onCancel }: { defaultValue?: string; placeholder?: string; autoFocus?: boolean; onSubmit: (value: string) => void; onCancel: () => void; }) {
    const cancelOnBlur = useRef(false);
    return (
        <input autoFocus={autoFocus} defaultValue={defaultValue} placeholder={placeholder} onBlur={(e) => { if (!cancelOnBlur.current) onSubmit(e.target.value); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { cancelOnBlur.current = true; onCancel(); } }} className="mb-1 w-full rounded-xl border border-[#DEDCEB] bg-white px-3 py-2 text-sm font-medium text-[#201F2E] outline-none focus:border-[#7B61FF]" />
    );
}

function MenuItem({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
    return <button onClick={onClick} className={`flex w-full items-center px-3 py-2 text-left text-sm transition-colors ${danger ? 'text-[#E5484D] hover:bg-[#FDEDED]' : 'text-[#333244] hover:bg-[#F2F1FA]'}`}>{label}</button>;
}

function PanelLeftIcon() {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><line x1="9" y1="3" x2="9" y2="21" /></svg>;
}

function PlusIcon() {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" className="h-3.5 w-3.5"><path d="M12 5v14M5 12h14" /></svg>;
}

function XIcon() {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" className="h-3 w-3"><path d="M6 6l12 12M18 6L6 18" /></svg>;
}

function SparkleIcon() {
    return <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5"><path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8L12 2z" /></svg>;
}

function CenterIcon() {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><circle cx="12" cy="12" r="3" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3" /></svg>;
}

function AlignIcon({ alignment }: { alignment: 'left' | 'center' | 'right' }) {
    const lines = alignment === 'left' ? [[4, 8, 18], [4, 12, 13], [4, 16, 20]]
        : alignment === 'right' ? [[6, 8, 20], [11, 12, 20], [4, 16, 20]]
            : [[5, 8, 19], [8, 12, 16], [4, 16, 20]];
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="h-4 w-4">{lines.map(([x1, y, x2]) => <line key={y} x1={x1} y1={y} x2={x2} y2={y} />)}</svg>;
}

function FolderIcon() {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 flex-shrink-0"><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H10l2 2h7.5A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" /></svg>;
}

function FolderPlusIcon() {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]"><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H10l2 2h6.5A1.5 1.5 0 0 1 20 9.5v3" /><path d="M17 16v6m-3-3h6" /><path d="M3 9v8.5A1.5 1.5 0 0 0 4.5 19H12" /></svg>;
}

function NotebookIcon() {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5"><rect x="5" y="3" width="15" height="18" rx="2" /><path d="M9 3v18M2.5 7h2.5m-2.5 5h2.5m-2.5 5h2.5" /></svg>;
}

function NotebookPlusIcon() {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]"><rect x="4" y="3" width="13" height="18" rx="2" /><path d="M8 3v18M2 7h2m-2 5h2m-2 5h2m15-8v7m-3.5-3.5h7" /></svg>;
}
