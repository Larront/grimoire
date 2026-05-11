import { render } from "@testing-library/svelte";
import { describe, it, expect } from "vitest";
import ScenesDashboard from "../lib/components/panes/ScenesDashboard.svelte";

describe("ScenesDashboard", () => {
  it("renders the scenes dashboard shell", () => {
    const { container } = render(ScenesDashboard);
    expect(container.querySelector("[data-scenes-dashboard]")).toBeTruthy();
  });

  it("shows a heading for All Scenes", () => {
    const { getByText } = render(ScenesDashboard);
    expect(getByText("All Scenes")).toBeTruthy();
  });
});
