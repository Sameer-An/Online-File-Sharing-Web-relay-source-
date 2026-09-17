    "use client";
    import { useEffect, useRef, useState } from "react";
    import {
    ArrowUpRight,
    ArrowDownToLine,
    ArrowLeft,
    Copy,
    File,
    FolderUp,
    Upload,
    Plus,
    Send,
    ShieldCheck,
    Clock,
    Trash2,
    Check,
    Radio,
    Code2,
    Link2,
    X,
    } from "lucide-react";
    import { Button } from "@/components/ui/button";
    import { Progress } from "@/components/ui/progress";
    import {
    sendTransfer,
    TransferError,
    type Transfer,
    } from "@/lib/share-transfer";
    import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
    import {
    AlertDialog,
    AlertDialogTrigger,
    AlertDialogContent,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogCancel,
    AlertDialogAction,
    } from "@/components/ui/alert-dialog";
    type Item = {
    id: string;
    name: string;
    body: string | null;
    size: number;
    created: number;
    kind: string;
    };
    type Room = { expires: number; owner: boolean; bytes: number };
    const formatSize = (n: number) =>
    n < 1024
        ? `${n} B`
        : n < 1048576
        ? `${(n / 1024).toFixed(1)} KB`
        : `${(n / 1048576).toFixed(1)} MB`;
    async function api(action: string, method = "GET", body?: unknown) {
    const r = await fetch(`/api/relay${action ? "?" + action : ""}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
    });
    const data = (await r.json()) as {
        error?: string;
        code: string;
        room: Room;
        items: Item[];
    };
    if (!r.ok) throw new Error(data.error || "Please retry.");
    return data;
    }
    export default function Home() {
    const [room, setRoom] = useState<Room | null>(null),
        [items, setItems] = useState<Item[]>([]),
        [code, setCode] = useState(""),
        [joinCode, setJoinCode] = useState(""),
        [minutes, setMinutes] = useState(60),
        [note, setNote] = useState(""),
        [error, setError] = useState(""),
        [busy, setBusy] = useState(false),
        [notice, setNotice] = useState(""),
        [sync, setSync] = useState(""),
        [now, setNow] = useState(Date.now()),
        [help, setHelp] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null),
        folderRef = useRef<HTMLInputElement>(null),
        busyRef = useRef(false);
    const [transfers, setTransfers] = useState<Transfer[]>([]);
    const updateTransfer = (id: string, value: Partial<Transfer>) =>
        setTransfers((current) =>
        current.map((t) => (t.id === id ? { ...t, ...value } : t)),
        );
    async function refresh() {
        const data = await api("");
        setRoom(data.room);
        setItems(data.items);
        setSync("Updated just now");
    }
    useEffect(() => {
        api("")
        .then((d) => {
            setRoom(d.room);
            setItems(d.items);
            setSync("Updated just now");
        })
        .catch(() => {});
    }, []);
    useEffect(() => {
        if (!room) return;
        let stopped = false;
        const tick = setInterval(async () => {
        setNow(Date.now());
        if (document.hidden) return;
        try {
            const d = await api("");
            if (!stopped) {
            setRoom(d.room);
            setItems(d.items);
            setSync("Updated just now");
            }
        } catch (e) {
            if (!stopped) {
            setSync("Connection interrupted");
            const message = (e as Error).message;
            if (message.includes("expired")) {
                setRoom(null);
                setCode("");
                setError(message);
            }
            }
        }
        }, 3000);
        return () => {
        stopped = true;
        clearInterval(tick);
        };
    }, [!!room]);
    async function perform(fn: () => Promise<void>) {
        if (busyRef.current) return;
        busyRef.current = true;
        setBusy(true);
        setError("");
        setNotice("");
        try {
        await fn();
        } catch (e) {
        setError((e as Error).message);
        } finally {
        busyRef.current = false;
        setBusy(false);
        }
    }
    async function create() {
        await perform(async () => {
        const d = await api("action=create", "POST", { minutes });
        setCode(d.code);
        await refresh();
        });
    }
    async function join() {
        await perform(async () => {
        await api("action=join", "POST", { code: joinCode });
        setCode(joinCode);
        await refresh();
        });
    }
    async function copy(text: string) {
        try {
        await navigator.clipboard.writeText(text);
        setNotice("Copied to clipboard.");
        } catch {
        setError("Clipboard unavailable. Select the text and copy it manually.");
        }
    }
    async function syncAfterShare() {
        try {
        await refresh();
        } catch {
        setSync("Waiting to refresh");
        setNotice(
            "Sharing confirmed. The list will refresh when the connection recovers.",
        );
        }
    }
    async function shareText() {
        const text = note;
        await perform(async () => {
        const id = crypto.randomUUID();
        setTransfers([
            {
            id,
            name: "Text note",
            phase: "queued",
            percent: 0,
            loaded: 0,
            total: new Blob([JSON.stringify({ text })]).size,
            },
        ]);
        try {
            await sendTransfer(
            "text",
            JSON.stringify({ text }),
            { "Content-Type": "application/json" },
            (value) => updateTransfer(id, value),
            );
            updateTransfer(id, { phase: "shared", percent: 100 });
            setNote("");
        } catch (e) {
            updateTransfer(id, {
            phase:
                e instanceof TransferError && e.unconfirmed
                ? "unconfirmed"
                : "failed",
            message: (e as Error).message,
            });
            throw e;
        }
        await syncAfterShare();
        });
    }
    async function upload(files: FileList | null) {
        if (!files?.length || busyRef.current) return;
        const selected = Array.from(files);
        await perform(async () => {
        const batch: Transfer[] = selected.map((f) => ({
            id: crypto.randomUUID(),
            name: f.webkitRelativePath || f.name,
            phase: "queued",
            percent: 0,
            loaded: 0,
            total: f.size,
        }));
        setTransfers(batch);
        for (let i = 0; i < selected.length; i++) {
            const f = selected[i],
            id = batch[i].id;
            try {
            await sendTransfer(
                "upload",
                f,
                {
                "Content-Type": "application/octet-stream",
                "X-File-Name": encodeURIComponent(f.webkitRelativePath || f.name),
                },
                (value) => updateTransfer(id, value),
            );
            updateTransfer(id, { phase: "shared", percent: 100, loaded: f.size });
            } catch (e) {
            const message = (e as Error).message;
            updateTransfer(id, {
                phase:
                e instanceof TransferError && e.unconfirmed
                    ? "unconfirmed"
                    : "failed",
                message,
            });
            setTransfers((current) =>
                current.map((t) =>
                t.phase === "queued"
                    ? {
                        ...t,
                        phase: "failed",
                        message: "Not sent because an earlier transfer stopped.",
                    }
                    : t,
                ),
            );
            await syncAfterShare();
            throw new Error(
                `${f.name}: ${message} Earlier confirmed uploads are saved.`,
            );
            }
            await syncAfterShare();
        }
        });
        if (fileRef.current) fileRef.current.value = "";
        if (folderRef.current) folderRef.current.value = "";
    }
    const remaining = room
        ? Math.max(0, Math.ceil((room.expires - now) / 60000))
        : 0;
    return (
        <div className="app-shell">
        <header className="topbar">
            <a className="brand" href="/" aria-label="Relay home">
            <span className="brand-icon">
                <Link2 size={22} />
            </span>
            relay<span className="brand-period">.</span>
            </a>
            <span className="header-label">
            A little less distance between devices.
            </span>
            <button className="quiet" onClick={() => setHelp(!help)}>
            <ShieldCheck size={16} /> Privacy & details
            </button>
        </header>
        <main>
            <div className="page-heading">
            <div>
                <div className="eyebrow">YOUR TEMPORARY SHARED SPACE</div>
                <h1>
                {room
                    ? "One room. All your devices."
                    : "Send it here. Pick it up there."}
                </h1>
                <p>Text, files, and folders. Connected by just eight digits.</p>
            </div>
            <span className="version">
                NO APP TO INSTALL <ArrowUpRight size={15} />
            </span>
            </div>
            {help && (
            <section className="details">
                <button
                aria-label="Close details"
                className="quiet close-details"
                onClick={() => setHelp(false)}
                >
                <X size={18} />
                </button>
                <h2>Simple sharing, with clear boundaries.</h2>
                <p>
                Anyone with your code can read, add, and delete room items. Share
                it privately. Access stops at expiry; expired files are physically
                removed when a room is next created or joined. This is not a
                guaranteed deletion deadline.
                </p>
                <p>
                Transfers use HTTPS on the hosted site. Content is not end-to-end
                encrypted, and files are not scanned for malware. Only download
                files you trust. Updates arrive every 3 seconds while this tab is
                visible.
                </p>
                <p>
                Limits: 20 MB per file, 100 MB uploaded and 100 items per room.
                Folder paths are preserved in the list; files download
                individually. Source is MIT licensed. This deployment initially
                requires the owner’s ChatGPT sign-in on each device.
                </p>
            </section>
            )}
            {error && (
            <div role="alert" className="message error">
                {error}
                <button
                className="quiet"
                onClick={() => setError("")}
                aria-label="Dismiss error"
                >
                <X size={16} />
                </button>
            </div>
            )}
            {notice && (
            <div role="status" className="message success">
                <Check size={16} />
                {notice}
            </div>
            )}
            {!room ? (
            <div className="welcome-grid">
                <section className="create-card">
                <div className="section-top">
                    <span className="step-label">01 / SEND</span>
                    <span className="circle-icon">
                    <ArrowUpRight size={23} />
                    </span>
                </div>
                <h2>Make room for your files.</h2>
                <p>
                    Start a private-by-code space, then add anything you need on
                    another device.
                </p>
                <div className="file-preview" aria-hidden="true">
                    <span className="preview-tile">
                    <File size={23} />
                    <small>Files</small>
                    </span>
                    <span className="preview-tile middle">
                    <FolderUp size={23} />
                    <small>Folders</small>
                    </span>
                    <span className="preview-tile">
                    <Code2 size={23} />
                    <small>Text</small>
                    </span>
                </div>
                <div className="expiry-field">
                    <label htmlFor="expiry">
                    <Clock size={17} /> Keep this room for
                    </label>
                    <select
                    id="expiry"
                    value={minutes}
                    onChange={(e) => setMinutes(Number(e.target.value))}
                    >
                    <option value={15}>15 minutes</option>
                    <option value={60}>1 hour</option>
                    <option value={360}>6 hours</option>
                    <option value={1440}>24 hours</option>
                    </select>
                </div>
                <Button
                    className="primary-action"
                    onClick={create}
                    disabled={busy}
                >
                    <Plus size={18} />
                    {busy ? "Connecting…" : "Create a room"}
                    <ArrowUpRight className="push-right" size={18} />
                </Button>
                <div className="card-foot">
                    <ShieldCheck size={14} /> Your code is generated when you create
                    a room.
                </div>
                </section>
                <section className="join-card">
                <div className="section-top">
                    <span className="step-label">02 / RECEIVE</span>
                    <span className="circle-icon">
                    <ArrowDownToLine size={22} />
                    </span>
                </div>
                <h2>Already have a code?</h2>
                <p>Your other device is just eight digits away.</p>
                <form
                    onSubmit={(e) => {
                    e.preventDefault();
                    join();
                    }}
                >
                    <label className="code-label" htmlFor="room-code">
                    ENTER ROOM CODE
                    </label>
                    <input
                    id="room-code"
                    className="code-input"
                    aria-label="8-digit room code"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="0000 0000"
                    maxLength={9}
                    value={
                        joinCode.length > 4
                        ? joinCode.slice(0, 4) + " " + joinCode.slice(4)
                        : joinCode
                    }
                    onChange={(e) =>
                        setJoinCode(e.target.value.replace(/\D/g, "").slice(0, 8))
                    }
                    />
                    <Button
                    type="submit"
                    variant="outline"
                    className="join-action"
                    disabled={busy || joinCode.length !== 8}
                    >
                    Join room <ArrowUpRight size={18} />
                    </Button>
                </form>
                <div className="join-bottom">
                    <span className="tiny-line" />
                    <p>
                    Open Relay on any device.
                    <br />
                    Same code. Same shared space.
                    </p>
                </div>
                </section>
            </div>
            ) : (
            <div className="room-grid">
                <aside className="room-sidebar">
                <div className="step-label">YOUR ROOM CODE</div>
                {code ? (
                    <>
                    <div className="active-code">
                        {code.slice(0, 4)}
                        <br />
                        {code.slice(4)}
                    </div>
                    <Button
                        variant="outline"
                        className="full"
                        onClick={() => copy(code)}
                    >
                        <Copy size={16} /> Copy code
                    </Button>
                    </>
                ) : (
                    <p className="muted">
                    Room restored. Use your original code to connect another
                    device.
                    </p>
                )}
                <div className="room-facts">
                    <p>
                    <Clock size={17} /> {remaining} min remaining
                    </p>
                    <p>
                    <Radio size={17} /> {sync}
                    </p>
                    <p>
                    <ShieldCheck size={17} /> Access with your code
                    </p>
                </div>
                <div className="usage">
                    <span>{formatSize(room.bytes)} / 100 MB uploaded</span>
                    <div>
                    <i
                        style={{ width: `${Math.min(100, room.bytes / 1048576)}%` }}
                    />
                    </div>
                    <small>
                    Deleting items does not reset the upload allowance.
                    </small>
                </div>
                <p className="sidebar-tip">
                    Keep this code between you and the people you trust.
                </p>
                <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                    perform(async () => {
                        await api("action=leave", "POST");
                        setRoom(null);
                        setCode("");
                        setItems([]);
                        setTransfers([]);
                    })
                    }
                >
                    <ArrowLeft size={16} /> Leave room
                </Button>
                {room.owner && (
                    <AlertDialog>
                    <AlertDialogTrigger asChild>
                        <Button variant="ghost" className="danger" disabled={busy}>
                        <Trash2 size={16} /> Close & delete room
                        </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                        <AlertDialogTitle>Close this room?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Everyone will lose access and all text and files in this
                            room will be deleted. This cannot be undone.
                        </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                        <AlertDialogCancel>Keep room</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() =>
                            perform(async () => {
                                await api("action=close", "DELETE");
                                setRoom(null);
                                setCode("");
                                setItems([]);
                                setTransfers([]);
                                setNotice("Room closed and content deleted.");
                            })
                            }
                        >
                            Delete room
                        </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                    </AlertDialog>
                )}
                </aside>
                <section className="workspace">
                <Tabs defaultValue="files">
                    <div className="workspace-heading">
                    <h2>Add to your room</h2>
                    <TabsList>
                        <TabsTrigger value="files">
                        <File size={16} /> Files & folders
                        </TabsTrigger>
                        <TabsTrigger value="text">
                        <Code2 size={16} /> Text
                        </TabsTrigger>
                    </TabsList>
                    </div>
                    <TabsContent value="files">
                    <div
                        className="dropzone"
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                        e.preventDefault();
                        if (!busy) upload(e.dataTransfer.files);
                        }}
                    >
                        <span className="upload-icon">
                        <Upload size={26} />
                        </span>
                        <h3>Drop your files here</h3>
                        <p>Up to 20 MB per file · 100 MB per room</p>
                        <div className="upload-actions">
                        <Button
                            disabled={busy}
                            onClick={() => fileRef.current?.click()}
                        >
                            <Plus size={16} /> Choose files
                        </Button>
                        <Button
                            variant="outline"
                            disabled={busy}
                            onClick={() => folderRef.current?.click()}
                        >
                            <FolderUp size={16} /> Choose folder
                        </Button>
                        </div>
                        <small>Use “Choose folder” to preserve folder paths.</small>
                        <input
                        ref={fileRef}
                        type="file"
                        multiple
                        hidden
                        onChange={(e) => upload(e.target.files)}
                        />
                        <input
                        ref={folderRef}
                        type="file"
                        multiple
                        hidden
                        {...({ webkitdirectory: "" } as object)}
                        onChange={(e) => upload(e.target.files)}
                        />
                    </div>
                    </TabsContent>
                    <TabsContent value="text">
                    <form
                        className="note-editor"
                        onSubmit={(e) => {
                        e.preventDefault();
                        shareText();
                        }}
                    >
                        <label htmlFor="note">A note, a link, or a snippet.</label>
                        <textarea
                        id="note"
                        disabled={busy}
                        maxLength={5000}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="Paste or type something to share…"
                        />
                        <div>
                        <small>{note.length} / 5,000</small>
                        <Button disabled={busy || !note.trim()} type="submit">
                            <Send size={16} /> Share text
                        </Button>
                        </div>
                    </form>
                    </TabsContent>
                </Tabs>
                {transfers.length > 0 && (
                    <section
                    className="transfer-panel"
                    aria-label="Sharing progress"
                    >
                    <div className="transfer-heading">
                        <h3>Sharing progress</h3>
                        <span role="status" aria-live="polite">
                        {transfers.filter((t) => t.phase === "shared").length} of{" "}
                        {transfers.length} confirmed
                        </span>
                    </div>
                    <div className="transfer-list">
                        {transfers.map((t, index) => (
                        <div
                            className={`transfer-row transfer-${t.phase}`}
                            key={t.id}
                        >
                            <div className="transfer-title">
                            <strong>
                                {index + 1}. {t.name}
                            </strong>
                            <span>
                                {t.phase === "queued"
                                ? "Queued"
                                : t.phase === "uploading"
                                    ? t.percent === null
                                    ? "Sending…"
                                    : `${t.percent}% sent`
                                    : t.phase === "saving"
                                    ? "Saving…"
                                    : t.phase === "shared"
                                        ? "Shared successfully"
                                        : t.phase === "unconfirmed"
                                        ? "Not confirmed"
                                        : "Not shared"}
                            </span>
                            </div>
                            <Progress
                            className={
                                t.phase === "saving" ||
                                (t.phase === "uploading" && t.percent === null)
                                ? "transfer-indeterminate"
                                : ""
                            }
                            value={t.phase === "saving" ? null : t.percent}
                            aria-label={`Sharing ${t.name}`}
                            aria-valuetext={
                                t.phase === "saving"
                                ? "All bytes sent. Waiting for server confirmation."
                                : t.phase === "shared"
                                    ? "Shared successfully"
                                    : t.phase === "uploading"
                                    ? `${t.percent ?? 0}% sent`
                                    : t.phase
                            }
                            />
                            <p>
                            {t.message ||
                                (t.phase === "shared"
                                ? "Saved to this room and available to connected devices."
                                : t.phase === "saving"
                                    ? "Upload sent. Waiting for the server to confirm it is saved."
                                    : t.phase === "queued"
                                    ? "Waiting for the previous item."
                                    : `${formatSize(t.loaded)}${t.total ? ` of ${formatSize(t.total)}` : ""} sent`)}
                            </p>
                        </div>
                        ))}
                    </div>
                    </section>
                )}
                <div className="items-heading">
                    <h2>
                    Shared items <span>{items.length}</span>
                    </h2>
                    <span>Newest first · Positions update with the list</span>
                </div>
                {items.length === 0 ? (
                    <div className="empty-state">
                    <div className="empty-icon">
                        <File size={24} />
                    </div>
                    <h3>A clean slate.</h3>
                    <p>
                        Files and text shared by either device will appear here.
                    </p>
                    </div>
                ) : (
                    <div className="item-list">
                    {items.map((item, index) => (
                        <article key={item.id} className="item">
                        <span
                            className="item-number"
                            aria-label={`Item ${index + 1}`}
                        >
                            {index + 1}
                        </span>
                        <div className="item-icon">
                            {item.kind === "text" ? (
                            <Code2 size={20} />
                            ) : (
                            <File size={20} />
                            )}
                        </div>
                        <div className="item-content">
                            <h3>{item.name}</h3>
                            <div className="item-meta">
                            {formatSize(item.size)} ·{" "}
                            {new Date(item.created).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                            })}
                            </div>
                            {item.body && <pre>{item.body}</pre>}
                        </div>
                        <div className="item-actions">
                            {item.kind === "text" ? (
                            <Button
                                variant="ghost"
                                size="icon"
                                aria-label="Copy text"
                                onClick={() => copy(item.body || "")}
                            >
                                <Copy size={17} />
                            </Button>
                            ) : (
                            <a
                                className="download"
                                href={`/api/relay?action=download&id=${encodeURIComponent(item.id)}`}
                                aria-label={`Download ${item.name}`}
                            >
                                <ArrowDownToLine size={18} />
                            </a>
                            )}
                            <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Delete ${item.name}`}
                            disabled={busy}
                            onClick={() =>
                                perform(async () => {
                                await api(
                                    "id=" + encodeURIComponent(item.id),
                                    "DELETE",
                                );
                                await refresh();
                                })
                            }
                            >
                            <Trash2 size={16} />
                            </Button>
                        </div>
                        </article>
                    ))}
                    </div>
                )}
                </section>
            </div>
            )}
            <div className="principles">
            <div>
                <span className="principle-number">01</span>
                <span>
                <strong>Across your devices</strong>
                <small>A browser is all you need.</small>
                </span>
            </div>
            <div>
                <span className="principle-number">02</span>
                <span>
                <strong>Temporary by design</strong>
                <small>You choose when access expires.</small>
                </span>
            </div>
            <div>
                <span className="principle-number">03</span>
                <span>
                <strong>Open from the start</strong>
                <small>MIT-licensed source. Yours to build on.</small>
                </span>
            </div>
            </div>
        </main>
        <footer>
            <span>
            relay.{" "}
            <span className="footer-caption">A space between devices.</span>
            </span>
            <div>
            <button className="quiet" onClick={() => setHelp(!help)}>
                How it works
            </button>
            <a href="/relay-source.zip" download>
                <Code2 size={15} /> Download source <ArrowUpRight size={14} />
            </a>
            </div>
        </footer>
        </div>
    );
    }
