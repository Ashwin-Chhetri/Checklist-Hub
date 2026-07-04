import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "#E8E8E8",
        }}
      >
        <div style={{ display: "flex", width: 64, height: 6, background: "#a41f24", marginBottom: 32 }} />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            fontSize: 64,
            fontWeight: 800,
            textTransform: "uppercase",
            color: "#1a1a1a",
            lineHeight: 1.15,
            letterSpacing: -2,
          }}
        >
          <div style={{ display: "flex" }}>Checklist for any region,</div>
          <div style={{ display: "flex" }}>
            any <span style={{ color: "#a41f24", marginLeft: 20 }}>taxa</span> made easy
          </div>
        </div>
        <div style={{ display: "flex", fontSize: 28, color: "#555", marginTop: 32, maxWidth: 900 }}>
          Evidence-based species checklists — import, validate, review, and publish to GBIF.
        </div>
      </div>
    ),
    { ...size }
  );
}
