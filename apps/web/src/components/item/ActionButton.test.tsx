// Item actions show their disabled reason as visible text (not only a
// tooltip), per ITERATIONS.md §4.2 J1.3/J1.7 and EXHIBIT §9. Replaces the
// pre-UX1 ItemDetail.test.tsx now that ActionButton is its own module.

import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ActionButton } from "./ActionButton.js";

afterEach(cleanup);

describe("ActionButton", () => {
  test("disabled: shows the reason as visible helper text and disables the button", () => {
    render(<ActionButton label="Start" testId="action-start" allowed={{ allowed: false, reason: "This item is already running." }} pending={false} onClick={vi.fn()} />);
    const button = screen.getByTestId("action-start");
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("This item is already running.")).toBeTruthy();
  });

  test("allowed: enabled, no helper text, click fires the handler", () => {
    const onClick = vi.fn();
    render(<ActionButton label="Start" testId="action-start" allowed={{ allowed: true, reason: null }} pending={false} onClick={onClick} />);
    const button = screen.getByTestId("action-start");
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test("pending: disabled even though allowed", () => {
    render(<ActionButton label="Start" testId="action-start" allowed={{ allowed: true, reason: null }} pending onClick={vi.fn()} />);
    expect((screen.getByTestId("action-start") as HTMLButtonElement).disabled).toBe(true);
  });

  test("the button's accessible name equals its visible label", () => {
    render(<ActionButton label="Resume" testId="action-resume" allowed={{ allowed: true, reason: null }} pending={false} onClick={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
  });
});
