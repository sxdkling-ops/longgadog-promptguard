import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { Caption, Card, Chip, COLORS, enter, Hi, Label, Scene } from "../kit";

const CHECK = 60;

/** Webmail: body and subject are checked at Send, and attachments must be password-protected. Fictional names. */
export const Email: React.FC = () => {
  const frame = useCurrentFrame();
  const done = interpolate(frame, [CHECK, CHECK + 8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <Scene>
      <Caption top={130} size={88} style={enter(frame, 0)}>
        Email too. Checked when you press <Hi>Send</Hi>.
      </Caption>

      <Card style={{ position: "absolute", left: 70, right: 70, top: 600, ...enter(frame, 10, 100) }}>
        <Label>New message</Label>
        <div style={{ fontSize: 40, padding: "10px 0", borderBottom: `2px solid ${COLORS.line}` }}>
          <b>Subject:</b>{" "}
          <span style={{ position: "relative" }}>
            <span style={{ opacity: 1 - done }}>Loan of Maria Santos</span>
            <span style={{ position: "absolute", left: 0, top: 0, whiteSpace: "nowrap", opacity: done }}>
              Loan of <Chip>[PERSON_1]</Chip>
            </span>
          </span>
        </div>
        <div style={{ fontSize: 40, padding: "18px 0", position: "relative", minHeight: 130 }}>
          <div style={{ position: "absolute", opacity: 1 - done }}>Dear Maria Santos, your TIN 123-456-789-000 is on file.</div>
          <div style={{ position: "absolute", opacity: done }}>
            Dear <Chip>[PERSON_1]</Chip>, your TIN <Chip>[TIN_1]</Chip> is on file.
          </div>
        </div>
      </Card>

      <Card style={{ position: "absolute", left: 70, right: 70, top: 1130, ...enter(frame, 84, 100) }}>
        <Label>Attachments</Label>
        <div style={{ fontSize: 42, fontWeight: 700, color: "#991b1b" }}>statement.pdf &nbsp;→&nbsp; blocked, no password</div>
        <div style={{ fontSize: 42, fontWeight: 700, color: "#166534", marginTop: 12 }}>statement-locked.pdf &nbsp;→&nbsp; allowed</div>
      </Card>

      <Caption top={1500} size={60} style={enter(frame, 104)}>
        Attachments need a <Hi>password</Hi> or they don&apos;t go.
      </Caption>
    </Scene>
  );
};
