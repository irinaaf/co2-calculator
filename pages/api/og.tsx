import { ImageResponse } from "next/og";

export const config = { runtime: "edge" };

export default function handler() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "hsl(34,20%,96%)",
          padding: "72px 80px",
          justifyContent: "space-between",
        }}
      >
        {/* Top: leaf badge + title */}
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
            }}
          >
            {/* Leaf circle */}
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: "50%",
                background: "hsl(150,30%,35%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M11 20A7 7 0 0 1 9.8 6.1C15.25 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z" />
                <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
              </svg>
            </div>
            <span
              style={{
                fontSize: 18,
                color: "hsl(150,30%,35%)",
                fontWeight: 600,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              CSRD Scope 3 · Norway
            </span>
          </div>

          <div
            style={{
              fontSize: 64,
              fontWeight: 700,
              color: "hsl(220,14%,12%)",
              lineHeight: 1.1,
              letterSpacing: "-0.02em",
            }}
          >
            CO₂ Route
            <br />
            Calculator
          </div>

          <div
            style={{
              fontSize: 26,
              color: "hsl(220,8%,44%)",
              lineHeight: 1.4,
              maxWidth: 680,
            }}
          >
            Compare emissions across all transport modes — real Entur timetables, operator-specific factors, CSRD export.
          </div>
        </div>

        {/* Bottom: mode pills */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", gap: "10px" }}>
            {[
              { emoji: "🚆", label: "Train" },
              { emoji: "🚌", label: "Bus" },
              { emoji: "⛴️", label: "Ferry" },
              { emoji: "⚡", label: "EV" },
              { emoji: "✈️", label: "Flight" },
              { emoji: "🚲", label: "Bicycle" },
            ].map(({ emoji, label }) => (
              <div
                key={label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  background: "white",
                  border: "1px solid hsl(220,8%,88%)",
                  borderRadius: 999,
                  padding: "8px 16px",
                  fontSize: 17,
                  color: "hsl(220,14%,25%)",
                }}
              >
                <span>{emoji}</span>
                <span>{label}</span>
              </div>
            ))}
          </div>
          <div
            style={{
              fontSize: 17,
              color: "hsl(220,8%,55%)",
            }}
          >
            co2-calculator.afanasev.no
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
