import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useNavigate } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { agentsApi, type OrgNode } from "../api/agents";
import { accessApi } from "../api/access";
import { authApi } from "../api/auth";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { agentUrl } from "../lib/utils";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { AgentIcon } from "../components/AgentIconPicker";
import { Network, User } from "lucide-react";
import { AGENT_ROLE_LABELS, type Agent } from "@paperclipai/shared";

// Layout constants
const CARD_W = 200;
const CARD_H = 100;
const GAP_X = 32;
const GAP_Y = 80;
const PADDING = 60;
const FRAME_GAP = 24;
const HUMAN_FRAME_WIDTH = 280;
const HUMAN_FRAME_MIN_HEIGHT = 400;

// ── Tree layout types ───────────────────────────────────────────────────

interface LayoutNode {
  id: string;
  name: string;
  role: string;
  status: string;
  x: number;
  y: number;
  children: LayoutNode[];
}

// ── Layout algorithm ────────────────────────────────────────────────────

/** Compute the width each subtree needs. */
function subtreeWidth(node: OrgNode): number {
  if (node.reports.length === 0) return CARD_W;
  const childrenW = node.reports.reduce((sum, c) => sum + subtreeWidth(c), 0);
  const gaps = (node.reports.length - 1) * GAP_X;
  return Math.max(CARD_W, childrenW + gaps);
}

/** Recursively assign x,y positions. */
function layoutTree(node: OrgNode, x: number, y: number): LayoutNode {
  const totalW = subtreeWidth(node);
  const layoutChildren: LayoutNode[] = [];

  if (node.reports.length > 0) {
    const childrenW = node.reports.reduce((sum, c) => sum + subtreeWidth(c), 0);
    const gaps = (node.reports.length - 1) * GAP_X;
    let cx = x + (totalW - childrenW - gaps) / 2;

    for (const child of node.reports) {
      const cw = subtreeWidth(child);
      layoutChildren.push(layoutTree(child, cx, y + CARD_H + GAP_Y));
      cx += cw + GAP_X;
    }
  }

  return {
    id: node.id,
    name: node.name,
    role: node.role,
    status: node.status,
    x: x + (totalW - CARD_W) / 2,
    y,
    children: layoutChildren,
  };
}

/** Layout all root nodes side by side. */
function layoutForest(roots: OrgNode[]): LayoutNode[] {
  if (roots.length === 0) return [];

  const totalW = roots.reduce((sum, r) => sum + subtreeWidth(r), 0);
  const gaps = (roots.length - 1) * GAP_X;
  let x = PADDING;
  const y = PADDING;

  const result: LayoutNode[] = [];
  for (const root of roots) {
    const w = subtreeWidth(root);
    result.push(layoutTree(root, x, y));
    x += w + GAP_X;
  }

  // Compute bounds and return
  return result;
}

/** Flatten layout tree to list of nodes. */
function flattenLayout(nodes: LayoutNode[]): LayoutNode[] {
  const result: LayoutNode[] = [];
  function walk(n: LayoutNode) {
    result.push(n);
    n.children.forEach(walk);
  }
  nodes.forEach(walk);
  return result;
}

/** Collect all parent→child edges. */
function collectEdges(nodes: LayoutNode[]): Array<{ parent: LayoutNode; child: LayoutNode }> {
  const edges: Array<{ parent: LayoutNode; child: LayoutNode }> = [];
  function walk(n: LayoutNode) {
    for (const c of n.children) {
      edges.push({ parent: n, child: c });
      walk(c);
    }
  }
  nodes.forEach(walk);
  return edges;
}

// ── Status dot colors (raw hex for SVG) ─────────────────────────────────

const adapterLabels: Record<string, string> = {
  claude_local: "Claude",
  codex_local: "Codex",
  gemini_local: "Gemini",
  opencode_local: "OpenCode",
  cursor: "Cursor",
  openclaw_gateway: "OpenClaw Gateway",
  process: "Process",
  http: "HTTP",
};

const statusDotColor: Record<string, string> = {
  running: "#22d3ee",
  active: "#4ade80",
  paused: "#facc15",
  idle: "#facc15",
  error: "#f87171",
  terminated: "#a3a3a3",
};
const defaultDotColor = "#a3a3a3";

// ── Main component ──────────────────────────────────────────────────────

