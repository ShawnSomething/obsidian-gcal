import { useState, useRef, useEffect } from "react";
import { useCalendar } from "../context/CalendarContext";

export default function CalendarToggle() {
    const { state, dispatch } = useCalendar();
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    // Close dropdown when clicking outside
    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                setOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // Group calendars by accountId
    const grouped = state.calendars.reduce<Record<string, typeof state.calendars>>(
        (acc, cal) => {
            if (!acc[cal.accountId]) acc[cal.accountId] = [];
            acc[cal.accountId]!.push(cal);
            return acc;
        },
        {}
    );

    return (
        <div ref={ref} style={{ position: "relative" }}>
            <button
                onClick={() => setOpen((prev) => !prev)}
                style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: "4px 6px",
                    borderRadius: "4px",
                    color: "var(--text-muted)",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                }}
                title="Toggle calendars"
            >
                {/* Stacked coloured dots preview */}
                {state.calendars.slice(0, 3).map((cal) => (
                    <span
                        key={cal.id}
                        style={{
                            width: "8px",
                            height: "8px",
                            borderRadius: "50%",
                            backgroundColor: cal.visible ? cal.backgroundColor : "transparent",
                            border: `2px solid ${cal.backgroundColor}`,
                            display: "inline-block",
                        }}
                    />
                ))}
            </button>

            {open && (
                <div
                    style={{
                        position: "absolute",
                        top: "calc(100% + 4px)",
                        right: 0,
                        background: "var(--background-primary)",
                        border: "1px solid var(--background-modifier-border)",
                        borderRadius: "8px",
                        boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
                        minWidth: "220px",
                        zIndex: 1000,
                        padding: "8px 0",
                    }}
                >
                    {Object.entries(grouped).map(([accountId, calendars], i) => (
                        <div key={accountId}>
                            {i > 0 && (
                                <div style={{
                                    height: "1px",
                                    background: "var(--background-modifier-border)",
                                    margin: "8px 0",
                                }} />
                            )}
                            <div style={{
                                padding: "2px 12px 6px",
                                fontSize: "11px",
                                color: "var(--text-muted)",
                            }}>
                                {accountId}
                            </div>
                            {calendars.map((cal) => (
                                <div
                                    key={cal.id}
                                    onClick={() => dispatch({ type: "TOGGLE_CALENDAR", payload: cal.id })}
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "10px",
                                        padding: "5px 12px",
                                        cursor: "pointer",
                                        color: "var(--text-normal)",
                                        fontSize: "13px",
                                    }}
                                    onMouseEnter={(e) =>
                                        (e.currentTarget.style.background = "var(--background-secondary)")
                                    }
                                    onMouseLeave={(e) =>
                                        (e.currentTarget.style.background = "transparent")
                                    }
                                >
                                    <span style={{
                                        width: "12px",
                                        height: "12px",
                                        borderRadius: "50%",
                                        flexShrink: 0,
                                        backgroundColor: cal.visible ? cal.backgroundColor : "transparent",
                                        border: `2px solid ${cal.backgroundColor}`,
                                    }} />
                                    <span style={{
                                        color: cal.visible ? "var(--text-normal)" : "var(--text-muted)",
                                    }}>
                                        {cal.summary}
                                    </span>
                                </div>
                            ))}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}