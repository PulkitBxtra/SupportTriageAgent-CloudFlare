import { Suspense, useCallback, useState, useEffect, useRef } from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { getToolName, isToolUIPart, type UIMessage } from "ai";
import type { TriageAgent } from "./server";
import {
  Badge,
  Button,
  Empty,
  InputArea,
  PoweredByCloudflare,
  Surface,
  Switch,
  Text
} from "@cloudflare/kumo";
import { Toasty, useKumoToastManager } from "@cloudflare/kumo/components/toast";
import { Streamdown } from "streamdown";
import { code } from "@streamdown/code";
import {
  PaperPlaneRightIcon,
  StopIcon,
  TrashIcon,
  GearIcon,
  ChatCircleDotsIcon,
  CircleIcon,
  MoonIcon,
  SunIcon,
  CheckCircleIcon,
  XCircleIcon,
  BrainIcon,
  CaretDownIcon,
  BugIcon,
  MicrophoneIcon,
  PencilSimpleIcon,
  UserSwitchIcon,
  ClipboardTextIcon,
  XIcon
} from "@phosphor-icons/react";

const CUSTOMER_ID_KEY = "loopwave-customer-id";

function randomCustomerId() {
  return `customer-${crypto.randomUUID().slice(0, 8)}`;
}

function getStoredCustomerId(): string {
  try {
    const stored = localStorage.getItem(CUSTOMER_ID_KEY);
    if (stored) return stored;
  } catch {
    // localStorage unavailable; fall through to a fresh id
  }
  const fresh = randomCustomerId();
  try {
    localStorage.setItem(CUSTOMER_ID_KEY, fresh);
  } catch {
    // ignore
  }
  return fresh;
}

// ── Small components ──────────────────────────────────────────────────

function ThemeToggle() {
  const [dark, setDark] = useState(
    () => document.documentElement.getAttribute("data-mode") === "dark"
  );

  const toggle = useCallback(() => {
    const next = !dark;
    setDark(next);
    const mode = next ? "dark" : "light";
    document.documentElement.setAttribute("data-mode", mode);
    document.documentElement.style.colorScheme = mode;
    localStorage.setItem("theme", mode);
  }, [dark]);

  return (
    <Button
      variant="secondary"
      shape="square"
      icon={dark ? <SunIcon size={16} /> : <MoonIcon size={16} />}
      onClick={toggle}
      aria-label="Toggle theme"
    />
  );
}