export function OrgChart() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const navigate = useNavigate();

  const { data: orgTree, isLoading } = useQuery({
    queryKey: queryKeys.org(selectedCompanyId!),
    queryFn: () => agentsApi.org(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: session } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
    enabled: !!selectedCompanyId,
  });
  const currentUserId = session?.user?.id ?? session?.session?.userId;
  const { data: members } = useQuery({
    queryKey: queryKeys.access.members(selectedCompanyId!),
    queryFn: () => accessApi.listMembers(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const userMembers = useMemo(
    () => (members ?? []).filter((m) => m.principalType === "user"),
    [members],
  );

  const agentMap = useMemo(() => {
    const m = new Map<string, Agent>();
    for (const a of agents ?? []) m.set(a.id, a);
    return m;
  }, [agents]);

  useEffect(() => {
    setBreadcrumbs([{ label: "Org Chart" }]);
  }, [setBreadcrumbs]);

  // Layout computation
  const layout = useMemo(() => layoutForest(orgTree ?? []), [orgTree]);
  const allNodes = useMemo(() => flattenLayout(layout), [layout]);
  const edges = useMemo(() => collectEdges(layout), [layout]);

  // Compute chart bounds and total canvas bounds (chart + human frame)
  const bounds = useMemo(() => {
    if (allNodes.length === 0) return { width: 800, height: 600 };
    let maxX = 0, maxY = 0;
    for (const n of allNodes) {
      maxX = Math.max(maxX, n.x + CARD_W);
      maxY = Math.max(maxY, n.y + CARD_H);
    }
    return { width: maxX + PADDING, height: maxY + PADDING };
  }, [allNodes]);

  const totalBounds = useMemo(
    () => ({
      width: bounds.width + FRAME_GAP + HUMAN_FRAME_WIDTH,
      height: Math.max(bounds.height, HUMAN_FRAME_MIN_HEIGHT),
    }),
    [bounds],
  );

  // Pan & zoom state
  const containerRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  // Center the canvas (both frames) on first load
  const hasInitialized = useRef(false);
  useEffect(() => {
    if (hasInitialized.current || !containerRef.current) return;
    hasInitialized.current = true;

    const container = containerRef.current;
    const containerW = container.clientWidth;
    const containerH = container.clientHeight;

    const scaleX = (containerW - 40) / totalBounds.width;
    const scaleY = (containerH - 40) / totalBounds.height;
    const fitZoom = Math.min(scaleX, scaleY, 1);

    const canvasW = totalBounds.width * fitZoom;
    const canvasH = totalBounds.height * fitZoom;

    setZoom(fitZoom);
    setPan({
      x: (containerW - canvasW) / 2,
      y: (containerH - canvasH) / 2,
    });
  }, [totalBounds]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("[data-org-card]") || target.closest("[data-human-frame]")) return;
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setPan({ x: dragStart.current.panX + dx, y: dragStart.current.panY + dy });
  }, [dragging]);

  const handleMouseUp = useCallback(() => {
    setDragging(false);
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const newZoom = Math.min(Math.max(zoom * factor, 0.2), 2);

    // Zoom toward mouse position
    const scale = newZoom / zoom;
    setPan({
      x: mouseX - scale * (mouseX - pan.x),
      y: mouseY - scale * (mouseY - pan.y),
    });
    setZoom(newZoom);
  }, [zoom, pan]);

  if (!selectedCompanyId) {
    return <EmptyState icon={Network} message="Select a company to view the org chart." />;
  }

  if (isLoading) {
    return <PageSkeleton variant="org-chart" />;
  }

  const hasAgents = orgTree && orgTree.length > 0;

  return (
    <div
      ref={containerRef}
      className="w-full h-[calc(100vh-4rem)] overflow-hidden relative bg-muted/20 border border-border rounded-lg"
      style={{ cursor: dragging ? "grabbing" : "grab" }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
    >
      {/* Zoom controls */}
      <div className="absolute top-3 right-3 z-10 flex flex-col gap-1">
        <button
          className="w-7 h-7 flex items-center justify-center bg-background border border-border rounded text-sm hover:bg-accent transition-colors"
          onClick={() => {
            const newZoom = Math.min(zoom * 1.2, 2);
            const container = containerRef.current;
            if (container) {
              const cx = container.clientWidth / 2;
              const cy = container.clientHeight / 2;
              const scale = newZoom / zoom;
              setPan({ x: cx - scale * (cx - pan.x), y: cy - scale * (cy - pan.y) });
            }
            setZoom(newZoom);
          }}
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          className="w-7 h-7 flex items-center justify-center bg-background border border-border rounded text-sm hover:bg-accent transition-colors"
          onClick={() => {
            const newZoom = Math.max(zoom * 0.8, 0.2);
            const container = containerRef.current;
            if (container) {
              const cx = container.clientWidth / 2;
              const cy = container.clientHeight / 2;
              const scale = newZoom / zoom;
              setPan({ x: cx - scale * (cx - pan.x), y: cy - scale * (cy - pan.y) });
            }
            setZoom(newZoom);
          }}
          aria-label="Zoom out"
        >
          &minus;
        </button>
        <button
          className="w-7 h-7 flex items-center justify-center bg-background border border-border rounded text-[10px] hover:bg-accent transition-colors"
          onClick={() => {
            if (!containerRef.current) return;
            const cW = containerRef.current.clientWidth;
            const cH = containerRef.current.clientHeight;
            const scaleX = (cW - 40) / totalBounds.width;
            const scaleY = (cH - 40) / totalBounds.height;
            const fitZoom = Math.min(scaleX, scaleY, 1);
            const canvasW = totalBounds.width * fitZoom;
            const canvasH = totalBounds.height * fitZoom;
            setZoom(fitZoom);
            setPan({ x: (cW - canvasW) / 2, y: (cH - canvasH) / 2 });
          }}
          title="Fit to screen"
          aria-label="Fit chart to screen"
        >
          Fit
        </button>
      </div>

      {/* Zoomable canvas: AI team frame (left) + Human team frame (right) */}
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{
          width: totalBounds.width,
          height: totalBounds.height,
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
        }}
      >
        {/* Left: AI team frame */}
        <div
          className="absolute left-0 top-0 rounded-lg border-2 border-border bg-card overflow-hidden"
          style={{ width: bounds.width, height: bounds.height }}
        >
          <div className="absolute top-2 left-2 z-10 px-2 py-1 rounded bg-background/90 border border-border text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
            AI team
          </div>
          <div className="absolute inset-0 bg-muted/20">
            {!hasAgents ? (
              <div className="absolute inset-0 flex items-center justify-center p-4">
                <EmptyState icon={Network} message="No organizational hierarchy defined." />
              </div>
            ) : (
              <>
                <svg
                  className="absolute inset-0 pointer-events-none w-full h-full"
                  style={{ left: 0, top: 0, width: bounds.width, height: bounds.height }}
                >
                    <g>
                      {edges.map(({ parent, child }) => {
                        const x1 = parent.x + CARD_W / 2;
                        const y1 = parent.y + CARD_H;
                        const x2 = child.x + CARD_W / 2;
                        const y2 = child.y;
                        const midY = (y1 + y2) / 2;
                        return (
                          <path
                            key={`${parent.id}-${child.id}`}
                            d={`M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`}
                            fill="none"
                            stroke="var(--border)"
                            strokeWidth={1.5}
                          />
                        );
                      })}
                    </g>
                  </svg>
                  <div className="absolute left-0 top-0" style={{ width: bounds.width, height: bounds.height }}>
                    {allNodes.map((node) => {
                      const agent = agentMap.get(node.id);
                      const dotColor = statusDotColor[node.status] ?? defaultDotColor;
                      return (
                        <div
                          key={node.id}
                          data-org-card
                          className="absolute bg-card border border-border rounded-lg shadow-sm hover:shadow-md hover:border-foreground/20 transition-[box-shadow,border-color] duration-150 cursor-pointer select-none"
                          style={{
                            left: node.x,
                            top: node.y,
                            width: CARD_W,
                            minHeight: CARD_H,
                          }}
                          onClick={() => navigate(agent ? agentUrl(agent) : `/agents/${node.id}`)}
                        >
                          <div className="flex items-center px-4 py-3 gap-3">
                            <div className="relative shrink-0">
                              <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center">
                                <AgentIcon icon={agent?.icon} className="h-4.5 w-4.5 text-foreground/70" />
                              </div>
                              <span
                                className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card"
                                style={{ backgroundColor: dotColor }}
                              />
                            </div>
                            <div className="flex flex-col items-start min-w-0 flex-1">
                              <span className="text-sm font-semibold text-foreground leading-tight">
                                {node.name}
                              </span>
                              <span className="text-[11px] text-muted-foreground leading-tight mt-0.5">
                                {agent?.title ?? roleLabel(node.role)}
                              </span>
                              {agent && (
                                <span className="text-[10px] text-muted-foreground/60 font-mono leading-tight mt-1">
                                  {adapterLabels[agent.adapterType] ?? agent.adapterType}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
          </div>
        </div>

        {/* Right: Human team frame */}
        <div
          data-human-frame
          className="absolute rounded-lg border-2 border-border bg-card overflow-hidden flex flex-col"
          style={{
            left: bounds.width + FRAME_GAP,
            top: 0,
            width: HUMAN_FRAME_WIDTH,
            height: totalBounds.height,
          }}
        >
          <div className="shrink-0 px-3 py-2 border-b border-border bg-muted/30">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Human team
            </p>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-3">
            {userMembers.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center text-sm text-muted-foreground">
                <User className="h-8 w-8 mb-2 opacity-50" />
                <p>No team members yet.</p>
                <p className="text-xs mt-1">Invite from Company Settings → Team.</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {userMembers.map((m) => {
                  const label =
                    m.name?.trim() ||
                    m.email?.trim() ||
                    (currentUserId && m.principalId === currentUserId
                      ? "Me"
                      : m.principalId.slice(0, 12) + (m.principalId.length > 12 ? "…" : ""));
                  const role = m.membershipRole ?? "member";
                  return (
                    <div
                      key={m.id}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-muted/50 text-xs border border-border/50"
                    >
                      <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="flex-1 truncate">{label}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground capitalize">{role}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const roleLabels = AGENT_ROLE_LABELS as Record<string, string>;

function roleLabel(role: string): string {
  return roleLabels[role] ?? role;
}
