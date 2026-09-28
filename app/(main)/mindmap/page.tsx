'use client';

import {
    useEffect,
    useMemo,
    useRef,
    useState,
    type MouseEvent as ReactMouseEvent,
    type PointerEvent as ReactPointerEvent,
} from 'react';
import { Manrope, Inter } from 'next/font/google';

const manrope = Manrope({ subsets: ['latin'], weight: ['600', '700', '800'], variable: '--font-display' });
const inter = Inter({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-ui' });

const API_BASE = '/api/mindmap';

type Notebook = { id: string; title: string };

type MindNode = {
    id: string; notebookId: string; parentId: string | null;
    text: string; x: number; y: number;
    type: 'text' | 'image'; width: number; height: number;
    imageUrl: string | null; preserveAspect: boolean; color: string | null;
};

const DEFAULT_W = 208, DEFAULT_H = 60;
const LEVEL_GAP_X = 64, SIBLING_GAP = 28, TREE_GAP = 64;
const MIN_ZOOM = 0.2, MAX_ZOOM = 3, DEFAULT_PAN = { x: 160, y: 180 };
const NODE_COLORS = ['#FFFFFF', '#FFEFE5', '#E5F4FF', '#EAFCE9', '#F4E5FF', '#FFF0F0'];

async function apiFetch(path: string, options?: RequestInit) {
    const res = await fetch(path, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
}

// LOGIC ĐỈNH: Sắp xếp các node cùng cha dựa trên TỌA ĐỘ Y HIỆN TẠI thay vì thứ tự tạo.
function buildChildrenMap(nodes: MindNode[]) {
    const map = new Map<string | null, MindNode[]>();
    for (const n of nodes) {
        const arr = map.get(n.parentId) ?? [];
        arr.push(n);
        map.set(n.parentId, arr);
    }
    // Sắp xếp lại mỗi nhánh theo tọa độ Y trực quan trên màn hình
    map.forEach(arr => arr.sort((a, b) => a.y - b.y));
    return map;
}

function layoutTree(nodes: MindNode[]): MindNode[] {
    const byParent = buildChildrenMap(nodes);
    const positions = new Map<string, { x: number; y: number }>();

    const getRealSize = (id: string, fallbackW: number, fallbackH: number) => {
        if (typeof document !== 'undefined') {
            const el = document.getElementById(`node-${id}`);
            if (el) return { w: el.offsetWidth, h: el.offsetHeight };
        }
        return { w: Math.max(fallbackW, DEFAULT_W), h: Math.max(fallbackH, DEFAULT_H) };
    };

    const subtreeHeight = new Map<string, number>();
    function calcSubtree(nodeId: string): number {
        const children = byParent.get(nodeId) ?? [];
        const node = nodes.find(n => n.id === nodeId)!;
        const size = getRealSize(nodeId, node.width, node.height);

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
        const node = nodes.find(n => n.id === nodeId)!;
        const size = getRealSize(nodeId, node.width, node.height);
        const children = byParent.get(nodeId) ?? [];
        const stHeight = subtreeHeight.get(nodeId)!;

        const nodeY = startY + (stHeight / 2) - (size.h / 2);
        positions.set(nodeId, { x, y: nodeY });

        let childrenTotalH = 0;
        for (const c of children) childrenTotalH += subtreeHeight.get(c.id)!;
        childrenTotalH += Math.max(0, children.length - 1) * SIBLING_GAP;

        let childStartY = startY + (stHeight / 2) - (childrenTotalH / 2);
        for (const c of children) {
            const cStHeight = subtreeHeight.get(c.id)!;
            place(c.id, x + size.w + LEVEL_GAP_X, childStartY);
            childStartY += cStHeight + SIBLING_GAP;
        }
    }

    let currentY = 0;
    for (const root of roots) {
        const h = subtreeHeight.get(root.id)!;
        place(root.id, 0, currentY);
        currentY += h + TREE_GAP;
    }

    return nodes.map((n) => {
        const pos = positions.get(n.id);
        return pos ? { ...n, x: pos.x, y: pos.y } : n;
    });
}

function collectSubtreeIds(nodes: MindNode[], rootId: string): Set<string> {
    const ids = new Set<string>([rootId]);
    let changed = true;
    while (changed) {
        changed = false;
        for (const n of nodes) {
            if (n.parentId && ids.has(n.parentId) && !ids.has(n.id)) {
                ids.add(n.id); changed = true;
            }
        }
    }
    return ids;
}

export default function MindmapPage() {
    const [notebooks, setNotebooks] = useState<Notebook[]>([]);
    const [activeNotebookId, setActiveNotebookId] = useState<string | null>(null);
    const [loadingNotebooks, setLoadingNotebooks] = useState(true);
    const [loadingNodes, setLoadingNodes] = useState(false);
    const [isCreatingNotebook, setIsCreatingNotebook] = useState(false);
    const [editingNotebookId, setEditingNotebookId] = useState<string | null>(null);
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [recentlyDeletedNotebook, setRecentlyDeletedNotebook] = useState<Notebook | null>(null);

    const [nodes, setNodes] = useState<MindNode[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);
    const [error, setError] = useState<string | null>(null);

    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState(DEFAULT_PAN);
    const [autoArrange, setAutoArrange] = useState(true);
    const [boardActive, setBoardActive] = useState(false);

    const containerRef = useRef<HTMLDivElement>(null);
    const contextMenuRef = useRef<HTMLDivElement>(null);
    const panRef = useRef({ panning: false });
    const viewRef = useRef({ zoom: 1, pan: DEFAULT_PAN });
    const touchPointersRef = useRef(new Map<number, { x: number; y: number }>());
    const pinchRef = useRef<{ distance: number; centerX: number; centerY: number } | null>(null);
    const dragRef = useRef<{ type: 'move' | 'resize' | null, id: string | null, startX: number, startY: number, startW: number, startH: number }>({ type: null, id: null, startX: 0, startY: 0, startW: 0, startH: 0 });
    const nodesRef = useRef<MindNode[]>([]);

    useEffect(() => {
        nodesRef.current = nodes;
    }, [nodes]);

    useEffect(() => {
        const handleWindowWheel = (event: WheelEvent) => {
            const target = event.target as Node | null;
            const rect = containerRef.current?.getBoundingClientRect();
            if (!rect) return;

            const isInsideBoard = Boolean(target && containerRef.current?.contains(target))
                || (event.clientX >= rect.left && event.clientX <= rect.right
                    && event.clientY >= rect.top && event.clientY <= rect.bottom);
            if (!isInsideBoard) return;

            event.preventDefault();
            event.stopPropagation();

            const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1;
            if (event.deltaY !== 0) {
                zoomAtPoint(event.clientX, event.clientY, viewRef.current.zoom * Math.exp(-event.deltaY * unit * 0.002));
                return;
            }

            const { zoom: currentZoom, pan: currentPan } = viewRef.current;
            setCanvasView(currentZoom, { x: currentPan.x - event.deltaX * unit, y: currentPan.y });
        };

        window.addEventListener('wheel', handleWindowWheel, { capture: true, passive: false });
        return () => window.removeEventListener('wheel', handleWindowWheel, true);
    }, [activeNotebookId]);

    const edges = useMemo(() => {
        return nodes.filter((n) => n.parentId).map((n) => {
            const parent = nodes.find((p) => p.id === n.parentId);
            if (!parent) return null;

            let pw = parent.width || DEFAULT_W, ph = parent.height || DEFAULT_H;
            let nw = n.width || DEFAULT_W, nh = n.height || DEFAULT_H;

            if (typeof document !== 'undefined') {
                const pEl = document.getElementById(`node-${parent.id}`);
                if (pEl) { pw = pEl.offsetWidth; ph = pEl.offsetHeight; }
                const nEl = document.getElementById(`node-${n.id}`);
                if (nEl) { nw = nEl.offsetWidth; nh = nEl.offsetHeight; }
            }

            const x1 = parent.x + pw;
            const y1 = parent.y + ph / 2;
            const x2 = n.x;
            const y2 = n.y + nh / 2;
            const mx = x1 + (x2 - x1) / 2;
            return { id: n.id, d: `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}` };
        }).filter((e): e is { id: string; d: string } => e !== null);
    }, [nodes]);

    useEffect(() => {
        (async () => {
            setLoadingNotebooks(true);
            try {
                const data = await apiFetch(`${API_BASE}?resource=notebooks`);
                const mapped: Notebook[] = (data.notebooks as { id: string; title: string }[]).map((n) => ({ id: n.id, title: n.title }));
                setNotebooks(mapped);
                if (mapped.length > 0) setActiveNotebookId(mapped[0].id);
            } catch { setError('Could not load notebooks.'); } finally { setLoadingNotebooks(false); }
        })();
    }, []);

    useEffect(() => {
        if (!activeNotebookId) { setNodes([]); return; }
        let cancelled = false;
        (async () => {
            setLoadingNodes(true); setSelectedId(null); setEditingId(null);
            try {
                const data = await apiFetch(`${API_BASE}?resource=nodes&notebookId=${activeNotebookId}`);
                if (cancelled) return;
                const mapped: MindNode[] = data.nodes.map((n: any) => ({
                    id: n.id, notebookId: n.notebook_id, parentId: n.parent_id,
                    text: n.text, x: n.x, y: n.y, type: (n.type as 'text' | 'image') || 'text',
                    width: n.width, height: n.height, imageUrl: n.image_url,
                    preserveAspect: Boolean(n.preserve_aspect ?? 1), color: n.color
                }));
                setNodes(mapped); setPan(DEFAULT_PAN); setZoom(1);
            } catch { if (!cancelled) setError('Could not load this board.'); } finally { if (!cancelled) setLoadingNodes(false); }
        })();
        return () => { cancelled = true; };
    }, [activeNotebookId]);

    // Bắt sự kiện bàn phím toàn cầu (Global Hotkeys)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
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
            } else if (e.key === 'Delete' || e.key === 'Backspace') {
                deleteNode(node.id);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedId, editingId, nodes, activeNotebookId, pan, zoom]);

    useEffect(() => {
        if (!contextMenu) return;
        function handlePointerDown(e: PointerEvent) { if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) setContextMenu(null); }
        function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') setContextMenu(null); }
        window.addEventListener('pointerdown', handlePointerDown); window.addEventListener('keydown', handleKey);
        return () => { window.removeEventListener('pointerdown', handlePointerDown); window.removeEventListener('keydown', handleKey); };
    }, [contextMenu]);

    useEffect(() => {
        const handlePaste = async (e: ClipboardEvent) => {
            if (!activeNotebookId || editingId) return;
            const items = e.clipboardData?.items;
            if (!items) return;

            for (const item of items) {
                if (item.type.startsWith('image/')) {
                    const file = item.getAsFile();
                    if (!file) continue;

                    const reader = new FileReader();
                    reader.onload = async (event) => {
                        const base64 = event.target?.result as string;
                        const img = new Image();
                        img.onload = async () => {
                            let w = img.width, h = img.height;
                            const ratio = w / h;
                            if (w > 300) { w = 300; h = w / ratio; }
                            try {
                                const { url } = await apiFetch(`${API_BASE}`, {
                                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ resource: 'upload', base64 })
                                });
                                createNode(selectedId, '', 'image', url, w, h);
                            } catch { setError('Image upload failed.'); }
                        };
                        img.src = base64;
                    };
                    reader.readAsDataURL(file);
                    break;
                }
            }
        };
        window.addEventListener('paste', handlePaste);
        return () => window.removeEventListener('paste', handlePaste);
    }, [activeNotebookId, selectedId, editingId, pan, zoom, nodes]);

    function persistPositions(list: MindNode[]) {
        void apiFetch(`${API_BASE}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ resource: 'nodes-bulk', nodes: list.map((n) => ({ id: n.id, x: n.x, y: n.y })) }),
        }).catch(() => setError('Could not save node positions.'));
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

        const children = list.filter((n) => n.parentId === parentId).sort((a, b) => b.y - a.y);
        if (children.length === 0) return parent.y + (parent.height || DEFAULT_H) + 16;

        const bottomNode = children.reduce((latest, n) => {
            const candidateBottom = n.y + (n.height || DEFAULT_H);
            return candidateBottom > latest ? candidateBottom : latest;
        }, parent.y + (parent.height || DEFAULT_H));

        return bottomNode + 16;
    }

    async function createNotebook(title: string) {
        const id = createStableId(), rootId = createStableId(), cleanTitle = title.trim() || 'Untitled notebook';
        try {
            await apiFetch(`${API_BASE}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resource: 'notebook', id, title: cleanTitle, rootId }) });
            setNotebooks((prev) => [...prev, { id, title: cleanTitle }]);
            setActiveNotebookId(id);
            setNodes([{ id: rootId, notebookId: id, parentId: null, text: 'Central idea', x: 0, y: 0, type: 'text', width: DEFAULT_W, height: DEFAULT_H, imageUrl: null, preserveAspect: true, color: null }]);
            setPan(DEFAULT_PAN); setZoom(1);
        } catch {
            setError('Could not create this notebook.');
        }
    }

    function renameNotebook(id: string, title: string) {
        const cleanTitle = title.trim() || 'Untitled notebook';
        setNotebooks((prev) => prev.map((n) => (n.id === id ? { ...n, title: cleanTitle } : n)));
        apiFetch(`${API_BASE}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resource: 'notebook', id, title: cleanTitle }) });
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
            await apiFetch(`${API_BASE}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ resource: 'notebook', action: 'restore', id: recentlyDeletedNotebook.id }),
            });
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

        setNodes(prevNodes => {
            const parent = parentId ? prevNodes.find(n => n.id === parentId) : null;
            let initialX = pan.x * -1 / zoom + 200;
            let initialY = pan.y * -1 / zoom + 200;

            if (parent) {
                const pEl = document.getElementById(`node-${parent.id}`);
                const pW = pEl ? pEl.offsetWidth : (parent.width || DEFAULT_W);
                initialX = parent.x + pW + LEVEL_GAP_X;
                initialY = getBranchBottomY(prevNodes, parentId, parent);
            }

            const newNode: MindNode = {
                id: newNodeId, notebookId: activeNotebookId, parentId, text,
                x: initialX, y: initialY, type, width, height, imageUrl, preserveAspect: true, color: null
            };

            const updatedNodes = [...prevNodes, newNode];
            const laidOut = parentId ? layoutTree(updatedNodes) : updatedNodes;

            apiFetch(`${API_BASE}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ resource: 'node', ...newNode, imageUrl, preserveAspect: 1 })
            }).then(() => { if (parentId) persistPositions(laidOut); }).catch(() => setError('Could not save this node.'));

            return laidOut;
        });

        setSelectedId(newNodeId);
        if (type === 'text') setEditingId(newNodeId);
    }

    function deleteNode(id: string) {
        const toRemove = collectSubtreeIds(nodes, id);
        setNodes(prev => {
            const laidOut = layoutTree(prev.filter((n) => !toRemove.has(n.id)));
            persistPositions(laidOut);
            return laidOut;
        });
        if (selectedId && toRemove.has(selectedId)) setSelectedId(null);
        apiFetch(`${API_BASE}?resource=node&id=${id}`, { method: 'DELETE' });
    }

    function updateNodeProps(id: string, updates: Partial<MindNode>) {
        setNodes(prev => prev.map(n => n.id === id ? { ...n, ...updates } : n));
        apiFetch(`${API_BASE}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resource: 'node', id, ...updates }) });
    }

    function rearrangeAll() {
        const laidOut = layoutTree(nodes);
        setNodes(laidOut); persistPositions(laidOut);
    }

    // Drag & Resize Handlers
    function handleNodePointerDown(e: ReactPointerEvent, node: MindNode) {
        e.stopPropagation(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        dragRef.current = { type: 'move', id: node.id, startX: 0, startY: 0, startW: 0, startH: 0 };
        setSelectedId(node.id);
    }

    function handleResizePointerDown(e: ReactPointerEvent, node: MindNode) {
        e.stopPropagation(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        const el = document.getElementById(`node-${node.id}`);
        dragRef.current = { type: 'resize', id: node.id, startX: e.clientX, startY: e.clientY, startW: el ? el.offsetWidth : node.width, startH: el ? el.offsetHeight : node.height };
        setSelectedId(node.id);
    }

    function handlePointerMove(e: ReactPointerEvent) {
        const { type, id, startX, startY, startW, startH } = dragRef.current;
        if (!id) return;

        if (type === 'move') {
            const dx = e.movementX / zoom;
            const dy = e.movementY / zoom;
            setNodes(prev => {
                if (!autoArrange) {
                    return prev.map(n => n.id === id ? { ...n, x: n.x + dx, y: n.y + dy } : n);
                }

                const subtreeIds = collectSubtreeIds(prev, id);
                return prev.map(n => subtreeIds.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n);
            });
        } else if (type === 'resize') {
            const node = nodesRef.current.find(n => n.id === id);
            if (!node) return;
            let newW = Math.max(80, startW + (e.clientX - startX) / zoom);
            let newH = Math.max(40, startH + (e.clientY - startY) / zoom);

            if (node.preserveAspect && node.type === 'image') {
                const ratio = startW / startH;
                if (Math.abs(e.clientX - startX) > Math.abs(e.clientY - startY)) newH = newW / ratio;
                else newW = newH * ratio;
            }
            setNodes(prev => prev.map(n => n.id === id ? { ...n, width: newW, height: newH } : n));
        }
    }

    function handlePointerUp() {
        const { id, type } = dragRef.current;
        if (id) {
            const liveNode = nodesRef.current.find(n => n.id === id);
            if (!liveNode) {
                dragRef.current.id = null;
                return;
            }

            if (type === 'resize') {
                updateNodeProps(id, { width: liveNode.width, height: liveNode.height });
            } else {
                const movedIds = autoArrange ? collectSubtreeIds(nodesRef.current, id) : new Set([id]);
                persistPositions(nodesRef.current.filter(n => movedIds.has(n.id)));
            }
        }
        dragRef.current.id = null;
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
        zoomAtPoint(rect.left + rect.width / 2, rect.top + rect.height / 2, viewRef.current.zoom + amount);
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
        if (e.pointerType !== 'touch') return;
        touchPointersRef.current.delete(e.pointerId);
        if (touchPointersRef.current.size < 2) pinchRef.current = null;
        if (touchPointersRef.current.size === 0) panRef.current.panning = false;
    }

    function handleBackgroundPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
        if (e.target !== e.currentTarget) return;
        if (e.pointerType === 'touch' && touchPointersRef.current.size > 1) return;
        panRef.current.panning = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); setSelectedId(null);
    }
    function handleBackgroundPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
        if (!panRef.current.panning) return;
        const { zoom: currentZoom, pan: currentPan } = viewRef.current;
        setCanvasView(currentZoom, { x: currentPan.x + e.movementX, y: currentPan.y + e.movementY });
    }
    function handleBackgroundPointerUp() { panRef.current.panning = false; }

    function resetView() { centerRoot(1); }

    return (
        <div className={`${manrope.variable} ${inter.variable} flex h-screen w-screen overflow-hidden bg-[#FAFAFC]`} style={{ fontFamily: 'var(--font-ui)' }}>

            <div className={`transition-[width] duration-300 ease-in-out flex-shrink-0 z-20 ${isSidebarOpen ? 'w-64' : 'w-0'}`} style={{ overflow: 'hidden' }}>
                <aside className="w-64 flex h-full flex-col border-r border-[#E4E4ED] bg-white">
                    <div className="flex items-center justify-between border-b border-[#EEEDF6] px-4 py-4">
                        <div className="flex items-center gap-2">
                            <span className="h-2.5 w-2.5 rounded-full bg-[#7B61FF]" />
                            <span className="text-sm font-bold tracking-tight text-[#201F2E]" style={{ fontFamily: 'var(--font-display)' }}>
                                Notebooks
                            </span>
                        </div>
                        <button onClick={() => setIsCreatingNotebook(true)} className="flex h-6 w-6 items-center justify-center rounded-lg text-[#7B61FF] hover:bg-[#F2F1FA]">
                            <PlusIcon />
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto px-2 py-2">
                        {loadingNotebooks && <p className="px-2 py-2 text-xs text-[#A5A4B5]">Loading notebooks…</p>}
                        {isCreatingNotebook && (
                            <NotebookInputRow autoFocus placeholder="Subject name…" onSubmit={(title) => { if (title.trim()) createNotebook(title); setIsCreatingNotebook(false); }} onCancel={() => setIsCreatingNotebook(false)} />
                        )}
                        {notebooks.map((nb) => (
                            <div key={nb.id} className={['group mb-1 flex items-center justify-between rounded-xl px-3 py-2 text-sm transition-colors', nb.id === activeNotebookId ? 'bg-[#EFECFF] text-[#4B33E0]' : 'text-[#4B4A5C] hover:bg-[#F7F7FB]',].join(' ')}>
                                {editingNotebookId === nb.id ? (
                                    <NotebookInputRow autoFocus defaultValue={nb.title} onSubmit={(title) => { renameNotebook(nb.id, title); setEditingNotebookId(null); }} onCancel={() => setEditingNotebookId(null)} />
                                ) : (
                                    <>
                                        <button onClick={() => setActiveNotebookId(nb.id)} onDoubleClick={() => setEditingNotebookId(nb.id)} className="flex-1 truncate text-left font-medium">{nb.title}</button>
                                        <button onClick={() => deleteNotebook(nb.id)} className="ml-2 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[#B9B8C6] opacity-0 transition-opacity group-hover:opacity-100 hover:text-[#E5484D]"><XIcon /></button>
                                    </>
                                )}
                            </div>
                        ))}
                    </div>
                </aside>
            </div>

            <main
                ref={containerRef}
                className="relative flex-1 overflow-hidden select-none"
                style={{
                    height: '100%',
                    backgroundImage: 'linear-gradient(to right, #E4E4ED66 1px, transparent 1px), linear-gradient(to bottom, #E4E4ED66 1px, transparent 1px)',
                    backgroundSize: `${40 * zoom}px ${40 * zoom}px`,
                    backgroundPosition: `${pan.x}px ${pan.y}px`,
                    touchAction: 'none',
                    overflow: 'hidden',
                    overscrollBehavior: 'none',
                }}
                onContextMenu={(e) => e.preventDefault()}
                onPointerDown={(e: ReactPointerEvent<HTMLDivElement>) => { setBoardActive(true); handleCanvasPointerDown(e); handleBackgroundPointerDown(e); }}
                onPointerMove={(e: ReactPointerEvent<HTMLDivElement>) => { setBoardActive(true); handleCanvasPointerMove(e); handleBackgroundPointerMove(e); }}
                onPointerUp={(e: ReactPointerEvent<HTMLDivElement>) => { setBoardActive(true); handleCanvasPointerEnd(e); handleBackgroundPointerUp(); }}
                onPointerCancel={(e: ReactPointerEvent<HTMLDivElement>) => { handleCanvasPointerEnd(e); handleBackgroundPointerUp(); }}
                onPointerLeave={() => { setBoardActive(false); handleBackgroundPointerUp(); }}
                onMouseEnter={() => setBoardActive(true)}
                onMouseLeave={() => setBoardActive(false)}
            >
                <div className="absolute left-6 top-6 z-10 flex items-center gap-2">
                    <button onClick={() => setIsSidebarOpen(v => !v)} className="flex h-10 w-10 items-center justify-center rounded-xl bg-white border border-[#E4E4ED] shadow-sm text-[#4B4A5C] hover:bg-[#F2F1FA] transition-colors">
                        <PanelLeftIcon />
                    </button>
                    <button onClick={() => createNode(null, '', 'text')} disabled={!activeNotebookId} className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-[#7B61FF] px-4 font-bold text-sm text-white shadow hover:bg-[#6A4FF5] transition-colors disabled:cursor-not-allowed disabled:opacity-40">
                        <PlusIcon /> Add
                    </button>
                    <button onClick={rearrangeAll} disabled={!activeNotebookId} className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-white border border-[#E4E4ED] px-4 font-bold text-sm text-[#4B4A5C] shadow-sm hover:bg-[#F2F1FA] transition-colors disabled:cursor-not-allowed disabled:opacity-40">
                        <SparkleIcon /> Re-arrange
                    </button>
                    <label className="flex items-center gap-2 rounded-xl border border-[#E4E4ED] bg-white px-3 py-2 text-xs font-semibold text-[#4B4A5C] shadow-sm">
                        <span>Follow</span>
                        <button
                            type="button"
                            aria-label="Toggle auto arrange"
                            onClick={() => setAutoArrange((value) => !value)}
                            className={`relative h-6 w-11 rounded-full transition-colors ${autoArrange ? 'bg-[#7B61FF]' : 'bg-[#D9D7E6]'}`}>
                            <span className={`absolute top-1 left-0 h-4 w-4 rounded-full bg-white transition-transform ${autoArrange ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                    </label>
                    <div className="flex h-10 items-center gap-1 rounded-xl bg-white border border-[#E4E4ED] px-2 shadow-sm text-[#4B4A5C]">
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
                    </div>
                </div>

                <div className="absolute left-0 top-0" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0' }}>
                    <svg style={{ position: 'absolute', left: 0, top: 0, width: 6000, height: 4000, overflow: 'visible', pointerEvents: 'none' }}>
                        {edges.map((edge) => <path key={edge.id} d={edge.d} fill="none" stroke="#B9AEFF" strokeWidth={2.5} strokeLinecap="round" />)}
                    </svg>

                    {nodes.map((node) => {
                        const isRoot = node.parentId === null;
                        const isSelected = selectedId === node.id;
                        return (
                            <div
                                key={node.id} id={`node-${node.id}`}
                                className={[
                                    'group absolute rounded-2xl border shadow-sm transition-shadow flex flex-col items-center justify-center',
                                    isRoot ? 'border-[#2B2A3D] text-white' : 'border-[#DEDCEB] text-[#201F2E]',
                                    isSelected ? 'ring-2 ring-[#7B61FF] ring-offset-2 ring-offset-[#FAFAFC]' : '',
                                ].join(' ')}
                                style={{
                                    left: node.x, top: node.y, width: node.width || DEFAULT_W,
                                    ...(node.type === 'image' ? { height: node.height || DEFAULT_H } : { minHeight: node.height || DEFAULT_H }),
                                    backgroundColor: node.color || (isRoot ? '#2B2A3D' : '#ffffff'),
                                    cursor: dragRef.current.id === node.id ? 'grabbing' : 'grab',
                                    userSelect: 'none',
                                }}
                                onPointerDown={(e) => handleNodePointerDown(e, node)} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp}
                                onDoubleClick={(e) => { e.stopPropagation(); setEditingId(node.id); }}
                                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setSelectedId(node.id); setContextMenu({ x: e.clientX, y: e.clientY, nodeId: node.id }); }}
                            >
                                {node.type === 'image' && node.imageUrl && (
                                    <div className="w-full h-full p-1.5 overflow-hidden rounded-xl flex items-center justify-center">
                                        <img src={node.imageUrl} alt="mindmap-img" className="max-w-full max-h-full object-contain select-none pointer-events-none" />
                                    </div>
                                )}

                                {(!node.imageUrl || editingId === node.id || node.text) && (
                                    <div className={`flex w-full px-4 py-3 items-center ${node.type === 'image' ? 'absolute bottom-1 bg-white/80 rounded backdrop-blur-sm shadow py-1 w-auto max-w-[90%]' : 'h-full'}`}>
                                        {editingId === node.id ? (
                                            <textarea
                                                autoFocus defaultValue={node.text} onPointerDown={(e) => e.stopPropagation()}
                                                onBlur={(e) => { updateNodeProps(node.id, { text: e.target.value }); setEditingId(prev => prev === node.id ? null : prev); }}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter' && !e.shiftKey) {
                                                        e.preventDefault();
                                                        updateNodeProps(node.id, { text: e.currentTarget.value });
                                                        if (e.ctrlKey || e.metaKey) {
                                                            // Ctrl + Enter: Tạo nhánh ngang cấp cha
                                                            const parentNode = nodes.find(n => n.id === node.parentId);
                                                            createNode(parentNode ? parentNode.parentId : null, '', 'text');
                                                        } else {
                                                            // Enter: Tạo nhánh ngang hàng (Sibling)
                                                            createNode(node.parentId, '', 'text');
                                                        }
                                                    } else if (e.key === 'Tab') {
                                                        // Tab: Tạo nhánh con (Child)
                                                        e.preventDefault();
                                                        updateNodeProps(node.id, { text: e.currentTarget.value });
                                                        createNode(node.id, '', 'text');
                                                    } else if (e.key === 'Escape') {
                                                        setEditingId(null);
                                                    }
                                                }}
                                                className={`w-full bg-transparent text-[15px] font-semibold outline-none text-center resize-none overflow-hidden ${isRoot && !node.color ? 'text-white' : 'text-[#201F2E]'}`}
                                                style={{ minHeight: '40px', fieldSizing: 'content', userSelect: 'text' } as React.CSSProperties}
                                            />
                                        ) : (
                                            <p className="whitespace-pre-wrap break-words text-[15px] font-semibold text-center w-full leading-snug" style={{ fontFamily: 'var(--font-display)', color: isRoot && !node.color ? 'white' : '#201F2E' }}>
                                                {node.text}
                                            </p>
                                        )}
                                    </div>
                                )}

                                <button onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); createNode(node.id, '', 'text'); }} className="absolute -right-3 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-[#7B61FF] text-white opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100 hover:bg-[#6A4FF5]"><PlusIcon /></button>
                                <div onPointerDown={(e) => handleResizePointerDown(e, node)} className={`absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize opacity-0 group-hover:opacity-100 ${isSelected ? 'opacity-100' : ''}`} style={{ background: 'linear-gradient(135deg, transparent 50%, #B9AEFF 50%)', borderBottomRightRadius: '14px' }} />
                            </div>
                        );
                    })}
                </div>
            </main>

            {recentlyDeletedNotebook && (
                <div className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-[#E4E4ED] bg-white px-4 py-3 text-sm text-[#333244] shadow-xl">
                    <span>Notebook moved to trash.</span>
                    <button onClick={restoreNotebook} className="font-bold text-[#5B45E5] hover:text-[#432FC7]">Undo</button>
                </div>
            )}

            {contextMenu && (
                <div ref={contextMenuRef} style={{ position: 'fixed', left: contextMenu.x, top: contextMenu.y }} className="z-50 w-56 overflow-hidden rounded-xl border border-[#E4E4ED] bg-white py-1.5 shadow-xl text-black">
                    <MenuItem label="Add child idea" onClick={() => { createNode(contextMenu.nodeId, '', 'text'); setContextMenu(null); }} />
                    <MenuItem label="Rename" onClick={() => { setEditingId(contextMenu.nodeId); setContextMenu(null); }} />

                    {nodes.find(n => n.id === contextMenu.nodeId)?.type === 'image' && (
                        <button className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-[#333244] hover:bg-[#F2F1FA] transition-colors" onClick={() => { const node = nodes.find(n => n.id === contextMenu.nodeId)!; updateNodeProps(node.id, { preserveAspect: !node.preserveAspect }); }}>
                            Preserve Aspect Ratio <span>{nodes.find(n => n.id === contextMenu.nodeId)?.preserveAspect ? '✅' : '❌'}</span>
                        </button>
                    )}

                    <div className="px-3 py-2 flex gap-2">
                        {NODE_COLORS.map(c => (
                            <button key={c} onClick={() => { updateNodeProps(contextMenu.nodeId, { color: c === '#FFFFFF' ? null : c }); setContextMenu(null); }} className="w-6 h-6 rounded-full border border-gray-200 hover:scale-110 transition-transform shadow-sm" style={{ backgroundColor: c }} title="Change color" />
                        ))}
                    </div>

                    <div className="my-1 h-px bg-[#EEEDF6]" />
                    <MenuItem label="Delete" danger onClick={() => { deleteNode(contextMenu.nodeId); setContextMenu(null); }} />
                </div>
            )}
        </div>
    );
}

function NotebookInputRow({ defaultValue = '', placeholder, autoFocus, onSubmit, onCancel }: { defaultValue?: string; placeholder?: string; autoFocus?: boolean; onSubmit: (value: string) => void; onCancel: () => void; }) {
    return (
        <input autoFocus={autoFocus} defaultValue={defaultValue} placeholder={placeholder} onBlur={(e) => onSubmit(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') onCancel(); }} className="mb-1 w-full rounded-xl border border-[#DEDCEB] bg-white px-3 py-2 text-sm font-medium text-[#201F2E] outline-none focus:border-[#7B61FF]" />
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