interface Ticket {
  id: string;
  customer_id: string;
  subject: string;
  category: string | null;
  priority: string | null;
  status: string;
  draft_reply: string | null;
  final_reply: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

const STATUS_BADGE: Record<string, "secondary" | "primary" | "destructive"> = {
  new: "secondary",
  awaiting_approval: "primary",
  resolved: "primary",
  escalated: "destructive"
};

function AdminPanel({ onClose }: { onClose: () => void }) {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/admin/tickets");
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = (await res.json()) as { tickets: Ticket[] };
      setTickets(data.tickets);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tickets");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 backdrop-blur-sm p-4 overflow-y-auto">
      <Surface className="w-full max-w-4xl mt-10 rounded-xl ring ring-kumo-line shadow-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <ClipboardTextIcon size={18} className="text-kumo-accent" />
            <Text size="sm" bold>
              All tickets (across every customer)
            </Text>
            {tickets && <Badge variant="secondary">{tickets.length}</Badge>}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={load}>
              Refresh
            </Button>
            <Button
              variant="ghost"
              size="sm"
              shape="square"
              aria-label="Close admin panel"
              icon={<XIcon size={14} />}
              onClick={onClose}
            />
          </div>
        </div>

        {error && (
          <Text size="sm" variant="error">
            {error}
          </Text>
        )}

        {!tickets && !error && (
          <Text size="sm" variant="secondary">
            Loading…
          </Text>
        )}

        {tickets && tickets.length === 0 && (
          <Text size="sm" variant="secondary">
            No tickets yet. Have a conversation in the chat first.
          </Text>
        )}

        {tickets && tickets.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-kumo-subtle border-b border-kumo-line">
                  <th className="py-1.5 pr-3 font-medium">Customer</th>
                  <th className="py-1.5 pr-3 font-medium">Subject</th>
                  <th className="py-1.5 pr-3 font-medium">Category</th>
                  <th className="py-1.5 pr-3 font-medium">Priority</th>
                  <th className="py-1.5 pr-3 font-medium">Status</th>
                  <th className="py-1.5 pr-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((t) => (
                  <tr key={t.id} className="border-b border-kumo-line/50">
                    <td className="py-1.5 pr-3 font-mono">{t.customer_id}</td>
                    <td className="py-1.5 pr-3">{t.subject}</td>
                    <td className="py-1.5 pr-3">{t.category ?? "—"}</td>
                    <td className="py-1.5 pr-3">{t.priority ?? "—"}</td>
                    <td className="py-1.5 pr-3">
                      <Badge variant={STATUS_BADGE[t.status] ?? "secondary"}>
                        {t.status}
                      </Badge>
                    </td>
                    <td className="py-1.5 pr-3 text-kumo-subtle">
                      {new Date(t.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Surface>
    </div>
  );
}

// ── Tool rendering ────────────────────────────────────────────────────

function ToolIO({ label, value }: { label: string; value: unknown }) {
  if (value === undefined || value === null) return null;
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (!text) return null;
  return (
    <div className="mt-1">
      <Text size="xs" variant="secondary" bold>
        {label}
      </Text>
      <pre className="mt-0.5 font-mono text-xs text-kumo-subtle whitespace-pre-wrap overflow-auto max-h-64">
        {text}
      </pre>
    </div>
  );
}

function ProposeReplyApprovalCard({
  part,
  addToolApprovalResponse,
  addToolOutput,
  finalizeReplyWithEdit
}: {
  part: UIMessage["parts"][number];
  addToolApprovalResponse: (response: {
    id: string;
    approved: boolean;
  }) => void;
  addToolOutput: (options: {
    toolCallId: string;
    output?: unknown;
    state?: "output-available" | "output-error";
    errorText?: string;
  }) => void;
  finalizeReplyWithEdit: (
    ticketId: string,
    editedReply: string
  ) => Promise<unknown>;
}) {
  const raw = part as unknown as {
    input: { ticketId: string; replyText: string };
    approval?: { id?: string };
    toolCallId: string;
  };
  const input = raw.input;
  const approvalId = raw.approval?.id;
  const toolCallId = raw.toolCallId;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(input.replyText);
  const [submitting, setSubmitting] = useState(false);

  const approveAsIs = () => {
    if (approvalId) addToolApprovalResponse({ id: approvalId, approved: true });
  };

  const reject = () => {
    if (approvalId)
      addToolApprovalResponse({ id: approvalId, approved: false });
  };

  const approveWithEdit = async () => {
    setSubmitting(true);
    try {
      await finalizeReplyWithEdit(input.ticketId, draft);
      addToolOutput({
        toolCallId,
        output: {
          ticketId: input.ticketId,
          status: "resolved",
          finalReply: draft,
          edited: true
        },
        state: "output-available"
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex justify-start">
      <Surface className="max-w-[85%] w-full px-4 py-3 rounded-xl ring-2 ring-kumo-warning">
        <div className="flex items-center gap-2 mb-2">
          <GearIcon size={14} className="text-kumo-warning" />
          <Text size="sm" bold>
            Draft reply awaiting approval
          </Text>
          <Badge variant="secondary">ticket {input.ticketId.slice(0, 8)}</Badge>
        </div>

        {editing ? (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            className="w-full mb-3 px-3 py-2 text-sm rounded-lg border border-kumo-line bg-kumo-base text-kumo-default focus:outline-none focus:ring-1 focus:ring-kumo-accent resize-y"
          />
        ) : (
          <div className="mb-3 px-3 py-2 rounded-lg bg-kumo-control text-sm whitespace-pre-wrap">
            {input.replyText}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {!editing && (
            <>
              <Button
                variant="primary"
                size="sm"
                icon={<CheckCircleIcon size={14} />}
                onClick={approveAsIs}
              >
                Approve
              </Button>
              <Button
                variant="secondary"
                size="sm"
                icon={<PencilSimpleIcon size={14} />}
                onClick={() => setEditing(true)}
              >
                Edit
              </Button>
              <Button
                variant="secondary"
                size="sm"
                icon={<XCircleIcon size={14} />}
                onClick={reject}
              >
                Reject
              </Button>
            </>
          )}
          {editing && (
            <>
              <Button
                variant="primary"
                size="sm"
                icon={<CheckCircleIcon size={14} />}
                disabled={submitting || !draft.trim()}
                onClick={approveWithEdit}
              >
                {submitting ? "Sending…" : "Approve edited reply"}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setEditing(false);
                  setDraft(input.replyText);
                }}
              >
                Cancel edit
              </Button>
            </>
          )}
        </div>
      </Surface>
    </div>
  );
}

function ToolPartView({
  part,
  addToolApprovalResponse,
  addToolOutput,
  finalizeReplyWithEdit
}: {
  part: UIMessage["parts"][number];
  addToolApprovalResponse: (response: {
    id: string;
    approved: boolean;
  }) => void;
  addToolOutput: (options: {
    toolCallId: string;
    output?: unknown;
    state?: "output-available" | "output-error";
    errorText?: string;
  }) => void;
  finalizeReplyWithEdit: (
    ticketId: string,
    editedReply: string
  ) => Promise<unknown>;
}) {
  if (!isToolUIPart(part)) return null;
  const toolName = getToolName(part);

  if (
    toolName === "proposeReply" &&
    "approval" in part &&
    part.state === "approval-requested"
  ) {
    return (
      <ProposeReplyApprovalCard
        part={part}
        addToolApprovalResponse={addToolApprovalResponse}
        addToolOutput={addToolOutput}
        finalizeReplyWithEdit={finalizeReplyWithEdit}
      />
    );
  }

  // Completed
  if (part.state === "output-available") {
    return (
      <div className="flex justify-start">
        <Surface className="max-w-[85%] px-4 py-2.5 rounded-xl ring ring-kumo-line">
          <div className="flex items-center gap-2 mb-1">
            <GearIcon size={14} className="text-kumo-inactive" />
            <Text size="xs" variant="secondary" bold>
              {toolName}
            </Text>
            <Badge variant="secondary">Done</Badge>
          </div>
          <ToolIO label="Input" value={part.input} />
          <ToolIO label="Output" value={part.output} />
        </Surface>
      </div>
    );
  }

  // Needs approval (generic — no tool other than proposeReply uses this
  // right now, but kept for any future approval-gated tool)
  if ("approval" in part && part.state === "approval-requested") {
    const approvalId = (part.approval as { id?: string })?.id;
    return (
      <div className="flex justify-start">
        <Surface className="max-w-[85%] px-4 py-3 rounded-xl ring-2 ring-kumo-warning">
          <div className="flex items-center gap-2 mb-2">
            <GearIcon size={14} className="text-kumo-warning" />
            <Text size="sm" bold>
              Approval needed: {toolName}
            </Text>
          </div>
          <div className="font-mono mb-3">
            <Text size="xs" variant="secondary">
              {JSON.stringify(part.input, null, 2)}
            </Text>
          </div>
          <div className="flex gap-2">
            <Button
              variant="primary"
              size="sm"
              icon={<CheckCircleIcon size={14} />}
              onClick={() => {
                if (approvalId)
                  addToolApprovalResponse({ id: approvalId, approved: true });
              }}
            >
              Approve
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<XCircleIcon size={14} />}
              onClick={() => {
                if (approvalId)
                  addToolApprovalResponse({ id: approvalId, approved: false });
              }}
            >
              Reject
            </Button>
          </div>
        </Surface>
      </div>
    );
  }

  // Rejected / denied
  if (
    part.state === "output-denied" ||
    ("approval" in part &&
      (part.approval as { approved?: boolean })?.approved === false)
  ) {
    return (
      <div className="flex justify-start">
        <Surface className="max-w-[85%] px-4 py-2.5 rounded-xl ring ring-kumo-line">
          <div className="flex items-center gap-2">
            <XCircleIcon size={14} className="text-kumo-danger" />
            <Text size="xs" variant="secondary" bold>
              {toolName}
            </Text>
            <Badge variant="secondary">Rejected</Badge>
          </div>
        </Surface>
      </div>
    );
  }

  // Errored
  if (part.state === "output-error") {
    const errorText = part.errorText;
    return (
      <div className="flex justify-start">
        <Surface className="max-w-[85%] px-4 py-2.5 rounded-xl ring-2 ring-kumo-danger">
          <div className="flex items-center gap-2 mb-1">
            <XCircleIcon size={14} className="text-kumo-danger" />
            <Text size="xs" variant="secondary" bold>
              {toolName}
            </Text>
            <Badge variant="destructive">Error</Badge>
          </div>
          <div className="font-mono">
            <Text size="xs" variant="secondary">
              {errorText || "Tool call failed"}
            </Text>
          </div>
        </Surface>
      </div>
    );
  }

  // Executing
  if (part.state === "input-available" || part.state === "input-streaming") {
    return (
      <div className="flex justify-start">
        <Surface className="max-w-[85%] px-4 py-2.5 rounded-xl ring ring-kumo-line">
          <div className="flex items-center gap-2">
            <GearIcon size={14} className="text-kumo-inactive animate-spin" />
            <Text size="xs" variant="secondary">
              Running {toolName}...
            </Text>
          </div>
          <ToolIO label="Input" value={part.input} />
        </Surface>
      </div>
    );
  }

  return null;
}

// ── Main chat ─────────────────────────────────────────────────────────

const EXAMPLE_PROMPTS = [
  "I was double-charged on my last invoice",
  "I can't get past the 2FA screen after losing my phone",
  "Our webhook endpoint keeps getting paused",
  "We're hitting 429s on the API way more than expected"
];

function Chat({
  customerId,
  onChangeCustomer
}: {
  customerId: string;
  onChangeCustomer: (id: string) => void;
}) {
  const [connected, setConnected] = useState(false);
  const [input, setInput] = useState("");
  const [showDebug, setShowDebug] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(false);
  const [customerDraft, setCustomerDraft] = useState(customerId);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const toasts = useKumoToastManager();

  const agent = useAgent<TriageAgent>({
    agent: "TriageAgent",
    name: customerId,
    onOpen: useCallback(() => setConnected(true), []),
    onClose: useCallback(() => setConnected(false), []),
    onError: useCallback(
      (error: Event) => console.error("WebSocket error:", error),
      []
    ),
    onMessage: useCallback(
      (message: MessageEvent) => {
        try {
          const data = JSON.parse(String(message.data));
          if (data.type === "ticket-escalated") {
            toasts.add({
              title: "Ticket escalated",
              description: `Ticket ${String(data.ticketId).slice(0, 8)} sat un-approved past the escalation window and was auto-escalated.`,
              timeout: 0
            });
          }
        } catch {
          // Not JSON or not our event
        }
      },
      [toasts]
    )
  });

  const {
    messages,
    sendMessage,
    clearHistory,
    addToolApprovalResponse,
    addToolOutput,
    stop,
    status
  } = useAgentChat({
    agent,
    experimental_throttle: 100
  });

  const finalizeReplyWithEdit = useCallback(
    (ticketId: string, editedReply: string) =>
      agent.stub.finalizeReplyWithEdit(ticketId, editedReply),
    [agent]
  );

  const isStreaming = status === "streaming" || status === "submitted";

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!isStreaming && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isStreaming]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput("");
    sendMessage({ role: "user", parts: [{ type: "text", text }] });
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }, [input, isStreaming, sendMessage]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true
      });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || "audio/webm"
        });
        if (blob.size === 0) return;
        setIsTranscribing(true);
        try {
          const res = await fetch("/api/voice/transcribe", {
            method: "POST",
            headers: { "Content-Type": blob.type },
            body: blob
          });
          if (!res.ok) throw new Error(`Transcription failed (${res.status})`);
          const data = (await res.json()) as { text: string };
          setInput((prev) =>
            prev ? `${prev} ${data.text}`.trim() : data.text
          );
        } catch (e) {
          toasts.add({
            title: "Voice transcription failed",
            description: e instanceof Error ? e.message : String(e),
            timeout: 4000
          });
        } finally {
          setIsTranscribing(false);
        }
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    } catch (e) {
      toasts.add({
        title: "Microphone access denied",
        description: e instanceof Error ? e.message : String(e),
        timeout: 4000
      });
    }
  }, [toasts]);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  }, []);

  return (
    <div className="flex flex-col h-screen bg-kumo-elevated relative">
      {showAdmin && <AdminPanel onClose={() => setShowAdmin(false)} />}

      {/* Header */}
      <header className="px-5 py-4 bg-kumo-base border-b border-kumo-line">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold text-kumo-default">
              <span className="mr-2">🌊</span>Loopwave Support
            </h1>
            <Badge variant="secondary">
              <ChatCircleDotsIcon size={12} weight="bold" className="mr-1" />
              Triage Agent
            </Badge>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <CircleIcon
                size={8}
                weight="fill"
                className={connected ? "text-kumo-success" : "text-kumo-danger"}
              />
              <Text size="xs" variant="secondary">
                {connected ? "Connected" : "Disconnected"}
              </Text>
            </div>
            <div className="flex items-center gap-1.5">
              <BugIcon size={14} className="text-kumo-inactive" />
              <Switch
                checked={showDebug}
                onCheckedChange={setShowDebug}
                size="sm"
                aria-label="Toggle debug mode"
              />
            </div>
            <ThemeToggle />
            <Button
              variant="secondary"
              icon={<ClipboardTextIcon size={16} />}
              onClick={() => setShowAdmin(true)}
            >
              Admin
            </Button>
            <Button
              variant="secondary"
              icon={<TrashIcon size={16} />}
              onClick={clearHistory}
            >
              Clear
            </Button>
          </div>
        </div>

        <div className="max-w-3xl mx-auto mt-2 flex items-center gap-2">
          <UserSwitchIcon size={14} className="text-kumo-inactive" />
          {editingCustomer ? (
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const id = customerDraft.trim();
                if (id) onChangeCustomer(id);
                setEditingCustomer(false);
              }}
            >
              <input
                value={customerDraft}
                onChange={(e) => setCustomerDraft(e.target.value)}
                className="px-2 py-1 text-xs font-mono rounded border border-kumo-line bg-kumo-base text-kumo-default focus:outline-none focus:ring-1 focus:ring-kumo-accent"
              />
              <Button type="submit" variant="primary" size="sm">
                Switch
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setCustomerDraft(customerId);
                  setEditingCustomer(false);
                }}
              >
                Cancel
              </Button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => {
                setCustomerDraft(customerId);
                setEditingCustomer(true);
              }}
              className="text-xs font-mono text-kumo-subtle hover:text-kumo-default underline decoration-dotted"
              title="Switch which customer you're chatting as — useful for demoing returning-customer memory"
            >
              {customerId}
            </button>
          )}
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-5 py-6 space-y-5">
          {messages.length === 0 && (
            <Empty
              icon={<ChatCircleDotsIcon size={32} />}
              title="Describe your issue"
              contents={
                <div className="flex flex-wrap justify-center gap-2">
                  {EXAMPLE_PROMPTS.map((prompt) => (
                    <Button
                      key={prompt}
                      variant="outline"
                      size="sm"
                      disabled={isStreaming}
                      onClick={() => {
                        sendMessage({
                          role: "user",
                          parts: [{ type: "text", text: prompt }]
                        });
                      }}
                    >
                      {prompt}
                    </Button>
                  ))}
                </div>
              }
            />
          )}

          {messages.map((message: UIMessage, index: number) => {
            const isUser = message.role === "user";
            const isLastAssistant =
              message.role === "assistant" && index === messages.length - 1;

            return (
              <div key={message.id} className="space-y-2">
                {showDebug && (
                  <pre className="text-[11px] text-kumo-subtle bg-kumo-control rounded-lg p-3 overflow-auto max-h-64">
                    {JSON.stringify(message, null, 2)}
                  </pre>
                )}

                {message.parts.map((part, i) => {
                  const key = `${message.id}-${i}`;

                  if (isToolUIPart(part)) {
                    return (
                      <ToolPartView
                        key={key}
                        part={part}
                        addToolApprovalResponse={addToolApprovalResponse}
                        addToolOutput={addToolOutput}
                        finalizeReplyWithEdit={finalizeReplyWithEdit}
                      />
                    );
                  }

                  if (part.type === "reasoning") {
                    if (!part.text.trim()) return null;
                    const isDone = part.state === "done" || !isStreaming;
                    return (
                      <div key={key} className="flex justify-start">
                        <details className="max-w-[85%] w-full" open={!isDone}>
                          <summary className="flex items-center gap-2 cursor-pointer px-3 py-2 rounded-lg bg-purple-500/10 border border-purple-500/20 text-sm select-none">
                            <BrainIcon size={14} className="text-purple-400" />
                            <span className="font-medium text-kumo-default">
                              Reasoning
                            </span>
                            {isDone ? (
                              <span className="text-xs text-kumo-success">
                                Complete
                              </span>
                            ) : (
                              <span className="text-xs text-kumo-brand">
                                Thinking...
                              </span>
                            )}
                            <CaretDownIcon
                              size={14}
                              className="ml-auto text-kumo-inactive"
                            />
                          </summary>
                          <pre className="mt-2 px-3 py-2 rounded-lg bg-kumo-control text-xs text-kumo-default whitespace-pre-wrap overflow-auto max-h-64">
                            {part.text}
                          </pre>
                        </details>
                      </div>
                    );
                  }

                  if (part.type === "text") {
                    if (!part.text) return null;

                    if (isUser) {
                      return (
                        <div key={key} className="flex justify-end">
                          <div className="max-w-[85%] px-4 py-2.5 rounded-2xl rounded-br-md bg-kumo-contrast text-kumo-inverse leading-relaxed">
                            {part.text}
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div key={key} className="flex justify-start">
                        <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-kumo-base text-kumo-default leading-relaxed">
                          <Streamdown
                            className="sd-theme rounded-2xl rounded-bl-md p-3"
                            plugins={{ code }}
                            controls={false}
                            isAnimating={isLastAssistant && isStreaming}
                          >
                            {part.text}
                          </Streamdown>
                        </div>
                      </div>
                    );
                  }

                  return null;
                })}
              </div>
            );
          })}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-kumo-line bg-kumo-base">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          className="max-w-3xl mx-auto px-5 py-4"
        >
          <div className="flex items-end gap-3 rounded-xl border border-kumo-line bg-kumo-base p-3 shadow-sm focus-within:ring-2 focus-within:ring-kumo-ring focus-within:border-transparent transition-shadow">
            <Button
              type="button"
              variant={isRecording ? "primary" : "ghost"}
              shape="square"
              aria-label={
                isRecording ? "Stop recording" : "Record voice message"
              }
              icon={<MicrophoneIcon size={18} />}
              onClick={isRecording ? stopRecording : startRecording}
              disabled={!connected || isStreaming || isTranscribing}
              className={`mb-0.5 ${isRecording ? "animate-pulse" : ""}`}
            />
            <InputArea
              ref={textareaRef}
              value={input}
              onValueChange={setInput}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = `${el.scrollHeight}px`;
              }}
              placeholder={
                isTranscribing
                  ? "Transcribing..."
                  : isRecording
                    ? "Recording... click the mic to stop"
                    : "Describe your issue..."
              }
              disabled={!connected || isStreaming}
              rows={1}
              className="flex-1 ring-0! focus:ring-0! shadow-none! bg-transparent! outline-none! resize-none max-h-40"
            />
            {isStreaming ? (
              <Button
                type="button"
                variant="secondary"
                shape="square"
                aria-label="Stop generation"
                icon={<StopIcon size={18} />}
                onClick={stop}
                className="mb-0.5"
              />
            ) : (
              <Button
                type="submit"
                variant="primary"
                shape="square"
                aria-label="Send message"
                disabled={!input.trim() || !connected}
                icon={<PaperPlaneRightIcon size={18} />}
                className="mb-0.5"
              />
            )}
          </div>
        </form>
        <div className="flex justify-center pb-3">
          <PoweredByCloudflare href="https://developers.cloudflare.com/agents/" />
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [customerId, setCustomerId] = useState(getStoredCustomerId);

  const changeCustomer = useCallback((id: string) => {
    try {
      localStorage.setItem(CUSTOMER_ID_KEY, id);
    } catch {
      // ignore
    }
    setCustomerId(id);
  }, []);

  return (
    <Toasty>
      <Suspense
        fallback={
          <div className="flex items-center justify-center h-screen text-kumo-inactive">
            Loading...
          </div>
        }
      >
        <Chat
          key={customerId}
          customerId={customerId}
          onChangeCustomer={changeCustomer}
        />
      </Suspense>
    </Toasty>
  );
}
